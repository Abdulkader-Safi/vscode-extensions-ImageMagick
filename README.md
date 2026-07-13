<p align="center">
  <img src="img/logo.png" alt="ImageMagick" width="160" />
</p>

# ImageMagick

A VS Code extension for optimizing images directly inside the editor. Resize, crop, rotate, compress and convert formats — without leaving VS Code, without uploading anything to the cloud.

Powered by [magickwand.js](https://github.com/mmomtchev/magickwand.js) (full ImageMagick-7 bindings for Node).

## Features

- **Resize** — width/height inputs, lock aspect ratio, quick percentage presets
- **Crop** — drag a region on the preview, or type exact coordinates
- **Rotate & Flip** — 90° presets, free-angle slider, horizontal / vertical flip
- **Compress** — quality slider (1–100) for lossy formats
- **Change format** — JPEG, PNG, WebP, GIF, TIFF, BMP (and AVIF where the bundled binary supports it)
- **Live preview** with output size estimate
- **Save As** dialog with a smart default filename (`photo.optimized.webp`) — never overwrites your source
- **Presets & one-click optimize** — right-click an image (or a selection) →
  **Optimize with Preset** to write optimized output straight to disk, no panel.
  Presets hold a format, quality, max size, and metadata-strip choice; edit them
  in the `imagemagick.presets` setting, or use **Save as preset** in the panel.
  Remove one with **ImageMagick: Delete Preset** from the command palette.

## Usage

1. **From the Explorer:** right-click any image file → **Optimize Image with ImageMagick**.
2. **From the command palette:** `Cmd/Ctrl+Shift+P` → **ImageMagick: Open Image** → pick a file.
3. **Drag & drop:** open the panel via the command palette, then drag an image into the preview area.

## Supported formats

Reads anything ImageMagick can read. Writes whichever formats are present in the prebuilt magickwand.js binary on your platform — typically JPEG, PNG, WebP, GIF, TIFF, BMP. The extension probes the available encoders at startup and only shows formats it can actually produce.

## Development

```bash
npm install
npm run watch    # rebuild extension + webview on save
```

The webview is a Svelte 5 + Tailwind v4 SPA. All ImageMagick work runs in the extension host (Node) — the webview only renders a downscaled PNG preview returned via base64.

## License

MIT
