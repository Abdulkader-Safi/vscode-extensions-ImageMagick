import * as path from "node:path";
import * as vscode from "vscode";
import { getOutputChannel } from "./extension";
import type {
  HostToWebviewMessage,
  ImageFormat,
  InboundMeta,
  OutboundMeta,
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

// Raw bytes per inbound chunk. ~64 KB base64 per message — small enough that
// VS Code's webview transport never drops or truncates it.
const CHUNK = 48 * 1024;

/**
 * Hosts the image-editor webview. The actual image work (decode, transform,
 * encode) runs inside the webview on the ImageMagick WASM build — this class is
 * a thin broker that reads source bytes off disk, streams them to the webview,
 * runs the save dialogs, and writes back the encoded bytes the webview returns.
 *
 * Bytes move in both directions as a sequence of small base64 chunks rather
 * than one message: VS Code's webview transport drops oversized message fields
 * and forbids fetch() of arbitrary on-disk files, so streaming is the portable
 * way to move image data.
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
  /** Monotonic id for inbound (host → webview) byte streams. */
  private streamSeq = 0;
  /** Reassembly state for outbound (webview → host) byte streams, keyed by id. */
  private outbound = new Map<
    number,
    { meta: OutboundMeta; total: number; parts: Buffer[] }
  >();
  /** Resolvers for in-flight bulk encodes, keyed by file index. */
  private pendingBulkEncode = new Map<number, (out: Buffer) => void>();

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
          await this.sendSource(this.pendingUris[0], 0);
        }
        this.pendingUris = [];
        return;
      case "openUri":
        await this.handleOpenUri(msg.data.uri);
        return;
      case "savePreset":
        await this.handleSavePreset(msg.data);
        return;
      case "selectBulkFile":
        await this.handleSelectBulkFile(msg.data.index);
        return;
      case "requestBulkSave":
        await this.handleBulkSave();
        return;
      case "outBegin":
        this.outbound.set(msg.data.id, {
          meta: msg.data.meta,
          total: msg.data.total,
          parts: [],
        });
        return;
      case "outChunk": {
        const entry = this.outbound.get(msg.data.id);
        if (!entry) {
          return;
        }
        entry.parts.push(Buffer.from(msg.data.b64, "base64"));
        if (entry.parts.length < entry.total) {
          return;
        }
        this.outbound.delete(msg.data.id);
        await this.onOutboundComplete(entry.meta, Buffer.concat(entry.parts));
        return;
      }
    }
  }

  /** Reads a source image off disk and streams it to the webview to open. */
  private async sendSource(
    uri: vscode.Uri,
    activeIndex: number,
  ): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.activeIndex = activeIndex;
      getOutputChannel().appendLine(
        `load: streaming ${path.basename(uri.fsPath)} (${bytes.length} bytes) to webview`,
      );
      this.streamInbound(
        {
          kind: "load",
          name: path.basename(uri.fsPath),
          path: uri.fsPath,
          activeIndex,
        },
        bytes,
      );
    } catch (err) {
      this.logException(err, `readFile ${uri.fsPath}`);
      this.postError(this.errorMessage(err, `Could not open ${uri.fsPath}`));
    }
  }

  /**
   * Loads a file dropped from the Explorer. A drop replaces the session with
   * this single image, so any prior bulk list is cleared first.
   */
  private async handleOpenUri(uriString: string): Promise<void> {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(uriString, true);
    } catch (err) {
      this.logException(err, `openUri parse ${uriString}`);
      this.postError(this.errorMessage(err, "Could not open the dropped item"));
      return;
    }
    this.bulkUris = [];
    this.post({ type: "bulkInfo", data: { files: [], activeIndex: 0 } });
    await this.sendSource(uri, 0);
  }

  private async handleSavePreset(data: {
    format: ImageFormat;
    quality: number;
    maxLongEdge: number | null;
  }): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Name this preset",
      value: `${data.format.toUpperCase()} q${data.quality}`,
      validateInput: (v) => (v.trim() === "" ? "Enter a name" : undefined),
    });
    if (!name) {
      return;
    }
    const config = vscode.workspace.getConfiguration("imagemagick");
    const existing = config.get<unknown[]>("presets") ?? [];
    const next = [
      ...existing,
      {
        name: name.trim(),
        format: data.format,
        quality: data.quality,
        maxLongEdge: data.maxLongEdge,
        stripMetadata: false,
        output: "suffix",
        suffix: ".optimized",
      },
    ];
    await config.update("presets", next, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Saved preset "${name.trim()}".`);
  }

  private async handleSelectBulkFile(index: number): Promise<void> {
    if (index < 0 || index >= this.bulkUris.length) {
      return;
    }
    await this.sendSource(this.bulkUris[index], index);
  }

  private async onOutboundComplete(
    meta: OutboundMeta,
    bytes: Buffer,
  ): Promise<void> {
    if (meta.kind === "save") {
      await this.handleSaveComplete(meta, bytes);
      return;
    }
    // meta.kind === "bulk": hand the encoded bytes to the waiting bulk loop.
    const resolve = this.pendingBulkEncode.get(meta.index);
    if (resolve) {
      this.pendingBulkEncode.delete(meta.index);
      resolve(bytes);
    }
  }

  private async handleSaveComplete(
    meta: Extract<OutboundMeta, { kind: "save" }>,
    bytes: Buffer,
  ): Promise<void> {
    const log = getOutputChannel();
    const ext = FORMAT_EXTENSIONS[meta.format];
    const baseName = stripExtension(meta.name) + ".optimized." + ext;
    const defaultDir = meta.path
      ? vscode.Uri.file(path.dirname(meta.path))
      : (vscode.workspace.workspaceFolders?.[0]?.uri ??
        vscode.Uri.file(process.cwd()));
    const defaultUri = vscode.Uri.joinPath(defaultDir, baseName);

    log.appendLine(
      `save: showing dialog (default=${defaultUri.fsPath}, format=${meta.format})`,
    );
    this.postSaveStatus("Choose where to save…");

    let dest: vscode.Uri | undefined;
    try {
      dest = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { [FORMAT_FILTER_LABELS[meta.format]]: [ext] },
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
      await vscode.workspace.fs.writeFile(dest, bytes);
      const sizeKb = Math.round(bytes.byteLength / 1024);
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
        const outBytes = await this.encodeViaWebview(i, name, sourceBytes);
        if (outBytes.byteLength === 0) {
          throw new Error("webview returned no output");
        }
        // Sniff the output's magic number for the right extension so converted
        // images land named correctly, even though the host never decoded them.
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
   * Streams one source image to the webview for encoding and resolves with the
   * encoded output. Times out defensively so a dropped reply can't wedge the
   * whole bulk loop.
   */
  private encodeViaWebview(
    index: number,
    name: string,
    bytes: Uint8Array,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBulkEncode.delete(index);
        reject(new Error(`Timed out encoding ${name}`));
      }, 120_000);
      this.pendingBulkEncode.set(index, (out) => {
        clearTimeout(timer);
        resolve(out);
      });
      this.streamInbound({ kind: "bulk", index, name }, bytes);
    });
  }

  /** Sends `bytes` to the webview as an inbound base64 chunk sequence. */
  private streamInbound(meta: InboundMeta, bytes: Uint8Array): void {
    const id = ++this.streamSeq;
    const total = Math.max(1, Math.ceil(bytes.length / CHUNK));
    this.post({ type: "inBegin", data: { id, total, meta } });
    for (let i = 0; i < total; i++) {
      const slice = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      this.post({
        type: "inChunk",
        data: { id, b64: Buffer.from(slice).toString("base64") },
      });
    }
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
