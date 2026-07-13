# Optimization presets + one-click optimize

Date: 2026-07-12
Branch: `feature/optimization-presets`

## Goal

Let a user right-click an image (or a multi-selection) in the VS Code Explorer,
pick a saved preset, and have the optimized output written to disk with no panel
and no dialogs. Presets hold a full lightweight pipeline (format, quality,
resize, strip metadata, output target). The editor panel can save its current
settings as a new preset.

## Why

The extension exists for repeat image work, but every image currently pays the
full editor round-trip (open, set format, set quality, set width, save, name
the file). A preset plus a right-click entry turns that into one action.

## Key constraint

The interactive editor runs ImageMagick as WebAssembly inside the webview. But
`@imagemagick/magick-wasm` is a pure WASM module (not the native addon that
crashed in 0.1 to 0.2), so it also runs in the extension host under Node. The
one-click path therefore encodes in the host with no webview at all. The wasm
file is already copied to `dist/magick.wasm` at build time.

## Components

### 1. Preset model — `src/presets.ts`

```ts
export interface OptimizePreset {
  name: string;
  format: "jpg" | "png" | "webp" | "avif" | "gif" | "tiff" | "bmp";
  quality: number;              // 1-100
  maxLongEdge: number | null;   // downscale longest edge to this; null keeps size; never upscales
  stripMetadata: boolean;       // EXIF / GPS / color profiles
  output: "suffix" | "overwrite";
  suffix: string;               // used when output === "suffix", e.g. ".optimized"
}
```

`src/presets.ts` also exports:
- `DEFAULT_PRESETS: OptimizePreset[]` (the three below).
- `loadPresets(): OptimizePreset[]` — reads `imagemagick.presets` from config,
  validates each entry, and falls back to `DEFAULT_PRESETS` when the setting is
  empty or missing. Invalid entries are dropped (logged), not fatal.

Default presets:
- **Web WebP** — webp, q80, maxLongEdge 1600, strip on, suffix `.optimized`
- **Compress JPEG** — jpg, q75, no resize, strip on, suffix `.optimized`
- **PNG to WebP** — webp, q90, no resize, strip on, suffix `.optimized`

### 2. Settings contribution — `package.json`

Add `contributes.configuration` with `imagemagick.presets`: an array of preset
objects, described so users can edit it in Settings JSON. Default `[]` (empty),
which triggers the built-in defaults at load time.

### 3. Host encoder — `src/hostEncoder.ts`

Runs magick-wasm in the extension host.

- `initHostEngine(extensionUri)`: read `dist/magick.wasm` off disk with
  `vscode.workspace.fs.readFile`, call `initializeImageMagick(bytes)` once
  (cached promise, same pattern as the webview engine).
- `encodePreset(bytes, preset): Promise<Uint8Array>`:
  1. Read the source into a `MagickImage`.
  2. If `maxLongEdge` is set and the longest edge exceeds it, resize preserving
     aspect ratio, downscale only (use a `MagickGeometry` with the `>` flag or
     an explicit guard so smaller images are untouched).
  3. If `stripMetadata`, call `image.strip()`.
  4. Set `image.quality = preset.quality`.
  5. Write in `preset.format` (map to `MagickFormat`), return the bytes.

The pipeline logic overlaps the webview engine's resize/quality handling. Kept
separate for now; extract a shared module only if a third caller appears.

### 4. Command — `imagemagick.optimizeWithPreset` (`src/extension.ts`)

- Contributed to `explorer/context` for the same image extensions as
  `openImageFromExplorer`, multi-select aware (VS Code passes the clicked uri
  plus the full selection, same signature the existing command uses).
- Flow:
  1. Resolve the selected image uris.
  2. `loadPresets()`. If more than one, `showQuickPick` on preset names; if one,
     use it; if none valid, error.
  3. `vscode.window.withProgress` over the files: read bytes, `encodePreset`,
     compute destination, write.
     - `output === "suffix"`: `<dir>/<stem><suffix>.<ext>` where ext comes from
       `preset.format`.
     - `output === "overwrite"`: write back to the source path.
  4. End summary: `Saved N` or `Saved N, M failed. See ImageMagick output.`
     Per-file failures are logged to the existing output channel and counted,
     never abort the batch.

### 5. Save as preset (panel)

- A "Save as preset" button in the action bar (`ActionBar.svelte`).
- Webview sends a new `savePreset` message with `{ format, quality, maxLongEdge }`
  where `maxLongEdge = resize ? max(resize.width, resize.height) : null`.
- Host handles it in `ImageEditorPanel`: `showInputBox` for a name (default
  suggestion from format), build an `OptimizePreset` (strip off, output suffix,
  suffix `.optimized`), append to `imagemagick.presets`, write back with
  `ConfigurationTarget.Global`. Confirm with an information message.
- Strip defaults off here because the panel has no strip toggle yet; that toggle
  is a separate roadmap item.

## Messages

Add to `WebviewToHostMessage` in `src/messages.ts`:

```ts
| { type: "savePreset"; data: { format: ImageFormat; quality: number; maxLongEdge: number | null } }
```

## Testing

One runnable self-check for `encodePreset`: generate or embed a tiny source
image, encode it with a webp preset, assert the output is non-empty and its
magic number matches the target format. No framework beyond the existing
`vscode-test` setup; a plain assert-based check is enough.

## Deliberate cuts (YAGNI)

- One command with a quick-pick, not a generated command per preset.
- Presets carry no crop (crop is interactive and per-image).
- Host encoder is not shared with the webview engine yet.
- No preset editor UI; presets are edited in Settings JSON or grown via
  "Save as preset".

## Out of scope (roadmap, not this feature)

Strip-metadata toggle in the panel, before/after savings, compare slider,
responsive size set, auto-optimize on save.
