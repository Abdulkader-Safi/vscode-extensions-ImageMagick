import * as path from "node:path";
import * as vscode from "vscode";
import { getOutputChannel } from "./extension";
import type {
  HostToWebviewMessage,
  ImageFormat,
  WebviewToHostMessage,
} from "./messages";

const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  jpg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  tiff: "tiff",
  bmp: "bmp",
};

const FORMAT_FILTER_LABELS: Record<ImageFormat, string> = {
  jpg: "JPEG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
  gif: "GIF",
  tiff: "TIFF",
  bmp: "BMP",
};

/**
 * Hosts the image-editor webview. The actual image work (decode, transform,
 * encode) runs inside the webview on the ImageMagick WASM build — this class is
 * a thin broker that reads source bytes off disk, hands them to the webview,
 * runs the save dialogs, and writes back the encoded bytes the webview returns.
 */
export class ImageEditorPanel {
  private static readonly viewType = "imagemagickEditor";
  private static panels: ImageEditorPanel[] = [];

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private webviewReady = false;
  private pendingUris: vscode.Uri[] = [];
  /** Full set of files in this panel; non-empty only in bulk mode. */
  private bulkUris: vscode.Uri[] = [];
  /** Index of the currently-loaded image in `bulkUris` (or 0 in single mode). */
  private activeIndex = 0;
  /** Resolvers for in-flight `bulkEncode` round-trips, keyed by file index. */
  private pendingBulkEncode = new Map<number, (out: Uint8Array) => void>();

  static createOrShow(
    extensionUri: vscode.Uri,
    uris: vscode.Uri[],
  ): ImageEditorPanel {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    const title =
      uris.length > 1
        ? `ImageMagick (${uris.length} files)`
        : uris[0]
          ? path.basename(uris[0].fsPath)
          : "ImageMagick";
    const panel = vscode.window.createWebviewPanel(
      ImageEditorPanel.viewType,
      title,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
        retainContextWhenHidden: true,
      },
    );

