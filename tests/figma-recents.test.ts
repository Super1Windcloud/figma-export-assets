import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultFigmaUrl, recentFigmaUrl } from '../scripts/figma-recents';

const tab = {
  path: '/file/abc123',
  title: '最近 文件',
  editorType: 'dev_handoff',
  userId: 'current',
  lastViewedAt: 1000,
};

test('selects latest supported file for the current account across windows and history', () => {
  const settings = {
    figmaID: 'current',
    windows: [{ tabs: [tab, { ...tab, userId: 'other', lastViewedAt: 9000 }] }],
    sharedTabHistory: [
      {
        ...tab,
        path: '/file/closed',
        lastViewedAt: undefined,
        dateClosed: new Date(2000).toISOString(),
      },
      {
        ...tab,
        path: '/file/make',
        editorType: 'figmake',
        lastViewedAt: 10000,
      },
      { ...tab, path: '//example.com/file/wrong', lastViewedAt: 10000 },
    ],
  };
  assert.equal(
    recentFigmaUrl(settings),
    'https://www.figma.com/file/closed/%E6%9C%80%E8%BF%91%20%E6%96%87%E4%BB%B6',
  );
  settings.windows.push({ tabs: [{ ...tab, lastViewedAt: 3000 }] });
  assert.equal(
    recentFigmaUrl(settings),
    'https://www.figma.com/file/abc123/%E6%9C%80%E8%BF%91%20%E6%96%87%E4%BB%B6',
  );
});

test('ignores malformed state and timestamps without choosing arbitrary tabs', () => {
  for (const state of [
    null,
    [],
    {},
    { windows: [null, { tabs: [null, { ...tab, lastViewedAt: 'invalid' }] }] },
  ]) {
    assert.equal(recentFigmaUrl(state), '');
  }
});

test('reads desktop state ahead of env and falls back for missing, invalid, or empty state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'figma-recents-'));
  const file = path.join(directory, 'settings.json');
  const env = {
    FIGMA_URL: ' https://www.figma.com/design/configured/Test ',
    FIGMA_FILE_KEY: 'fallback',
  };
  try {
    assert.equal(await defaultFigmaUrl(env, file), env.FIGMA_URL.trim());
    await writeFile(file, '{');
    assert.equal(await defaultFigmaUrl(env, file), env.FIGMA_URL.trim());
    await writeFile(file, '{}');
    assert.equal(
      await defaultFigmaUrl({ FIGMA_FILE_KEY: 'fallback' }, file),
      'https://www.figma.com/design/fallback/Untitled',
    );
    assert.equal(await defaultFigmaUrl({}, file), '');
    await writeFile(file, JSON.stringify({ windows: [{ tabs: [tab] }] }));
    assert.match(await defaultFigmaUrl(env, file), /\/file\/abc123\//);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
