import { createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { ZipFile } from 'yazl';

import type { StemPackInputFile } from '../../../shared/domain/stemPacking';
import type { ExtraZipEntry } from './types';

/**
 * All entries are stored uncompressed. Audio formats in the supported list
 * are already compressed (or WAV, which is small enough for MVP folders),
 * so deflate would add CPU cost for little size benefit and keeps archive
 * layout trivial to verify in tests.
 */
export async function writeStemZip(
  zipPath: string,
  files: StemPackInputFile[],
  entryNames: Map<string, string>,
  extras: ExtraZipEntry[]
): Promise<void> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });

  const zip = new ZipFile();

  for (const file of files) {
    const entryName = entryNames.get(file.path) ?? path.basename(file.path);
    zip.addFile(file.path, entryName, { compress: false });
  }

  for (const extra of extras) {
    const buffer = typeof extra.content === 'string' ? Buffer.from(extra.content, 'utf-8') : extra.content;
    zip.addBuffer(buffer, extra.name, { compress: false });
  }

  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(zipPath))
      .on('close', () => resolve())
      .on('error', reject);
    zip.end();
  });
}
