import type { StemGroup } from '../shared/domain';

export const HAZE_SMOKE_FIXTURE_ID = 'haze-smoke';

export const HAZE_SMOKE_STEM_GROUPS: StemGroup[] = [
  {
    groupId: 'fixture-haze-smoke',
    artist: 'Zutsuri',
    canonicalSongTitle: 'Haze',
    bpm: 97,
    confidence: 'medium',
    groupingReasons: [
      'Fixture group only: recorded from https://ccmixter.org/files/Zutsuri/56384 for Slice 5.5 smoke testing.',
      'Stem/source tags or file-format hints support this group.'
    ],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: [
      'Fixture/sample data: this smoke fixture is recorded data, not live recursive ccMixter resolution.',
      'Related upload links may be detected but are not recursively resolved in this slice.'
    ],
    uploads: [
      {
        uploadId: '56384',
        artistName: 'Zutsuri',
        artistLogin: 'Zutsuri',
        title: 'Haze',
        bpm: 97,
        tags: ['sample', 'media', 'bpm_095_100', 'preview', 'acappella', 'attribution', 'archive', 'zip', 'pells'],
        licenseSummary: 'Attribution (3.0)',
        sourceUrl: 'https://ccmixter.org/files/Zutsuri/56384',
        metadataSource: 'fixture',
        relatedUploadUrls: [
          'https://ccmixter.org/files/Reiswerk/56402',
          'https://ccmixter.org/files/raja_ffm/56497'
        ],
        warnings: ['Upload metadata is fixture/sample data recorded from ccMixter.']
      }
    ],
    files: [
      {
        originalFilename: 'Zutsuri_-_Haze_1.mp3',
        fileKind: 'preview',
        extension: 'mp3',
        sizeBytes: 5390045,
        downloadUrl: 'https://ccmixter.org/content/Zutsuri/Zutsuri_-_Haze_1.mp3',
        metadataSource: 'fixture',
        warnings: ['File metadata is fixture/sample data recorded from ccMixter.']
      },
      {
        originalFilename: 'Zutsuri_-_Haze.zip',
        fileKind: 'archive',
        extension: 'zip',
        sizeBytes: 34800847,
        downloadUrl: 'https://ccmixter.org/content/Zutsuri/Zutsuri_-_Haze.zip',
        metadataSource: 'fixture',
        zipFileHints: ['haze - Vox 3.02_01-01.flac', 'haze - Vox Dbl_01-05.flac'],
        warnings: ['Archive is downloaded as-is in this slice; no ZIP extraction happens.']
      },
      {
        originalFilename: 'fixture-missing-url.wav',
        fileKind: 'stem',
        extension: 'wav',
        metadataSource: 'fixture',
        warnings: ['Fixture file intentionally has no download URL so the smoke path shows a skipped file.']
      }
    ],
    metadataSource: 'fixture'
  }
];

export const SAMPLE_STEM_GROUPS: StemGroup[] = [
  {
    groupId: 'fixture-quarter-inch-jack',
    artist: 'Sample Artist',
    canonicalSongTitle: 'Quarter-Inch Jack (Source)',
    bpm: 96,
    confidence: 'low',
    groupingReasons: ['Fixture group only: no resolver grouping decision was made.'],
    ambiguousUploads: [],
    unverifiedFields: ['licenseSummary'],
    warnings: [
      'Fixture group only: grouping has not been resolved from the ccMixter API or upload pages.',
      'License summary is a placeholder and must not be treated as verified.'
    ],
    uploads: [
      {
        uploadId: '000000',
        artistName: 'Sample Artist',
        artistLogin: 'sample_artist',
        title: 'Quarter-Inch Jack (Source)',
        bpm: 96,
        tags: ['fixture', 'stems', 'zip'],
        licenseSummary: 'Unverified placeholder license summary',
        sourceUrl: 'https://ccmixter.org/files/sample_artist/000000',
        metadataSource: 'fixture',
        warnings: ['Upload metadata is fixture/sample data only.']
      }
    ],
    files: [
      {
        originalFilename: 'BASS.flac',
        fileKind: 'stem',
        extension: 'flac',
        qualityHint: 'fixture lossless source hint',
        metadataSource: 'fixture',
        warnings: ['File metadata is fixture/sample data only.']
      },
      {
        originalFilename: 'GUITAR.flac',
        fileKind: 'stem',
        extension: 'flac',
        qualityHint: 'fixture lossless source hint',
        metadataSource: 'fixture',
        warnings: ['File metadata is fixture/sample data only.']
      },
      {
        originalFilename: 'preview.mp3',
        fileKind: 'preview',
        extension: 'mp3',
        qualityHint: 'fixture preview hint',
        metadataSource: 'fixture',
        warnings: ['Preview/stem classification is not verified.']
      }
    ],
    metadataSource: 'fixture'
  }
];
