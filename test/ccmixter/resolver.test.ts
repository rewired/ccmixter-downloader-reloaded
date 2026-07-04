import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { mapRawApiUpload, parseCcmixterApiResponse } from '../../src/main/services/ccmixter/ccmixterApiClient';
import { parseCcmixterArtistCatalogHtml, parseCcmixterUploadHtml } from '../../src/main/services/ccmixter/ccmixterHtmlClient';
import { buildGroupingCandidates, CcmixterResolver } from '../../src/main/services/ccmixter/ccmixterResolver';
import { groupStemUploads } from '../../src/main/services/grouping/stemGrouper';
import {
  ARTIST_CATALOG_NO_STEM_EVIDENCE_WARNING,
  ARTIST_SCAN_PAGINATION_WARNING,
  ARTIST_SCAN_REALITY_CHECK_WARNING,
  RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING
} from '../../src/shared/domain';
import artistFixture from '../fixtures/ccmixter/artist-info.json';
import hazeFixture from '../fixtures/ccmixter/haze-56384-info.json';
import missingFieldsFixture from '../fixtures/ccmixter/missing-fields.json';
import soundbitchFixture from '../fixtures/ccmixter/soundbitch-1883-info.json';
import uploadFixture from '../fixtures/ccmixter/upload-info.json';

