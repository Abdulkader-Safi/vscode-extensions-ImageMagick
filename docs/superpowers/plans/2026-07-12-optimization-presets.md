# Optimization presets + one-click optimize — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click an image (or a multi-selection) in the Explorer, pick a saved preset, and have optimized output written to disk headlessly — no panel, no dialogs.

**Architecture:** Presets are plain objects stored in the `imagemagick.presets` setting (with built-in defaults). A new host-side encoder runs `@imagemagick/magick-wasm` in the extension host (Node) — the same wasm the webview uses, already copied to `dist/magick.wasm` — so the one-click path needs no webview. A single command shows a quick-pick of presets and encodes each selected file. The editor panel gains a "Save as preset" button that writes the current settings back to config.

**Tech Stack:** TypeScript, VS Code Extension API, `@imagemagick/magick-wasm` (already a dependency), Svelte 5 (webview), esbuild.

## Global Constraints

- No em-dashes in any user-facing string or comment; use full stops, commas, or colons.
- The host must never load a native addon. Only the pure-WASM `@imagemagick/magick-wasm` is allowed in the host (this is why 0.2.0 was safe).
- Image extensions handled: `png jpg jpeg webp gif bmp tiff tif avif heic heif` (reuse `IMAGE_EXT_RE` from `src/extension.ts`).
- Lossless formats (`png gif bmp tiff`) ignore the quality setting; only set quality for lossy formats.
- Resize semantics for `maxLongEdge`: downscale only, preserve aspect ratio (ImageMagick geometry `NxN>`). Never upscale.
- All work happens on branch `feature/optimization-presets`.

---

### Task 1: Preset model, defaults, and validation

**Files:**
- Create: `src/presets.ts`
- Modify: `package.json` (add `contributes.configuration`)
- Modify: `src/test/extension.test.ts` (add tests)

**Interfaces:**
- Produces:
  - `interface OptimizePreset { name: string; format: ImageFormat; quality: number; maxLongEdge: number | null; stripMetadata: boolean; output: "suffix" | "overwrite"; suffix: string; }`
  - `const DEFAULT_PRESETS: OptimizePreset[]`
  - `function resolvePresets(raw: unknown): OptimizePreset[]` — pure; validates a raw array, drops invalid entries, returns `DEFAULT_PRESETS` when the result is empty.
  - `function loadPresets(): OptimizePreset[]` — reads `imagemagick.presets` from config and passes it through `resolvePresets`.
- Consumes: `ImageFormat` from `src/messages.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/test/extension.test.ts`:

```ts
import * as assert from "assert";
import { resolvePresets, DEFAULT_PRESETS } from "../presets";

suite("presets", () => {
  test("empty input falls back to defaults", () => {
    assert.deepStrictEqual(resolvePresets([]), DEFAULT_PRESETS);
    assert.deepStrictEqual(resolvePresets(undefined), DEFAULT_PRESETS);
  });

  test("drops invalid entries, keeps valid ones", () => {
    const raw = [
      { name: "Good", format: "webp", quality: 80, maxLongEdge: 1600, stripMetadata: true, output: "suffix", suffix: ".optimized" },
      { name: "NoFormat", quality: 50 },
      { name: "BadFormat", format: "xyz", quality: 50 },
    ];
    const out = resolvePresets(raw);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].name, "Good");
    assert.strictEqual(out[0].format, "webp");
  });

  test("clamps quality and normalizes missing optional fields", () => {
    const raw = [
      { name: "Clamp", format: "jpg", quality: 999 },
    ];
    const out = resolvePresets(raw);
    assert.strictEqual(out[0].quality, 100);
    assert.strictEqual(out[0].maxLongEdge, null);
    assert.strictEqual(out[0].stripMetadata, false);
    assert.strictEqual(out[0].output, "suffix");
    assert.strictEqual(out[0].suffix, ".optimized");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `../presets`.

- [ ] **Step 3: Create `src/presets.ts`**

```ts
import * as vscode from "vscode";
import type { ImageFormat } from "./messages";

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
  "jpg", "png", "webp", "avif", "gif", "tiff", "bmp",
]);

