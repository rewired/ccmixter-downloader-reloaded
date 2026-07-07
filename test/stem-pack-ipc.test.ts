import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../src/shared/ipc/contracts';

describe('stem pack IPC contract', () => {
  it('declares narrow, uniquely-named channels for choose/preview/pack', () => {
    expect(IPC_CHANNELS.chooseStemPackFolder).toBe('stem-pack:choose-folder');
    expect(IPC_CHANNELS.previewStemPackFolder).toBe('stem-pack:preview-folder');
    expect(IPC_CHANNELS.packStemFolder).toBe('stem-pack:pack-folder');

    const values = Object.values(IPC_CHANNELS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('does not add progress or cancel channels for stem packing in this slice', () => {
    const channelNames = Object.keys(IPC_CHANNELS);
    expect(channelNames.some((name) => /stemPack.*(Progress|Cancel)/i.test(name))).toBe(false);
  });
});

describe('preload stem pack surface', () => {
  it('exposes only the narrow choose/preview/pack functions through the single contextBridge api', async () => {
    const source = await readFile(path.resolve('src/preload/index.ts'), 'utf8');

    expect(source).toContain('chooseStemPackFolder: () =>');
    expect(source).toContain('ipcRenderer.invoke(IPC_CHANNELS.chooseStemPackFolder)');
    expect(source).toContain('previewStemPackFolder: (folderPath: string) =>');
    expect(source).toContain('ipcRenderer.invoke(IPC_CHANNELS.previewStemPackFolder, folderPath)');
    expect(source).toContain('packStemFolder: (request: StemPackFolderRequest) =>');
    expect(source).toContain('ipcRenderer.invoke(IPC_CHANNELS.packStemFolder, request)');

    // Exactly one contextBridge exposure, no direct ipcRenderer/electron passthrough.
    expect((source.match(/contextBridge\.exposeInMainWorld/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/exposeInMainWorld\(\s*['"]ipcRenderer['"]/);
    expect(source).not.toContain('readFileSync');
    expect(source).not.toContain('require(');
  });
});

describe('main process stem pack wiring', () => {
  it('routes chooseFolder/previewFolder/packFolder through the stem packing service, not the downloader pipeline', async () => {
    const source = await readFile(path.resolve('src/main/index.ts'), 'utf8');

    expect(source).toContain("import { packStemFolder, previewStemFolder, StemPackError } from './services/stemPacking';");

    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.chooseStemPackFolder,');
    expect(source).toContain('IPC_CHANNELS.previewStemPackFolder,');
    expect(source).toContain('IPC_CHANNELS.packStemFolder,');

    expect(source).toContain('await previewStemFolder(folderPath)');
    expect(source).toContain('await packStemFolder(request)');

    const stemPackWiring = extractBetween(source, "ipcMain.handle(IPC_CHANNELS.chooseStemPackFolder,", 'async function applyE2EStemLibraryRoot');

    // Must not read from a download job/review session or reach ccMixter services.
    expect(stemPackWiring).not.toContain('downloadManager.getJob(');
    expect(stemPackWiring).not.toContain('reviewedPlan');
    expect(stemPackWiring).not.toContain('ccmixterResolver.');

    // No progress broadcasting was wired for stem packing in this slice.
    expect(stemPackWiring).not.toContain('stemPackProgress');
    expect(stemPackWiring).not.toContain('broadcastToRenderer');
  });

  it('rejects invalid folder paths and requests with a typed IpcResult failure before calling the service', async () => {
    const source = await readFile(path.resolve('src/main/index.ts'), 'utf8');

    expect(source).toContain('if (!isValidFolderPath(folderPath)) {\n        return errorResult(\'STEM_PACK_FOLDER_INVALID\'');
    expect(source).toContain(
      'if (!request || !isValidFolderPath(request.folderPath)) {\n        return errorResult(\'STEM_PACK_FOLDER_INVALID\''
    );
  });
});

describe('reference-only Stem ZIPper source', () => {
  it('is never imported from application source, tests, or build config', async () => {
    const searchRoots = [
      'src',
      'test',
      'webpack.main.config.ts',
      'webpack.renderer.config.ts',
      'forge.config.ts',
      'tsconfig.json'
    ];
    const selfPath = path.resolve('test/stem-pack-ipc.test.ts');
    const files = (await Promise.all(searchRoots.map((root) => collectTsLikeFiles(path.resolve(root))))).flat();

    const offenders: string[] = [];
    for (const file of files) {
      if (file === selfPath) {
        continue;
      }
      const source = await readFile(file, 'utf8');
      if (source.includes('_import') || source.includes('stem-zipper-main')) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end === -1 ? undefined : end);
}

async function collectTsLikeFiles(root: string): Promise<string[]> {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat) {
    return [];
  }
  if (rootStat.isFile()) {
    return /\.(ts|tsx|js|jsx|json)$/.test(root) ? [root] : [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectTsLikeFiles(fullPath);
      }
      return /\.(ts|tsx|js|jsx|json)$/.test(entry.name) ? [fullPath] : [];
    })
  );

  return files.flat();
}
