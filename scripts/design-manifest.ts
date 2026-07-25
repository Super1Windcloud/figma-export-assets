import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DESIGN_MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestLayout {
  mode?: string;
  itemSpacing?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
}

export interface ManifestAsset {
  format: string;
  scale?: number;
  relativePath: string;
  ninePatchRelativePath?: string;
}

export interface ManifestComponent {
  nodeId: string;
  name: string;
  nodePath: string[];
  type: 'COMPONENT';
  componentSet?: { nodeId: string; name: string };
  dimensions?: { width: number; height: number };
  layout?: ManifestLayout;
  variantProperties?: Record<string, string>;
  componentProperties?: Record<string, unknown>;
  assets: ManifestAsset[];
}

export interface DesignManifest {
  schemaVersion: number;
  generatedAt: string;
  figma: { fileKey: string; fileName: string };
  export: {
    format: string;
    scale?: number;
    suffix: string;
    assetRoot: '.';
  };
  components: ManifestComponent[];
}

export async function writeDesignManifest(
  manifestPath: string,
  manifest: DesignManifest,
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

export async function readDesignManifest(
  manifestPath: string,
): Promise<DesignManifest> {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object')
    throw new Error('The design manifest must be a JSON object.');

  const manifest = parsed as Partial<DesignManifest>;
  if (manifest.schemaVersion !== DESIGN_MANIFEST_SCHEMA_VERSION)
    throw new Error(
      `Unsupported design manifest schema: ${String(manifest.schemaVersion)}`,
    );
  if (!manifest.figma?.fileKey || !manifest.figma.fileName)
    throw new Error('The design manifest is missing Figma file metadata.');
  if (!Array.isArray(manifest.components))
    throw new Error('The design manifest is missing its components array.');

  return manifest as DesignManifest;
}
