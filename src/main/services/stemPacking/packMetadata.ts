import type { StemPackMetadataInput } from '../../../shared/domain/stemPacking';
import type { ExtraZipEntry } from './types';

export const STEM_PACK_STAMP_FILENAME = '_stem-zipper.txt';
export const STEM_PACK_METADATA_FILENAME = 'PACK-METADATA.json';
export const STEM_PACK_LICENSE_FILENAME = 'LICENSE.txt';
export const STEM_PACK_ATTRIBUTION_FILENAME = 'ATTRIBUTION.txt';

const STAMP_APP_NAME = 'ccMixter Downloader Reloaded — Package Remix';

export function createPackMetadataJson(metadata: StemPackMetadataInput, packedAt: string): string {
  const payload: Record<string, unknown> = {
    title: metadata.title,
    artist: metadata.artist,
    license: metadata.license,
    packedAt
  };

  if (metadata.bpm) {
    payload.bpm = metadata.bpm;
  }
  if (metadata.attribution) {
    payload.attribution = metadata.attribution;
  }

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function createLicenseText(metadata: StemPackMetadataInput): string {
  return `License: ${metadata.license}\n`;
}

export function createAttributionText(metadata: StemPackMetadataInput): string {
  const fallback = `${metadata.artist} — ${metadata.title}`;
  return `${metadata.attribution ?? fallback}\n`;
}

export function createStampText(metadata: StemPackMetadataInput, packedAt: string): string {
  const lines = [STAMP_APP_NAME, '', `Title: ${metadata.title}`, `Artist: ${metadata.artist}`];

  if (metadata.bpm) {
    lines.push(`BPM: ${metadata.bpm}`);
  }

  lines.push(`License: ${metadata.license}`);
  lines.push(`Packed: ${packedAt}`);

  return `${lines.join('\n')}\n`;
}

export function createStemPackMetadataEntries(metadata: StemPackMetadataInput, packedAt: string): ExtraZipEntry[] {
  return [
    { name: STEM_PACK_METADATA_FILENAME, content: createPackMetadataJson(metadata, packedAt) },
    { name: STEM_PACK_LICENSE_FILENAME, content: createLicenseText(metadata) },
    { name: STEM_PACK_ATTRIBUTION_FILENAME, content: createAttributionText(metadata) },
    { name: STEM_PACK_STAMP_FILENAME, content: createStampText(metadata, packedAt) }
  ];
}
