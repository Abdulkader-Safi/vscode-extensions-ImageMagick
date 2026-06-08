export type ImageFormat =
  | "jpg"
  | "png"
  | "webp"
  | "avif"
  | "gif"
  | "tiff"
  | "bmp";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResizeSpec {
  width: number;
  height: number;
  lockAspect: boolean;
}

export interface SourceInfo {
  /** Absolute file path on disk, or `null` for a buffer-only (drag-dropped) source. */
  path: string | null;
  /** Display name used to seed the save dialog. */
  name: string;
  width: number;
  height: number;
  format: string;
}

/** One entry in the bulk-edit file list. */
export interface BulkFileInfo {
  name: string;
  path: string;
}

/** Declarative pipeline state — applied in this order: crop → rotate → flip → resize → format/quality. */
export interface EditorState {
  crop: CropRect | null;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  resize: ResizeSpec | null;
  format: ImageFormat;
  quality: number;
}

/**
 * Messages sent host → webview.
 *
 * The image engine (ImageMagick WASM) lives in the webview, so the host's job
 * is narrow: read source bytes off disk, hand them to the webview, run save
 * dialogs, and write the encoded bytes the webview returns. It never decodes
 * or encodes an image itself.
 *
 * Source images are NOT shipped through postMessage — the host exposes each one
 * as a webview resource URI and the webview fetches the bytes directly. That
 * sidesteps both the serializer's poor `Uint8Array` support and the size limit
 * on a single message (a large base64 payload gets dropped/truncated). Only the
 * encoded output travels back as base64, which the host decodes with Node's
 * (lenient) Buffer.
 */
export type HostToWebviewMessage =
  /** Source image to load, as a webview resource URI the webview fetches itself. */
  | {
      type: "fileBytes";
      data: {
        name: string;
        path: string | null;
        uri: string;
        /** Index in the bulk list this payload corresponds to (0 in single-file mode). */
        activeIndex: number;
      };
    }
  /** The bulk file list (names + paths) shown in the sidebar. */
  | {
      type: "bulkInfo";
      data: { files: BulkFileInfo[]; activeIndex: number };
    }
  /** Per-file source URI during a bulk save; the webview fetches + encodes and replies with `bulkEncoded`. */
  | {
      type: "bulkEncode";
      data: { index: number; name: string; uri: string };
    }
  | { type: "saveStatus"; data: { message: string } }
  | { type: "saveDone"; data: { path: string; sizeKb: number } }
  | { type: "saveCanceled" }
  | {
      type: "bulkSaveProgress";
      data: { current: number; total: number; name: string };
    }
  | {
      type: "bulkSaveDone";
      data: { saved: number; failed: number; dir: string };
    }
  | { type: "error"; data: { message: string } };

/** Messages sent webview → host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  /** Ask the host to load a different file from the bulk list; it replies with `fileBytes`. */
  | { type: "selectBulkFile"; data: { index: number } }
  /** Encoded single-image output (base64) for the host to run a save dialog on and write to disk. */
  | {
      type: "saveBytes";
      data: {
        name: string;
        path: string | null;
        format: ImageFormat;
        b64: string;
      };
    }
  /** Begin a bulk save: the host shows a folder dialog, then streams `bulkEncode` per file. */
  | { type: "requestBulkSave" }
  /** Reply to a `bulkEncode` request with the encoded bytes (base64) for the host to write. */
  | {
      type: "bulkEncoded";
      data: { index: number; name: string; outB64: string };
    };
