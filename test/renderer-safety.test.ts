import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

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

  it('renders artist catalog reality-check copy and scan counts from shared renderer state', async () => {
    const source = await readFile(path.resolve('src/renderer/ui/App.tsx'), 'utf8');

    expect(source).toContain('ARTIST_SCAN_REALITY_CHECK_WARNING');
    expect(source).toContain('Review artist uploads');
    expect(source).toContain('Loaded uploads');
    expect(source).toContain('Total uploads');
    expect(source).toContain('Has more');
    expect(source).toContain('Planned files');
    expect(source).toContain('Included files');
    expect(source).toContain('Loading more uploads');
    expect(source).toContain('uploads loaded');
    expect(source).toContain('resolveArtistCatalogCounts');
    expect(source).toContain('isArtistCatalogInput');
    expect(source).toContain('Include recommended source/stem/archive files');
    expect(source).toContain('Exclude previews');
    expect(source).toContain('Exclude archives');
    expect(source).toContain('Clear all included files');
  });

  it('renders archive preview controls and warning states from shared renderer state', async () => {
    const source = await readFile(path.resolve('src/renderer/ui/App.tsx'), 'utf8');

    expect(source).toContain('Preview archive contents');
    expect(source).toContain('Archive preview is informational; extraction is not implemented yet.');
    expect(source).toContain('ArchivePreviewDetails');
    expect(source).toContain('Safe to extract');
    expect(source).toContain('blocking');
    expect(source).toContain('previewArchiveDownload');
  });
});

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
