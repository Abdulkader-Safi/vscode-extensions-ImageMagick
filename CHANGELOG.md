# Change Log

All notable changes to the "vs-code-extension-svelte-starter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.0]

- Optimization presets: right-click an image or a multi-selection and pick a
  preset to write optimized output straight to disk, with no panel and no
  dialogs. Presets cover format, quality, max long edge, metadata stripping, and
  whether to write alongside with a suffix or overwrite in place. Three presets
  ship by default (Web WebP, Compress JPEG, PNG to WebP); add your own in the
  `imagemagick.presets` setting or with the new "Save as preset" button in the
  editor panel. The one-click path encodes in the extension host with the same
  WebAssembly engine, so nothing is uploaded and no editor tab opens.

## [0.3.0]

- Fixed drag-and-drop from the VS Code Explorer. Dragging an image from the
  Explorer onto the preview did nothing, because those drops carry only a file
  URI, not a file the webview could read. The dropped file is now loaded off
  disk through the extension host, the same path the context menu uses. Drags
  from Finder / File Explorer keep working as before.

## [0.2.0]

- Fixed a hard crash on Windows (and any platform without a matching native
  binary). The extension no longer loads a native ImageMagick addon into the
  extension host, which on some machines faulted with an access violation
  (`0xC0000005`) and took the whole extension host down.
- The image engine now runs as single-threaded WebAssembly
  (`@imagemagick/magick-wasm`) inside the webview. It works on every OS and CPU
  architecture, including Windows on ARM, with no per-platform binaries.
- A failed decode/encode now surfaces as an error message instead of crashing.
- The package is much smaller: one ~14 MB wasm module instead of four bundled
  native builds (.vsix down from ~88 MB to ~17 MB).

## [0.1.0]

- Bulk edit: select multiple images in the Explorer (or via `Open Image`) to
  edit and export them together. Sidebar lists files, pipeline settings carry
  across the set, and **Save All** writes them to a chosen folder.
- Movable & resizable crop box: drag inside the box to move it, drag any of
  the eight handles to resize. Cursor switches to indicate the active region.
- Crop preview no longer "zooms in" — the full image stays visible with the
  crop box overlaid; the cropped region is what gets exported on save.
- Author credit + portfolio link in the action bar.

## [0.0.4]

- Initial release