describe('CcmixterResolver', () => {
  it('combines API data and HTML enrichment without fixture fallback', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/upload-page.html'), 'utf8');
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => catalog([]),
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
        resolveByArtistLogin: async () => catalog([]),
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

  it('treats artist links as catalog scans with independent low-confidence groups when evidence is missing', async () => {
    const artistCalls: string[] = [];
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async (artistLogin) => {
          artistCalls.push(artistLogin);
          return catalog(unrelatedCatalogUploads().map((upload) => mapRawApiUpload(upload)));
        },
        resolveByUploadId: async () => []
      }
    });

    const metadata = await resolver.resolveMetadata('https://ccmixter.org/people/WiseMan', { enrichHtml: false });

    expect(artistCalls).toEqual(['WiseMan']);
    expect(metadata.input.kind).toBe('artist-link');
    expect(metadata.warnings).toContain(ARTIST_SCAN_REALITY_CHECK_WARNING);
    expect(metadata.warnings).not.toContain(ARTIST_SCAN_PAGINATION_WARNING);
    expect(metadata.warnings).not.toContain(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
    expect(metadata.groups).toHaveLength(2);
    expect(metadata.groups.map((group) => group.confidence)).toEqual(['low', 'low']);
    expect(metadata.groups.every((group) => group.warnings.includes(ARTIST_CATALOG_NO_STEM_EVIDENCE_WARNING))).toBe(true);
    expect(metadata.uploads).toHaveLength(2);
    expect(metadata.files).toHaveLength(2);
  });

  it('uses artist HTML fallback once for one-record people-page catalog results and keeps missing-BPM uploads visible', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/artist-catalog-page.html'), 'utf8');
    const artistCalls: string[] = [];
    let htmlFallbackCount = 0;
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async (artistLogin) => {
          artistCalls.push(artistLogin);
          return catalog([
            mapRawApiUpload({
              upload_id: '70001',
              upload_name: 'Pulse Map',
              user_name: '7OOP3D',
              user_real_name: '7OOP3D',
              upload_bpm: 121,
              upload_tags: 'sample stems',
              license_name: 'Attribution (4.0)',
              file_page_url: 'https://ccmixter.org/files/7OOP3D/70001'
            })
          ]);
        },
        resolveByUploadId: async () => []
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => parseCcmixterUploadHtml(html, sourceUrl),
        resolveArtistCatalogPage: async (sourceUrl, artistLogin) => {
          htmlFallbackCount += 1;
          return parseCcmixterArtistCatalogHtml(html, sourceUrl, artistLogin);
        }
      }
    });

    const metadata = await resolver.resolveMetadata('https://ccmixter.org/people/7OOP3D');

    expect(artistCalls).toEqual(['7OOP3D']);
    expect(htmlFallbackCount).toBe(1);
    expect(metadata.input.artistLogin).toBe('7OOP3D');
    expect(metadata.uploads.map((upload) => upload.uploadId)).toEqual(['70001', '70002', '70003']);
    expect(metadata.groups.map((group) => group.uploads[0]?.uploadId)).toEqual(['70001', '70002', '70003']);
    expect(metadata.groups).toHaveLength(3);
    expect(metadata.files).toHaveLength(0);
    expect(metadata.uploads.map((upload) => upload.bpm)).toEqual([121, 83, undefined]);
    expect(metadata.warnings).not.toContain('BPM missing for one or more uploads.');
  });

  it('falls back to artist-page HTML when an artist-link API catalog request fails', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/artist-catalog-page.html'), 'utf8');
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => {
          throw new Error('fetch failed');
        },
        resolveByUploadId: async () => []
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => parseCcmixterUploadHtml(html, sourceUrl),
        resolveArtistCatalogPage: async (sourceUrl, artistLogin) => parseCcmixterArtistCatalogHtml(html, sourceUrl, artistLogin)
      }
    });

    const metadata = await resolver.resolveMetadata('https://ccmixter.org/people/7OOP3D');

    expect(metadata.status).not.toBe('unresolved');
    expect(metadata.groups.length).toBeGreaterThanOrEqual(3);
    expect(metadata.uploads.length).toBeGreaterThanOrEqual(3);
    expect(metadata.uploads.map((upload) => upload.uploadId)).toEqual(['70001', '70002', '70003']);
    expect(metadata.uploads.map((upload) => upload.bpm)).toEqual([121, 83, undefined]);
    expect(metadata.warnings).toContain(
      'ccMixter API artist catalog request failed for https://ccmixter.org/api/query?f=json&dataview=default&user=7OOP3D&limit=100&offset=0: fetch failed'
    );
    expect(metadata.warnings).toContain('HTML artist catalog fallback succeeded for https://ccmixter.org/people/7OOP3D with 3 upload(s).');
    expect(metadata.warnings).not.toContain('fetch failed');
    expect(metadata.warnings).not.toContain('BPM missing for one or more uploads.');
  });

  it('builds the artist-page HTML fallback URL from exact artist-name input when the API catalog request fails', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/artist-catalog-page.html'), 'utf8');
    const fallbackUrls: string[] = [];
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => {
          throw new Error('fetch failed');
        },
        resolveByUploadId: async () => []
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => parseCcmixterUploadHtml(html, sourceUrl),
        resolveArtistCatalogPage: async (sourceUrl, artistLogin) => {
          fallbackUrls.push(sourceUrl);
          return parseCcmixterArtistCatalogHtml(html, sourceUrl, artistLogin);
        }
      }
    });

    const metadata = await resolver.resolveMetadata('7OOP3D');

    expect(fallbackUrls).toEqual(['https://ccmixter.org/people/7OOP3D']);
    expect(metadata.status).not.toBe('unresolved');
    expect(metadata.uploads.length).toBeGreaterThanOrEqual(3);
  });

  it('treats plain artist-name inputs as artist catalog scans', async () => {
    const artistCalls: string[] = [];
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async (artistLogin) => {
          artistCalls.push(artistLogin);
          return catalog(unrelatedCatalogUploads().map((upload) => mapRawApiUpload(upload)));
        },
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

    expect(artistCalls).toEqual(['WiseMan']);
    expect(plan.input.kind).toBe('artist-name');
    expect(plan.warnings).toContain(ARTIST_SCAN_REALITY_CHECK_WARNING);
    expect(plan.warnings).not.toContain(ARTIST_SCAN_PAGINATION_WARNING);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.map((group) => group.confidence)).toEqual(['low', 'low']);
    expect(plan.plannedFiles).toHaveLength(2);
  });

  it('falls back to normalized artist login only when exact spelling returns no catalog uploads', async () => {
    const artistCalls: string[] = [];
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async (artistLogin) => {
          artistCalls.push(artistLogin);
          return artistLogin === 'WiseMan' ? catalog([]) : catalog(unrelatedCatalogUploads().map((upload) => mapRawApiUpload(upload)));
        },
        resolveByUploadId: async () => []
      }
    });

    const metadata = await resolver.resolveMetadata('WiseMan', { enrichHtml: false });

    expect(artistCalls).toEqual(['WiseMan', 'wiseman']);
    expect(metadata.uploads.map((upload) => upload.uploadId)).toEqual(['80001', '80002']);
  });

  it('warns about artist pagination only when the artist API reports incomplete paging', async () => {
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () =>
          catalog(
            Array.from({ length: 100 }, (_value, index) =>
              mapRawApiUpload({
                upload_id: `page-${index}`,
                upload_name: `Catalog Upload ${index}`,
                user_name: 'WiseMan',
                user_real_name: 'Wiseman',
                upload_bpm: 100 + index,
                upload_tags: 'audio mp3',
                license_name: 'Creative Commons Attribution',
                file_page_url: `https://ccmixter.org/files/WiseMan/page-${index}`,
                files: [
                  {
                    file_name: `catalog-${index}.mp3`,
                    download_url: `https://ccmixter.org/content/WiseMan/catalog-${index}.mp3`
                  }
                ]
              })
            ),
            true
          ),
        resolveByUploadId: async () => []
      }
    });

    const metadata = await resolver.resolveMetadata('WiseMan', { enrichHtml: false });

    expect(metadata.warnings).toContain(ARTIST_SCAN_PAGINATION_WARNING);
  });

  it('creates dry-run path planning from resolved metadata', async () => {
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => catalog([]),
        resolveByUploadId: async () => parseCcmixterApiResponse(uploadFixture).map((upload) => mapRawApiUpload(upload))
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

    const plan = await resolver.createDryRunPlan('https://ccmixter.org/files/WiseMan/64501', {
      path: 'D:/Stem Library',
      selectedAt: '2026-07-03T00:00:00.000Z'
    });

    expect(plan.placeholderData).toBe(false);
    expect(plan.metadataSource).toBe('api');
    expect(plan.plannedFiles[0]?.targetRelativePath).toBe('Wiseman/Boxcar heading West (145 bpm)/GUITAR-main.flac');
    expect(plan.warnings).toContain('No files will be downloaded.');
    expect(plan.warnings).not.toContain('No ccMixter scan happened.');
  });

  it('creates fixture smoke metadata explicitly for fixture:haze-smoke', async () => {
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => catalog([]),
        resolveByUploadId: async () => []
      }
    });

    const plan = await resolver.createDryRunPlan('fixture:haze-smoke', {
      path: 'D:/Stem Library',
      selectedAt: '2026-07-03T00:00:00.000Z'
    });

    expect(plan.placeholderData).toBe(true);
    expect(plan.resolverStatus).toBe('fixture');
    expect(plan.metadataSource).toBe('fixture');
    expect(plan.plannedFiles.map((file) => file.targetRelativePath)).toContain('Zutsuri/Haze (97 bpm)/Zutsuri_-_Haze_1.mp3');
    expect(plan.plannedFiles.map((file) => file.targetRelativePath)).toContain('Zutsuri/Haze (97 bpm)/fixture-missing-url.wav');
    expect(plan.warnings).toContain('Fixture/sample data: fixture:haze-smoke uses recorded ccMixter metadata for UI smoke testing.');
  });

  it('returns a visible warning for unknown fixture IDs', async () => {
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => catalog([]),
        resolveByUploadId: async () => []
      }
    });

    const metadata = await resolver.resolveMetadata('fixture:not-real');

    expect(metadata.status).toBe('unresolved');
    expect(metadata.warnings).toContain('Unknown fixture ID: not-real.');
  });

  it('resolves recorded Haze fixture shape with multiple same-page files', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/haze-56384-page.html'), 'utf8');
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => catalog([]),
        resolveByUploadId: async () => parseCcmixterApiResponse(hazeFixture).map((upload) => mapRawApiUpload(upload))
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => parseCcmixterUploadHtml(html, sourceUrl)
      }
    });

    const metadata = await resolver.resolveMetadata('56384');
    const plan = await resolver.createDryRunPlan('56384', {
      path: 'D:/Stem Library',
      selectedAt: '2026-07-03T00:00:00.000Z'
    });

    expect(metadata.status).toBe('resolved');
    expect(metadata.groups).toHaveLength(1);
    expect(metadata.groups[0]?.confidence).toBe('medium');
    expect(metadata.groups[0]?.metadataSource).toBe('html-enriched');
    expect(metadata.groups[0]?.warnings).toContain('Preview and source files are mixed in this group.');
    expect(metadata.groups[0]?.files.map((file) => file.originalFilename)).toEqual([
      'Zutsuri_-_Haze_1.mp3',
      'Zutsuri_-_Haze.zip',
      'Zutsuri_-_Haze_1.zip'
    ]);
    expect(metadata.groups[0]?.files.map((file) => file.classification?.role)).toEqual(['preview', 'archive', 'archive']);
    expect(metadata.groups[0]?.files.every((file) => (file.classification?.reasons.length ?? 0) > 0)).toBe(true);
    expect(plan.plannedFiles.map((file) => file.targetRelativePath)).toContain('Zutsuri/Haze (97 bpm)/Zutsuri_-_Haze_1.mp3');
    expect(plan.plannedFiles.map((file) => file.targetRelativePath)).toContain('Zutsuri/Haze (97 bpm)/Zutsuri_-_Haze.zip');
    expect(metadata.warnings).toContain(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
  });

  it('detects recorded remix-child links without recursively resolving sibling pages', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/soundbitch-1883-page.html'), 'utf8');
    let htmlFetchCount = 0;
    const resolver = new CcmixterResolver({
      apiClient: {
        resolveByArtistLogin: async () => catalog([]),
        resolveByUploadId: async () => parseCcmixterApiResponse(soundbitchFixture).map((upload) => mapRawApiUpload(upload))
      },
      htmlClient: {
        enrichUploadPage: async (sourceUrl) => {
          htmlFetchCount += 1;
          return parseCcmixterUploadHtml(html, sourceUrl);
        }
      }
    });

    const metadata = await resolver.resolveMetadata('1883');
    const plan = await resolver.createDryRunPlan('1883', {
      path: 'D:/Stem Library',
      selectedAt: '2026-07-03T00:00:00.000Z'
    });

    expect(htmlFetchCount).toBe(2);
    expect(metadata.uploads[0]?.relatedUploadUrls).toContain('https://ccmixter.org/files/zrox/2440');
    expect(metadata.warnings).toContain(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
    expect(metadata.groups).toHaveLength(1);
    expect(metadata.groups[0]?.confidence).toBe('medium');
    expect(metadata.groups[0]?.groupingReasons).toContain('Stem/source tags or file-format hints support this group.');
    expect(metadata.groups[0]?.files.map((file) => file.originalFilename)).toEqual([
      'soundbitch_-_pls-crepman-grunge-90bpm.mp3'
    ]);
    expect(plan.plannedFiles[0]?.targetRelativePath).toBe(
      'Chillheimer&Soundbitch/pls-crepman-grunge-90bpm (90 bpm)/soundbitch_-_pls-crepman-grunge-90bpm.mp3'
    );
  });
});

