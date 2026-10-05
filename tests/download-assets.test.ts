import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  buildManifest,
  collectExports,
  deduplicateImageExports,
  deduplicateInstanceExports,
  type DuplicateExport,
} from '../scripts/download-assets';

const pngSettings = [
  { format: 'PNG', constraint: { type: 'SCALE', value: 3 } },
];

test('collects a frame image fill as a raw background without flattening the frame', () => {
  const exports = collectExports(
    {
      id: '1:1',
      name: 'Home',
      type: 'FRAME',
      fills: [{ type: 'IMAGE', imageRef: 'background-ref' }],
      children: [{ id: '1:2', name: 'Title', type: 'TEXT' }],
    },
    pngSettings,
  );

  assert.deepEqual(
    exports.map(({ nodeId, source, imageRef, scale, directory, fileName }) => ({
      nodeId,
      source,
      imageRef,
      scale,
      directory,
      fileName,
    })),
    [
      {
        nodeId: '1:1',
        source: 'IMAGE_FILL',
        imageRef: 'background-ref',
        scale: undefined,
        directory: ['Home'],
        fileName: 'background.png',
      },
    ],
  );
});

test('does not collect renderable descendants of a hidden ancestor', () => {
  const exports = collectExports(
    {
      id: '2:1',
      name: 'Hidden state',
      type: 'FRAME',
      visible: false,
      children: [
        {
          id: '2:2',
          name: 'Hidden image',
          type: 'RECTANGLE',
          fills: [{ type: 'IMAGE', imageRef: 'hidden-ref' }],
        },
        {
          id: '2:3',
          name: 'Hidden component',
          type: 'COMPONENT',
        },
      ],
    },
    pngSettings,
  );

  assert.deepEqual(exports, []);
});

const box = (size: number) => ({ width: size, height: size });
const pngSvgSettings = [...pngSettings, { format: 'SVG' }];

test('collects childless image-filled frames as rendered image assets', () => {
  const exports = collectExports(
    {
      id: '3:1',
      name: 'icon',
      type: 'FRAME',
      children: [
        {
          id: '3:2',
          name: 'Frame 8',
          type: 'FRAME',
          fills: [{ type: 'IMAGE', imageRef: 'tab-icon' }],
          absoluteBoundingBox: box(28),
        },
      ],
    },
    pngSvgSettings,
  );

  assert.deepEqual(
    exports.map(({ nodeId, source, format, directory, fileName }) => ({
      nodeId,
      source,
      format,
      directory,
      fileName,
    })),
    [
      {
        nodeId: '3:2',
        source: 'NODE_RENDER',
        format: 'PNG',
        directory: ['icon'],
        fileName: 'Frame 8.png',
      },
    ],
  );
});

test('exports the outermost unmarked icon and skips its layers and instance sublayers', () => {
  const exports = collectExports(
    {
      id: '4:1',
      name: 'Card',
      type: 'FRAME',
      absoluteBoundingBox: box(200),
      children: [
        {
          id: '4:2',
          name: 'Switch',
          type: 'FRAME',
          absoluteBoundingBox: box(20),
          children: [
            {
              id: '4:3',
              name: 'arrow-left-right',
              type: 'FRAME',
              absoluteBoundingBox: box(10),
              children: [
                {
                  id: '4:4',
                  name: 'Vector',
                  type: 'VECTOR',
                  absoluteBoundingBox: box(8),
                },
              ],
            },
          ],
        },
        {
          id: 'I4:5;9:1',
          name: 'Vector',
          type: 'VECTOR',
          absoluteBoundingBox: box(12),
        },
      ],
    },
    pngSvgSettings,
  );

  assert.deepEqual(
    exports.map(
      ({ nodeId, format, fileName }) => `${nodeId}:${format}:${fileName}`,
    ),
    ['4:2:PNG:Switch.png', '4:2:SVG:Switch.svg'],
  );
});

test('keeps one export per external instance and drops local component instances', () => {
  const instance = (id: string, componentId: string) => ({
    id,
    name: 'Close',
    type: 'INSTANCE',
    componentId,
    absoluteBoundingBox: box(31),
    children: [
      {
        id: `I${id};1`,
        name: 'Vector',
        type: 'VECTOR',
        absoluteBoundingBox: box(15),
      },
    ],
  });
  const exports = collectExports(
    {
      id: '5:1',
      name: 'Page',
      type: 'FRAME',
      children: [
        instance('5:2', 'remote:1'),
        instance('5:3', 'remote:1'),
        instance('5:4', 'local:1'),
      ],
    },
    pngSettings,
  );
  deduplicateInstanceExports(exports, new Set(['local:1']));

  assert.deepEqual(
    exports.map((item) => item.nodeId),
    ['5:2'],
  );
});

test('keeps manifest entries for deduplicated image layers on every screen', () => {
  const hero = (id: string) => ({
    id,
    name: 'Hero',
    type: 'RECTANGLE',
    fills: [{ type: 'IMAGE', imageRef: 'hero-ref' }],
    absoluteBoundingBox: { width: 360, height: 299 },
  });
  const page = {
    id: '0:1',
    name: 'Page',
    type: 'CANVAS',
    children: [
      { id: '1:1', name: 'Landscape', type: 'FRAME', children: [hero('1:2')] },
      { id: '2:1', name: 'Portrait', type: 'FRAME', children: [hero('2:2')] },
    ],
  };
  const exports = collectExports(page, pngSettings);
  const duplicates: DuplicateExport[] = [];
  deduplicateImageExports(exports, duplicates);

  assert.deepEqual(
    exports.map((item) => item.nodeId),
    ['1:2'],
  );
  assert.deepEqual(
    duplicates.map(({ item, canonicalNodeId }) => [
      item.nodeId,
      canonicalNodeId,
    ]),
    [['2:2', '1:2']],
  );

  const root = path.resolve('/tmp/export-root');
  const manifest = buildManifest(
    'file-key',
    'File',
    root,
    { id: '0:0', name: 'Document', type: 'DOCUMENT', children: [page] },
    exports,
    [{ ...exports[0], destination: path.join(root, 'Page/Landscape/Hero.png') }],
    [],
    duplicates,
  );

  const portrait = manifest.resources?.find((item) => item.nodeId === '2:2');
  assert.deepEqual(portrait?.nodePath, ['Page', 'Portrait', 'Hero']);
  assert.equal(portrait?.assets[0].relativePath, 'Page/Landscape/Hero.png');
  assert.equal(portrait?.assets[0].duplicateOf, '1:2');
});
