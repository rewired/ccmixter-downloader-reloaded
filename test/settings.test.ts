import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { SettingsStore } from '../src/main/settings';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('SettingsStore', () => {
  it('returns null before a Stem Library Root Folder is persisted', async () => {
    const dir = await createTempDir();
    const store = new SettingsStore(dir);

    await expect(store.getStemLibraryRoot()).resolves.toBeNull();
  });

  it('persists and retrieves the Stem Library Root Folder', async () => {
    const dir = await createTempDir();
    const store = new SettingsStore(dir);
    const rootPath = path.join(dir, 'Stem Library');

    const saved = await store.setStemLibraryRoot(rootPath);

    expect(saved.path).toBe(rootPath);
    await expect(store.getStemLibraryRoot()).resolves.toEqual(saved);
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ccmixter-settings-'));
  tempDirs.push(dir);
  return dir;
}
