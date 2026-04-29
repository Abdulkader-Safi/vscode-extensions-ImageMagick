#!/usr/bin/env node
// Idempotent fetcher for magickwand.js prebuilt native binaries.
// Pulls the per-platform tarballs from the upstream GitHub release and
// extracts each into node_modules/magickwand.js/lib/binding/<platform>-<arch>/
// so the universal .vsix can ship with binaries for every supported OS.
//
// Skips downloads when the target directory already contains magickwand.node.

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const magickwandDir = join(projectRoot, "node_modules", "magickwand.js");
const bindingDir = join(magickwandDir, "lib", "binding");

const PLATFORMS = [
  { platform: "darwin", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "linux", arch: "x64" },
  { platform: "win32", arch: "x64" },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readMagickwandVersion() {
  const pkgPath = join(magickwandDir, "package.json");
  if (!(await exists(pkgPath))) {
    throw new Error(
      `Cannot find ${pkgPath}. Run \`npm install\` before fetch-binaries.mjs.`,
    );
  }
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  return pkg.version;
}

function downloadFollowingRedirects(url, destStream, depth = 0) {
  return new Promise((resolveP, rejectP) => {
    if (depth > 5) {
      rejectP(new Error(`Too many redirects fetching ${url}`));
      return;
    }
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          downloadFollowingRedirects(
            new URL(res.headers.location, url).toString(),
            destStream,
            depth + 1,
          ).then(resolveP, rejectP);
          return;
        }
        if (res.statusCode !== 200) {
          rejectP(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          res.resume();
          return;
        }
        res.pipe(destStream);
        destStream.on("finish", () => resolveP());
        destStream.on("error", rejectP);
        res.on("error", rejectP);
      })
      .on("error", rejectP);
  });
}

function extractTarGz(tarballPath, destDir) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("tar", ["-xzf", tarballPath, "-C", destDir], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", rejectP);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveP();
      } else {
        rejectP(new Error(`tar exited with code ${code}`));
      }
    });
  });
}

async function ensureBinaryFor(platform, arch, version) {
  const target = join(bindingDir, `${platform}-${arch}`);
  const nodeFile = join(target, "magickwand.node");
  if (await exists(nodeFile)) {
    console.log(
      `[fetch-binaries] ${platform}-${arch}: already present, skipping`,
    );
    return;
  }

  const tarball = `${platform}-${arch}.tar.gz`;
  const url = `https://github.com/mmomtchev/magickwand.js/releases/download/v${version}/${tarball}`;
  const tmpFile = join(
    tmpdir(),
    `magickwand-${platform}-${arch}-${process.pid}.tar.gz`,
  );

  console.log(`[fetch-binaries] ${platform}-${arch}: downloading ${url}`);
  const stream = createWriteStream(tmpFile);
  try {
    await downloadFollowingRedirects(url, stream);
  } catch (err) {
    stream.destroy();
    await rm(tmpFile, { force: true });
    throw err;
  }

  console.log(`[fetch-binaries] ${platform}-${arch}: extracting`);
  // The tarballs already contain `lib/binding/<platform>-<arch>/...`
  // so extracting into the magickwand.js root places files where they belong.
  await extractTarGz(tmpFile, magickwandDir);
  await rm(tmpFile, { force: true });

  if (!(await exists(nodeFile))) {
    throw new Error(
      `Extraction completed but ${nodeFile} not found — tarball layout may have changed.`,
    );
  }
  console.log(`[fetch-binaries] ${platform}-${arch}: done`);
}

async function main() {
  await mkdir(bindingDir, { recursive: true });
  const version = await readMagickwandVersion();
  console.log(`[fetch-binaries] magickwand.js version: ${version}`);

  for (const { platform, arch } of PLATFORMS) {
    await ensureBinaryFor(platform, arch, version);
  }

  console.log(`[fetch-binaries] all binaries ready`);
}

main().catch((err) => {
  console.error(`[fetch-binaries] FAILED: ${err.message}`);
  process.exit(1);
});