export const DEFAULT_PRESETS: OptimizePreset[] = [
  { name: "Web WebP", format: "webp", quality: 80, maxLongEdge: 1600, stripMetadata: true, output: "suffix", suffix: ".optimized" },
  { name: "Compress JPEG", format: "jpg", quality: 75, maxLongEdge: null, stripMetadata: true, output: "suffix", suffix: ".optimized" },
  { name: "PNG to WebP", format: "webp", quality: 90, maxLongEdge: null, stripMetadata: true, output: "suffix", suffix: ".optimized" },
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
  if (typeof r.format !== "string" || !VALID_FORMATS.has(r.format as ImageFormat)) {
    return null;
  }
  const maxLongEdge =
    typeof r.maxLongEdge === "number" && Number.isFinite(r.maxLongEdge) && r.maxLongEdge > 0
      ? Math.round(r.maxLongEdge)
      : null;
  const output = r.output === "overwrite" ? "overwrite" : "suffix";
  const suffix = typeof r.suffix === "string" && r.suffix !== "" ? r.suffix : ".optimized";
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

/** Pure: validate a raw array into presets, falling back to defaults when empty. */
export function resolvePresets(raw: unknown): OptimizePreset[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_PRESETS;
  }
  const out = raw.map(toPreset).filter((p): p is OptimizePreset => p !== null);
  return out.length > 0 ? out : DEFAULT_PRESETS;
}

