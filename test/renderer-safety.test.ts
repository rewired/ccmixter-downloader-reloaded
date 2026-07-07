import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { en } from '../src/renderer/i18n/en';

const FORBIDDEN_IMPORTS = ['electron', 'fs', 'path', 'child_process', 'os', 'crypto', 'stream', 'buffer'];

describe('renderer safety', () => {
  it('does not import Node or Electron modules directly', async () => {
    const files = await collectRendererSourceFiles(path.resolve('src/renderer'));
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const moduleName of FORBIDDEN_IMPORTS) {
        const modulePattern = `${escapeRegExp(moduleName)}(?:/[^'"]*)?`;
        const importPattern = new RegExp(
          String.raw`from\s+['"]${modulePattern}['"]|import\s+['"]${modulePattern}['"]|require\(\s*['"]${modulePattern}['"]\s*\)`
        );
        if (importPattern.test(source)) {
          violations.push(`${path.relative(process.cwd(), file)} imports ${moduleName}`);
        }
      }

      if (/from\s+['"]node:|import\s+['"]node:|require\(\s*['"]node:/.test(source)) {
        violations.push(`${path.relative(process.cwd(), file)} imports node:*`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not inject remote WaveSurfer scripts into the renderer', async () => {
    const source = await readAllRendererSource();

    expect(source).not.toContain('wavesurfer.xyz');
    expect(source).not.toContain('createElement("script")');
    expect(source).not.toContain("createElement('script')");
  });

  it('renders musician-facing artist scan progress and counts from shared renderer state', async () => {
    const source = await readAllRendererSource();

    expect(source).toContain('Reading artist catalog...');
    expect(source).toContain('Checking upload pages...');
    expect(source).toContain('Finding downloadable files...');
    expect(source).toContain('No files found');
    expect(source).toContain('Could not check files');
    expect(source).toContain('checkedUploadCount');
    expect(source).toContain('downloadableFileCount');
    expect(source).toContain('noFilesFoundCount');
    expect(source).toContain('couldNotCheckFilesCount');
    expect(source).toContain('resolveArtistCatalogStatus');
    expect(source).toContain('resolveArtistCatalogCounts');
    expect(source).toContain('isArtistCatalogInput');
    expect(source).not.toContain('Include recommended source/stem/archive files');
    expect(source).not.toContain('Exclude previews');
    expect(source).not.toContain('Exclude archives');
    expect(source).not.toContain('Clear all included files');
  });

  it('keeps developer terms out of the main source and review flow', async () => {
    const source = await readRendererSourceFiles([
      'src/renderer/ui/SourcePanel.tsx',
      'src/renderer/ui/UploadListDetail.tsx',
      'src/renderer/ui/DownloadScreen.tsx',
      'src/renderer/ui/StatusBar.tsx'
    ]);

    expect(source).not.toContain('Developer actions');
    expect(source).not.toContain('Merge into');
    expect(source).not.toContain('Confidence');
    expect(source).not.toContain('Grouping reasons');
    expect(source).not.toContain('source mode');
  });

  it('keeps the download screen focused on progress and result, not archive inspection', async () => {
    const source = await readRendererSourceFiles(['src/renderer/ui/DownloadScreen.tsx']);

    expect(source).not.toContain('Preview archive contents');
    expect(source).not.toContain('ArchivePreviewDetails');
    expect(source).not.toContain('previewArchiveDownload');
  });

  it('exposes one primary "Scan source" workflow action instead of separate parse/resolve/dry-run primaries', async () => {
    const source = await readAllRendererSource();

    expect(source).toContain('Scan source');
    expect(source).not.toContain('Create dry run');
  });

  it('collapses technical/debug details by default', async () => {
    const source = await readAllRendererSource();

    expect(source).toContain('<details className="technical-details">');
    expect(source).toContain('Technical details');
    expect(source).not.toMatch(/<details className="technical-details"[^>]*\bopen\b/);
  });

  it('exposes a Get Source Material / Package Remix tool switch defaulting to source', async () => {
    const source = await readRendererSourceFiles(['src/renderer/ui/App.tsx']);

    expect(source).toContain("useState<ActiveTool>('source')");
    expect(source).toContain("t('app.tool.source')");
    expect(source).toContain("t('app.tool.package')");
    expect(source).toContain("aria-pressed={activeTool === 'source'}");
    expect(source).toContain("aria-pressed={activeTool === 'package'}");

    expect(en['app.tool.source']).toBe('Get Source Material');
    expect(en['app.tool.package']).toBe('Package Remix');
  });

  it('keeps the Package Remix placeholder static, with no working buttons', async () => {
    const source = await readRendererSourceFiles(['src/renderer/ui/PackageRemixPlaceholder.tsx']);

    expect(source).not.toContain('<button');
    expect(source).not.toContain('onClick');
    expect(source).toContain("t('packageRemix.title')");

    expect(en['packageRemix.title']).toBe('Package Remix');
    expect(en['packageRemix.description']).toBe('Create upload-ready stem ZIP packages from your own local remix exports.');
    expect(en['packageRemix.comingSoon']).toBe(
      'Folder scanning, metadata, attribution, and stereo WAV splitting will be added in a later slice.'
    );
  });
});

async function readAllRendererSource(): Promise<string> {
  const files = await collectRendererSourceFiles(path.resolve('src/renderer'));
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  return contents.join('\n');
}

async function readRendererSourceFiles(files: string[]): Promise<string> {
  const contents = await Promise.all(files.map((file) => readFile(path.resolve(file), 'utf8')));
  return contents.join('\n');
}

async function collectRendererSourceFiles(root: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return collectRendererSourceFiles(fullPath);
      }

      if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        return [fullPath];
      }

      return [];
    })
  );

  return files.flat();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
