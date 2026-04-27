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

export function activate(context: vscode.ExtensionContext): void {
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  channel.appendLine("ImageMagick activated");

  context.subscriptions.push(
    vscode.commands.registerCommand("imagemagick.openImage", async () => {
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Open",
        filters: { Images: IMAGE_EXTENSIONS },
      });
      const uri = picks?.[0];
      ImageEditorPanel.createOrShow(context.extensionUri, uri ?? null);
    }),
    vscode.commands.registerCommand(
      "imagemagick.openImageFromExplorer",
      (uri: vscode.Uri | undefined) => {
        ImageEditorPanel.createOrShow(context.extensionUri, uri ?? null);
      },
    ),
  );
}

export function deactivate(): void {}
