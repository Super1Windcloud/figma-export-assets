import { copyFile, mkdir, mkdtemp, rename, rm, unlink } from 'node:fs/promises';
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
  const operations = stagedPaths.map((stagedPath) => {
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
    return { source, relativePath, destination, hadExistingFile: false };
  });

  const destinations = new Set(
    operations.map(({ destination }) => destination),
  );
  if (destinations.size !== operations.length) {
    throw new Error('Refusing to commit duplicate generated asset paths.');
  }

  await mkdir(path.dirname(outputRoot), { recursive: true });
  const transactionRoot = await mkdtemp(
    path.join(path.dirname(outputRoot), '.figma-export-transaction-'),
  );
  const preparedRoot = path.join(transactionRoot, 'prepared');
  const backupRoot = path.join(transactionRoot, 'backup');
  const replaced: typeof operations = [];

  try {
    for (const operation of operations) {
      const prepared = path.join(preparedRoot, operation.relativePath);
      const backup = path.join(backupRoot, operation.relativePath);
      await mkdir(path.dirname(prepared), { recursive: true });
      await copyFile(operation.source, prepared);
      try {
        await mkdir(path.dirname(backup), { recursive: true });
        await copyFile(operation.destination, backup);
        operation.hadExistingFile = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    for (const operation of operations) {
      await mkdir(path.dirname(operation.destination), { recursive: true });
      await rename(
        path.join(preparedRoot, operation.relativePath),
        operation.destination,
      );
      replaced.push(operation);
    }
  } catch (error) {
    for (const operation of replaced.reverse()) {
      if (operation.hadExistingFile) {
        await copyFile(
          path.join(backupRoot, operation.relativePath),
          operation.destination,
        );
      } else {
        try {
          await unlink(operation.destination);
        } catch (rollbackError) {
          if ((rollbackError as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(
              `Could not roll back ${operation.relativePath}: ${String(rollbackError)}`,
            );
          }
        }
      }
    }
    throw error;
  } finally {
    await rm(transactionRoot, { recursive: true, force: true });
  }

  return operations.map(({ destination }) => destination);
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
