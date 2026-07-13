import * as assert from "assert";
import * as path from "path";
import { fileURLToPath } from "url";
import * as vscode from "vscode";
import { resolvePresets, parsePresets, DEFAULT_PRESETS } from "../presets.js";
import type { OptimizePreset } from "../presets.js";
import { encodePreset, presetOutputPath } from "../hostEncoder.js";

suite("presets", () => {
  test("empty input falls back to defaults", () => {
    assert.deepStrictEqual(resolvePresets([]), DEFAULT_PRESETS);
    assert.deepStrictEqual(resolvePresets(undefined), DEFAULT_PRESETS);
  });

  test("drops invalid entries, keeps valid ones", () => {
    const raw = [
      {
        name: "Good",
        format: "webp",
        quality: 80,
        maxLongEdge: 1600,
        stripMetadata: true,
        output: "suffix",
        suffix: ".optimized",
      },
      { name: "NoFormat", quality: 50 },
      { name: "BadFormat", format: "xyz", quality: 50 },
    ];
    const out = resolvePresets(raw);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].name, "Good");
    assert.strictEqual(out[0].format, "webp");
  });

  test("parsePresets never falls back to defaults", () => {
    // The delete command edits the saved list, so it must see an empty list as
    // empty. Falling back to the defaults here would offer to delete presets
    // that are not actually in settings.
    assert.deepStrictEqual(parsePresets([]), []);
    assert.deepStrictEqual(parsePresets(undefined), []);
    assert.strictEqual(
      parsePresets([{ name: "Mine", format: "webp" }]).length,
      1,
    );
  });

  test("clamps quality and normalizes missing optional fields", () => {
    const raw = [{ name: "Clamp", format: "jpg", quality: 999 }];
    const out = resolvePresets(raw);
    assert.strictEqual(out[0].quality, 100);
    assert.strictEqual(out[0].maxLongEdge, null);
    assert.strictEqual(out[0].stripMetadata, false);
    assert.strictEqual(out[0].output, "suffix");
    assert.strictEqual(out[0].suffix, ".optimized");
  });
});

const WEBP_PRESET: OptimizePreset = {
  name: "t",
  format: "webp",
  quality: 80,
  maxLongEdge: 1600,
  stripMetadata: true,
  output: "suffix",
  suffix: ".optimized",
};

// 1x1 red PNG.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

// dist/magick.wasm is produced by the build; the pretest step runs the build first.
// This file compiles to out/test/, so dist/ is two levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(HERE, "..", "..", "dist", "magick.wasm");

suite("hostEncoder", () => {
  test("encodePreset returns webp bytes", async () => {
    const out = await encodePreset(
      WASM_PATH,
      new Uint8Array(ONE_PX_PNG),
      WEBP_PRESET,
    );
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

suite("ImageMagick", () => {
  test("registers commands", async () => {
    // The extension is lazily activated, so trigger activation before checking
    // the command registry.
    await vscode.extensions
      .getExtension("abdulkadersafi.imagemagick")
      ?.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("imagemagick.openImage"),
      "imagemagick.openImage should be registered",
    );
    assert.ok(
      commands.includes("imagemagick.openImageFromExplorer"),
      "imagemagick.openImageFromExplorer should be registered",
    );
  });
});
