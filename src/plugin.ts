import { isBaseComponent } from './shared/figma-nodes';

// Figma plugin entrypoint.
const EXPORT_FORMAT = import.meta.env.VITE_EXPORT_FORMAT;
const EXPORT_FORMATS = import.meta.env.VITE_EXPORT_FORMATS || EXPORT_FORMAT;
const EXPORT_SCALE = Number(import.meta.env.VITE_EXPORT_SCALE);
const EXPORT_SUFFIX = import.meta.env.VITE_EXPORT_SUFFIX;

type SupportedExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';

interface SyncResult {
  baseComponentsUpdated: number;
  nonBaseNodesCleared: number;
  unchanged: number;
  failed: number;
}

function readExportConfigs(): ExportSettings[] {
  const formats = EXPORT_FORMATS.split(',').map(
    (format) => format.trim().toUpperCase() as SupportedExportFormat,
  );

  if (
    formats.length === 0 ||
    formats.some((format) => !['PNG', 'JPG', 'SVG', 'PDF'].includes(format))
  ) {
    throw new Error(
      `VITE_EXPORT_FORMATS must contain PNG, JPG, SVG or PDF; received "${EXPORT_FORMATS}"`,
    );
  }

  if (formats.some((format) => format === 'PNG' || format === 'JPG')) {
    if (!Number.isFinite(EXPORT_SCALE) || EXPORT_SCALE <= 0) {
      throw new Error(
        `VITE_EXPORT_SCALE must be greater than 0; received "${import.meta.env.VITE_EXPORT_SCALE}"`,
      );
    }
  }

  return [...new Set(formats)].map((format) => ({
    format,
    suffix: EXPORT_SUFFIX,
    constraint:
      format === 'PNG' || format === 'JPG'
        ? { type: 'SCALE', value: EXPORT_SCALE }
        : undefined,
  }));
}

function exportSettingsEqual(
  current: ReadonlyArray<ExportSettings>,
  expected: ReadonlyArray<ExportSettings>,
): boolean {
  return JSON.stringify(current) === JSON.stringify(expected);
}

function syncNode(
  node: SceneNode,
  exportSettings: ExportSettings[],
  result: SyncResult,
): void {
  const expected = isBaseComponent(node) ? exportSettings : [];

  if (exportSettingsEqual(node.exportSettings, expected)) {
    result.unchanged += 1;
    return;
  }

  try {
    node.exportSettings = expected;
    if (expected.length > 0) {
      result.baseComponentsUpdated += 1;
    } else {
      result.nonBaseNodesCleared += 1;
    }
  } catch (error) {
    result.failed += 1;
    console.warn(
      `Could not update ${node.type} node "${node.name}" (${node.id})`,
      error,
    );
  }
}

async function syncExportSettings(): Promise<SyncResult> {
  const exportSettings = readExportConfigs();
  const result: SyncResult = {
    baseComponentsUpdated: 0,
    nonBaseNodesCleared: 0,
    unchanged: 0,
    failed: 0,
  };

  await figma.loadAllPagesAsync();

  for (const page of figma.root.children) {
    for (const node of page.findAll()) {
      syncNode(node, exportSettings, result);
    }
  }

  return result;
}

async function main(): Promise<void> {
  try {
    const result = await syncExportSettings();
    const summary = [
      `${result.baseComponentsUpdated} base components updated`,
      `${result.nonBaseNodesCleared} non-base nodes cleared`,
      `${result.unchanged} unchanged`,
      `${result.failed} failed`,
    ].join(', ');

    figma.closePlugin(`Export settings synced: ${summary}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    figma.closePlugin(`Export settings sync failed: ${message}`);
  }
}

void main();
