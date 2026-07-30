export interface FigmaTreeNode {
  id?: string;
  type: string;
  children?: readonly FigmaTreeNode[];
  exportSettings?: readonly unknown[];
  visible?: boolean;
  fills?: unknown;
  strokes?: unknown;
  effects?: unknown;
}

export function isBaseComponent(node: FigmaTreeNode): boolean {
  return node.type === 'COMPONENT';
}

const ATOMIC_GRAPHIC_NODE_TYPES = new Set([
  'BOOLEAN_OPERATION',
  'ELLIPSE',
  'LINE',
  'POLYGON',
  'RECTANGLE',
  'REGULAR_POLYGON',
  'STAR',
  'VECTOR',
]);

interface FigmaPaint {
  type?: string;
  visible?: boolean;
  imageRef?: string;
  scaleMode?: string;
  imageTransform?: unknown;
  rotation?: number;
  scalingFactor?: number;
}

function visibleImagePaints(node: FigmaTreeNode): FigmaPaint[] {
  if (!Array.isArray(node.fills)) return [];
  return node.fills.filter((paint): paint is FigmaPaint => {
    if (!paint || typeof paint !== 'object') return false;
    const value = paint as FigmaPaint;
    return value.type === 'IMAGE' && value.visible !== false;
  });
}

export function hasVisibleImageFill(node: FigmaTreeNode): boolean {
  return visibleImagePaints(node).length > 0;
}

function isGraphicComposition(node: FigmaTreeNode): boolean {
  if (node.type !== 'GROUP' || !node.children?.length) return false;
  return node.children
    .filter((child) => child.visible !== false)
    .every(
      (child) =>
        ATOMIC_GRAPHIC_NODE_TYPES.has(child.type) ||
        isGraphicComposition(child),
    );
}

export function isExportableAssetNode(node: FigmaTreeNode): boolean {
  if (node.visible === false) return false;
  if (isBaseComponent(node)) return true;

  if (
    ATOMIC_GRAPHIC_NODE_TYPES.has(node.type) &&
    hasVisibleImageFill(node)
  ) {
    return true;
  }

  const explicitlyMarked = (node.exportSettings?.length ?? 0) > 0;
  return (
    explicitlyMarked &&
    (ATOMIC_GRAPHIC_NODE_TYPES.has(node.type) || isGraphicComposition(node))
  );
}

export function imageAssetDeduplicationKey(
  node: FigmaTreeNode & {
    absoluteBoundingBox?: { width?: number; height?: number };
  },
): string | undefined {
  const paints = visibleImagePaints(node);
  if (!paints.length) return undefined;

  return JSON.stringify({
    paints: paints.map((paint) => ({
      imageRef: paint.imageRef,
      scaleMode: paint.scaleMode,
      imageTransform: paint.imageTransform,
      rotation: paint.rotation,
      scalingFactor: paint.scalingFactor,
    })),
    width: node.absoluteBoundingBox?.width,
    height: node.absoluteBoundingBox?.height,
  });
}

function hasVisibleStyle(styles: unknown): boolean {
  if (!Array.isArray(styles)) return false;
  return Boolean(
    styles.some((style) => {
      if (!style || typeof style !== 'object') return true;
      const value = style as { visible?: boolean; opacity?: number };
      return value.visible !== false && value.opacity !== 0;
    }),
  );
}

export function isRenderableAssetNode(node: FigmaTreeNode): boolean {
  if (!isExportableAssetNode(node)) return false;
  if (!node.children?.length) return true;

  const hasVisibleChild = node.children.some(
    (child) => child.visible !== false,
  );
  return (
    hasVisibleChild ||
    hasVisibleStyle(node.fills) ||
    hasVisibleStyle(node.strokes) ||
    hasVisibleStyle(node.effects)
  );
}
