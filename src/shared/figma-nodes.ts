export interface FigmaTreeNode {
  type: string;
  children?: readonly FigmaTreeNode[];
}

export function isBaseComponent(node: FigmaTreeNode): boolean {
  return node.type === 'COMPONENT';
}
