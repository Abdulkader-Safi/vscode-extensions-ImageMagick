import * as path from "node:path";
import * as vscode from "vscode";
import { ImageService, getWritableFormats } from "./imageService";
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

export class ImageEditorPanel {
  private static readonly viewType = "imagemagickEditor";
  private static panels: ImageEditorPanel[] = [];

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly service = new ImageService();
  private disposables: vscode.Disposable[] = [];
  private webviewReady = false;
  private pendingUris: vscode.Uri[] = [];
  /** Full set of files in this panel; non-empty only in bulk mode. */
  private bulkUris: vscode.Uri[] = [];
  /** Index of the currently-loaded image in `bulkUris` (or 0 in single mode). */
  private activeIndex = 0;

  static createOrShow(
    extensionUri: vscode.Uri,
    uris: vscode.Uri[],
  ): ImageEditorPanel {
    // For now each invocation opens a fresh panel; image-edit sessions are
    // independent. A later iteration could reuse an existing panel for the
    // same path.
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
        this.post({
          type: "formatsAvailable",
          data: { formats: Array.from(await getWritableFormats()) },
        });
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
          await this.loadFromUri(this.pendingUris[0]);
        }
        this.pendingUris = [];
        return;
      case "dropFile": {
        const bytes = Uint8Array.from(msg.data.bytes);
        // Drag-dropped files break out of bulk mode; the panel becomes a
        // single-image editor for that buffer.
        this.bulkUris = [];
        this.activeIndex = 0;
        await this.loadFromBuffer(bytes, msg.data.name);
        return;
      }
      case "selectBulkFile": {
        await this.handleSelectBulkFile(msg.data.index);
        return;
      }
      case "requestPreview":
        try {
          const result = await this.service.renderPreview(msg.data);
          this.post({ type: "previewUpdated", data: result });
        } catch (err) {
          this.logException(err, "renderPreview");
          this.postError(this.errorMessage(err, "Failed to render preview"));
        }
        return;
      case "requestSave":
        await this.handleSave(msg);
        return;
      case "requestBulkSave":
        await this.handleBulkSave(msg);
        return;
    }
  }

  private async handleSelectBulkFile(index: number): Promise<void> {
    if (index < 0 || index >= this.bulkUris.length) {
      return;
    }
    const uri = this.bulkUris[index];
    try {
      const info = await this.service.loadFromPath(
        uri.fsPath,
        path.basename(uri.fsPath),
      );
      this.activeIndex = index;
      this.post({
        type: "bulkActiveChanged",
        data: { ...info, activeIndex: index },
      });
    } catch (err) {
      this.logException(err, `selectBulkFile ${uri.fsPath}`);
      this.postError(this.errorMessage(err, `Could not open ${uri.fsPath}`));
    }
  }

  private async loadFromUri(uri: vscode.Uri): Promise<void> {
    try {
      const info = await this.service.loadFromPath(
        uri.fsPath,
        path.basename(uri.fsPath),
      );
      const initial = await this.service.renderPreview(
        await this.defaultStateFor(info.format),
      );
      this.post({
        type: "imageLoaded",
        data: { ...info, previewDataUrl: initial.previewDataUrl },
      });
    } catch (err) {
      this.logException(err, `loadFromUri ${uri.fsPath}`);
      this.postError(this.errorMessage(err, `Could not open ${uri.fsPath}`));
    }
  }

  private async loadFromBuffer(bytes: Uint8Array, name: string): Promise<void> {
    try {
      const info = await this.service.loadFromBuffer(bytes, name);
      const initial = await this.service.renderPreview(
        await this.defaultStateFor(info.format),
      );
      this.post({
        type: "imageLoaded",
        data: { ...info, previewDataUrl: initial.previewDataUrl },
      });
    } catch (err) {
      this.logException(err, `loadFromBuffer ${name}`);
      this.postError(this.errorMessage(err, `Could not open ${name}`));
    }
  }

  private async handleSave(
    msg: Extract<WebviewToHostMessage, { type: "requestSave" }>,
  ): Promise<void> {
    const log = getOutputChannel();
    const source = this.service.getSourceInfo();
    if (!source) {
      log.appendLine("save: no image loaded");
      this.postError("No image loaded yet.");
      return;
    }

    const ext = FORMAT_EXTENSIONS[msg.data.format];
    const baseName = stripExtension(source.name) + ".optimized." + ext;
    const defaultDir = source.path
      ? vscode.Uri.file(path.dirname(source.path))
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
    this.postSaveStatus(`Encoding ${msg.data.format.toUpperCase()}…`);

    try {
      const result = await this.service.save(msg.data, dest.fsPath);
      log.appendLine(`save: done (${result.sizeKb} KB)`);
      this.post({ type: "saveDone", data: result });
      vscode.window.showInformationMessage(
        `Saved ${path.basename(result.path)} (${result.sizeKb} KB)`,
      );
    } catch (err) {
      this.logException(err, "save: write");
      this.postError(this.errorMessage(err, "Failed to save image"));
    }
  }

  private async handleBulkSave(
    msg: Extract<WebviewToHostMessage, { type: "requestBulkSave" }>,
  ): Promise<void> {
    const log = getOutputChannel();
    if (this.bulkUris.length === 0) {
      this.postError("No bulk file list.");
      return;
    }

    const ext = FORMAT_EXTENSIONS[msg.data.format];
    const defaultDir =
      vscode.Uri.file(path.dirname(this.bulkUris[0].fsPath));

    this.postSaveStatus("Choose an output folder…");
    let folder: vscode.Uri | undefined;
    try {
      const picks = await vscode.window.showOpenDialog({
        defaultUri: defaultDir,
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
        await this.service.loadFromPath(uri.fsPath, name);
        const destPath = path.join(
          folder.fsPath,
          stripExtension(name) + ".optimized." + ext,
        );
        await this.service.save(msg.data, destPath);
        saved++;
      } catch (err) {
        failed++;
        this.logException(err, `bulkSave: ${uri.fsPath}`);
      }
    }

    // Restore the active image so the panel keeps working after the bulk run.
    try {
      const active = this.bulkUris[this.activeIndex];
      if (active) {
        await this.service.loadFromPath(
          active.fsPath,
          path.basename(active.fsPath),
        );
      }
    } catch (err) {
      this.logException(err, "bulkSave: restore active");
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

  private postSaveStatus(message: string): void {
    this.post({ type: "saveStatus", data: { message } });
  }

  private async defaultStateFor(
    sourceFormat: string,
  ): Promise<import("./messages").EditorState> {
    const fmt = sourceFormat.toLowerCase();
    const guessed: ImageFormat =
      fmt === "jpeg" || fmt === "jpg"
        ? "jpg"
        : fmt === "png"
          ? "png"
          : fmt === "webp"
            ? "webp"
            : fmt === "avif"
              ? "avif"
              : fmt === "gif"
                ? "gif"
                : fmt === "tiff" || fmt === "tif"
                  ? "tiff"
                  : fmt === "bmp"
                    ? "bmp"
                    : "png";
    const writable = await getWritableFormats();
    const initial: ImageFormat = writable.has(guessed) ? guessed : "png";
    return {
      crop: null,
      rotate: 0,
      flipH: false,
      flipV: false,
      resize: null,
      format: initial,
      quality: 85,
    };
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
   * "ImageMagick" Output channel so users can copy a complete diagnostic
   * when reporting bugs. The toast and webview banner only show the
   * top-level message because long stacks are useless there.
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
    const nonce = makeNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>ImageMagick</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
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
