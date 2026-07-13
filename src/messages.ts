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
 * What a completed inbound (host → webview) byte stream should become.
 *  - `load`: a source image to open in the editor.
 *  - `bulk`: a source image to encode for a bulk save (webview streams the
 *    result back as an outbound `bulk` blob).
 */
export type InboundMeta =
  | { kind: "load"; name: string; path: string | null; activeIndex: number }
  | { kind: "bulk"; index: number; name: string };

/** What a completed outbound (webview → host) byte stream should become. */
export type OutboundMeta =
  | { kind: "save"; name: string; path: string | null; format: ImageFormat }
  | { kind: "bulk"; index: number; name: string };

/**
 * Messages sent host → webview.
 *
 * The image engine (ImageMagick WASM) lives in the webview; the host reads
 * source bytes off disk, runs save dialogs, and writes the encoded output.
 *
 * Image bytes never travel in a single message. VS Code's webview transport
 * drops oversized message fields (a big base64 payload vanished on Windows) and
 * forbids `fetch()` of arbitrary on-disk resources (403 on both platforms). So
 * bytes are streamed as a sequence of small base64 chunks (`*Begin` + `*Chunk`)
 * that the other side reassembles. Each chunk is well under any size limit.
 */
export type HostToWebviewMessage =
  /** Start of an inbound byte stream; `meta` says what to do once it's whole. */
  | { type: "inBegin"; data: { id: number; total: number; meta: InboundMeta } }
  /** One ordered base64 chunk of inbound stream `id`. */
  | { type: "inChunk"; data: { id: number; b64: string } }
  /** The bulk file list (names + paths) shown in the sidebar. */
  | {
      type: "bulkInfo";
      data: { files: BulkFileInfo[]; activeIndex: number };
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
  /**
   * Open a file dropped onto the preview from the VS Code Explorer (or another
   * editor). Such drops carry a `file:` URI but no `File` object, so the host
   * reads the bytes off disk and streams them back as a `load`.
   */
  | { type: "openUri"; data: { uri: string } }
  /** Save the panel's current format/quality/resize as a new named preset. */
  | {
      type: "savePreset";
      data: {
        format: ImageFormat;
        quality: number;
        maxLongEdge: number | null;
      };
    }
  /** Ask the host to load a different file from the bulk list; it streams it back. */
  | { type: "selectBulkFile"; data: { index: number } }
  /** Begin a bulk save: the host shows a folder dialog, then streams each source in. */
  | { type: "requestBulkSave" }
  /** Start of an outbound byte stream (encoded output); `meta` says what to do with it. */
  | { type: "outBegin"; data: { id: number; total: number; meta: OutboundMeta } }
  /** One ordered base64 chunk of outbound stream `id`. */
  | { type: "outChunk"; data: { id: number; b64: string } };
