const esbuild = require("esbuild");
const esbuildSvelte = require("esbuild-svelte");
const { sveltePreprocess } = require("svelte-preprocess");
const { spawn } = require("child_process");
const fs = require("node:fs");
const path = require("node:path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// The ImageMagick engine (@imagemagick/magick-wasm) runs inside the webview.
// Its JS is bundled into webview.js by esbuild; only the wasm module is copied
// into dist/ and fetched at runtime via a webview resource URI.
function copyMagickAssets() {
  const srcPath = path.resolve(
    __dirname,
    "node_modules",
    "@imagemagick",
    "magick-wasm",
    "dist",
    "magick.wasm",
  );
  const distDir = path.resolve(__dirname, "dist");
  fs.mkdirSync(distDir, { recursive: true });

  if (!fs.existsSync(srcPath)) {
    throw new Error(
      `Missing ${srcPath}. Run \`npm install\` so the ImageMagick wasm is present before packaging.`,
    );
  }
  fs.copyFileSync(srcPath, path.join(distDir, "magick.wasm"));
  console.log("[build] copied magick.wasm into dist/");
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

/**
 * @type {import('esbuild').Plugin}
 */
const postcssPlugin = {
  name: "postcss-plugin",
  setup(build) {
    build.onEnd(() => {
      return new Promise((resolve, reject) => {
        const args = [
          "postcss",
          "./src/webview/index.css",
          "-o",
          "./dist/webview.css",
        ];

        if (production) {
          args.push("--env", "production");
        }

        const postcss = spawn("npx", args, {
          shell: true,
        });

        postcss.stdout.on("data", (data) => {
          console.log(data.toString());
        });

        postcss.stderr.on("data", (data) => {
          console.error(data.toString());
        });

        postcss.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`PostCSS process exited with code ${code}`));
          }
        });
      });
    });
  },
};

async function main() {
  // Build extension
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    // The host no longer touches magickwand — the engine lives in the webview.
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Build webview
  const webviewCtx = await esbuild.context({
    entryPoints: ["src/webview/index.ts"],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    platform: "browser",
    outfile: "dist/webview.js",
    mainFields: ["svelte", "browser", "module", "main"],
    conditions: [
      "svelte",
      "browser",
      production ? "production" : "development",
    ],
    logLevel: "silent",
    plugins: [
      esbuildSvelte({
        preprocess: sveltePreprocess(),
        compilerOptions: { dev: !production },
      }),
      postcssPlugin,
    ],
  });

  if (watch) {
    copyMagickAssets();
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    copyMagickAssets();
    await extensionCtx.dispose();
    await webviewCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
