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

/** Messages sent host → webview. */
export type HostToWebviewMessage =
  | { type: "formatsAvailable"; data: { formats: ImageFormat[] } }
  | { type: "imageLoaded"; data: SourceInfo & { previewDataUrl: string } }
  | {
      type: "previewUpdated";
      data: {
        previewDataUrl: string;
        width: number;
        height: number;
        sizeKb: number;
      };
    }
  | { type: "saveStatus"; data: { message: string } }
  | { type: "saveDone"; data: { path: string; sizeKb: number } }
  | { type: "saveCanceled" }
  | { type: "error"; data: { message: string } };

/** Messages sent webview → host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "requestPreview"; data: EditorState }
  | { type: "requestSave"; data: EditorState }
  | { type: "dropFile"; data: { name: string; bytes: number[] } };
