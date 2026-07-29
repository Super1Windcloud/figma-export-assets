import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DESIGN_MANIFEST_SCHEMA_VERSION = 2;

export interface ManifestBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

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

export interface ManifestNode {
  nodeId: string;
  name: string;
  nodePath: string[];
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  isMask?: boolean;
  maskType?: string;
  clipsContent?: boolean;
  bounds?: ManifestBounds;
  renderBounds?: ManifestBounds;
  layout?: ManifestLayout;
  layoutPositioning?: string;
  constraints?: { horizontal?: string; vertical?: string };
  characters?: string;
  textStyle?: Record<string, unknown>;
  styles?: Record<string, string>;
  componentId?: string;
  componentProperties?: Record<string, unknown>;
  variantProperties?: Record<string, string>;
  fills?: unknown[];
  strokes?: unknown[];
  effects?: unknown[];
  cornerRadius?: number;
  properties: Record<string, unknown>;
  children?: ManifestNode[];
}

export interface FigmaManifestNode {
  [key: string]: unknown;
  id: string;
  name?: string;
  type: string;
  children?: FigmaManifestNode[];
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  isMask?: boolean;
  maskType?: string;
  clipsContent?: boolean;
  absoluteBoundingBox?: ManifestBounds;
  absoluteRenderBounds?: ManifestBounds | null;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutPositioning?: string;
  constraints?: { horizontal?: string; vertical?: string };
  characters?: string;
  style?: Record<string, unknown>;
  styles?: Record<string, string>;
  componentId?: string;
  componentProperties?: Record<string, unknown>;
  componentPropertyDefinitions?: Record<string, unknown>;
  variantProperties?: Record<string, string>;
  fills?: unknown[];
  strokes?: unknown[];
  effects?: unknown[];
  cornerRadius?: number;
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
    formats?: string[];
    scale?: number;
    suffix: string;
    assetRoot: '.';
  };
  document: ManifestNode;
  components: ManifestComponent[];
}

function nodeLayout(node: FigmaManifestNode): ManifestLayout | undefined {
  const hasLayout =
    node.layoutMode !== undefined ||
    node.itemSpacing !== undefined ||
    node.paddingTop !== undefined ||
    node.paddingRight !== undefined ||
    node.paddingBottom !== undefined ||
    node.paddingLeft !== undefined ||
    node.primaryAxisSizingMode !== undefined ||
    node.counterAxisSizingMode !== undefined;
  if (!hasLayout) return undefined;

  return {
    mode: node.layoutMode,
    itemSpacing: node.itemSpacing,
    padding: {
      top: node.paddingTop || 0,
      right: node.paddingRight || 0,
      bottom: node.paddingBottom || 0,
      left: node.paddingLeft || 0,
    },
    primaryAxisSizingMode: node.primaryAxisSizingMode,
    counterAxisSizingMode: node.counterAxisSizingMode,
  };
}

export function createManifestNode(
  node: FigmaManifestNode,
  parentPath: string[] = [],
): ManifestNode {
  const name = node.name || node.type || node.id;
  const nodePath = [...parentPath, name];
  const children = node.children?.map((child) =>
    createManifestNode(child, nodePath),
  );
  const properties = Object.fromEntries(
    Object.entries(node).filter(
      ([key]) => !['id', 'name', 'type', 'children'].includes(key),
    ),
  );

  return {
    nodeId: node.id,
    name,
    nodePath,
    type: node.type,
    visible: node.visible,
    opacity: node.opacity,
    blendMode: node.blendMode,
    isMask: node.isMask,
    maskType: node.maskType,
    clipsContent: node.clipsContent,
    bounds: node.absoluteBoundingBox,
    renderBounds: node.absoluteRenderBounds || undefined,
    layout: nodeLayout(node),
    layoutPositioning: node.layoutPositioning,
    constraints: node.constraints,
    characters: node.characters,
    textStyle: node.style,
    styles: node.styles,
    componentId: node.componentId,
    componentProperties:
      node.componentProperties || node.componentPropertyDefinitions,
    variantProperties: node.variantProperties,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    cornerRadius: node.cornerRadius,
    properties,
    children: children?.length ? children : undefined,
  };
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
  if (!manifest.document || typeof manifest.document !== 'object')
    throw new Error('The design manifest is missing its document tree.');
  if (!Array.isArray(manifest.components))
    throw new Error('The design manifest is missing its components array.');

  return manifest as DesignManifest;
}
