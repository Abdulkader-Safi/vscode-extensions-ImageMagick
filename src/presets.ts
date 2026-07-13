import * as vscode from "vscode";
import type { ImageFormat } from "./messages";

export type { ImageFormat } from "./messages";

/** A saved, reusable optimization pipeline. Applied headlessly by the encoder. */
export interface OptimizePreset {
  name: string;
  format: ImageFormat;
  /** 1-100. Ignored for lossless formats. */
  quality: number;
  /** Downscale the longest edge to this. null keeps the source size. Never upscales. */
  maxLongEdge: number | null;
  /** Drop EXIF, GPS, and color profiles before encoding. */
  stripMetadata: boolean;
  /** Where the output lands. */
  output: "suffix" | "overwrite";
  /** Filename suffix when output is "suffix", e.g. ".optimized". */
  suffix: string;
}

const VALID_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>([
  "jpg",
  "png",
  "webp",
  "avif",
  "gif",
  "tiff",
  "bmp",
]);

export const DEFAULT_PRESETS: OptimizePreset[] = [
  {
    name: "Web WebP",
    format: "webp",
    quality: 80,
    maxLongEdge: 1600,
    stripMetadata: true,
    output: "suffix",
    suffix: ".optimized",
  },
  {
    name: "Compress JPEG",
    format: "jpg",
    quality: 75,
    maxLongEdge: null,
    stripMetadata: true,
    output: "suffix",
    suffix: ".optimized",
  },
  {
    name: "PNG to WebP",
    format: "webp",
    quality: 90,
    maxLongEdge: null,
    stripMetadata: true,
    output: "suffix",
    suffix: ".optimized",
  },
];

function clampQuality(q: unknown): number {
  const n = typeof q === "number" && Number.isFinite(q) ? q : 85;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/** Validates one raw config entry into an OptimizePreset, or null if unusable. */
function toPreset(raw: unknown): OptimizePreset | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.trim() === "") {
    return null;
  }
  if (
    typeof r.format !== "string" ||
    !VALID_FORMATS.has(r.format as ImageFormat)
  ) {
    return null;
  }
  const maxLongEdge =
    typeof r.maxLongEdge === "number" &&
    Number.isFinite(r.maxLongEdge) &&
    r.maxLongEdge > 0
      ? Math.round(r.maxLongEdge)
      : null;
  const output = r.output === "overwrite" ? "overwrite" : "suffix";
  const suffix =
    typeof r.suffix === "string" && r.suffix !== "" ? r.suffix : ".optimized";
  return {
    name: r.name,
    format: r.format as ImageFormat,
    quality: clampQuality(r.quality),
    maxLongEdge,
    stripMetadata: r.stripMetadata === true,
    output,
    suffix,
  };
}

/**
 * Pure: validate a raw array into presets. Returns exactly what is saved, with
 * no fallback, so callers that edit the list (delete) see only real entries.
 */
export function parsePresets(raw: unknown): OptimizePreset[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(toPreset).filter((p): p is OptimizePreset => p !== null);
}

/** Pure: validate a raw array into presets, falling back to defaults when empty. */
export function resolvePresets(raw: unknown): OptimizePreset[] {
  const out = parsePresets(raw);
  return out.length > 0 ? out : DEFAULT_PRESETS;
}

/** The presets to offer the user: their saved ones, or the built-in defaults. */
export function loadPresets(): OptimizePreset[] {
  return resolvePresets(readPresetSetting());
}

/** Only the presets actually saved in settings. Empty means the defaults are in play. */
export function loadSavedPresets(): OptimizePreset[] {
  return parsePresets(readPresetSetting());
}

function readPresetSetting(): unknown {
  return vscode.workspace.getConfiguration("imagemagick").get("presets");
}
