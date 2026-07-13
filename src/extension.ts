import * as path from "node:path";
import * as vscode from "vscode";
import { ImageEditorPanel } from "./ImageEditorPanel";
import { loadPresets, type OptimizePreset } from "./presets";
import { encodePreset, presetOutputPath } from "./hostEncoder";

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
    vscode.commands.registerCommand(
      "imagemagick.optimizeWithPreset",
      async (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
        const selected = uris && uris.length > 0 ? uris : uri ? [uri] : [];
        const images = filterImageUris(selected);
        if (images.length === 0) {
          vscode.window.showWarningMessage(
            "ImageMagick: no image files selected.",
          );
          return;
        }

        const presets = loadPresets();
        let preset: OptimizePreset | undefined = presets[0];
        if (presets.length > 1) {
          const pick = await vscode.window.showQuickPick(
            presets.map((p) => ({
              label: p.name,
              description: `${p.format}${p.maxLongEdge ? ` · ${p.maxLongEdge}px` : ""} · q${p.quality}${p.stripMetadata ? " · strip" : ""}`,
              preset: p,
            })),
            { placeHolder: "Choose an optimization preset" },
          );
          preset = pick?.preset;
        }
        if (!preset) {
          return;
        }
        const chosen = preset;

        const wasmPath = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "magick.wasm",
        ).fsPath;
        const log = getOutputChannel();

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Optimizing with ${chosen.name}`,
          },
          async (progress) => {
            let saved = 0;
            let failed = 0;
            for (let i = 0; i < images.length; i++) {
              const src = images[i];
              progress.report({
                message: `${i + 1}/${images.length} ${path.basename(src.fsPath)}`,
              });
              try {
                const bytes = await vscode.workspace.fs.readFile(src);
                const out = await encodePreset(wasmPath, bytes, chosen);
                const dest = presetOutputPath(src.fsPath, chosen);
                await vscode.workspace.fs.writeFile(
                  vscode.Uri.file(dest),
                  out,
                );
                saved++;
              } catch (err) {
                failed++;
                log.appendLine(
                  `optimizeWithPreset failed for ${src.fsPath}: ${String(err)}`,
                );
              }
            }
            if (failed === 0) {
              vscode.window.showInformationMessage(
                `Optimized ${saved} image${saved === 1 ? "" : "s"}.`,
              );
            } else {
              vscode.window.showWarningMessage(
                `Optimized ${saved}, ${failed} failed. See the ImageMagick output for details.`,
              );
            }
          },
        );
      },
    ),
  );
}

export function deactivate(): void {}
