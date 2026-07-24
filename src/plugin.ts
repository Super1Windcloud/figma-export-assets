import { isBaseComponent } from './shared/figma-nodes';

// Figma plugin entrypoint.
const EXPORT_FORMAT = import.meta.env.VITE_EXPORT_FORMAT;
const EXPORT_SCALE = Number(import.meta.env.VITE_EXPORT_SCALE);
const EXPORT_SUFFIX = import.meta.env.VITE_EXPORT_SUFFIX;

type SupportedExportFormat = 'PNG' | 'JPG' | 'SVG' | 'PDF';

interface SyncResult {
  baseComponentsUpdated: number;
  nonBaseNodesCleared: number;
  unchanged: number;
  failed: number;
}

function readExportConfig(): ExportSettings {
  const format = EXPORT_FORMAT.toUpperCase() as SupportedExportFormat;

  if (!['PNG', 'JPG', 'SVG', 'PDF'].includes(format)) {
    throw new Error(
      `VITE_EXPORT_FORMAT must be PNG, JPG, SVG or PDF; received "${EXPORT_FORMAT}"`,
    );
  }

  if (format === 'PNG' || format === 'JPG') {
    if (!Number.isFinite(EXPORT_SCALE) || EXPORT_SCALE <= 0) {
      throw new Error(
        `VITE_EXPORT_SCALE must be greater than 0; received "${import.meta.env.VITE_EXPORT_SCALE}"`,
      );
    }

    return {
      format,
      suffix: EXPORT_SUFFIX,
      constraint: { type: 'SCALE', value: EXPORT_SCALE },
    };
  }

  return { format, suffix: EXPORT_SUFFIX };
}

function exportSettingsEqual(
  current: ReadonlyArray<ExportSettings>,
  expected: ReadonlyArray<ExportSettings>,
): boolean {
  return JSON.stringify(current) === JSON.stringify(expected);
}

function syncNode(
  node: SceneNode,
  exportSetting: ExportSettings,
  result: SyncResult,
): void {
  const expected = isBaseComponent(node) ? [exportSetting] : [];

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
  const exportSetting = readExportConfig();
  const result: SyncResult = {
    baseComponentsUpdated: 0,
    nonBaseNodesCleared: 0,
    unchanged: 0,
    failed: 0,
  };

  await figma.loadAllPagesAsync();

  for (const page of figma.root.children) {
    for (const node of page.findAll()) {
      syncNode(node, exportSetting, result);
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
