import assert from 'node:assert/strict';
import test from 'node:test';
import { collectExports } from '../scripts/download-assets';

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
