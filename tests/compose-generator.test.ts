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
              fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.8 } }],
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
                  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
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
    resources: [
      {
        nodeId: '34:244',
        name: 'Home',
        nodePath: ['Screens', 'Home'],
        type: 'FRAME',
        assets: [
          {
            format: 'PNG',
            source: 'IMAGE_FILL',
            imageRef: 'home-background-ref',
            paintIndex: 0,
            relativePath: 'Screens/Home/background.png',
          },
        ],
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
    const backgroundAsset = path.join(
      directory,
      'Screens',
      'Home',
      'background.png',
    );
    await writeDesignManifest(manifestPath, manifest);
    await mkdir(path.dirname(originalAsset), { recursive: true });
    await writeFile(originalAsset, new Uint8Array([1, 2, 3]));
    await writeFile(ninePatchAsset, new Uint8Array([4, 5, 6]));
    await mkdir(path.dirname(backgroundAsset), { recursive: true });
    await writeFile(backgroundAsset, new Uint8Array([7, 8, 9]));

    const result = await generateComposeModule(manifestPath, {
      outputDirectory: directory,
      moduleName: 'design-ui',
      packageName: 'com.example.designui',
      compileSdk: 36,
      minSdk: 24,
      composeBomVersion: '2026.06.01',
    });

    assert.equal(result.componentCount, 2);
    assert.equal(result.semanticComponentCount, 2);
    assert.equal(result.fallbackOnlyComponentCount, 0);
    assert.equal(result.resourceCount, 3);
    assert.equal(result.designResourceCount, 1);
    const registryPath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/FigmaComponentRegistry.kt',
    );
    const componentPath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/components/buttons/FigmaPrimaryButton12_34.kt',
    );
    const runtimePath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/runtime/FigmaRuntime.kt',
    );
    const colorsPath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/tokens/FigmaColors.kt',
    );
    const assetsPath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/assets/FigmaAssets.kt',
    );
    const registry = await readFile(registryPath, 'utf8');
    const component = await readFile(componentPath, 'utf8');
    const runtime = await readFile(runtimePath, 'utf8');
    const colors = await readFile(colorsPath, 'utf8');
    const assets = await readFile(assetsPath, 'utf8');
    const buildGradle = await readFile(
      path.join(result.moduleDirectory, 'build.gradle.kts'),
      'utf8',
    );
    assert.match(registry, /enum class FigmaComponent/);
    assert.match(registry, /PRIMARY_BUTTON/);
    assert.match(registry, /COMPONENT_12_35/);
    assert.match(registry, /fun FigmaComponentUi/);
    assert.match(component, /fun FigmaPrimaryButton12_34/);
    assert.match(component, /layoutMode = "HORIZONTAL"/);
    assert.match(component, /characters = "Continue"/);
    assert.match(component, /isMask = true/);
    assert.match(component, /FigmaColors\.ColorFF1A33CC/);
    assert.match(runtime, /data class GeneratedFigmaNode/);
    assert.match(colors, /ColorFF1A33CC/);
    assert.match(assets, /enum class FigmaAsset/);
    assert.match(assets, /home-background-ref/);
    assert.match(buildGradle, /JavaVersion\.VERSION_17/);
    assert.match(buildGradle, /jvmToolchain\(17\)/);
    assert.match(buildGradle, /compileSdk = 36/);
    assert.match(buildGradle, /minSdk = 24/);
    assert.match(buildGradle, /compose-bom:2026\.06\.01/);
    await access(
      path.join(
        result.moduleDirectory,
        'src/main/res/drawable-nodpi/figma_primary_button_12_34.png',
      ),
    );
    await access(
      path.join(
        result.moduleDirectory,
        'src/main/res/drawable-nodpi/figma_asset_home_34_244_1.png',
      ),
    );
    await assert.rejects(
      access(
        path.join(
          result.moduleDirectory,
          'src/main/java/com/example/designui/FigmaComponents.kt',
        ),
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
