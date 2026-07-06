import { describe, expect, it } from 'vitest';

import {
  RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING,
  createDryRunPlanFromGroups,
  type TrackFile,
  type TrackUpload
} from '../../src/shared/domain';
import { classifyTrackFileCandidate, groupStemUploads, normalizeTitleRoot } from '../../src/main/services/grouping/stemGrouper';

describe('normalizeTitleRoot', () => {
  it('strips known functional suffixes', () => {
    expect(normalizeTitleRoot('Quarter-Inch Jack (Source)').normalizedTitle).toBe('Quarter-Inch Jack');
    expect(normalizeTitleRoot('If You Are Not There [STEMS]').normalizedTitle).toBe('If You Are Not There');
    expect(normalizeTitleRoot('Boxcar heading West (stems)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West (instrumental stems)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West (pells)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West (acapella)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West (a cappella)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West (vocals)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West (instrumental)').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West - stems').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West - source').normalizedTitle).toBe('Boxcar heading West');
    expect(normalizeTitleRoot('Boxcar heading West [source]').normalizedTitle).toBe('Boxcar heading West');
  });

  it('does not strip creative bracket text', () => {
    expect(normalizeTitleRoot('Night Drive [Blue Room]').normalizedTitle).toBe('Night Drive [Blue Room]');
    expect(normalizeTitleRoot('Wake Up (The Long Version)').normalizedTitle).toBe('Wake Up (The Long Version)');
  });

  it('returns a warning when normalization materially changes a title', () => {
    const normalized = normalizeTitleRoot('Boxcar heading West (pells)');

    expect(normalized.changed).toBe(true);
    expect(normalized.warnings).toContain('Title root normalized from "Boxcar heading West (pells)" to "Boxcar heading West".');
  });
});

describe('classifyTrackFileCandidate', () => {
  it('classifies ZIP files as archives', () => {
    expect(classifyTrackFileCandidate(file('stems.zip', 'unknown'), { uploadTags: ['stems'] }).fileKind).toBe('archive');
  });

  it('classifies lossless files with stem/source hints as stems', () => {
    expect(classifyTrackFileCandidate(file('BASS.flac', 'unknown'), { uploadTags: ['source'] }).fileKind).toBe('stem');
    expect(classifyTrackFileCandidate(file('DRUMS.wav', 'unknown'), { uploadTags: ['stems'] }).fileKind).toBe('stem');
  });

  it('classifies MP3 files with preview hints as previews', () => {
    expect(classifyTrackFileCandidate(file('preview.mp3', 'unknown'), { uploadTags: ['stems', 'preview'] }).fileKind).toBe('preview');
  });

  it('keeps unknown files and warns', () => {
    const result = classifyTrackFileCandidate(file('notes.txt', 'unknown'), { uploadTags: [] });

    expect(result.fileKind).toBe('unknown');
    expect(result.warnings).toContain('File candidate could not be classified confidently.');
  });
});

