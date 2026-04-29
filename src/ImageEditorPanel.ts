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
  private pendingSourceUri: vscode.Uri | null = null;

  static createOrShow(
    extensionUri: vscode.Uri,
    sourceUri: vscode.Uri | null,
  ): ImageEditorPanel {
    // For now each invocation opens a fresh panel; image-edit sessions are
    // independent. A later iteration could reuse an existing panel for the
    // same path.
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    const title = sourceUri ? path.basename(sourceUri.fsPath) : "ImageMagick";
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

    return new ImageEditorPanel(panel, extensionUri, sourceUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sourceUri: vscode.Uri | null,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.pendingSourceUri = sourceUri;
    ImageEditorPanel.panels.push(this);

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => {
        this.handleMessage(msg).catch((err: unknown) => {
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
        if (this.pendingSourceUri) {
          await this.loadFromUri(this.pendingSourceUri);
          this.pendingSourceUri = null;
        }
        return;
      case "dropFile": {
        const bytes = Uint8Array.from(msg.data.bytes);
        await this.loadFromBuffer(bytes, msg.data.name);
        return;
      }
      case "requestPreview":
        try {
          const result = await this.service.renderPreview(msg.data);
          this.post({ type: "previewUpdated", data: result });
        } catch (err) {
          this.postError(this.errorMessage(err, "Failed to render preview"));
        }
        return;
      case "requestSave":
        await this.handleSave(msg);
        return;
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
      log.appendLine(`save: showSaveDialog threw — ${String(err)}`);
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
      log.appendLine(`save: failed — ${String(err)}`);
      this.postError(this.errorMessage(err, "Failed to save image"));
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
