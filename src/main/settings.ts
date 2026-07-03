import { promises as fs } from 'fs';
import path from 'path';

import type { StemLibraryRoot } from '../shared/domain';

interface SettingsFile {
  stemLibraryRoot: StemLibraryRoot | null;
}

const SETTINGS_FILENAME = 'settings.json';

export class SettingsStore {
  private readonly settingsPath: string;

  constructor(userDataPath: string) {
    this.settingsPath = path.join(userDataPath, SETTINGS_FILENAME);
  }

  async getStemLibraryRoot(): Promise<StemLibraryRoot | null> {
    const settings = await this.readSettings();
    return settings.stemLibraryRoot;
  }

  async setStemLibraryRoot(folderPath: string): Promise<StemLibraryRoot> {
    const root: StemLibraryRoot = {
      path: folderPath,
      selectedAt: new Date().toISOString()
    };

    await this.writeSettings({
      stemLibraryRoot: root
    });

    return root;
  }

  private async readSettings(): Promise<SettingsFile> {
    try {
      const contents = await fs.readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(stripUtf8Bom(contents)) as Partial<SettingsFile>;

      return {
        stemLibraryRoot: parsed.stemLibraryRoot ?? null
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          stemLibraryRoot: null
        };
      }

      throw error;
    }
  }

  private async writeSettings(settings: SettingsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function stripUtf8Bom(contents: string): string {
  return contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
}
