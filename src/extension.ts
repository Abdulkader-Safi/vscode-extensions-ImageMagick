import * as path from "node:path";
import * as vscode from "vscode";
import { ImageEditorPanel } from "./ImageEditorPanel";
import { LOSSLESS_FORMATS } from "./formats";
import {
  loadPresets,
  loadSavedPresets,
  type OptimizePreset,
} from "./presets";
import { encodePreset, presetOutputPath } from "./hostEncoder";

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("ImageMagick");
  }
  return outputChannel;
}

// Keep this list in sync with the `explorer/context` menu `when` clause in
// package.json, which VS Code requires as a literal regex.
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

const IMAGE_EXT_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join("|")})$`, "i");

function filterImageUris(uris: vscode.Uri[]): vscode.Uri[] {
  return uris.filter((u) => IMAGE_EXT_RE.test(u.fsPath));
}

/** One-line summary of what a preset will do, shown next to its name in the quick-pick. */
function describePreset(p: OptimizePreset): string {
  const parts: string[] = [p.format];
  if (p.maxLongEdge) {
    parts.push(`max ${p.maxLongEdge}px`);
  }
  if (!LOSSLESS_FORMATS.has(p.format)) {
    parts.push(`quality ${p.quality}`);
  }
  if (p.stripMetadata) {
    parts.push("strip metadata");
  }
  parts.push(p.output === "overwrite" ? "OVERWRITES SOURCE" : "saves a copy");
  return parts.join(" · ");
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

        // Always show the picker, even for a single preset. Optimizing writes
        // to disk (and can overwrite the source), so the user must see which
        // preset is about to run.
        const pick = await vscode.window.showQuickPick(
          loadPresets().map((p) => ({
            label: p.name,
            description: describePreset(p),
            detail:
              p.output === "overwrite"
                ? "Overwrites the source file in place."
                : `Writes alongside as <name>${p.suffix}.${p.format}`,
            preset: p,
          })),
          {
            placeHolder: `Optimize ${images.length} image${images.length === 1 ? "" : "s"} with which preset?`,
            matchOnDescription: true,
          },
        );
        if (!pick) {
          return;
        }
        const chosen = pick.preset;

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
    vscode.commands.registerCommand("imagemagick.deletePreset", async () => {
      const saved = loadSavedPresets();
      if (saved.length === 0) {
        vscode.window.showInformationMessage(
          "ImageMagick: you have no saved presets. The three built-in presets cannot be deleted; they are only offered while your preset list is empty.",
        );
        return;
      }

      const picks = await vscode.window.showQuickPick(
        saved.map((p, index) => ({
          label: p.name,
          description: describePreset(p),
          index,
        })),
        {
          canPickMany: true,
          placeHolder: "Select the presets to delete",
        },
      );
      if (!picks || picks.length === 0) {
        return;
      }

      const names = picks.map((p) => p.label).join(", ");
      const confirm = await vscode.window.showWarningMessage(
        `Delete ${picks.length} preset${picks.length === 1 ? "" : "s"}: ${names}?`,
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") {
        return;
      }

      const dropped = new Set(picks.map((p) => p.index));
      const next = saved.filter((_, i) => !dropped.has(i));
      await vscode.workspace
        .getConfiguration("imagemagick")
        .update("presets", next, vscode.ConfigurationTarget.Global);

      vscode.window.showInformationMessage(
        next.length === 0
          ? `Deleted ${picks.length} preset${picks.length === 1 ? "" : "s"}. The built-in presets are back.`
          : `Deleted ${picks.length} preset${picks.length === 1 ? "" : "s"}.`,
      );
    }),
  );
}

export function deactivate(): void {}