function catalog(mappings: ReturnType<typeof mapRawApiUpload>[], pagingIncomplete = false) {
  return {
    mappings,
    pagingIncomplete,
    warnings: pagingIncomplete ? ['Artist catalog API paging reached the maximum page guard.'] : []
  };
}

function unrelatedCatalogUploads(): Record<string, unknown>[] {
  return [
    {
      upload_id: '80001',
      upload_name: 'Morning Sketch',
      user_name: 'WiseMan',
      user_real_name: 'Wiseman',
      upload_bpm: 92,
      upload_tags: 'audio mp3',
      license_name: 'Creative Commons Attribution',
      file_page_url: 'https://ccmixter.org/files/WiseMan/80001',
      files: [
        {
          file_name: 'morning-sketch.mp3',
          download_url: 'https://ccmixter.org/content/WiseMan/morning-sketch.mp3'
        }
      ]
    },
    {
      upload_id: '80002',
      upload_name: 'Night Roads',
      user_name: 'WiseMan',
      user_real_name: 'Wiseman',
      upload_bpm: 118,
      upload_tags: 'audio mp3',
      license_name: 'Creative Commons Attribution',
      file_page_url: 'https://ccmixter.org/files/WiseMan/80002',
      files: [
        {
          file_name: 'night-roads.mp3',
          download_url: 'https://ccmixter.org/content/WiseMan/night-roads.mp3'
        }
      ]
    }
  ];
}
