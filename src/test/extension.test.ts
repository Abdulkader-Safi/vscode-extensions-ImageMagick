import * as assert from "assert";
import * as vscode from "vscode";
import { resolvePresets, DEFAULT_PRESETS } from "../presets.js";

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