describe('groupStemUploads', () => {
  it('creates a high-confidence group for same artist, same title root, close BPM, and stem hints', () => {
    const result = groupStemUploads([
      {
        upload: upload({ uploadId: '1', title: 'Boxcar heading West (instrumental stems)', bpm: 145, tags: ['stems', 'flac'] }),
        files: [file('GUITAR.flac', 'unknown')]
      },
      {
        upload: upload({ uploadId: '2', title: 'Boxcar heading West (pells)', bpm: 146, tags: ['pells'] }),
        files: [file('VOCALS.wav', 'unknown')]
      }
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.confidence).toBe('high');
    expect(result.groups[0]?.canonicalSongTitle).toBe('Boxcar heading West');
    expect(result.groups[0]?.groupingReasons).toContain('Same artist and normalized song title root.');
    expect(result.groups[0]?.groupingReasons).toContain('BPM values match or are very similar.');
  });

  it('creates a medium-confidence group when BPM is missing', () => {
    const result = groupStemUploads([
      {
        upload: upload({ uploadId: '1', title: 'Quarter-Inch Jack (Source)', bpm: undefined, tags: ['source'] }),
        files: [file('BASS.flac', 'unknown')]
      },
      {
        upload: upload({ uploadId: '2', title: 'Quarter-Inch Jack [STEMS]', bpm: undefined, tags: ['stems'] }),
        files: [file('DRUMS.wav', 'unknown')]
      }
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.confidence).toBe('medium');
    expect(result.groups[0]?.warnings).toContain('BPM missing for one or more uploads.');
    expect(result.groups[0]?.unverifiedFields).toContain('bpm');
  });

  it('creates a low-confidence ambiguous group for related links with different title roots', () => {
    const left = upload({
      uploadId: '1',
      title: 'Boxcar heading West',
      bpm: 145,
      tags: ['stems'],
      sourceUrl: 'https://ccmixter.org/files/WiseMan/1',
      relatedUploadUrls: ['https://ccmixter.org/files/WiseMan/2']
    });
    const right = upload({
      uploadId: '2',
      title: 'Freight Yard Vocals',
      bpm: 145,
      tags: ['vocals'],
      sourceUrl: 'https://ccmixter.org/files/WiseMan/2'
    });

    const result = groupStemUploads([
      { upload: left, files: [file('stems.zip', 'unknown')] },
      { upload: right, files: [file('vocals.flac', 'unknown')] }
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.confidence).toBe('low');
    expect(result.groups[0]?.warnings).toContain(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
    expect(result.groups[0]?.warnings).toContain('Multiple possible song roots are present in this group.');
    expect(result.groups[0]?.ambiguousUploads.map((item) => item.uploadId)).toEqual(['1', '2']);
  });

  it('uses API source/remix relationships as grouping signals', () => {
    const result = groupStemUploads([
      {
        upload: upload({ uploadId: '10', title: 'Circuit Bloom', bpm: 120, tags: ['source'] }),
        files: [file('SOURCE.flac', 'unknown')]
      },
      {
        upload: upload({
          uploadId: '11',
          title: 'Circuit Bloom remix stems',
          bpm: 120,
          tags: ['stems'],
          remixOfUploadIds: ['10']
        }),
        files: [file('REMIX-STEMS.zip', 'unknown')]
      }
    ]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.groupingReasons).toContain('API source/remix relationship references another upload in this group.');
  });

  it('records close upload dates as a weak explanatory signal', () => {
    const result = groupStemUploads([
      {
        upload: upload({
          uploadId: '21',
          title: 'Same Week Song (source)',
          bpm: 100,
          tags: ['source'],
          uploadedAt: '2026-07-01T00:00:00.000Z'
        }),
        files: [file('SOURCE.flac', 'unknown')]
      },
      {
        upload: upload({
          uploadId: '22',
          title: 'Same Week Song (stems)',
          bpm: 100,
          tags: ['stems'],
          uploadedAt: '2026-07-06T00:00:00.000Z'
        }),
        files: [file('STEMS.zip', 'unknown')]
      }
    ]);

    expect(result.signals).toContainEqual({
      fromUploadId: '21',
      toUploadId: '22',
      strength: 'weak',
      reason: 'Upload dates are close.'
    });
    expect(result.groups[0]?.groupingReasons).toContain('Upload dates are close.');
  });

  it('warns when preview and source files are mixed', () => {
    const result = groupStemUploads([
      {
        upload: upload({ uploadId: '1', title: 'Okay for Sound 145 (stems)', bpm: 145, tags: ['stems', 'preview'] }),
        files: [file('preview.mp3', 'unknown'), file('GUITAR.flac', 'unknown')]
      }
    ]);

    expect(result.groups[0]?.files.map((candidate) => candidate.fileKind)).toEqual(['preview', 'stem']);
    expect(result.groups[0]?.warnings).toContain('Preview and source files are mixed in this group.');
  });

  it('keeps dry-run path planning under the selected root from grouped data', () => {
    const grouped = groupStemUploads([
      {
        upload: upload({ uploadId: '1', title: 'Boxcar heading West (instrumental stems)', bpm: 145, tags: ['stems'] }),
        files: [file('GUITAR:main?.flac', 'unknown')]
      }
    ]);
    const plan = createDryRunPlanFromGroups(
      'WiseMan',
      {
        path: 'D:/Stem Library',
        selectedAt: '2026-07-03T00:00:00.000Z'
      },
      grouped.groups,
      {
        createdAt: '2026-07-03T00:00:00.000Z',
        metadataSource: 'api',
        placeholderData: false,
        resolverStatus: 'resolved',
        warnings: ['No files will be downloaded.']
      }
    );

    expect(plan.plannedFiles[0]?.targetRelativePath).toBe('Wiseman/Boxcar heading West (145 BPM)/GUITAR-main-.flac');
    expect(plan.plannedFiles[0]?.targetAbsolutePath).toBe(
      'D:/Stem Library/Wiseman/Boxcar heading West (145 BPM)/GUITAR-main-.flac'
    );
  });
});

function upload(overrides: Partial<TrackUpload>): TrackUpload {
  return {
    uploadId: '1',
    artistName: 'Wiseman',
    artistLogin: 'WiseMan',
    title: 'Boxcar heading West',
    bpm: 145,
    tags: [],
    licenseSummary: 'Creative Commons Attribution',
    sourceUrl: `https://ccmixter.org/files/WiseMan/${overrides.uploadId ?? '1'}`,
    metadataSource: 'api',
    warnings: [],
    ...overrides
  };
}

function file(originalFilename: string, fileKind: TrackFile['fileKind']): TrackFile {
  const extension = originalFilename.includes('.') ? originalFilename.split('.').at(-1)?.toLowerCase() ?? 'unknown' : 'unknown';

  return {
    originalFilename,
    fileKind,
    extension,
    metadataSource: 'api',
    warnings: []
  };
}
