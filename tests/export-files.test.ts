import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitStagedFiles,
  generatedAssetPaths,
  pruneStaleGeneratedAssets,
  removeGeneratedManifest,
} from '../scripts/export-files';
import {
  DESIGN_MANIFEST_SCHEMA_VERSION,
  type DesignManifest,
  writeDesignManifest,
} from '../scripts/design-manifest';

function previousManifest(): DesignManifest {
  return {
    schemaVersion: DESIGN_MANIFEST_SCHEMA_VERSION,
    generatedAt: '2026-08-02T00:00:00.000Z',
    figma: { fileKey: 'file-key', fileName: 'Design System' },
    export: { format: 'PNG', scale: 1, suffix: '', assetRoot: '.' },
    document: {
      nodeId: '0:0',
      name: 'Document',
      nodePath: ['Document'],
      type: 'DOCUMENT',
      properties: {},
    },
    components: [
      {
        nodeId: '12:34',
        name: 'Primary Button',
        nodePath: ['Components', 'Buttons', 'Primary Button'],
        type: 'COMPONENT',
        assets: [
          {
            format: 'PNG',
            scale: 1,
            relativePath: 'Components/Buttons/Primary Button.png',
            ninePatchRelativePath: 'Components/Buttons/Primary Button.9.png',
          },
        ],
      },
    ],
  };
}

test('commits staged files before pruning only manifest-owned stale assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'export-files-test-'));
  const staging = path.join(directory, 'staging');
  const output = path.join(directory, 'output');
  try {
    const currentRelativePath = 'Components/Buttons/Primary Button.png';
    const staleRelativePath = 'Components/Buttons/Primary Button.9.png';
    const unrelatedRelativePath = 'keep-me.txt';
    await mkdir(path.join(staging, 'Components/Buttons'), { recursive: true });
    await mkdir(path.join(output, 'Components/Buttons'), { recursive: true });
    await writeFile(path.join(staging, currentRelativePath), 'new');
    await writeFile(path.join(output, currentRelativePath), 'old');
    await writeFile(path.join(output, staleRelativePath), 'stale');
    await writeFile(path.join(output, unrelatedRelativePath), 'unrelated');
    await writeDesignManifest(
      path.join(output, 'design-manifest.json'),
      previousManifest(),
    );

    const committed = await commitStagedFiles(staging, output, [
      path.join(staging, currentRelativePath),
    ]);
    const removed = await pruneStaleGeneratedAssets(
      path.join(output, 'design-manifest.json'),
      output,
      generatedAssetPaths(output, committed),
    );

    assert.equal(
      await readFile(path.join(output, currentRelativePath), 'utf8'),
      'new',
    );
    assert.equal(removed, 1);
    await assert.rejects(access(path.join(output, staleRelativePath)));
    assert.equal(
      await readFile(path.join(output, unrelatedRelativePath), 'utf8'),
      'unrelated',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('removes an existing manifest when persistence is disabled', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'export-files-test-'));
  const manifestPath = path.join(directory, 'design-manifest.json');
  try {
    await writeDesignManifest(manifestPath, previousManifest());
    await removeGeneratedManifest(manifestPath);
    await assert.rejects(access(manifestPath));
    await removeGeneratedManifest(manifestPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects staged paths outside the staging directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'export-files-test-'));
  try {
    const outside = path.join(directory, 'outside.png');
    await writeFile(outside, 'data');
    await assert.rejects(
      commitStagedFiles(
        path.join(directory, 'staging'),
        path.join(directory, 'output'),
        [outside],
      ),
      /outside staging/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
