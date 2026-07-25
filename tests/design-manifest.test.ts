import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DESIGN_MANIFEST_SCHEMA_VERSION,
  createManifestNode,
  readDesignManifest,
  type DesignManifest,
  writeDesignManifest,
} from '../scripts/design-manifest';

export function exampleManifest(): DesignManifest {
  return {
    schemaVersion: DESIGN_MANIFEST_SCHEMA_VERSION,
    generatedAt: '2026-07-25T00:00:00.000Z',
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
        componentSet: { nodeId: '12:1', name: 'Button' },
        dimensions: { width: 120, height: 48 },
        variantProperties: { State: 'Default' },
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

test('writes and reads a structured design manifest', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
  try {
    const manifestPath = path.join(directory, 'design-manifest.json');
    await writeDesignManifest(manifestPath, exampleManifest());
    const manifest = await readDesignManifest(manifestPath);
    assert.equal(manifest.schemaVersion, DESIGN_MANIFEST_SCHEMA_VERSION);
    assert.equal(manifest.components[0].type, 'COMPONENT');
    assert.deepEqual(manifest.components[0].nodePath, [
      'Components',
      'Buttons',
      'Primary Button',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preserves every layer including non-exported mask nodes', () => {
  const document = createManifestNode({
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT',
    children: [
      {
        id: '1:1',
        name: 'Components',
        type: 'CANVAS',
        children: [
          {
            id: '2:1',
            name: 'Card',
            type: 'COMPONENT',
            children: [
              {
                id: '2:2',
                name: 'mask-up',
                type: 'RECTANGLE',
                isMask: true,
                maskType: 'ALPHA',
                visible: true,
                absoluteBoundingBox: {
                  x: 10,
                  y: 20,
                  width: 120,
                  height: 48,
                },
                exportSettings: [],
              },
              {
                id: '2:3',
                name: 'Label',
                type: 'TEXT',
                characters: 'Continue',
              },
            ],
          },
        ],
      },
    ],
  });

  const mask = document.children?.[0].children?.[0].children?.[0];
  assert.equal(mask?.name, 'mask-up');
  assert.equal(mask?.isMask, true);
  assert.equal(mask?.maskType, 'ALPHA');
  assert.deepEqual(mask?.nodePath, [
    'Document',
    'Components',
    'Card',
    'mask-up',
  ]);
  assert.deepEqual(mask?.bounds, {
    x: 10,
    y: 20,
    width: 120,
    height: 48,
  });
  assert.deepEqual(mask?.properties.exportSettings, []);
});
