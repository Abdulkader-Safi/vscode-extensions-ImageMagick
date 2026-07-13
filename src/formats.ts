import { MagickFormat } from "@imagemagick/magick-wasm";
import type { ImageFormat } from "./messages";

/**
 * The shared format vocabulary. Both the host encoder and the webview engine
 * need these, so they live in one place rather than being retyped on each side.
 *
 * Note there is deliberately no ImageFormat → file-extension map: every
 * ImageFormat value already IS its extension.
 */
export const FORMAT_TO_MAGICK: Record<ImageFormat, MagickFormat> = {
  jpg: MagickFormat.Jpeg,
  png: MagickFormat.Png,
  webp: MagickFormat.WebP,
  avif: MagickFormat.Avif,
  gif: MagickFormat.Gif,
  tiff: MagickFormat.Tiff,
  bmp: MagickFormat.Bmp,
};

/** Formats that ignore the quality setting. */
export const LOSSLESS_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>([
  "png",
  "gif",
  "bmp",
  "tiff",
]);

export function clampQuality(q: unknown): number {
  const n = typeof q === "number" && Number.isFinite(q) ? q : 85;
  return Math.max(1, Math.min(100, Math.round(n)));
}
