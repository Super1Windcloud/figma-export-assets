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
import { generateComposeModule } from '../scripts/compose-generator';
import {
  DESIGN_MANIFEST_SCHEMA_VERSION,
  type DesignManifest,
  writeDesignManifest,
} from '../scripts/design-manifest';

function exampleManifest(): DesignManifest {
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
      children: [
        {
          nodeId: '1:1',
          name: 'Components',
          nodePath: ['Document', 'Components'],
          type: 'CANVAS',
          properties: {},
          children: [
            {
              nodeId: '12:34',
              name: 'Primary Button',
              nodePath: ['Document', 'Components', 'Primary Button'],
              type: 'COMPONENT',
              bounds: { x: 0, y: 0, width: 120, height: 48 },
              layout: {
                mode: 'HORIZONTAL',
                itemSpacing: 8,
                padding: { top: 12, right: 16, bottom: 12, left: 16 },
              },
              fills: [
                { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.8 } },
              ],
              cornerRadius: 8,
              properties: {},
              children: [
                {
                  nodeId: '12:36',
                  name: 'mask-up',
                  nodePath: [
                    'Document',
                    'Components',
                    'Primary Button',
                    'mask-up',
                  ],
                  type: 'RECTANGLE',
                  isMask: true,
                  maskType: 'ALPHA',
                  bounds: { x: 0, y: 0, width: 120, height: 48 },
                  properties: {},
                },
                {
                  nodeId: '12:37',
                  name: 'Label',
                  nodePath: [
                    'Document',
                    'Components',
                    'Primary Button',
                    'Label',
                  ],
                  type: 'TEXT',
                  characters: 'Continue',
                  bounds: { x: 16, y: 12, width: 88, height: 24 },
                  fills: [
                    { type: 'SOLID', color: { r: 1, g: 1, b: 1 } },
                  ],
                  textStyle: { fontSize: 16, fontWeight: 600 },
                  properties: {},
                },
              ],
            },
            {
              nodeId: '12:35',
              name: 'Text Only',
              nodePath: ['Document', 'Components', 'Text Only'],
              type: 'COMPONENT',
              bounds: { x: 0, y: 60, width: 100, height: 24 },
              properties: {},
            },
          ],
        },
      ],
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
      {
        nodeId: '12:35',
        name: 'Text Only',
        nodePath: ['Components', 'Text Only'],
        type: 'COMPONENT',
        assets: [],
      },
    ],
  };
}

test('generates a Compose module by consuming only the manifest contract', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'compose-test-'));
  try {
    const manifest = exampleManifest();
    const manifestPath = path.join(directory, 'design-manifest.json');
    const originalAsset = path.join(
      directory,
      'Components',
      'Buttons',
      'Primary Button.png',
    );
    const ninePatchAsset = originalAsset.replace(/\.png$/, '.9.png');
    await writeDesignManifest(manifestPath, manifest);
    await mkdir(path.dirname(originalAsset), { recursive: true });
    await writeFile(originalAsset, new Uint8Array([1, 2, 3]));
    await writeFile(ninePatchAsset, new Uint8Array([4, 5, 6]));

    const result = await generateComposeModule(manifestPath, {
      outputDirectory: directory,
      moduleName: 'design-ui',
      packageName: 'com.example.designui',
    });

    assert.equal(result.componentCount, 2);
    assert.equal(result.semanticComponentCount, 2);
    assert.equal(result.fallbackOnlyComponentCount, 0);
    assert.equal(result.resourceCount, 2);
    const kotlinPath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/FigmaComponents.kt',
    );
    const kotlin = await readFile(kotlinPath, 'utf8');
    const buildGradle = await readFile(
      path.join(result.moduleDirectory, 'build.gradle.kts'),
      'utf8',
    );
    assert.match(kotlin, /enum class FigmaComponent/);
    assert.match(kotlin, /PRIMARY_BUTTON/);
    assert.match(kotlin, /COMPONENT_12_35/);
    assert.match(kotlin, /fun FigmaComponentUi/);
    assert.match(kotlin, /fun FigmaPrimaryButton12_34/);
    assert.match(kotlin, /layoutMode = "HORIZONTAL"/);
    assert.match(kotlin, /characters = "Continue"/);
    assert.match(kotlin, /isMask = true/);
    assert.match(buildGradle, /JavaVersion\.VERSION_17/);
    assert.match(buildGradle, /jvmToolchain\(17\)/);
    await access(
      path.join(
        result.moduleDirectory,
        'src/main/res/drawable-nodpi/figma_primary_button_12_34.png',
      ),
    );
    await access(
      path.join(
        result.moduleDirectory,
        'src/main/res/drawable-nodpi/figma_primary_button_12_34_stretch.9.png',
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
