import assert from 'node:assert/strict';
import test from 'node:test';
import {
  imageAssetDeduplicationKey,
  isBaseComponent,
  isExportableAssetNode,
  isRenderableAssetNode,
} from '../src/shared/figma-nodes';

test('accepts a component composed of primitive layers', () => {
  assert.equal(
    isBaseComponent({
      type: 'COMPONENT',
      children: [
        { type: 'RECTANGLE' },
        { type: 'FRAME', children: [{ type: 'TEXT' }] },
      ],
    }),
    true,
  );
});

test('accepts a component with a nested instance', () => {
  assert.equal(
    isBaseComponent({
      type: 'COMPONENT',
      children: [
        {
          type: 'FRAME',
          children: [{ type: 'GROUP', children: [{ type: 'INSTANCE' }] }],
        },
      ],
    }),
    true,
  );
});

test('rejects every non-component node type', () => {
  assert.equal(isBaseComponent({ type: 'RECTANGLE' }), false);
  assert.equal(isBaseComponent({ type: 'INSTANCE' }), false);
  assert.equal(
    isBaseComponent({
      type: 'COMPONENT_SET',
      children: [{ type: 'COMPONENT' }],
    }),
    false,
  );
  assert.equal(
    isBaseComponent({
      type: 'FRAME',
      children: [{ type: 'GROUP' }, { type: 'COMPONENT' }],
    }),
    false,
  );
});

test('exports components, atomic image layers, and explicit graphic resources', () => {
  assert.equal(isExportableAssetNode({ type: 'COMPONENT' }), true);
  assert.equal(
    isExportableAssetNode({
      type: 'RECTANGLE',
      fills: [{ type: 'IMAGE', imageRef: 'image-ref' }],
    }),
    true,
  );
  assert.equal(
    isExportableAssetNode({
      type: 'VECTOR',
      exportSettings: [{}],
    }),
    true,
  );
  assert.equal(
    isExportableAssetNode({
      type: 'FRAME',
      fills: [{ type: 'IMAGE', imageRef: 'composite-preview' }],
      exportSettings: [{}],
      children: [{ type: 'TEXT' }],
    }),
    false,
  );
  assert.equal(isExportableAssetNode({ type: 'VECTOR' }), false);
  assert.equal(
    isExportableAssetNode({
      type: 'GROUP',
      exportSettings: [{}],
      children: [{ type: 'ELLIPSE' }, { type: 'VECTOR' }],
    }),
    true,
  );
  assert.equal(
    isExportableAssetNode({
      type: 'GROUP',
      exportSettings: [{}],
      children: [{ type: 'TEXT' }, { type: 'VECTOR' }],
    }),
    false,
  );
});

test('builds stable image deduplication keys from paint and render size', () => {
  const base = {
    type: 'RECTANGLE',
    fills: [{ type: 'IMAGE', imageRef: 'same-image', scaleMode: 'FILL' }],
    absoluteBoundingBox: { width: 40, height: 40 },
  };
  assert.equal(
    imageAssetDeduplicationKey(base),
    imageAssetDeduplicationKey({ ...base, id: 'another-instance' }),
  );
  assert.notEqual(
    imageAssetDeduplicationKey(base),
    imageAssetDeduplicationKey({
      ...base,
      absoluteBoundingBox: { width: 80, height: 80 },
    }),
  );
});

test('skips exportable containers that render as empty', () => {
  assert.equal(
    isRenderableAssetNode({
      type: 'COMPONENT',
      fills: [{ opacity: 0 }],
      children: [{ type: 'RECTANGLE', visible: false }],
    }),
    false,
  );
  assert.equal(
    isRenderableAssetNode({
      type: 'COMPONENT',
      fills: [{ opacity: 1 }],
      children: [{ type: 'RECTANGLE', visible: false }],
    }),
    true,
  );
  assert.equal(
    isRenderableAssetNode({
      type: 'GROUP',
      exportSettings: [{}],
      children: [{ type: 'RECTANGLE' }],
    }),
    true,
  );
});
