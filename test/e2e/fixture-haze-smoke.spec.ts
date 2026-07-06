import { access, mkdtemp, readdir, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const EXPECTED_RELATIVE_PATH = path.join('Zutsuri', 'Haze smoke review', 'Zutsuri_-_Haze_1.mp3');

test('fixture:haze-smoke review and download smoke', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccmixter-haze-smoke-'));
  const expectedTarget = path.join(root, EXPECTED_RELATIVE_PATH);
  let electronApp: ElectronApplication | undefined;

  try {
    const launchEnv: Record<string, string> = {
      ...stringEnv(process.env),
      CCMIXTER_E2E: '1',
      CCMIXTER_E2E_ROOT: root,
      NODE_USE_SYSTEM_CA: '1'
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;

    electronApp = await electron.launch({
      args: [path.join(process.cwd(), '.webpack', 'x64', 'main', 'index.js')],
      cwd: process.cwd(),
      env: launchEnv
    });

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'ccMixter Stem Downloader' })).toBeVisible();
    await expect(page.getByText(root)).toBeVisible();

    await page.getByLabel('ccMixter artist or upload').fill('fixture:haze-smoke');
    await page.getByRole('button', { name: 'Scan source' }).click();

    await expect(page.getByText('0 files selected', { exact: true })).toBeVisible();
    await expect(page.locator('.upload-list .candidate-badge')).toHaveCount(0);
    await expect(page.getByText('Developer actions')).not.toBeVisible();
    await expect(page.getByText('Merge into')).not.toBeVisible();

    await page.getByLabel('Song folder').fill('Haze smoke review');
    await expectSelectedFiles(page, 0);
    await expect(page.getByRole('button', { name: 'Download (0)' })).toBeDisabled();

    // Zutsuri_-_Haze.zip carries recorded ccMixter ZIP contents; selecting it should reveal all of them, uncapped.
    await fileRow(page, 'Zutsuri_-_Haze.zip').getByRole('checkbox').check();
    await expectSelectedFiles(page, 1);
    await expect(page.getByText('2 files inside')).toBeVisible();
    await page.getByText('2 files inside').click();
    await expect(page.getByText('haze - Vox 3.02_01-01.flac')).toBeVisible();
    await expect(page.getByText('haze - Vox Dbl_01-05.flac')).toBeVisible();
    await expect(page.locator('.archive-disclosure__more')).toHaveCount(0);

    await fileRow(page, 'Zutsuri_-_Haze_1.mp3').getByRole('checkbox').check();
    await expectSelectedFiles(page, 2);

    await fileRow(page, 'fixture-missing-url.wav').getByRole('checkbox').check();
    await expectSelectedFiles(page, 3);

    await fileRow(page, 'Zutsuri_-_Haze.zip').getByRole('checkbox').uncheck();
    await expectSelectedFiles(page, 2);

    await expect(fileExists(expectedTarget)).resolves.toBe(false);
    await page.getByRole('button', { name: 'Download (2)' }).click();

    await expect(page.getByRole('heading', { name: 'Download' })).toBeVisible();
    await expect(downloadFileRow(page, 'fixture-missing-url.wav')).toContainText('skipped');
    await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('1 completed, 0 failed')).toBeVisible();
    await expect(fileExists(expectedTarget)).resolves.toBe(true);

    const writtenFiles = await collectFiles(root);
    expect(writtenFiles.map((file) => path.relative(root, file))).toEqual([EXPECTED_RELATIVE_PATH]);
    expect(writtenFiles.some((file) => /\.zip$/i.test(file))).toBe(false);
    expect(writtenFiles.some((file) => /(?:attribution|credits|license|notice)\.(?:txt|md|json)$/i.test(path.basename(file)))).toBe(false);
  } finally {
    await electronApp?.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function expectSelectedFiles(page: Page, count: number): Promise<void> {
  await expect(page.getByText(`${count} file${count === 1 ? '' : 's'} selected`, { exact: true })).toBeVisible();
}

function fileRow(page: Page, filename: string) {
  return page.locator(`.candidate-list > li[data-filename="${cssAttributeValue(filename)}"]`);
}

function downloadFileRow(page: Page, filename: string) {
  return page.locator('.download-file-list > li').filter({ hasText: filename });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }

      return (await stat(fullPath)).isFile() ? [fullPath] : [];
    })
  );

  return files.flat().sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
