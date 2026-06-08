import {
  initializeImageMagick,
  Magick,
  MagickFormat,
  MagickGeometry,
  MagickImage,
  MagickImageInfo,
  type IMagickImage,
} from "@imagemagick/magick-wasm";
import type { EditorState, ImageFormat, SourceInfo } from "../../messages";

const PREVIEW_LONG_EDGE = 1600;

const FORMAT_TO_MAGICK: Record<ImageFormat, MagickFormat> = {
  jpg: MagickFormat.Jpeg,
  png: MagickFormat.Png,
  webp: MagickFormat.WebP,
  avif: MagickFormat.Avif,
  gif: MagickFormat.Gif,
  tiff: MagickFormat.Tiff,
  bmp: MagickFormat.Bmp,
};

const LOSSLESS_FORMATS = new Set<ImageFormat>(["png", "gif", "bmp", "tiff"]);

const MAGICK_TO_FORMAT: Record<string, ImageFormat> = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  tiff: "tiff",
  bmp: "bmp",
};

/**
 * Location of the magick.wasm module, resolved by the host to a webview
 * resource URI and injected before the app mounts. The single-threaded
 * `@imagemagick/magick-wasm` build needs no Workers and no SharedArrayBuffer,
 * so it runs in a plain (non-cross-origin-isolated) VS Code webview.
 */
interface MagickUris {
  wasm: string;
}

declare global {
  interface Window {
    __MAGICK__?: MagickUris;
  }
}

let initPromise: Promise<void> | null = null;

/**
 * Initializes ImageMagick once, in the webview. We fetch the wasm bytes from
 * the injected resource URI and hand them to the initializer — a WASM fault
 * here surfaces as a catchable JS error instead of the native access violation
 * that used to take down the whole extension host.
 */
