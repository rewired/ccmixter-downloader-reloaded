import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

describe('main process wiring', () => {
  it('injects Electron net.fetch into ccMixter metadata clients', async () => {
    const source = await readFile(path.resolve('src/main/index.ts'), 'utf8');

    expect(source).not.toMatch(/new CcmixterResolver\(\s*\)/);
    expect(source).toContain('const electronFetch: typeof fetch');
    expect(source).toContain('input instanceof URL ? input.toString() : input');
    expect(source).toContain('net.fetch(resolvedInput');
    expect(source).toContain('new CcmixterApiClient({ fetchImpl: electronFetch })');
    expect(source).toContain('new CcmixterHtmlClient({ fetchImpl: electronFetch })');
  });
});
