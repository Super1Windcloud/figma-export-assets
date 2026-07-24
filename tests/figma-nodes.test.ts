import assert from 'node:assert/strict';
import test from 'node:test';
import { isBaseComponent } from '../src/shared/figma-nodes';

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
