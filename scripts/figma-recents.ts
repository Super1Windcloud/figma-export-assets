import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFigmaUrl } from '../src/shared/figma-url';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function recentFigmaUrl(settings: unknown): string {
  const state = asRecord(settings);
  const candidates: { url: string; time: number }[] = [];
  const addTab = (value: unknown, closed: boolean, windowUser?: unknown) => {
    const tab = asRecord(value);
    const user = tab.userId ?? windowUser;
    if (state.figmaID && user !== state.figmaID) return;
    if (
      typeof tab.path !== 'string' ||
      !/^\/file\/[a-zA-Z0-9]+$/.test(tab.path)
    )
      return;
    if (
      !['design', 'dev_handoff', 'figjam', 'slides'].includes(
        String(tab.editorType),
      )
    )
      return;
    const time =
      typeof tab.lastViewedAt === 'number'
        ? tab.lastViewedAt
        : closed && typeof tab.dateClosed === 'string'
          ? Date.parse(tab.dateClosed)
          : NaN;
    if (!Number.isFinite(time) || time <= 0) return;
    const title = typeof tab.title === 'string' ? tab.title : 'Untitled';
    const url = `https://www.figma.com${tab.path}/${encodeURIComponent(title)}`;
    if (parseFigmaUrl(url)) candidates.push({ url, time });
  };
  if (Array.isArray(state.windows)) {
    for (const value of state.windows) {
      const window = asRecord(value);
      if (Array.isArray(window.tabs)) {
        for (const tab of window.tabs) addTab(tab, false, window.userId);
      }
    }
  }
  if (Array.isArray(state.sharedTabHistory)) {
    for (const tab of state.sharedTabHistory) addTab(tab, true);
  }
  return candidates.sort((a, b) => b.time - a.time)[0]?.url || '';
}

export async function defaultFigmaUrl(
  env: NodeJS.ProcessEnv = process.env,
  settingsPath = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support/Figma/settings.json')
    : '',
): Promise<string> {
  if (settingsPath) {
    try {
      const url = recentFigmaUrl(
        JSON.parse(await readFile(settingsPath, 'utf8')),
      );
      if (url) return url;
    } catch {
      // Missing, incomplete, or incompatible desktop state uses configured defaults.
    }
  }
  const fileKey = env.FIGMA_FILE_KEY?.trim();
  return (
    env.FIGMA_URL?.trim() ||
    (fileKey ? `https://www.figma.com/design/${fileKey}/Untitled` : '')
  );
}
