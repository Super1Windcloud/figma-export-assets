export interface FigmaTreeNode {
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

export function isExportableAssetNode(node: FigmaTreeNode): boolean {
  return (
    node.visible !== false &&
    (isBaseComponent(node) || (node.exportSettings?.length ?? 0) > 0)
  );
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