    return new ImageEditorPanel(panel, extensionUri, uris);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    uris: vscode.Uri[],
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.pendingUris = uris;
    this.bulkUris = uris.length > 1 ? uris.slice() : [];
    this.activeIndex = 0;
    ImageEditorPanel.panels.push(this);

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => {
        this.handleMessage(msg).catch((err: unknown) => {
          this.logException(err, "handleMessage");
          this.postError(this.errorMessage(err, "Unexpected error"));
        });
      },
      null,
      this.disposables,
    );
  }

  dispose(): void {
    ImageEditorPanel.panels = ImageEditorPanel.panels.filter((p) => p !== this);
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.webviewReady = true;
        if (this.bulkUris.length > 0) {
          this.post({
            type: "bulkInfo",
            data: {
              files: this.bulkUris.map((u) => ({
                name: path.basename(u.fsPath),
                path: u.fsPath,
              })),
              activeIndex: 0,
            },
          });
        }
        if (this.pendingUris[0]) {
          await this.sendFileBytes(this.pendingUris[0], 0);
        }
        this.pendingUris = [];
        return;
      case "selectBulkFile":
        await this.handleSelectBulkFile(msg.data.index);
        return;
      case "saveBytes":
        await this.handleSave(msg);
        return;
      case "requestBulkSave":
        await this.handleBulkSave();
        return;
      case "bulkEncoded": {
        const resolve = this.pendingBulkEncode.get(msg.data.index);
        if (resolve) {
          this.pendingBulkEncode.delete(msg.data.index);
          resolve(msg.data.outBytes);
        }
        return;
      }
    }
  }

  private async sendFileBytes(
    uri: vscode.Uri,
    activeIndex: number,
  ): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.activeIndex = activeIndex;
      this.post({
        type: "fileBytes",
        data: {
          name: path.basename(uri.fsPath),
          path: uri.fsPath,
          bytes,
          activeIndex,
        },
      });
    } catch (err) {
      this.logException(err, `readFile ${uri.fsPath}`);
      this.postError(this.errorMessage(err, `Could not open ${uri.fsPath}`));
    }
  }

  private async handleSelectBulkFile(index: number): Promise<void> {
    if (index < 0 || index >= this.bulkUris.length) {
      return;
    }
    await this.sendFileBytes(this.bulkUris[index], index);
  }

  private async handleSave(
    msg: Extract<WebviewToHostMessage, { type: "saveBytes" }>,
  ): Promise<void> {
    const log = getOutputChannel();
    const ext = FORMAT_EXTENSIONS[msg.data.format];
    const baseName = stripExtension(msg.data.name) + ".optimized." + ext;
    const defaultDir = msg.data.path
      ? vscode.Uri.file(path.dirname(msg.data.path))
      : (vscode.workspace.workspaceFolders?.[0]?.uri ??
        vscode.Uri.file(process.cwd()));
    const defaultUri = vscode.Uri.joinPath(defaultDir, baseName);

    log.appendLine(
      `save: showing dialog (default=${defaultUri.fsPath}, format=${msg.data.format})`,
    );
    this.postSaveStatus("Choose where to save…");

    let dest: vscode.Uri | undefined;
    try {
      dest = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { [FORMAT_FILTER_LABELS[msg.data.format]]: [ext] },
      });
    } catch (err) {
      this.logException(err, "save: showSaveDialog");
      this.postError(this.errorMessage(err, "Could not show the save dialog"));
      return;
    }

    if (!dest) {
      log.appendLine("save: dialog dismissed");
      this.post({ type: "saveCanceled" });
      return;
    }

    log.appendLine(`save: writing to ${dest.fsPath}`);
    try {
      await vscode.workspace.fs.writeFile(dest, msg.data.bytes);
      const sizeKb = Math.round(msg.data.bytes.byteLength / 1024);
      log.appendLine(`save: done (${sizeKb} KB)`);
      this.post({ type: "saveDone", data: { path: dest.fsPath, sizeKb } });
      vscode.window.showInformationMessage(
        `Saved ${path.basename(dest.fsPath)} (${sizeKb} KB)`,
      );
    } catch (err) {
      this.logException(err, "save: write");
      this.postError(this.errorMessage(err, "Failed to save image"));
    }
  }

  private async handleBulkSave(): Promise<void> {
    const log = getOutputChannel();
    if (this.bulkUris.length === 0) {
      this.postError("No bulk file list.");
      return;
    }

    this.postSaveStatus("Choose an output folder…");
    let folder: vscode.Uri | undefined;
    try {
      const picks = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(path.dirname(this.bulkUris[0].fsPath)),
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Save All Here",
      });
      folder = picks?.[0];
    } catch (err) {
      this.logException(err, "bulkSave: showOpenDialog");
      this.postError(
        this.errorMessage(err, "Could not show the folder dialog"),
      );
      return;
    }

    if (!folder) {
      log.appendLine("bulkSave: dialog dismissed");
      this.post({ type: "saveCanceled" });
      return;
    }

    log.appendLine(
      `bulkSave: writing ${this.bulkUris.length} file(s) to ${folder.fsPath}`,
    );

    let saved = 0;
    let failed = 0;
    for (let i = 0; i < this.bulkUris.length; i++) {
      const uri = this.bulkUris[i];
      const name = path.basename(uri.fsPath);
      this.post({
        type: "bulkSaveProgress",
        data: { current: i + 1, total: this.bulkUris.length, name },
      });
      try {
        const sourceBytes = await vscode.workspace.fs.readFile(uri);
        const outBytes = await this.requestBulkEncode(i, name, sourceBytes);
        // The webview applied a uniform format across the run; sniff the output
        // bytes for the right extension so converted images land named correctly.
        const finalPath = withOptimizedSuffix(
          path.join(folder.fsPath, name),
          outBytes,
        );
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(finalPath),
          outBytes,
        );
        saved++;
      } catch (err) {
        failed++;
        this.logException(err, `bulkSave: ${uri.fsPath}`);
      }
    }

    this.post({
      type: "bulkSaveDone",
      data: { saved, failed, dir: folder.fsPath },
    });
    if (failed === 0) {
      vscode.window.showInformationMessage(
        `Saved ${saved} image${saved === 1 ? "" : "s"} to ${folder.fsPath}`,
      );
    } else {
      vscode.window.showWarningMessage(
        `Saved ${saved}, ${failed} failed. See ImageMagick output for details.`,
      );
    }
  }

  /**
   * Ships one source's bytes to the webview for encoding and resolves with the
   * encoded output. Times out defensively so a dropped reply can't wedge the
   * whole bulk loop.
   */
  private requestBulkEncode(
    index: number,
    name: string,
    bytes: Uint8Array,
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBulkEncode.delete(index);
        reject(new Error(`Timed out encoding ${name}`));
      }, 120_000);
      this.pendingBulkEncode.set(index, (out) => {
        clearTimeout(timer);
        resolve(out);
      });
      this.post({ type: "bulkEncode", data: { index, name, bytes } });
    });
  }

  private postSaveStatus(message: string): void {
    this.post({ type: "saveStatus", data: { message } });
  }

  private post(msg: HostToWebviewMessage): void {
    if (this.webviewReady) {
      this.panel.webview.postMessage(msg);
    }
  }

  private postError(message: string): void {
    if (this.webviewReady) {
      this.panel.webview.postMessage({
        type: "error",
        data: { message },
      } satisfies HostToWebviewMessage);
    }
    vscode.window.showErrorMessage(`ImageMagick: ${message}`);
  }

  /**
   * Logs the full exception (message + stack + chained cause) to the
   * "ImageMagick" Output channel so users can copy a complete diagnostic when
   * reporting bugs.
   */
  private logException(err: unknown, context: string): void {
    const log = getOutputChannel();
    log.appendLine(`---`);
    log.appendLine(`${context} (${new Date().toISOString()})`);
    if (err instanceof Error) {
      log.appendLine(`message: ${err.message}`);
      if (err.stack) {
        log.appendLine(err.stack);
      }
      const cause = (err as Error & { cause?: unknown }).cause;
      if (cause instanceof Error) {
        log.appendLine(`caused by: ${cause.message}`);
        if (cause.stack) {
          log.appendLine(cause.stack);
        }
      } else if (cause !== undefined) {
        log.appendLine(`caused by: ${String(cause)}`);
      }
    } else {
      log.appendLine(`error: ${String(err)}`);
    }
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      return err.message || fallback;
    }
    if (typeof err === "string") {
      return err;
    }
    return fallback;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"),
    );
    // The ImageMagick wasm module, copied into dist/ at build time. The engine
    // JS itself is bundled into webview.js; only the wasm is fetched at runtime
    // via this resource URI (window.__MAGICK__).
    const magickWasmUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "magick.wasm"),
    );
    const nonce = makeNonce();
    const magickUris = JSON.stringify({ wasm: magickWasmUri.toString() });

    // CSP additions vs. a plain webview:
    //  - script-src 'wasm-unsafe-eval' → allow WebAssembly.instantiate
    //  - connect-src ${cspSource}      → allow fetch() of the .wasm bytes
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>ImageMagick</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__MAGICK__ = ${magickUris};</script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Builds the `<stem>.optimized.<ext>` output path. The target extension is
 * sniffed from the encoded bytes' magic number, since the host never decodes
 * the image and so doesn't otherwise know the chosen format.
 */
function withOptimizedSuffix(destPath: string, bytes: Uint8Array): string {
  const dir = path.dirname(destPath);
  const stem = stripExtension(path.basename(destPath));
  const ext = sniffExtension(bytes);
  return path.join(dir, `${stem}.optimized.${ext}`);
}

/** Minimal magic-number sniff for the formats this extension can output. */
function sniffExtension(b: Uint8Array): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "jpg";
  }
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) {
    return "png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "webp";
  }
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return "gif";
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return "bmp";
  }
  if (
    b.length >= 2 &&
    ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))
  ) {
    return "tiff";
  }
  if (
    b.length >= 12 &&
    b[4] === 0x66 &&
    b[5] === 0x74 &&
    b[6] === 0x79 &&
    b[7] === 0x70
  ) {
    return "avif";
  }
  return "img";
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
