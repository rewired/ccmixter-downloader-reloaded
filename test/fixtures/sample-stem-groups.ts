import type { StemGroup } from '../../src/shared/domain';

export const sampleStemGroups: StemGroup[] = [
  {
    groupId: 'test-group',
    artist: 'Test Artist',
    canonicalSongTitle: 'Boxcar heading West (instrumental stems)',
    bpm: 145,
    confidence: 'medium',
    metadataSource: 'fixture',
    groupingReasons: ['Fixture group for path planning tests.'],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: [],
    uploads: [],
    files: [
      {
        originalFilename: 'GUITAR:main?.flac',
        fileKind: 'stem',
        extension: 'flac',
        metadataSource: 'fixture',
        warnings: []
      }
    ]
  }
];
