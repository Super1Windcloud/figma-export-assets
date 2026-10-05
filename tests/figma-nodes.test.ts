import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ICON_MAX_SIZE,
  imageAssetDeduplicationKey,
  isBaseComponent,
  isExportableAssetNode,
  isIconGraphicNode,
  isImageFillContainerResourceNode,
  isImageFillLeafNode,
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

test('recognizes image-filled frames as raw background resources', () => {
  assert.equal(
    isImageFillContainerResourceNode({
      type: 'FRAME',
      fills: [{ type: 'IMAGE', imageRef: 'background-ref' }],
      children: [{ type: 'TEXT' }],
    }),
    true,
  );
  assert.equal(
    isImageFillContainerResourceNode({
      type: 'RECTANGLE',
      fills: [{ type: 'IMAGE', imageRef: 'atomic-ref' }],
    }),
    false,
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
  assert.notEqual(
    imageAssetDeduplicationKey(base),
    imageAssetDeduplicationKey({ ...base, cornerRadius: 12 }),
  );
  assert.notEqual(
    imageAssetDeduplicationKey(base),
    imageAssetDeduplicationKey({
      ...base,
      effects: [{ type: 'DROP_SHADOW', radius: 8 }],
    }),
  );
  assert.notEqual(
    imageAssetDeduplicationKey(base),
    imageAssetDeduplicationKey({ ...base, type: 'ELLIPSE' }),
  );
});

test('skips exportable containers that render as empty', () => {
  assert.equal(isRenderableAssetNode({ type: 'COMPONENT', opacity: 0 }), false);
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

test('exports childless image-filled frames as atomic image slots', () => {
  const leaf = {
    type: 'FRAME',
    fills: [{ type: 'IMAGE', imageRef: 'icon-ref' }],
  };
  assert.equal(isImageFillLeafNode(leaf), true);
  assert.equal(isExportableAssetNode(leaf), true);
  assert.equal(isImageFillContainerResourceNode(leaf), false);
  assert.equal(
    isImageFillLeafNode({ ...leaf, children: [{ type: 'TEXT' }] }),
    false,
  );
});

test('accepts explicitly marked frame and instance graphic compositions', () => {
  for (const type of ['FRAME', 'INSTANCE']) {
    assert.equal(
      isExportableAssetNode({
        type,
        exportSettings: [{}],
        children: [{ type: 'FRAME', children: [{ type: 'VECTOR' }] }],
      }),
      true,
    );
  }
});

test('recognizes small unmarked vector artwork as icons', () => {
  const box = (size: number) => ({ width: size, height: size });
  assert.equal(
    isIconGraphicNode({ type: 'VECTOR', absoluteBoundingBox: box(16) }),
    true,
  );
  assert.equal(
    isIconGraphicNode({
      type: 'INSTANCE',
      absoluteBoundingBox: box(31),
      children: [{ type: 'RECTANGLE' }, { type: 'VECTOR' }],
    }),
    true,
  );
  assert.equal(
    isIconGraphicNode({
      type: 'FRAME',
      absoluteBoundingBox: box(38),
      children: [{ type: 'RECTANGLE' }, { type: 'RECTANGLE' }],
    }),
    true,
  );
  assert.equal(
    isIconGraphicNode({
      type: 'FRAME',
      absoluteBoundingBox: box(20),
      children: [{ type: 'RECTANGLE' }],
    }),
    false,
  );
  assert.equal(
    isIconGraphicNode({ type: 'RECTANGLE', absoluteBoundingBox: box(16) }),
    false,
  );
  assert.equal(
    isIconGraphicNode({
      type: 'VECTOR',
      absoluteBoundingBox: box(ICON_MAX_SIZE + 1),
    }),
    false,
  );
  assert.equal(
    isIconGraphicNode({
      type: 'FRAME',
      absoluteBoundingBox: box(24),
      children: [{ type: 'TEXT' }, { type: 'VECTOR' }],
    }),
    false,
  );
  assert.equal(
    isIconGraphicNode({
      type: 'FRAME',
      absoluteBoundingBox: box(24),
      children: [
        { type: 'VECTOR' },
        { type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'photo' }] },
      ],
    }),
    false,
  );
});