function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const uris = window.__MAGICK__;
      if (!uris?.wasm) {
        throw new Error(
          "ImageMagick wasm location was not provided to the webview (window.__MAGICK__ missing).",
        );
      }
      console.log("[ImageMagick] fetching wasm:", uris.wasm);
      const response = await fetch(uris.wasm);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch magick.wasm (HTTP ${response.status}).`,
        );
      }
      const wasmBytes = new Uint8Array(await response.arrayBuffer());
      console.log("[ImageMagick] wasm fetched, bytes:", wasmBytes.length);
      await initializeImageMagick(wasmBytes);
      console.log("[ImageMagick] engine initialized");
    })();
  }
  return initPromise;
}

let cachedWritableFormats: Set<ImageFormat> | null = null;

/**
 * Returns the subset of `ImageFormat` values this ImageMagick build can encode.
 * Probing the supported-format list lets the UI hide formats with no encoder
 * instead of failing at save time.
 */
export async function getWritableFormats(): Promise<Set<ImageFormat>> {
  if (cachedWritableFormats) {
    return cachedWritableFormats;
  }
  const set = new Set<ImageFormat>();
  try {
    await ensureInitialized();
    for (const info of Magick.supportedFormats) {
      if (!info.supportsWriting) {
        continue;
      }
      const mapped = MAGICK_TO_FORMAT[String(info.format).toLowerCase()];
      if (mapped) {
        set.add(mapped);
      }
    }
  } catch {
    // Fall back to the universally-supported set if probing fails.
    (["jpg", "png", "webp", "gif", "tiff", "bmp"] as ImageFormat[]).forEach(
      (f) => set.add(f),
    );
  }
  if (set.size === 0) {
    (["jpg", "png", "webp", "gif", "tiff", "bmp"] as ImageFormat[]).forEach(
      (f) => set.add(f),
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

export interface EncodeResult {
  bytes: Uint8Array;
  sizeKb: number;
}

/** Browser-safe base64 of a byte array (no Node `Buffer` in a webview). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Bytes cross the webview/host boundary as a stream of small base64 chunks
 * (see transport.ts). These convert a single chunk at each edge; chunks are
 * small enough that the browser's strict `atob` never trips on truncation.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return toBase64(bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Decodes `bytes` into a fresh image, runs `fn`, and always disposes the native
 * handle. Each call re-decodes from the source bytes, which keeps the pipeline
 * non-destructive without juggling clone lifetimes — decode is cheap next to
 * encode, and previews are debounced.
 */
function withImage<T>(bytes: Uint8Array, fn: (image: IMagickImage) => T): T {
  const image = MagickImage.create(bytes);
  try {
    return fn(image);
  } finally {
    image.dispose();
  }
}

function applyPipeline(
  image: IMagickImage,
  state: EditorState,
  opts: { skipCrop?: boolean },
): void {
  if (state.crop && !opts.skipCrop) {
    const w = Math.max(1, Math.round(state.crop.w));
    const h = Math.max(1, Math.round(state.crop.h));
    const x = Math.max(0, Math.round(state.crop.x));
    const y = Math.max(0, Math.round(state.crop.y));
    image.crop(new MagickGeometry(`${w}x${h}+${x}+${y}`));
    // Crop sets a virtual canvas offset; reset it so the output isn't padded.
    image.resetPage();
  }
  if (state.rotate !== 0) {
    image.rotate(state.rotate);
  }
  // ImageMagick: flip = vertical (top-bottom), flop = horizontal (left-right).
  if (state.flipV) {
    image.flip();
  }
  if (state.flipH) {
    image.flop();
  }
  if (state.resize) {
    const w = Math.max(1, Math.round(state.resize.width));
    const h = Math.max(1, Math.round(state.resize.height));
    // `!` forces exact dimensions (ignore aspect ratio).
    image.resize(new MagickGeometry(`${w}x${h}!`));
  }
}

function encodeImage(image: IMagickImage, state: EditorState): Uint8Array {
  if (!LOSSLESS_FORMATS.has(state.format)) {
    image.quality = clampQuality(state.quality);
  }
  return image.write(FORMAT_TO_MAGICK[state.format], (d) => Uint8Array.from(d));
}

function encodeFrom(bytes: Uint8Array, state: EditorState): EncodeResult {
  const out = withImage(bytes, (image) => {
    applyPipeline(image, state, {});
    return encodeImage(image, state);
  });
  return { bytes: out, sizeKb: Math.round(out.byteLength / 1024) };
}

/**
 * Wraps ImageMagick for a single image-edit session: holds the source bytes and
 * re-applies the user's declarative `EditorState` for each preview/encode.
 */
export class ImageService {
  private bytes: Uint8Array | null = null;
  private sourceInfo: SourceInfo | null = null;

  async loadFromBytes(
    bytes: Uint8Array,
    path: string | null,
    displayName: string,
  ): Promise<SourceInfo> {
    await ensureInitialized();
    // Own a stable copy — the incoming view may be backed by transferred memory.
    this.bytes = bytes.slice();
    const info = MagickImageInfo.create(this.bytes);
    this.sourceInfo = {
      path,
      name: displayName,
      width: info.width,
      height: info.height,
      format: String(info.format),
    };
    return this.sourceInfo;
  }

  getSourceInfo(): SourceInfo | null {
    return this.sourceInfo;
  }

  /**
   * Renders a downscaled PNG preview of the current pipeline output.
   *
   * The visual preview SKIPS the crop step so the user can see the full frame
   * and reposition the crop box on it. The reported dimensions and size, by
   * contrast, come from the full pipeline (crop included) so they describe what
   * a save will actually produce. Always PNG so colors are exact.
   */
  async renderPreview(state: EditorState): Promise<PreviewResult> {
    await ensureInitialized();
    if (!this.bytes) {
      throw new Error("No image loaded");
    }
    const bytes = this.bytes;

    // Measurement: full pipeline (crop included).
    const { outWidth, outHeight, sizeKb } = withImage(bytes, (image) => {
      applyPipeline(image, state, {});
      const w = image.width;
      const h = image.height;
      if (!LOSSLESS_FORMATS.has(state.format)) {
        image.quality = clampQuality(state.quality);
      }
      const len = image.write(
        FORMAT_TO_MAGICK[state.format],
        (d) => d.byteLength,
      );
      return { outWidth: w, outHeight: h, sizeKb: Math.round(len / 1024) };
    });

    // Visual: same pipeline without crop, downscaled to the preview cap.
    const previewDataUrl = withImage(bytes, (image) => {
      applyPipeline(image, state, { skipCrop: true });
      // `>` shrinks only if larger than the box, preserving aspect ratio.
      image.resize(
        new MagickGeometry(`${PREVIEW_LONG_EDGE}x${PREVIEW_LONG_EDGE}>`),
      );
      const base64 = image.write(MagickFormat.Png, (d) => toBase64(d));
      return `data:image/png;base64,${base64}`;
    });

    return { previewDataUrl, width: outWidth, height: outHeight, sizeKb };
  }

  /** Encodes the current source through the pipeline to the target format. */
  async encode(state: EditorState): Promise<EncodeResult> {
    await ensureInitialized();
    if (!this.bytes) {
      throw new Error("No image loaded");
    }
    return encodeFrom(this.bytes, state);
  }
}

/**
 * Stateless one-shot encode used by bulk save: decode `bytes`, apply the
 * pipeline, and return the encoded output without touching the interactive
 * session's source.
 */
export async function encodeBytes(
  bytes: Uint8Array,
  state: EditorState,
): Promise<EncodeResult> {
  await ensureInitialized();
  return encodeFrom(bytes, state);
}

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) {
    return 85;
  }
  return Math.max(1, Math.min(100, Math.round(q)));
}
