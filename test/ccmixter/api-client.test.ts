import { describe, expect, it } from 'vitest';

import { RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING } from '../../src/shared/domain';
import {
  ARTIST_CATALOG_MAX_PAGES,
  ARTIST_CATALOG_QUERY_LIMIT,
  buildCcmixterQueryUrl,
  CcmixterApiClient,
  mapRawApiUpload,
  parseCcmixterApiResponse
} from '../../src/main/services/ccmixter/ccmixterApiClient';
import artistFixture from '../fixtures/ccmixter/artist-info.json';
import hazeFixture from '../fixtures/ccmixter/haze-56384-info.json';
import missingFieldsFixture from '../fixtures/ccmixter/missing-fields.json';
import soundbitchFixture from '../fixtures/ccmixter/soundbitch-1883-info.json';
import uploadFixture from '../fixtures/ccmixter/upload-info.json';

describe('CcmixterApiClient URL building', () => {
  it('builds artist query URLs safely', () => {
    const url = buildCcmixterQueryUrl(
      {
        artistLogin: 'Wise Man',
        dataview: 'default',
        limit: 100,
        offset: 200
      },
      'https://ccmixter.org/api/query'
    );

    expect(url.toString()).toBe('https://ccmixter.org/api/query?f=json&dataview=default&user=Wise+Man&limit=100&offset=200');
  });

  it('builds upload ID query URLs safely', () => {
    const url = buildCcmixterQueryUrl(
      {
        uploadId: '64501',
        dataview: 'info',
        limit: 1
      },
      'https://ccmixter.org/api/query'
    );

    expect(url.toString()).toBe('https://ccmixter.org/api/query?f=json&dataview=info&ids=64501&limit=1');
  });
});

