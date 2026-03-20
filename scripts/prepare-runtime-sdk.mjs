import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const vendorRoot = resolve(projectRoot, '.vendor', 'xcodex-runtime');
const unpackedPackageDir = join(vendorRoot, 'package');

async function main() {
  const source = process.env.XCODEX_RUNTIME_TARBALL?.trim();
  if (!source) {
    throw new Error('XCODEX_RUNTIME_TARBALL is required.');
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'xcodexui-runtime-sdk-'));
  try {
    const tarballPath = await resolveTarball(source, tempRoot);
    await extractTarball(tarballPath, tempRoot);
    const packageDir = await findPackageRoot(tempRoot);
    await stat(join(packageDir, 'package.json'));
    await stat(join(packageDir, 'dist', 'index.js'));

    await rm(vendorRoot, { recursive: true, force: true });
    await mkdir(vendorRoot, { recursive: true });
    await cp(packageDir, unpackedPackageDir, { recursive: true });

    console.log(`Prepared runtime SDK at ${unpackedPackageDir}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function resolveTarball(source, tempRoot) {
  if (/^https?:\/\//u.test(source)) {
    const response = await fetch(source);
    if (!response.ok || response.body === null) {
      throw new Error(`failed to download runtime SDK tarball: ${response.status} ${response.statusText}`);
    }
    const targetPath = join(tempRoot, basename(new URL(source).pathname) || 'xcodex-runtime.tgz');
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

async function findPackageRoot(rootDir) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has('package.json') && names.has('dist')) {
      return current;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(join(current, entry.name));
      }
    }
  }
  throw new Error('runtime SDK tarball did not unpack into a valid npm package');
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
