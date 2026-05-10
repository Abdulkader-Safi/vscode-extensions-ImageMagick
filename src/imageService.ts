import type { Magick } from "magickwand.js/native";
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

type MagickNS = (typeof import("magickwand.js/native"))["Magick"];

let magickPromise: Promise<MagickNS> | null = null;

/**
 * Lazily loads the platform-native magickwand binary. Bundling all four
 * supported native binaries (darwin-arm64/x64, linux-x64, win32-x64) into one
 * universal .vsix means activation can land on a host that doesn't match any
 * of them — a Linux ARM box, Windows ARM, etc. Loading on demand turns that
 * from a silent activation crash into a clean error toast at the moment the
 * user actually tries to use the extension.
 */
function loadMagick(): Promise<MagickNS> {
  if (!magickPromise) {
    magickPromise = (async () => {
      try {
        const mod = await import("magickwand.js/native");
        return mod.Magick;
      } catch (err) {
        // Preserve the original error so the user (and the Output channel)
        // can see what actually failed. The previous version of this catch
        // discarded the cause and made bug reports impossible to act on.
        const detail =
          err instanceof Error
            ? `${err.message}${err.stack ? `\n${err.stack}` : ""}`
            : String(err);
        const wrapped = new Error(
          `Failed to load the ImageMagick native binary on ` +
            `${process.platform}-${process.arch}. ` +
            `Open the "ImageMagick" output channel for the full error.\n\n` +
            `${detail}`,
        );
        if (err instanceof Error) {
          (wrapped as Error & { cause?: unknown }).cause = err;
        }
        throw wrapped;
      }
    })();
  }
  return magickPromise;
}

let cachedWritableFormats: Set<ImageFormat> | null = null;

/**
 * Returns the subset of `ImageFormat` values the loaded ImageMagick build can
 * actually encode. The prebuilt binary may lack delegates for some formats
 * (e.g. AVIF on certain platforms) — calling write with a missing coder
 * throws "no encode delegate for this image format". Probing the coder list
 * lets the UI hide those choices instead of failing at save time.
 */
export async function getWritableFormats(): Promise<Set<ImageFormat>> {
  if (cachedWritableFormats) {
    return cachedWritableFormats;
  }
  const set = new Set<ImageFormat>();
  try {
    const M = await loadMagick();
    const coders = M.coderInfoList(
      M.CoderInfo.AnyMatch,
      M.CoderInfo.TrueMatch,
      M.CoderInfo.AnyMatch,
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
    const M = await loadMagick();
    const image = new M.Image();
    await image.readAsync(filePath);
    return this.adoptSource(image, filePath, displayName);
  }

  async loadFromBuffer(
    bytes: Uint8Array,
    displayName: string,
  ): Promise<SourceInfo> {
    const M = await loadMagick();
    // Copy into a fresh ArrayBuffer so the Blob constructor accepts it
    // regardless of whether the source view is backed by SharedArrayBuffer.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new M.Blob(ab);
    const image = new M.Image();
    await image.readAsync(blob);
    return this.adoptSource(image, null, displayName);
  }

  getSourceInfo(): SourceInfo | null {
    return this.sourceInfo;
  }

  /**
   * Renders a downscaled PNG preview of the current pipeline output.
   *
   * The visual preview SKIPS the crop step so the user can see the full
   * frame and reposition the crop box on it. Output dimensions and the file
   * size estimate, however, are still measured from the cropped pipeline —
   * those describe what Save will actually produce.
   *
   * Always emits PNG so colors are exact regardless of target format/quality.
   */
  async renderPreview(state: EditorState): Promise<PreviewResult> {
    const M = await loadMagick();

    // Measurement: full pipeline (crop included) — drives the bottom-bar
    // dimensions and KB estimate so they match the eventual export.
    const full = await this.applyPipeline(state, M);
    const targetSizeKb = await this.encodedSizeKb(full, state, M);
    const outWidth = full.columns();
    const outHeight = full.rows();

    // Visual: same pipeline but without crop, so the entire image stays
    // visible with the crop overlay drawn on top in the webview.
    const visual = await this.applyPipeline(state, M, { skipCrop: true });

    const longEdge = Math.max(visual.columns(), visual.rows());
    if (longEdge > PREVIEW_LONG_EDGE) {
      const scale = PREVIEW_LONG_EDGE / longEdge;
      const w = Math.max(1, Math.round(visual.columns() * scale));
      const h = Math.max(1, Math.round(visual.rows() * scale));
      await visual.resizeAsync(`${w}x${h}!`);
    }

    const previewBlob = new M.Blob();
    await visual.magickAsync("PNG");
    await visual.writeAsync(previewBlob);
    const buf = Buffer.from(await previewBlob.dataAsync());
    const previewDataUrl = `data:image/png;base64,${buf.toString("base64")}`;

    return {
      previewDataUrl,
      width: outWidth,
      height: outHeight,
      sizeKb: targetSizeKb,
    };
  }

  async save(state: EditorState, destPath: string): Promise<SaveResult> {
    const M = await loadMagick();
    const work = await this.applyPipeline(state, M);
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

  private async applyPipeline(
    state: EditorState,
    M: MagickNS,
    opts: { skipCrop?: boolean } = {},
  ): Promise<Magick.Image> {
    if (!this.source) {
      throw new Error("No image loaded");
    }
    // Construct a fresh Image from the source so the pipeline is non-destructive.
    const work = new M.Image(this.source);

    if (state.crop && !opts.skipCrop) {
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
    M: MagickNS,
  ): Promise<number> {
    const measureBlob = new M.Blob();
    const probe = new M.Image(image);
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
