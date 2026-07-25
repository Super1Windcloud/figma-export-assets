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

    assert.equal(result.componentCount, 1);
    assert.equal(result.resourceCount, 2);
    const kotlinPath = path.join(
      result.moduleDirectory,
      'src/main/java/com/example/designui/FigmaComponents.kt',
    );
    const kotlin = await readFile(kotlinPath, 'utf8');
    assert.match(kotlin, /enum class FigmaComponent/);
    assert.match(kotlin, /PRIMARY_BUTTON/);
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
