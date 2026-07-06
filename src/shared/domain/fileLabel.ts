import type { TrackFile } from './models';

export const EXTENSION_ONLY_FILE_LABELS = new Set(['mp3', 'flac', 'wav', 'aif', 'aiff', 'ogg', 'm4a', 'zip']);
export const GENERIC_FILE_LABELS = new Set(['download', 'file', 'archive', 'zip archive']);

type LabelableFile = Pick<TrackFile, 'displayLabel' | 'originalFilename' | 'extension'>;

// ccMixter's file_nicname/description fields are often a much more musician-readable name than the
// technical originalFilename (e.g. "Stems, Second Half" vs "Zutsuri_-_Haze.zip"), but the same field
// is also frequently populated with junk (a bare extension, the filename itself, or a generic word
// like "download") that would make the review UI's default target filename worse, not better.
export function resolveMusicianFacingFileLabel(file: LabelableFile): string | undefined {
  const trimmed = file.displayLabel?.trim();

  if (!trimmed) {
    return undefined;
  }

  const extension = file.extension?.toLowerCase();
  const stripped = stripMatchingExtension(trimmed, extension);

  if (stripped.length === 0) {
    return undefined;
  }

  const lowerStripped = stripped.toLowerCase();

  if (EXTENSION_ONLY_FILE_LABELS.has(lowerStripped)) {
    return undefined;
  }

  const originalWithExtension = file.originalFilename.toLowerCase();
  const originalWithoutExtension = stripMatchingExtension(file.originalFilename, extension).toLowerCase();

  if (lowerStripped === originalWithExtension || lowerStripped === originalWithoutExtension) {
    return undefined;
  }

  return stripped;
}

export function isGenericFileLabel(label: string): boolean {
  return GENERIC_FILE_LABELS.has(label.trim().toLowerCase());
}

// Two label sources (e.g. an API file_nicname and a matching HTML archive hint group's title) can
// both survive resolveMusicianFacingFileLabel's validation while differing wildly in usefulness -
// generic ccMixter boilerplate like "Archive" should lose to a specific label like "Stems, Second
// Half" whenever a specific alternative is available, but should still be shown when it's the only
// label on offer.
export function preferMusicianFacingFileLabel(primary: string | undefined, fallback: string | undefined): string | undefined {
  if (primary && !isGenericFileLabel(primary)) {
    return primary;
  }

  if (fallback && !isGenericFileLabel(fallback)) {
    return fallback;
  }

  return primary ?? fallback;
}

function stripMatchingExtension(value: string, extension?: string): string {
  const trimmed = value.trim();

  if (!extension) {
    return trimmed;
  }

  const suffix = `.${extension}`;
  return trimmed.toLowerCase().endsWith(suffix.toLowerCase()) ? trimmed.slice(0, trimmed.length - suffix.length).trim() : trimmed;
}
