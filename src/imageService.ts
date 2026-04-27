import { Magick } from "magickwand.js/native";
import type { EditorState, ImageFormat, SourceInfo } from "./messages";

const PREVIEW_LONG_EDGE = 1600;

const FORMAT_TO_MAGICK: Record<ImageFormat, string> = {
  jpg: "JPEG",
  png: "PNG",
  webp: "WEBP",
  avif: "AVIF",
  gif: "GIF",
  tiff: "TIFF",
  bmp: "BMP",
};

const LOSSLESS_FORMATS = new Set<ImageFormat>(["png", "gif", "bmp", "tiff"]);

const CODER_TO_FORMAT: Record<string, ImageFormat> = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  tiff: "tiff",
  bmp: "bmp",
};

let cachedWritableFormats: Set<ImageFormat> | null = null;

/**
 * Returns the subset of `ImageFormat` values the loaded ImageMagick build can
 * actually encode. The prebuilt binary may lack delegates for some formats
 * (e.g. AVIF on certain platforms) — calling write with a missing coder
 * throws "no encode delegate for this image format". Probing the coder list
 * lets the UI hide those choices instead of failing at save time.
 */
export function getWritableFormats(): Set<ImageFormat> {
  if (cachedWritableFormats) {
    return cachedWritableFormats;
  }
  const set = new Set<ImageFormat>();
  try {
    const coders = Magick.coderInfoList(
      Magick.CoderInfo.AnyMatch,
      Magick.CoderInfo.TrueMatch,
      Magick.CoderInfo.AnyMatch,
    );
    for (const coder of coders) {
      const mapped = CODER_TO_FORMAT[coder.name().toLowerCase()];
      if (mapped) {
        set.add(mapped);
      }
    }
  } catch {
    // If probing fails for any reason, fall back to the universally-supported set.
    ["jpg", "png", "webp", "gif", "tiff", "bmp"].forEach((f) =>
      set.add(f as ImageFormat),
    );
  }
  cachedWritableFormats = set;
  return set;
}

export interface PreviewResult {
  previewDataUrl: string;
  width: number;
  height: number;
  sizeKb: number;
}

export interface SaveResult {
  path: string;
  sizeKb: number;
}

/**
 * Wraps magickwand.js for a single image-edit session: loads the source once,
 * then re-applies the user's declarative `EditorState` for each preview/save.
 */
export class ImageService {
  private source: Magick.Image | null = null;
  private sourceInfo: SourceInfo | null = null;

  async loadFromPath(
    filePath: string,
    displayName: string,
  ): Promise<SourceInfo> {
    const image = new Magick.Image();
    await image.readAsync(filePath);
    return this.adoptSource(image, filePath, displayName);
  }

  async loadFromBuffer(
    bytes: Uint8Array,
    displayName: string,
  ): Promise<SourceInfo> {
    // Copy into a fresh ArrayBuffer so the Blob constructor accepts it
    // regardless of whether the source view is backed by SharedArrayBuffer.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Magick.Blob(ab);
    const image = new Magick.Image();
    await image.readAsync(blob);
    return this.adoptSource(image, null, displayName);
  }

  getSourceInfo(): SourceInfo | null {
    return this.sourceInfo;
  }

  /**
   * Renders a downscaled PNG preview of the current pipeline output.
   * Always emits PNG so colors are exact regardless of target format/quality;
   * the displayed file size estimate is the true size at the target format/quality.
   */
  async renderPreview(state: EditorState): Promise<PreviewResult> {
    const work = await this.applyPipeline(state);
    const targetSizeKb = await this.encodedSizeKb(work, state);

    const longEdge = Math.max(work.columns(), work.rows());
    if (longEdge > PREVIEW_LONG_EDGE) {
      const scale = PREVIEW_LONG_EDGE / longEdge;
      const w = Math.max(1, Math.round(work.columns() * scale));
      const h = Math.max(1, Math.round(work.rows() * scale));
      await work.resizeAsync(`${w}x${h}!`);
    }

    const previewBlob = new Magick.Blob();
    await work.magickAsync("PNG");
    await work.writeAsync(previewBlob);
    const buf = Buffer.from(await previewBlob.dataAsync());
    const previewDataUrl = `data:image/png;base64,${buf.toString("base64")}`;

    return {
      previewDataUrl,
      width: work.columns(),
      height: work.rows(),
      sizeKb: targetSizeKb,
    };
  }

  async save(state: EditorState, destPath: string): Promise<SaveResult> {
    const work = await this.applyPipeline(state);
    await work.magickAsync(FORMAT_TO_MAGICK[state.format]);
    if (!LOSSLESS_FORMATS.has(state.format)) {
      await work.qualityAsync(this.clampQuality(state.quality));
    }
    await work.writeAsync(destPath);

    // Re-stat the file to get the actual size — writeAsync doesn't return it.
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(destPath);
    return { path: destPath, sizeKb: Math.round(stat.size / 1024) };
  }

  private async adoptSource(
    image: Magick.Image,
    path: string | null,
    name: string,
  ): Promise<SourceInfo> {
    this.source = image;
    this.sourceInfo = {
      path,
      name,
      width: image.columns(),
      height: image.rows(),
      // `magick()` returns the short coder name ("JPEG", "PNG"); `format()`
      // returns a long description ("Joint Photographic Experts Group...").
      format: image.magick(),
    };
    return this.sourceInfo;
  }

  private async applyPipeline(state: EditorState): Promise<Magick.Image> {
    if (!this.source) {
      throw new Error("No image loaded");
    }
    // Construct a fresh Image from the source so the pipeline is non-destructive.
    const work = new Magick.Image(this.source);

    if (state.crop) {
      const c = state.crop;
      const w = Math.max(1, Math.round(c.w));
      const h = Math.max(1, Math.round(c.h));
      const x = Math.max(0, Math.round(c.x));
      const y = Math.max(0, Math.round(c.y));
      await work.cropAsync(`${w}x${h}+${x}+${y}`);
    }
    if (state.rotate !== 0) {
      await work.rotateAsync(state.rotate);
    }
    // Magick++ semantics: flip = vertical (top-bottom), flop = horizontal (left-right).
    if (state.flipV) {
      await work.flipAsync();
    }
    if (state.flipH) {
      await work.flopAsync();
    }
    if (state.resize) {
      const w = Math.max(1, Math.round(state.resize.width));
      const h = Math.max(1, Math.round(state.resize.height));
      // `!` forces exact dimensions; if lockAspect is on the caller already
      // computed matching width/height, so exact is fine either way.
      await work.resizeAsync(`${w}x${h}!`);
    }
    return work;
  }

  /** Encode to the target format+quality just to measure the resulting size. */
  private async encodedSizeKb(
    image: Magick.Image,
    state: EditorState,
  ): Promise<number> {
    const measureBlob = new Magick.Blob();
    const probe = new Magick.Image(image);
    await probe.magickAsync(FORMAT_TO_MAGICK[state.format]);
    if (!LOSSLESS_FORMATS.has(state.format)) {
      await probe.qualityAsync(this.clampQuality(state.quality));
    }
    await probe.writeAsync(measureBlob);
    const len = await measureBlob.lengthAsync();
    return Math.round(len / 1024);
  }

  private clampQuality(q: number): number {
    if (!Number.isFinite(q)) {
      return 85;
    }
    return Math.max(1, Math.min(100, Math.round(q)));
  }
}
