export interface FigmaTreeNode {
  type: string;
  children?: readonly FigmaTreeNode[];
}

function hasDescendantType(node: FigmaTreeNode, type: string): boolean {
  for (const child of node.children || []) {
    if (child.type === type || hasDescendantType(child, type)) return true;
  }
  return false;
}

export function isBaseComponent(node: FigmaTreeNode): boolean {
  return node.type === 'COMPONENT' && !hasDescendantType(node, 'INSTANCE');
}
