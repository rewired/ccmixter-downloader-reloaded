import fs from 'fs';
import path from 'path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'ccMixter Stem Downloader',
    electronZipDir: findCachedElectronZipDir()
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts'
            }
          }
        ]
      }
    })
  ]
};

export default config;

function findCachedElectronZipDir(): string | undefined {
  const electronVersion = readInstalledElectronVersion();
  const electronCacheDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'electron', 'Cache')
    : undefined;

  if (!electronVersion || !electronCacheDir || !fs.existsSync(electronCacheDir)) {
    return undefined;
  }

  const zipName = `electron-v${electronVersion}-${process.platform}-${process.arch}.zip`;
  const topLevelZip = path.join(electronCacheDir, zipName);

  if (fs.existsSync(topLevelZip)) {
    return electronCacheDir;
  }

  for (const entry of fs.readdirSync(electronCacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nestedZip = path.join(electronCacheDir, entry.name, zipName);
    if (fs.existsSync(nestedZip)) {
      return path.dirname(nestedZip);
    }
  }

  return undefined;
}

function readInstalledElectronVersion(): string | undefined {
  try {
    const packageJsonPath = require.resolve('electron/package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return packageJson.version;
  } catch {
    return undefined;
  }
}
