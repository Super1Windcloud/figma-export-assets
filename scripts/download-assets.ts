import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateComposeModule } from './compose-generator';
import {
  DESIGN_MANIFEST_SCHEMA_VERSION,
  createManifestNode,
  type DesignManifest,
  type FigmaManifestNode,
  type ManifestComponent,
  type ManifestResource,
  writeDesignManifest,
} from './design-manifest';
import { createNinePatches } from './nine-patch';
import {
  commitStagedFiles,
  generatedAssetPaths,
  pruneStaleGeneratedAssets,
  removeGeneratedManifest,
} from './export-files';
import {
  hasVisibleImageFill,
  imageAssetDeduplicationKey,
  isBaseComponent,
  isRenderableAssetNode,
} from '../src/shared/figma-nodes';

type ExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';

interface FigmaExportSetting {
  format?: string;
  suffix?: string;
  constraint?: { type?: string; value?: number };
}

interface FigmaNode extends FigmaManifestNode {
  id: string;
  name?: string;
  type: string;
  children?: FigmaNode[];
  exportSettings?: FigmaExportSetting[];
  absoluteBoundingBox?: { width?: number; height?: number };
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  variantProperties?: Record<string, string>;
}

interface ExportItem {
  nodeId: string;
  format: ExportFormat;
  scale?: number;
  directory: string[];
  fileName: string;
  nodeName: string;
  nodePath: string[];
  sourceNode: FigmaNode;
  componentSet?: { nodeId: string; name: string };
}

interface DownloadItem extends ExportItem {
  url: string;
}

interface DownloadedAsset extends ExportItem {
  destination: string;
}

interface FigmaFileResponse {
  name?: string;
  document: FigmaNode;
}

interface FigmaImagesResponse {
  images?: Record<string, string | null>;
}

const FIGMA_API_BASE_URL = 'https://api.figma.com/v1';
const IMAGE_BATCH_SIZE = 50;
const DOWNLOAD_CONCURRENCY = 8;
const IMAGE_URL_MAX_ATTEMPTS = 3;
const IMAGE_URL_RETRY_DELAY_MS = 500;

const FIGMA_TOKEN = process.env.FIGMA_TOKEN?.trim();
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY?.trim();
const EXPORT_OUTPUT_DIR = process.env.EXPORT_OUTPUT_DIR?.trim();
const EXPORT_FORMATS = (
  process.env.EXPORT_FORMATS ||
  process.env.EXPORT_FORMAT ||
  process.env.VITE_EXPORT_FORMATS ||
  process.env.VITE_EXPORT_FORMAT ||
  'PNG,SVG'
)
  .split(',')
  .map((format) => format.trim().toUpperCase())
  .filter(Boolean);
const EXPORT_SCALE = Number(
  process.env.EXPORT_SCALE || process.env.VITE_EXPORT_SCALE || '1',
);
const EXPORT_SUFFIX =
  process.env.EXPORT_SUFFIX ?? process.env.VITE_EXPORT_SUFFIX ?? '';
const EXPORT_BASE_COMPONENTS =
  process.env.EXPORT_BASE_COMPONENTS !== 'false' &&
  process.env.EXPORT_BASE_NODES !== 'false';
const NINE_PATCH_ENABLED = process.env.NINE_PATCH_ENABLED !== 'false';
const DESIGN_MANIFEST_ENABLED = process.env.DESIGN_MANIFEST_ENABLED !== 'false';
const COMPOSE_GENERATOR_ENABLED =
  process.env.COMPOSE_GENERATOR_ENABLED === 'true';
const COMPOSE_MODULE_NAME =
  process.env.COMPOSE_MODULE_NAME?.trim() || 'figma-compose-ui';
const COMPOSE_PACKAGE_NAME =
  process.env.COMPOSE_PACKAGE_NAME?.trim() || 'com.generated.figmaui';

function requireConfig(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
}

