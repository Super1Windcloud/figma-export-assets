import { copyFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { type DesignManifest, readDesignManifest } from './design-manifest';

function relativeAssetPath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

export async function commitStagedFiles(
  stagingDirectory: string,
  outputDirectory: string,
  stagedPaths: string[],
): Promise<string[]> {
  const stagingRoot = path.resolve(stagingDirectory);
  const outputRoot = path.resolve(outputDirectory);
  const committed: string[] = [];

  for (const stagedPath of stagedPaths) {
    const source = path.resolve(stagedPath);
    if (!source.startsWith(`${stagingRoot}${path.sep}`)) {
      throw new Error(
        `Refusing to commit a file outside staging: ${stagedPath}`,
      );
    }

    const relativePath = path.relative(stagingRoot, source);
    const destination = path.resolve(outputRoot, relativePath);
    if (!destination.startsWith(`${outputRoot}${path.sep}`)) {
      throw new Error(
        `Refusing to write an unsafe asset path: ${relativePath}`,
      );
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    committed.push(destination);
  }

  return committed;
}

export function generatedAssetPaths(
  outputDirectory: string,
  generatedFiles: string[],
): Set<string> {
  return new Set(
    generatedFiles.map((file) => relativeAssetPath(outputDirectory, file)),
  );
}

export async function removeGeneratedManifest(
  manifestPath: string,
): Promise<void> {
  try {
    await unlink(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function pruneStaleGeneratedAssets(
  manifestPath: string,
  outputDirectory: string,
  expected: Set<string>,
): Promise<number> {
  let previous: DesignManifest;
  try {
    previous = await readDesignManifest(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Could not read the previous manifest: ${String(error)}`);
    }
    return 0;
  }

  const previousPaths = new Set<string>();
  for (const entry of [...previous.components, ...(previous.resources || [])]) {
    for (const asset of entry.assets) {
      previousPaths.add(asset.relativePath);
      if (asset.ninePatchRelativePath) {
        previousPaths.add(asset.ninePatchRelativePath);
      }
    }
  }

  const root = path.resolve(outputDirectory);
  let removed = 0;
  for (const relativePath of previousPaths) {
    if (expected.has(relativePath)) continue;
    const target = path.resolve(root, relativePath);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) {
      console.warn(`Skipping unsafe stale asset path: ${relativePath}`);
      continue;
    }
    try {
      await unlink(target);
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed;
}