/** Reads the `imagemagick.presets` setting and resolves it. */
export function loadPresets(): OptimizePreset[] {
  const raw = vscode.workspace.getConfiguration("imagemagick").get("presets");
  return resolvePresets(raw);
}
```

- [ ] **Step 4: Add the configuration contribution to `package.json`**

Inside `contributes` (a sibling of `commands` and `menus`), add:

```json
"configuration": {
  "title": "ImageMagick",
  "properties": {
    "imagemagick.presets": {
      "type": "array",
      "default": [],
      "markdownDescription": "Optimization presets shown in the \"Optimize with Preset\" right-click menu. When empty, three built-in presets are used (Web WebP, Compress JPEG, PNG to WebP).",
      "items": {
        "type": "object",
        "required": ["name", "format"],
        "properties": {
          "name": { "type": "string", "description": "Shown in the quick-pick." },
          "format": { "type": "string", "enum": ["jpg", "png", "webp", "avif", "gif", "tiff", "bmp"] },
          "quality": { "type": "number", "minimum": 1, "maximum": 100, "default": 80 },
          "maxLongEdge": { "type": ["number", "null"], "default": null, "description": "Downscale the longest edge to this many pixels. null keeps the source size." },
          "stripMetadata": { "type": "boolean", "default": false },
          "output": { "type": "string", "enum": ["suffix", "overwrite"], "default": "suffix" },
          "suffix": { "type": "string", "default": ".optimized" }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS for the three `presets` tests.

- [ ] **Step 6: Commit**

```bash
git add src/presets.ts package.json src/test/extension.test.ts
git commit -m "Add optimization preset model, defaults, and settings"
```

---

### Task 2: Host encoder

**Files:**
- Create: `src/hostEncoder.ts`
- Modify: `src/test/extension.test.ts` (add tests)

**Interfaces:**
- Consumes: `OptimizePreset` from `src/presets.ts`.
- Produces:
  - `async function encodePreset(wasmPath: string, bytes: Uint8Array, preset: OptimizePreset): Promise<Uint8Array>`
  - `function presetOutputPath(sourcePath: string, preset: OptimizePreset): string`

- [ ] **Step 1: Write the failing tests**

Add to `src/test/extension.test.ts`:

```ts
import * as path from "path";
import { encodePreset, presetOutputPath } from "../hostEncoder";
import type { OptimizePreset } from "../presets";

const WEBP_PRESET: OptimizePreset = {
  name: "t", format: "webp", quality: 80, maxLongEdge: 1600, stripMetadata: true, output: "suffix", suffix: ".optimized",
};

// 1x1 red PNG.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// dist/magick.wasm is produced by the build; the pretest step runs the build first.
const WASM_PATH = path.resolve(__dirname, "..", "..", "dist", "magick.wasm");

suite("hostEncoder", () => {
  test("encodePreset returns webp bytes", async () => {
    const out = await encodePreset(WASM_PATH, new Uint8Array(ONE_PX_PNG), WEBP_PRESET);
    assert.ok(out.byteLength > 0, "expected non-empty output");
    // RIFF....WEBP magic number.
    assert.strictEqual(out[0], 0x52);
    assert.strictEqual(out[1], 0x49);
    assert.strictEqual(out[2], 0x46);
    assert.strictEqual(out[3], 0x46);
    assert.strictEqual(out[8], 0x57);
    assert.strictEqual(out[9], 0x45);
    assert.strictEqual(out[10], 0x42);
    assert.strictEqual(out[11], 0x50);
  });

  test("presetOutputPath builds suffix path", () => {
    const p = presetOutputPath("/imgs/photo.png", WEBP_PRESET);
    assert.strictEqual(p, path.join("/imgs", "photo.optimized.webp"));
  });

  test("presetOutputPath overwrites in place", () => {
    const overwrite: OptimizePreset = { ...WEBP_PRESET, output: "overwrite" };
    const p = presetOutputPath("/imgs/photo.png", overwrite);
    assert.strictEqual(p, path.join("/imgs", "photo.webp"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `../hostEncoder`.

- [ ] **Step 3: Create `src/hostEncoder.ts`**

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
  MagickImage,
  type IMagickImage,
} from "@imagemagick/magick-wasm";
import type { ImageFormat, OptimizePreset } from "./presets";

const FORMAT_TO_MAGICK: Record<ImageFormat, MagickFormat> = {
  jpg: MagickFormat.Jpeg,
  png: MagickFormat.Png,
  webp: MagickFormat.WebP,
  avif: MagickFormat.Avif,
  gif: MagickFormat.Gif,
  tiff: MagickFormat.Tiff,
  bmp: MagickFormat.Bmp,
};

const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  jpg: "jpg", png: "png", webp: "webp", avif: "avif", gif: "gif", tiff: "tiff", bmp: "bmp",
};

const LOSSLESS: ReadonlySet<ImageFormat> = new Set<ImageFormat>(["png", "gif", "bmp", "tiff"]);

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
    if (!LOSSLESS.has(preset.format)) {
      image.quality = preset.quality;
    }
    return image.write(FORMAT_TO_MAGICK[preset.format], (d) => Uint8Array.from(d));
  } finally {
    image.dispose();
  }
}

/** Where a preset writes: alongside with a suffix, or over the source. */
export function presetOutputPath(sourcePath: string, preset: OptimizePreset): string {
  const dir = path.dirname(sourcePath);
  const ext = FORMAT_EXTENSIONS[preset.format];
  const base = path.basename(sourcePath);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const suffix = preset.output === "suffix" ? preset.suffix : "";
  return path.join(dir, `${stem}${suffix}.${ext}`);
}
```

Note: `src/presets.ts` must also re-export `ImageFormat` so this import works. Add to the top of `src/presets.ts`:

```ts
export type { ImageFormat } from "./messages";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS for the three `hostEncoder` tests. (The `pretest` script builds first, so `dist/magick.wasm` exists.)

- [ ] **Step 5: Commit**

```bash
git add src/hostEncoder.ts src/presets.ts src/test/extension.test.ts
git commit -m "Add host-side preset encoder"
```

---

### Task 3: One-click command and menu

**Files:**
- Modify: `src/extension.ts` (register `imagemagick.optimizeWithPreset`)
- Modify: `package.json` (`contributes.commands` + `contributes.menus.explorer/context`)

**Interfaces:**
- Consumes: `loadPresets` from `src/presets.ts`; `encodePreset`, `presetOutputPath` from `src/hostEncoder.ts`; `getOutputChannel` from `src/extension.ts`.

- [ ] **Step 1: Add the command and menu entry to `package.json`**

In `contributes.commands`, add:

```json
{
  "command": "imagemagick.optimizeWithPreset",
  "title": "Optimize with Preset (ImageMagick)",
  "category": "ImageMagick"
}
```

In `contributes.menus.commandPalette`, hide it (it needs a file argument):

```json
{ "command": "imagemagick.optimizeWithPreset", "when": "false" }
```

In `contributes.menus.explorer/context`, add next to the existing entry:

```json
{
  "command": "imagemagick.optimizeWithPreset",
  "when": "resourceExtname =~ /\\.(png|jpg|jpeg|webp|gif|bmp|tiff|tif|avif|heic|heif)$/i",
  "group": "navigation@51"
}
```

- [ ] **Step 2: Register the command in `src/extension.ts`**

Add imports at the top:

```ts
import { loadPresets, type OptimizePreset } from "./presets";
import { encodePreset, presetOutputPath } from "./hostEncoder";
```

Add this command registration inside the `context.subscriptions.push(...)` list in `activate`, after the `openImageFromExplorer` registration:

```ts
vscode.commands.registerCommand(
  "imagemagick.optimizeWithPreset",
  async (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
    const selected = uris && uris.length > 0 ? uris : uri ? [uri] : [];
    const images = filterImageUris(selected);
    if (images.length === 0) {
      vscode.window.showWarningMessage("ImageMagick: no image files selected.");
      return;
    }

    const presets = loadPresets();
    let preset: OptimizePreset | undefined = presets[0];
    if (presets.length > 1) {
      const pick = await vscode.window.showQuickPick(
        presets.map((p) => ({
          label: p.name,
          description: `${p.format}${p.maxLongEdge ? ` · ${p.maxLongEdge}px` : ""} · q${p.quality}${p.stripMetadata ? " · strip" : ""}`,
          preset: p,
        })),
        { placeHolder: "Choose an optimization preset" },
      );
      preset = pick?.preset;
    }
    if (!preset) {
      return;
    }
    const chosen = preset;

    const wasmPath = vscode.Uri.joinPath(context.extensionUri, "dist", "magick.wasm").fsPath;
    const log = getOutputChannel();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Optimizing with ${chosen.name}` },
      async (progress) => {
        let saved = 0;
        let failed = 0;
        for (let i = 0; i < images.length; i++) {
          const src = images[i];
          progress.report({
            message: `${i + 1}/${images.length} ${path.basename(src.fsPath)}`,
          });
          try {
            const bytes = await vscode.workspace.fs.readFile(src);
            const out = await encodePreset(wasmPath, bytes, chosen);
            const dest = presetOutputPath(src.fsPath, chosen);
            await vscode.workspace.fs.writeFile(vscode.Uri.file(dest), out);
            saved++;
          } catch (err) {
            failed++;
            log.appendLine(`optimizeWithPreset failed for ${src.fsPath}: ${String(err)}`);
          }
        }
        if (failed === 0) {
          vscode.window.showInformationMessage(`Optimized ${saved} image${saved === 1 ? "" : "s"}.`);
        } else {
          vscode.window.showWarningMessage(
            `Optimized ${saved}, ${failed} failed. See the ImageMagick output for details.`,
          );
        }
      },
    );
  },
),
```

Add `import * as path from "node:path";` at the top of `src/extension.ts` (it is not imported today).

- [ ] **Step 3: Build and type-check**

Run: `npm run check-types && node esbuild.js`
Expected: no errors; `[build] copied magick.wasm into dist/`.

- [ ] **Step 4: Manual verification (host integration — no unit test)**

1. Press F5 to launch the Extension Development Host.
2. In the Explorer, right-click a `.png` or `.jpg` → **Optimize with Preset (ImageMagick)**.
3. Pick **Web WebP**.
4. Confirm a `<name>.optimized.webp` appears next to the source and a "Optimized 1 image." notification shows.
5. Select two images, right-click, run it again, confirm both are written and the count is correct.

Why manual: this exercises VS Code's menu, quick-pick, progress, and filesystem APIs, which the `vscode-test` harness cannot drive headlessly. The encode itself is covered by Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "Add one-click Optimize with Preset command"
```

---

### Task 4: Save as preset from the panel

**Files:**
- Modify: `src/messages.ts` (add `savePreset` message)
- Modify: `src/webview/components/ActionBar.svelte` (button + prop)
- Modify: `src/webview/pages/EditorPage.svelte` (pass handler, send message)
- Modify: `src/ImageEditorPanel.ts` (handle message, write config)

**Interfaces:**
- Consumes: `WebviewToHostMessage` union in `src/messages.ts`.
- Produces: a `savePreset` message the host turns into a new `imagemagick.presets` entry.

- [ ] **Step 1: Add the message type to `src/messages.ts`**

In the `WebviewToHostMessage` union, add:

```ts
  /** Save the panel's current format/quality/resize as a new named preset. */
  | { type: "savePreset"; data: { format: ImageFormat; quality: number; maxLongEdge: number | null } }
```

- [ ] **Step 2: Add the button to `src/webview/components/ActionBar.svelte`**

Add `onSavePreset: () => void;` to the `Props` interface and to the destructured props. Then add this button just before the `Reset` button:

```svelte
    <button
        type="button"
        onclick={onSavePreset}
        disabled={!canSave}
        class="px-3 py-1 text-sm rounded-sm bg-vscode-button-secondary-bg text-vscode-button-secondary-fg hover:bg-vscode-button-secondary-hover disabled:opacity-50"
    >
        Save as preset
    </button>
```

- [ ] **Step 3: Wire the handler in `src/webview/pages/EditorPage.svelte`**

Add a handler near the other action handlers:

```ts
    function handleSavePreset() {
        const state = $state.snapshot(editorState) as EditorState;
        const maxLongEdge = state.resize
            ? Math.max(Math.round(state.resize.width), Math.round(state.resize.height))
            : null;
        send({
            type: "savePreset",
            data: { format: state.format, quality: state.quality, maxLongEdge },
        });
    }
```

Pass it to the `ActionBar` component where it is rendered:

```svelte
        onSavePreset={handleSavePreset}
```

(Confirm the exact prop name of the editor state object in this file — it is the same object read elsewhere via `$state.snapshot(editorState)`. If the local name differs, use that name.)

- [ ] **Step 4: Handle the message in `src/ImageEditorPanel.ts`**

Add a case to the `switch (msg.type)` in `handleMessage`:

```ts
      case "savePreset":
        await this.handleSavePreset(msg.data);
        return;
```

Add the method (near `handleSelectBulkFile`):

```ts
  private async handleSavePreset(data: {
    format: ImageFormat;
    quality: number;
    maxLongEdge: number | null;
  }): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Name this preset",
      value: `${data.format.toUpperCase()} q${data.quality}`,
      validateInput: (v) => (v.trim() === "" ? "Enter a name" : undefined),
    });
    if (!name) {
      return;
    }
    const config = vscode.workspace.getConfiguration("imagemagick");
    const existing = config.get<unknown[]>("presets") ?? [];
    const next = [
      ...existing,
      {
        name: name.trim(),
        format: data.format,
        quality: data.quality,
        maxLongEdge: data.maxLongEdge,
        stripMetadata: false,
        output: "suffix",
        suffix: ".optimized",
      },
    ];
    await config.update("presets", next, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Saved preset "${name.trim()}".`);
  }
```

`ImageFormat` is already imported in `src/ImageEditorPanel.ts`.

- [ ] **Step 5: Build and type-check**

Run: `npm run check-types && node esbuild.js`
Expected: no errors.

- [ ] **Step 6: Manual verification**

1. F5 to launch the Extension Development Host.
2. Open an image, set format to WebP and quality to 70, set a resize width.
3. Click **Save as preset**, name it "My Web", confirm the info message.
4. Open Settings JSON, confirm `imagemagick.presets` has a "My Web" entry with `format: "webp"`, `quality: 70`, and the expected `maxLongEdge`.
5. Right-click an image → **Optimize with Preset** → confirm "My Web" appears in the quick-pick.

- [ ] **Step 7: Commit**

```bash
git add src/messages.ts src/webview/components/ActionBar.svelte src/webview/pages/EditorPage.svelte src/ImageEditorPanel.ts
git commit -m "Add Save as preset button to the editor panel"
```

---

### Task 5: Docs and changelog

**Files:**
- Modify: `README.md` (document presets + one-click)
- Modify: `CHANGELOG.md` (new unreleased/next-version entry)

- [ ] **Step 1: Add a Presets section to `README.md`**

Under `## Features`, add a bullet and a short usage note:

```markdown
- **Presets & one-click optimize** — right-click an image (or a selection) →
  **Optimize with Preset** to write optimized output straight to disk, no panel.
  Presets hold a format, quality, max size, and metadata-strip choice; edit them
  in the `imagemagick.presets` setting, or use **Save as preset** in the panel.
```

- [ ] **Step 2: Add a changelog entry to `CHANGELOG.md`**

Add above the `[0.3.0]` entry (pick the next version number when releasing):

```markdown
## [0.4.0]

- Optimization presets: right-click an image or a multi-selection and pick a
  preset to write optimized output straight to disk, with no panel and no
  dialogs. Presets cover format, quality, max long edge, metadata stripping, and
  whether to write alongside with a suffix or overwrite in place. Three presets
  ship by default (Web WebP, Compress JPEG, PNG to WebP); add your own in the
  `imagemagick.presets` setting or with the new "Save as preset" button in the
  editor panel. The one-click path encodes in the extension host with the same
  WebAssembly engine, so nothing is uploaded and no editor tab opens.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document optimization presets"
```

---

## Self-Review

**Spec coverage:**
- Preset model → Task 1. ✓
- Settings + defaults → Task 1. ✓
- Host encoder (magick-wasm in host) → Task 2. ✓
- One-click command + menu + quick-pick + progress + summary → Task 3. ✓
- Overwrite vs suffix per preset → Task 1 (model) + Task 2 (`presetOutputPath`). ✓
- Save as preset in panel → Task 4. ✓
- `savePreset` message → Task 4. ✓
- Test for `encodePreset` → Task 2. ✓
- Docs/changelog → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. One flagged uncertainty (the editor-state variable name in `EditorPage.svelte`) is called out with how to resolve it, not left blank.

**Type consistency:** `OptimizePreset` fields are identical across Tasks 1, 2, 4. `encodePreset(wasmPath, bytes, preset)` and `presetOutputPath(sourcePath, preset)` match between Task 2's definition and Task 3's calls. The `savePreset` message payload matches between Task 1's message type, Task 3's send, and Task 4's handler.