function readExportConfigs(): FigmaExportSetting[] {
  if (
    EXPORT_FORMATS.length === 0 ||
    EXPORT_FORMATS.some(
      (format) => !['PNG', 'JPG', 'SVG', 'PDF'].includes(format),
    )
  ) {
    throw new Error(
      `EXPORT_FORMATS must contain PNG, JPG, SVG or PDF; received "${EXPORT_FORMATS.join(',')}"`,
    );
  }

  if (
    EXPORT_FORMATS.some((format) => ['PNG', 'JPG'].includes(format)) &&
    (!Number.isFinite(EXPORT_SCALE) || EXPORT_SCALE <= 0 || EXPORT_SCALE > 4)
  ) {
    throw new Error(
      `EXPORT_SCALE must be between 0 and 4; received "${EXPORT_SCALE}"`,
    );
  }

  return [...new Set(EXPORT_FORMATS)].map((format) => ({
    format,
    suffix: EXPORT_SUFFIX,
    constraint: ['PNG', 'JPG'].includes(format)
      ? { type: 'SCALE', value: EXPORT_SCALE }
      : undefined,
  }));
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return sanitized || 'unnamed';
}

function getExtension(format: ExportFormat): string {
  return format.toLowerCase();
}

function collectExports(
  node: FigmaNode,
  globalSettings: FigmaExportSetting[],
  parentPath: string[] = [],
  exports: ExportItem[] = [],
  componentSet?: { nodeId: string; name: string },
): ExportItem[] {
  const nodeName = sanitizePathSegment(node.name || node.type || node.id);
  const currentPath = [...parentPath, nodeName];
  let settings = EXPORT_BASE_COMPONENTS
    ? isRenderableAssetNode(node)
      ? globalSettings
      : []
    : node.exportSettings || [];

  if (!isBaseComponent(node) && hasVisibleImageFill(node)) {
    settings = settings.filter((setting) =>
      ['PNG', 'JPG'].includes(setting.format?.toUpperCase() || ''),
    );
  }

  for (const setting of settings) {
    const format = setting.format?.toUpperCase() as ExportFormat | undefined;
    if (!format || !['PNG', 'JPG', 'SVG', 'PDF'].includes(format)) {
      console.warn(
        `Skipping unsupported export format on ${node.id}: ${setting.format}`,
      );
      continue;
    }

    const scale =
      ['PNG', 'JPG'].includes(format) && setting.constraint?.type === 'SCALE'
        ? setting.constraint.value
        : undefined;
    const suffix = sanitizePathSegment(setting.suffix || '');
    const normalizedNodeName =
      NINE_PATCH_ENABLED &&
      format === 'PNG' &&
      nodeName.toLowerCase().endsWith('.9')
        ? nodeName.slice(0, -2)
        : nodeName;
    exports.push({
      nodeId: node.id,
      format,
      scale,
      directory: parentPath,
      fileName: `${normalizedNodeName}${suffix === 'unnamed' ? '' : suffix}.${getExtension(format)}`,
      nodeName,
      nodePath: currentPath,
      sourceNode: node,
      componentSet,
    });
  }

  const childComponentSet =
    node.type === 'COMPONENT_SET'
      ? { nodeId: node.id, name: nodeName }
      : componentSet;
  for (const child of node.children || [])
    collectExports(
      child,
      globalSettings,
      currentPath,
      exports,
      childComponentSet,
    );
  return exports;
}

function deduplicateImageExports(exports: ExportItem[]): void {
  const preferredNodeByImage = new Map<string, string>();
  for (const item of exports) {
    if (isBaseComponent(item.sourceNode)) continue;
    const key = imageAssetDeduplicationKey(item.sourceNode);
    if (!key) continue;
    const current = preferredNodeByImage.get(key);
    if (!current || (current.startsWith('I') && !item.nodeId.startsWith('I'))) {
      preferredNodeByImage.set(key, item.nodeId);
    }
  }

  const unique = exports.filter((item) => {
    if (isBaseComponent(item.sourceNode)) return true;
    const key = imageAssetDeduplicationKey(item.sourceNode);
    return !key || preferredNodeByImage.get(key) === item.nodeId;
  });
  exports.splice(0, exports.length, ...unique);
}

