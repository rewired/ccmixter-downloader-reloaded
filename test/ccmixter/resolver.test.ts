import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { mapRawApiUpload, parseCcmixterApiResponse } from '../../src/main/services/ccmixter/ccmixterApiClient';
import { parseCcmixterUploadHtml } from '../../src/main/services/ccmixter/ccmixterHtmlClient';
import { buildGroupingCandidates, CcmixterResolver } from '../../src/main/services/ccmixter/ccmixterResolver';
import { groupStemUploads } from '../../src/main/services/grouping/stemGrouper';
import artistFixture from '../fixtures/ccmixter/artist-info.json';
import missingFieldsFixture from '../fixtures/ccmixter/missing-fields.json';
import uploadFixture from '../fixtures/ccmixter/upload-info.json';

describe('CcmixterResolver', () => {
  it('combines API data and HTML enrichment without fixture fallback', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/upload-page.html'), 'utf8');
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => [],
        resolveByUploadId: async () => parseCcmixterApiResponse(uploadFixture).map((upload) => mapRawApiUpload(upload))
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => parseCcmixterUploadHtml(html, sourceUrl)
      }
    });

    const metadata = await resolver.resolveMetadata('https://ccmixter.org/files/WiseMan/64501');

    expect(metadata.status).toBe('resolved');
    expect(metadata.metadataSource).toBe('html-enriched');
    expect(metadata.groups).toHaveLength(1);
    expect(metadata.groups[0]?.files.map((file) => file.originalFilename)).toEqual(['GUITAR-main.flac', 'Boxcar-stems.zip']);
    expect(metadata.warnings).not.toContain('Dry run only: fixture/sample data is shown as a placeholder.');
  });

  it('returns resolver warnings when metadata is missing', async () => {
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => [],
        resolveByUploadId: async () => parseCcmixterApiResponse(missingFieldsFixture).map((upload) => mapRawApiUpload(upload))
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => ({
          sourceUrl,
          tags: [],
          fileCandidates: [],
          zipFileHints: [],
          relatedUploadUrls: [],
          warnings: []
        })
      }
    });

    const metadata = await resolver.resolveMetadata('99999');

    expect(metadata.status).toBe('partial');
    expect(metadata.warnings).toContain('API upload record did not include a recognized title field.');
    expect(metadata.groups[0]?.warnings).toContain('No file candidates are available for this upload.');
  });

  it('groups same artist and normalized song title conservatively', () => {
    const groups = groupStemUploads(
      buildGroupingCandidates(parseCcmixterApiResponse(artistFixture).map((upload) => mapRawApiUpload(upload)))
    ).groups;

    expect(groups).toHaveLength(1);
    expect(groups[0]?.canonicalSongTitle).toBe('Boxcar heading West');
    expect(groups[0]?.uploads.map((upload) => upload.uploadId)).toEqual(['64501', '64502']);
    expect(groups[0]?.confidence).toBe('high');
    expect(groups[0]?.groupingReasons).toContain('Same artist and normalized song title root.');
  });

  it('creates dry-run path planning from resolved metadata', async () => {
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => parseCcmixterApiResponse(artistFixture).map((upload) => mapRawApiUpload(upload)),
        resolveByUploadId: async () => []
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => ({
          sourceUrl,
          tags: [],
          fileCandidates: [],
          zipFileHints: [],
          relatedUploadUrls: [],
          warnings: []
        })
      }
    });

    const plan = await resolver.createDryRunPlan('WiseMan', {
      path: 'D:/Stem Library',
      selectedAt: '2026-07-03T00:00:00.000Z'
    });

    expect(plan.placeholderData).toBe(false);
    expect(plan.metadataSource).toBe('api');
    expect(plan.plannedFiles[0]?.targetRelativePath).toBe('Wiseman/Boxcar heading West (145 bpm)/GUITAR-main.flac');
    expect(plan.warnings).toContain('No files will be downloaded.');
    expect(plan.warnings).not.toContain('No ccMixter scan happened.');
  });
});