describe('CcmixterApiClient mapping', () => {
  it('maps upload ID fixture JSON to domain upload and files', async () => {
    const client = new CcmixterApiClient({
      fetchImpl: async () => new Response(JSON.stringify(uploadFixture), { status: 200 })
    });

    const result = await client.resolveByUploadId('64501');

    expect(result).toHaveLength(1);
    expect(result[0]?.upload).toMatchObject({
      uploadId: '64501',
      artistLogin: 'WiseMan',
      artistName: 'Wiseman',
      title: 'Boxcar heading West (instrumental stems)',
      bpm: 145,
      metadataSource: 'api'
    });
    expect(result[0]?.files.map((file) => file.originalFilename)).toEqual(['GUITAR-main.flac', 'Boxcar-stems.zip']);
  });

  it('maps artist fixture JSON to multiple uploads', async () => {
    const client = new CcmixterApiClient({
      fetchImpl: async () => new Response(JSON.stringify(artistFixture), { status: 200 })
    });

    const result = await client.resolveByArtistLogin('WiseMan');

    expect(result.mappings.map((mapping) => mapping.upload.uploadId)).toEqual(['64501', '64502']);
    expect(result.mappings[1]?.files[0]?.originalFilename).toBe('VOCALS.flac');
    expect(result.pagingIncomplete).toBe(false);
  });

  it('pages artist catalog queries with offset and dedupes by upload ID', async () => {
    const requestedUrls: string[] = [];
    const client = new CcmixterApiClient({
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url.toString());
        const offset = Number(url.searchParams.get('offset') ?? '0');
        const page =
          offset === 0
            ? Array.from({ length: ARTIST_CATALOG_QUERY_LIMIT }, (_value, index) => ({
                upload_id: index === ARTIST_CATALOG_QUERY_LIMIT - 1 ? 1 : index + 1,
                upload_name: index === ARTIST_CATALOG_QUERY_LIMIT - 1 ? 'One Duplicate' : `Upload ${index + 1}`,
                user_name: 'WiseMan',
                user_real_name: 'Wiseman',
                upload_tags: 'audio'
              }))
            : [{ upload_id: 2, upload_name: 'Two', user_name: 'WiseMan', user_real_name: 'Wiseman', upload_tags: 'audio' }];

        return new Response(JSON.stringify(page), { status: 200 });
      }
    });

    const result = await client.resolveByArtistLogin('WiseMan');

    expect(result.mappings.map((mapping) => mapping.upload.uploadId)).toContain('1');
    expect(result.mappings.map((mapping) => mapping.upload.uploadId)).toContain('2');
    expect(result.mappings.filter((mapping) => mapping.upload.uploadId === '1')).toHaveLength(1);
    expect(requestedUrls[0]).toContain('dataview=default');
    expect(requestedUrls[0]).toContain('user=WiseMan');
    expect(requestedUrls[0]).toContain('offset=0');
    expect(requestedUrls[1]).toContain(`offset=${ARTIST_CATALOG_QUERY_LIMIT}`);
  });

  it('reports incomplete paging when artist catalog reaches the max page guard', async () => {
    let requestCount = 0;
    const client = new CcmixterApiClient({
      fetchImpl: async () => {
        const pageBase = requestCount * ARTIST_CATALOG_QUERY_LIMIT;
        requestCount += 1;

        return new Response(
          JSON.stringify(
            Array.from({ length: ARTIST_CATALOG_QUERY_LIMIT }, (_value, index) => ({
              upload_id: pageBase + index,
              upload_name: `Upload ${pageBase + index}`,
              user_name: 'WiseMan',
              user_real_name: 'Wiseman',
              upload_tags: 'audio'
            }))
          ),
          { status: 200 }
        );
      }
    });

    const result = await client.resolveByArtistLogin('WiseMan');

    expect(requestCount).toBe(ARTIST_CATALOG_MAX_PAGES);
    expect(result.pagingIncomplete).toBe(true);
    expect(result.warnings).toContain('Artist catalog API paging reached the maximum page guard.');
  });

  it('adds warnings for missing optional metadata instead of fabricating certainty', () => {
    const rawUpload = parseCcmixterApiResponse(missingFieldsFixture)[0]!;
    const result = mapRawApiUpload(rawUpload);

    expect(result.upload.uploadId).toBe('99999');
    expect(result.upload.licenseSummary).toBe('not specified');
    expect(result.warnings).toContain('API upload record did not include a recognized license summary or URL.');
    expect(result.warnings).toContain('No downloadable file candidates were mapped from recognized API fields.');
  });

  it('reads file_nicname as an alternate display label and zipdir contents as zip file hints', () => {
    const haze = parseCcmixterApiResponse(hazeFixture)[0]!;
    const result = mapRawApiUpload(haze);
    const stemsZip = result.files.find((file) => file.originalFilename === 'Zutsuri_-_Haze.zip');
    const stemsZipFirstHalf = result.files.find((file) => file.originalFilename === 'Zutsuri_-_Haze_1.zip');
    const previewMp3 = result.files.find((file) => file.originalFilename === 'Zutsuri_-_Haze_1.mp3');

    expect(stemsZip?.displayLabel).toBe('Stems, Second Half');
    expect(stemsZip?.zipFileHints).toEqual([
      'haze - Vox 3.02_01-01.flac (927.47KB)',
      'haze - Vox Dbl_01-05.flac (3.54MB)',
      'haze - Vox Harmony 02.01_01-03.flac (3.32MB)',
      'haze - Vox Harmony.04_01-03.flac (6.66MB)',
      'haze - VOX PRE CHORUS_01.flac (873.21KB)',
      'haze - Vox.01_01-15.flac (6.18MB)',
      'haze - Wah EP BOUNCE.03_02.flac (12.22MB)'
    ]);
    expect(stemsZipFirstHalf?.displayLabel).toBe('Stems, First Half');
    expect(stemsZipFirstHalf?.zipFileHints).toHaveLength(6);
    // "mp3" is not a musician-facing name; the alternate label must not surface it as a display label.
    expect(previewMp3?.displayLabel).toBe('mp3');
  });

  it('falls back to alternate filename/description fields and nested file_extra when file_nicname is absent', () => {
    const rawUpload = {
      upload_id: '9002',
      upload_name: 'Test Song',
      user_name: 'WiseMan',
      files: [
        {
          file_name: 'a.wav',
          download_url: 'https://ccmixter.org/content/WiseMan/a.wav',
          alternate_filename: 'Alt Name A'
        },
        {
          file_name: 'b.wav',
          download_url: 'https://ccmixter.org/content/WiseMan/b.wav',
          file_extra: { title: 'Alt Name B' }
        }
      ]
    };
    const result = mapRawApiUpload(rawUpload);

    expect(result.files.find((file) => file.originalFilename === 'a.wav')?.displayLabel).toBe('Alt Name A');
    expect(result.files.find((file) => file.originalFilename === 'b.wav')?.displayLabel).toBe('Alt Name B');
  });

  it('maps recorded related upload links without recursively resolving them', () => {
    const haze = parseCcmixterApiResponse(hazeFixture)[0]!;
    const soundbitch = parseCcmixterApiResponse(soundbitchFixture)[0]!;
    const hazeResult = mapRawApiUpload(haze);
    const soundbitchResult = mapRawApiUpload(soundbitch);

    expect(hazeResult.upload.relatedUploadUrls).toContain('https://ccmixter.org/files/Reiswerk/56402');
    expect(soundbitchResult.upload.relatedUploadUrls).toContain('https://ccmixter.org/files/zrox/2440');
    expect(hazeResult.warnings).toContain(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
    expect(soundbitchResult.warnings).toContain(RELATED_UPLOADS_NOT_RECURSIVELY_RESOLVED_WARNING);
  });
});