function disambiguateFileNames(exports: ExportItem[]): void {
  const usedPaths = new Set<string>();

  for (const item of exports) {
    const originalPath = path
      .join(...item.directory, item.fileName)
      .toLowerCase();
    if (!usedPaths.has(originalPath)) {
      usedPaths.add(originalPath);
      continue;
    }

    const extension = path.extname(item.fileName);
    const baseName = path.basename(item.fileName, extension);
    const nodeSuffix = item.nodeId.replace(/:/g, '-');
    let duplicateIndex = 1;
    let candidate = `${baseName}__${nodeSuffix}${extension}`;
    while (
      usedPaths.has(path.join(...item.directory, candidate).toLowerCase())
    ) {
      duplicateIndex += 1;
      candidate = `${baseName}__${nodeSuffix}-${duplicateIndex}${extension}`;
    }

    item.fileName = candidate;
    usedPaths.add(path.join(...item.directory, candidate).toLowerCase());
  }
}

function groupExports(exports: ExportItem[]): ExportItem[][] {
  const groups = new Map<string, ExportItem[]>();
  for (const item of exports) {
    const key = `${item.format}:${item.scale ?? ''}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

async function figmaRequest<T>(pathname: string, token: string): Promise<T> {
  const response = await fetch(`${FIGMA_API_BASE_URL}${pathname}`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!response.ok)
    throw new Error(`Figma API ${response.status}: ${await response.text()}`);
  return (await response.json()) as Promise<T>;
}

async function getDownloadUrls(
  fileKey: string,
  token: string,
  exports: ExportItem[],
): Promise<DownloadItem[]> {
  const urls: DownloadItem[] = [];

  for (const group of groupExports(exports)) {
    for (const batch of chunk(group, IMAGE_BATCH_SIZE)) {
      let pending = batch;
      for (
        let attempt = 1;
        attempt <= IMAGE_URL_MAX_ATTEMPTS && pending.length > 0;
        attempt += 1
      ) {
        const query = new URLSearchParams({
          ids: pending.map((item) => item.nodeId).join(','),
          format: pending[0].format.toLowerCase(),
        });
        if (pending[0].scale !== undefined)
          query.set('scale', String(pending[0].scale));

        const response = await figmaRequest<FigmaImagesResponse>(
          `/images/${fileKey}?${query}`,
          token,
        );
        const unresolved: ExportItem[] = [];
        for (const item of pending) {
          const url = response.images?.[item.nodeId];
          if (url) urls.push({ ...item, url });
          else unresolved.push(item);
        }
        pending = unresolved;

        if (pending.length > 0 && attempt < IMAGE_URL_MAX_ATTEMPTS) {
          console.log(
            `Retrying ${pending.length} ${batch[0].format} export URLs (attempt ${attempt + 1}/${IMAGE_URL_MAX_ATTEMPTS})...`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, IMAGE_URL_RETRY_DELAY_MS),
          );
        }
      }

      for (const item of pending)
        console.warn(
          `Figma did not return a ${item.format} export URL for node ${item.nodeId} (${item.nodeName}) after ${IMAGE_URL_MAX_ATTEMPTS} attempts`,
        );
    }
  }

  return urls;
}

async function downloadAsset(
  item: DownloadItem,
  outputDirectory: string,
): Promise<DownloadedAsset> {
  const response = await fetch(item.url);
  if (!response.ok)
    throw new Error(
      `Download failed for node ${item.nodeId}: HTTP ${response.status}`,
    );
  const directory = path.join(outputDirectory, ...item.directory);
  const destination = path.join(directory, item.fileName);
  await mkdir(directory, { recursive: true });
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()), {
    flag: 'w',
  });
  console.log(`Saved ${path.relative(outputDirectory, destination)}`);
  return { ...item, destination };
}

async function downloadWithConcurrency(
  items: DownloadItem[],
  outputDirectory: string,
): Promise<DownloadedAsset[]> {
  let nextIndex = 0;
  const downloaded: DownloadedAsset[] = [];

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      downloaded.push(await downloadAsset(item, outputDirectory));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, items.length) }, () =>
      worker(),
    ),
  );
  return downloaded;
}

function relativeAssetPath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function buildManifest(
  fileKey: string,
  fileName: string,
  fileOutputDirectory: string,
  document: FigmaNode,
  exports: ExportItem[],
  downloaded: DownloadedAsset[],
  ninePatches: string[],
): DesignManifest {
  const downloadsByNode = new Map<string, DownloadedAsset[]>();
  for (const asset of downloaded) {
    const assets = downloadsByNode.get(asset.nodeId) || [];
    assets.push(asset);
    downloadsByNode.set(asset.nodeId, assets);
  }
  const ninePatchSet = new Set(ninePatches.map((asset) => path.resolve(asset)));
  const components = new Map<string, ManifestComponent>();
  const resources = new Map<string, ManifestResource>();

  for (const item of exports) {
    const source = item.sourceNode;
    const width = source.absoluteBoundingBox?.width;
    const height = source.absoluteBoundingBox?.height;
    const assets = (downloadsByNode.get(item.nodeId) || []).map((asset) => {
      const ninePatchPath = asset.destination.replace(/\.png$/i, '.9.png');
      return {
        format: asset.format,
        scale: asset.scale,
        relativePath: relativeAssetPath(fileOutputDirectory, asset.destination),
        ninePatchRelativePath: ninePatchSet.has(path.resolve(ninePatchPath))
          ? relativeAssetPath(fileOutputDirectory, ninePatchPath)
          : undefined,
      };
    });
    const dimensions =
      typeof width === 'number' && typeof height === 'number'
        ? { width, height }
        : undefined;

    if (!isBaseComponent(source)) {
      if (!resources.has(item.nodeId)) {
        resources.set(item.nodeId, {
          nodeId: item.nodeId,
          name: item.nodeName,
          nodePath: item.nodePath,
          type: source.type,
          dimensions,
          assets,
        });
      }
      continue;
    }

    if (components.has(item.nodeId)) continue;
    const hasLayout =
      source.layoutMode !== undefined ||
      source.itemSpacing !== undefined ||
      source.paddingTop !== undefined;
    components.set(item.nodeId, {
      nodeId: item.nodeId,
      name: item.nodeName,
      nodePath: item.nodePath,
      type: 'COMPONENT',
      componentSet: item.componentSet,
      dimensions,
      layout: hasLayout
        ? {
            mode: source.layoutMode,
            itemSpacing: source.itemSpacing,
            padding: {
              top: source.paddingTop || 0,
              right: source.paddingRight || 0,
              bottom: source.paddingBottom || 0,
              left: source.paddingLeft || 0,
            },
            primaryAxisSizingMode: source.primaryAxisSizingMode,
            counterAxisSizingMode: source.counterAxisSizingMode,
          }
        : undefined,
      variantProperties: source.variantProperties,
      componentProperties: source.componentPropertyDefinitions,
      assets,
    });
  }

  return {
    schemaVersion: DESIGN_MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    figma: { fileKey, fileName },
    export: {
      format: EXPORT_FORMATS[0],
      formats: [...new Set(EXPORT_FORMATS)],
      scale: EXPORT_FORMATS.some((format) => ['PNG', 'JPG'].includes(format))
        ? EXPORT_SCALE
        : undefined,
      suffix: EXPORT_SUFFIX,
      assetRoot: '.',
    },
    document: createManifestNode(document, []),
    components: [...components.values()],
    resources: [...resources.values()],
  };
}

async function main(): Promise<void> {
  const token = requireConfig('FIGMA_TOKEN', FIGMA_TOKEN);
  const fileKey = requireConfig('FIGMA_FILE_KEY', FIGMA_FILE_KEY);
  const outputDirectory = path.resolve(
    process.cwd(),
    requireConfig('EXPORT_OUTPUT_DIR', EXPORT_OUTPUT_DIR),
  );
  const globalSettings = readExportConfigs();

  console.log(`Reading Figma file ${fileKey}...`);
  const file = await figmaRequest<FigmaFileResponse>(
    `/files/${fileKey}`,
    token,
  );
  const fileDirectoryName = sanitizePathSegment(file.name || fileKey);
  const fileOutputDirectory = path.join(outputDirectory, fileDirectoryName);
  const manifestPath = path.join(fileOutputDirectory, 'design-manifest.json');
  const exports: ExportItem[] = [];
  for (const page of file.document.children || [])
    collectExports(page, globalSettings, [], exports);
  deduplicateImageExports(exports);
  disambiguateFileNames(exports);
  if (exports.length === 0) console.log('No exportable nodes were found.');
  else
    console.log(
      `Found ${new Set(exports.map((item) => item.nodeId)).size} asset nodes (${exports.length} files). Requesting export URLs...`,
    );
  const urls =
    exports.length > 0 ? await getDownloadUrls(fileKey, token, exports) : [];
  const missingUrlCount = exports.length - urls.length;
  if (missingUrlCount > 0)
    throw new Error(
      `Export incomplete: Figma returned no URL for ${missingUrlCount}/${exports.length} requested files after ${IMAGE_URL_MAX_ATTEMPTS} attempts. Existing generated assets were left unchanged.`,
    );

  await mkdir(fileOutputDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'figma-asset-export-'),
  );
  let downloaded: DownloadedAsset[] = [];
  let ninePatches: string[] = [];
  try {
    const stagedDownloads = await downloadWithConcurrency(
      urls,
      stagingDirectory,
    );
    let stagedNinePatches: string[] = [];
    if (NINE_PATCH_ENABLED) {
      console.log('Generating Nine-Patch variants with ImageMagick...');
      stagedNinePatches = await createNinePatches(
        stagedDownloads.map((asset) => asset.destination),
      );
      console.log(`Generated ${stagedNinePatches.length} Nine-Patch assets.`);
    }

    const committedPaths = await commitStagedFiles(
      stagingDirectory,
      fileOutputDirectory,
      [
        ...stagedDownloads.map((asset) => asset.destination),
        ...stagedNinePatches,
      ],
    );
    const committedByStagedPath = new Map(
      [
        ...stagedDownloads.map((asset) => asset.destination),
        ...stagedNinePatches,
      ].map((stagedPath, index) => [stagedPath, committedPaths[index]]),
    );
    downloaded = stagedDownloads.map((asset) => ({
      ...asset,
      destination: committedByStagedPath.get(asset.destination)!,
    }));
    ninePatches = stagedNinePatches.map((asset) =>
      committedByStagedPath.get(asset)!,
    );

    const expected = generatedAssetPaths(fileOutputDirectory, [
      ...downloaded.map((asset) => asset.destination),
      ...ninePatches,
    ]);
    const staleAssetCount = await pruneStaleGeneratedAssets(
      manifestPath,
      fileOutputDirectory,
      expected,
    );
    if (staleAssetCount > 0) {
      console.log(`Removed ${staleAssetCount} stale generated assets.`);
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  const manifest = buildManifest(
    fileKey,
    file.name || fileKey,
    fileOutputDirectory,
    file.document,
    exports,
    downloaded,
    ninePatches,
  );
  let generatorManifestPath = manifestPath;
  let temporaryDirectory: string | undefined;
  if (DESIGN_MANIFEST_ENABLED) {
    await writeDesignManifest(manifestPath, manifest);
    console.log(`Saved ${path.relative(outputDirectory, manifestPath)}`);
  } else if (COMPOSE_GENERATOR_ENABLED) {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'figma-design-manifest-'),
    );
    generatorManifestPath = path.join(
      temporaryDirectory,
      'design-manifest.json',
    );
    await writeDesignManifest(generatorManifestPath, manifest);
  }

  if (COMPOSE_GENERATOR_ENABLED) {
    try {
      const result = await generateComposeModule(generatorManifestPath, {
        outputDirectory: fileOutputDirectory,
        moduleName: COMPOSE_MODULE_NAME,
        packageName: COMPOSE_PACKAGE_NAME,
        assetRoot: fileOutputDirectory,
      });
      console.log(
        `Generated Compose module with ${result.semanticComponentCount}/${result.componentCount} semantic components, ${result.fallbackOnlyComponentCount} fallback-only components, and ${result.resourceCount} fallback resources at ${result.moduleDirectory}`,
      );
    } finally {
      if (temporaryDirectory)
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
  if (!DESIGN_MANIFEST_ENABLED) {
    await removeGeneratedManifest(manifestPath);
  }
  console.log(
    `Downloaded ${downloaded.length}/${exports.length} files from ${new Set(exports.map((item) => item.nodeId)).size} asset nodes to ${fileOutputDirectory}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
