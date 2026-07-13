import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeImageMagick,
  MagickGeometry,
  MagickImage,
  type IMagickImage,
} from "@imagemagick/magick-wasm";
import { FORMAT_TO_MAGICK, LOSSLESS_FORMATS } from "./formats.js";
import type { OptimizePreset } from "./presets";

let initPromise: Promise<void> | null = null;

/**
 * Initializes ImageMagick once in the extension host. Reads the same wasm the
 * webview uses (copied to dist/magick.wasm at build time). This is the pure
 * WASM build, so it cannot fault the host the way a native addon could.
 */
function ensureEngine(wasmPath: string): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const bytes = await fs.promises.readFile(wasmPath);
      await initializeImageMagick(new Uint8Array(bytes));
    })();
  }
  return initPromise;
}

/** Applies a preset's pipeline (resize, strip, quality, format) to `bytes`. */
export async function encodePreset(
  wasmPath: string,
  bytes: Uint8Array,
  preset: OptimizePreset,
): Promise<Uint8Array> {
  await ensureEngine(wasmPath);
  const image: IMagickImage = MagickImage.create(bytes);
  try {
    if (preset.maxLongEdge) {
      const edge = preset.maxLongEdge;
      // `>` shrinks only if larger, preserving aspect ratio.
      image.resize(new MagickGeometry(`${edge}x${edge}>`));
    }
    if (preset.stripMetadata) {
      image.strip();
    }
    if (!LOSSLESS_FORMATS.has(preset.format)) {
      image.quality = preset.quality;
    }
    return image.write(FORMAT_TO_MAGICK[preset.format], (d) =>
      Uint8Array.from(d),
    );
  } finally {
    image.dispose();
  }
}

/** Where a preset writes: alongside with a suffix, or over the source. */
export function presetOutputPath(
  sourcePath: string,
  preset: OptimizePreset,
): string {
  const suffix = preset.output === "suffix" ? preset.suffix : "";
  const stem = path.parse(sourcePath).name;
  return path.join(
    path.dirname(sourcePath),
    `${stem}${suffix}.${preset.format}`,
  );
}
