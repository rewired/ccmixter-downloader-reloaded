import type { StemGroup } from '../shared/domain';

export const SAMPLE_STEM_GROUPS: StemGroup[] = [
  {
    groupId: 'fixture-quarter-inch-jack',
    artist: 'Sample Artist',
    canonicalSongTitle: 'Quarter-Inch Jack (Source)',
    bpm: 96,
    confidence: 'low',
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
        warnings: ['Upload metadata is fixture/sample data only.']
      }
    ],
    files: [
      {
        originalFilename: 'BASS.flac',
        fileKind: 'stem',
        extension: 'flac',
        qualityHint: 'fixture lossless source hint',
        warnings: ['File metadata is fixture/sample data only.']
      },
      {
        originalFilename: 'GUITAR.flac',
        fileKind: 'stem',
        extension: 'flac',
        qualityHint: 'fixture lossless source hint',
        warnings: ['File metadata is fixture/sample data only.']
      },
      {
        originalFilename: 'preview.mp3',
        fileKind: 'preview',
        extension: 'mp3',
        qualityHint: 'fixture preview hint',
        warnings: ['Preview/stem classification is not verified.']
      }
    ]
  }
];
