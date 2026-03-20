import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_WASM_TARBALL =
  'https://github.com/olegische/xcodex/releases/download/xcodex-wasm/xcodex-wasm.tar.gz';
const DEFAULT_XROUTER_TARBALL =
  'https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDir = resolve(projectRoot, 'public');
const pkgDir = join(publicDir, 'pkg');
const xrouterDir = join(publicDir, 'xrouter-browser');

async function main() {
  const buildId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

  await prepareBundle({
    label: 'wasm runtime',
    source: process.env.XCODEX_WASM_TARBALL || DEFAULT_WASM_TARBALL,
    outputDir: pkgDir,
    currentSubdir: 'current',
    manifestPath: '/pkg/manifest.json',
    entryFile: 'codex_wasm_browser.js',
    wasmFile: 'codex_wasm_browser_bg.wasm',
    requiredFiles: ['codex_wasm_browser.js', 'codex_wasm_browser_bg.wasm'],
    buildId,
  });

  await prepareBundle({
    label: 'xrouter-browser',
    source: process.env.XROUTER_BROWSER_TARBALL || DEFAULT_XROUTER_TARBALL,
    outputDir: xrouterDir,
    currentSubdir: 'current',
    manifestPath: '/xrouter-browser/manifest.json',
    entryFile: 'xrouter_browser.js',
    wasmFile: 'xrouter_browser_bg.wasm',
    requiredFiles: ['xrouter_browser.js', 'xrouter_browser_bg.wasm'],
    buildId,
  });

  console.log('Prepared WASM assets:');
  console.log(`  pkg manifest: ${join(pkgDir, 'manifest.json')}`);
  console.log(`  xrouter manifest: ${join(xrouterDir, 'manifest.json')}`);
}

async function prepareBundle({
  label,
  source,
  outputDir,
  currentSubdir,
  manifestPath,
  entryFile,
  wasmFile,
  requiredFiles,
  buildId,
}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'xcodexui-wasm-'));
  try {
    const tarballPath = await resolveTarball(source, tempRoot, label);
    await extractTarball(tarballPath, tempRoot);
    const bundleRoot = await findBundleRoot(tempRoot, requiredFiles);
    const currentDir = join(outputDir, currentSubdir);
    await rm(currentDir, { recursive: true, force: true });
    await mkdir(currentDir, { recursive: true });
    await cp(bundleRoot, currentDir, { recursive: true });
    await writeManifest(join(outputDir, 'manifest.json'), {
      buildId,
      entry: manifestPath.replace('/manifest.json', `/current/${entryFile}`),
      wasm: manifestPath.replace('/manifest.json', `/current/${wasmFile}`),
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function resolveTarball(source, tempRoot, label) {
  if (/^https?:\/\//u.test(source)) {
    const response = await fetch(source);
    if (!response.ok || response.body === null) {
      throw new Error(`failed to download ${label} tarball: ${response.status} ${response.statusText}`);
    }
    const targetPath = join(tempRoot, basename(new URL(source).pathname) || 'bundle.tar.gz');
    await pipeline(response.body, createWriteStream(targetPath));
    return targetPath;
  }

  const resolved = resolve(source);
  await stat(resolved);
  return resolved;
}

async function extractTarball(tarballPath, destDir) {
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', destDir]);
}

async function findBundleRoot(rootDir, requiredFiles) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    const entryNames = new Set(entries.map((entry) => entry.name));
    if (requiredFiles.every((file) => entryNames.has(file))) {
      return current;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(join(current, entry.name));
      }
    }
  }
  throw new Error(`tarball did not unpack into a valid bundle with: ${requiredFiles.join(', ')}`);
}

async function writeManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
