import assert from 'node:assert/strict';
import test from 'node:test';
import { isBaseComponent } from '../src/shared/figma-nodes';

test('accepts a component composed only of primitive layers', () => {
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

test('rejects a component with a nested instance', () => {
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
    false,
  );
});

test('rejects primitive, instance, and component-set nodes', () => {
  assert.equal(isBaseComponent({ type: 'RECTANGLE' }), false);
  assert.equal(isBaseComponent({ type: 'INSTANCE' }), false);
  assert.equal(
    isBaseComponent({
      type: 'COMPONENT_SET',
      children: [{ type: 'COMPONENT' }],
    }),
    false,
  );
});
