import * as vscode from "vscode";
import { ImageEditorPanel } from "./ImageEditorPanel";

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("ImageMagick");
  }
  return outputChannel;
}

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tiff",
  "tif",
  "avif",
  "heic",
  "heif",
];

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|gif|bmp|tiff|tif|avif|heic|heif)$/i;

function filterImageUris(uris: vscode.Uri[]): vscode.Uri[] {
  return uris.filter((u) => IMAGE_EXT_RE.test(u.fsPath));
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  channel.appendLine("ImageMagick activated");

  context.subscriptions.push(
    vscode.commands.registerCommand("imagemagick.openImage", async () => {
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: "Open",
        filters: { Images: IMAGE_EXTENSIONS },
      });
      const uris = picks ? filterImageUris(picks) : [];
      ImageEditorPanel.createOrShow(context.extensionUri, uris);
    }),
    vscode.commands.registerCommand(
      "imagemagick.openImageFromExplorer",
      (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
        // VS Code passes the full multi-select in the second argument when the
        // user right-clicks with multiple items selected. Fall back to the
        // single uri for the regular one-item case.
        const selected =
          uris && uris.length > 0 ? uris : uri ? [uri] : [];
        ImageEditorPanel.createOrShow(
          context.extensionUri,
          filterImageUris(selected),
        );
      },
    ),
  );
}

export function deactivate(): void {}
