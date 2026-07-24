import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createNinePatches } from './nine-patch';

type ExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';

interface FigmaExportSetting {
  format?: string;
  suffix?: string;
  constraint?: { type?: string; value?: number };
}

interface FigmaNode {
  id: string;
  name?: string;
  type?: string;
  children?: FigmaNode[];
  exportSettings?: FigmaExportSetting[];
}

interface ExportItem {
  nodeId: string;
  format: ExportFormat;
  scale?: number;
  directory: string[];
  fileName: string;
}

interface DownloadItem extends ExportItem {
  url: string;
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

const FIGMA_TOKEN = process.env.FIGMA_TOKEN?.trim();
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY?.trim();
const EXPORT_OUTPUT_DIR = process.env.EXPORT_OUTPUT_DIR?.trim();
const EXPORT_FORMAT = (
  process.env.EXPORT_FORMAT ||
  process.env.VITE_EXPORT_FORMAT ||
  'PNG'
).toUpperCase();
const EXPORT_SCALE = Number(
  process.env.EXPORT_SCALE || process.env.VITE_EXPORT_SCALE || '1',
);
const EXPORT_SUFFIX =
  process.env.EXPORT_SUFFIX ?? process.env.VITE_EXPORT_SUFFIX ?? '';
const EXPORT_BASE_NODES = process.env.EXPORT_BASE_NODES !== 'false';
const NINE_PATCH_ENABLED = process.env.NINE_PATCH_ENABLED !== 'false';

function requireConfig(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
}

function readExportConfig(): FigmaExportSetting {
  if (!['PNG', 'JPG', 'SVG', 'PDF'].includes(EXPORT_FORMAT)) {
    throw new Error(
      `EXPORT_FORMAT must be PNG, JPG, SVG or PDF; received "${EXPORT_FORMAT}"`,
    );
  }

  if (
    ['PNG', 'JPG'].includes(EXPORT_FORMAT) &&
    (!Number.isFinite(EXPORT_SCALE) || EXPORT_SCALE <= 0 || EXPORT_SCALE > 4)
  ) {
    throw new Error(
      `EXPORT_SCALE must be between 0 and 4; received "${EXPORT_SCALE}"`,
    );
  }

  return {
    format: EXPORT_FORMAT,
    suffix: EXPORT_SUFFIX,
    constraint: ['PNG', 'JPG'].includes(EXPORT_FORMAT)
      ? { type: 'SCALE', value: EXPORT_SCALE }
      : undefined,
  };
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
  globalSetting: FigmaExportSetting,
  parentPath: string[] = [],
  exports: ExportItem[] = [],
): ExportItem[] {
  const nodeName = sanitizePathSegment(node.name || node.type || node.id);
  const currentPath = [...parentPath, nodeName];
  const isBaseNode = !node.children || node.children.length === 0;
  const settings =
    EXPORT_BASE_NODES && isBaseNode
      ? [globalSetting]
      : node.exportSettings || [];

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
    });
  }

  for (const child of node.children || [])
    collectExports(child, globalSetting, currentPath, exports);
  return exports;
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
      const query = new URLSearchParams({
        ids: batch.map((item) => item.nodeId).join(','),
        format: batch[0].format.toLowerCase(),
      });
      if (batch[0].scale !== undefined)
        query.set('scale', String(batch[0].scale));

      const response = await figmaRequest<FigmaImagesResponse>(
        `/images/${fileKey}?${query}`,
        token,
      );
      for (const item of batch) {
        const url = response.images?.[item.nodeId];
        if (url) urls.push({ ...item, url });
        else
          console.warn(
            `Figma did not return an export URL for node ${item.nodeId}`,
          );
      }
    }
  }

  return urls;
}

async function downloadAsset(
  item: DownloadItem,
  outputDirectory: string,
): Promise<string> {
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
  return destination;
}

async function downloadWithConcurrency(
  items: DownloadItem[],
  outputDirectory: string,
): Promise<string[]> {
  let nextIndex = 0;
  const downloaded: string[] = [];

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

async function main(): Promise<void> {
  const token = requireConfig('FIGMA_TOKEN', FIGMA_TOKEN);
  const fileKey = requireConfig('FIGMA_FILE_KEY', FIGMA_FILE_KEY);
  const outputDirectory = path.resolve(
    process.cwd(),
    requireConfig('EXPORT_OUTPUT_DIR', EXPORT_OUTPUT_DIR),
  );
  const globalSetting = readExportConfig();

  console.log(`Reading Figma file ${fileKey}...`);
  const file = await figmaRequest<FigmaFileResponse>(
    `/files/${fileKey}`,
    token,
  );
  const fileDirectoryName = sanitizePathSegment(file.name || fileKey);
  const fileOutputDirectory = path.join(outputDirectory, fileDirectoryName);
  const exports: ExportItem[] = [];
  for (const page of file.document.children || [])
    collectExports(page, globalSetting, [], exports);
  disambiguateFileNames(exports);

  if (exports.length === 0) {
    console.log('No exportable nodes were found.');
    return;
  }

  console.log(`Found ${exports.length} base nodes. Requesting export URLs...`);
  const urls = await getDownloadUrls(fileKey, token, exports);
  const downloaded = await downloadWithConcurrency(urls, fileOutputDirectory);
  if (NINE_PATCH_ENABLED) {
    console.log('Generating Nine-Patch variants with ImageMagick...');
    const generated = await createNinePatches(downloaded);
    console.log(`Generated ${generated.length} Nine-Patch assets.`);
  }
  console.log(
    `Downloaded ${downloaded.length}/${exports.length} assets to ${fileOutputDirectory}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
