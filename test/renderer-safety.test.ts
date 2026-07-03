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
