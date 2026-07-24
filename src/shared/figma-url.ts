export interface ParsedFigmaUrl {
  fileKey: string;
  fileName: string;
}

const FIGMA_DOCUMENT_TYPES = new Set([
  'design',
  'file',
  'proto',
  'board',
  'slides',
]);

export function parseFigmaUrl(value: string): ParsedFigmaUrl | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'figma.com' && !hostname.endsWith('.figma.com'))
      return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const documentIndex = segments.findIndex((segment) =>
      FIGMA_DOCUMENT_TYPES.has(segment),
    );
    const fileKey = segments[documentIndex + 1];
    const encodedFileName = segments[documentIndex + 2];
    if (documentIndex < 0 || !fileKey || !/^[a-zA-Z0-9]+$/.test(fileKey))
      return null;

    return {
      fileKey,
      fileName: encodedFileName
        ? decodeURIComponent(encodedFileName)
        : 'Untitled',
    };
  } catch {
    return null;
  }
}
