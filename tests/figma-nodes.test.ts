import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('exports components and nodes explicitly marked by designers', () => {
  assert.equal(isExportableAssetNode({ type: 'COMPONENT' }), true);
  assert.equal(
    isExportableAssetNode({ type: 'RECTANGLE', exportSettings: [{}] }),
    true,
  );
  assert.equal(
    isExportableAssetNode({ type: 'FRAME', exportSettings: [] }),
    false,
  );
  assert.equal(isExportableAssetNode({ type: 'VECTOR' }), false);
  assert.equal(
    isExportableAssetNode({
      type: 'GROUP',
      visible: false,
      exportSettings: [{}],
    }),
    false,
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
