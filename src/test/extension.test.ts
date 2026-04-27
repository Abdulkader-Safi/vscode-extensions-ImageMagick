import * as assert from "assert";
import * as vscode from "vscode";

suite("ImageMagick", () => {
  test("registers commands", async () => {
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
