import { describe, expect, it } from 'vitest';

import {
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
        dataview: 'info',
        limit: 100
      },
      'https://ccmixter.org/api/query'
    );

    expect(url.toString()).toBe('https://ccmixter.org/api/query?f=json&dataview=info&user=Wise+Man&limit=100');
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

    expect(result.map((mapping) => mapping.upload.uploadId)).toEqual(['64501', '64502']);
    expect(result[1]?.files[0]?.originalFilename).toBe('VOCALS.flac');
  });

  it('adds warnings for missing optional metadata instead of fabricating certainty', () => {
    const rawUpload = parseCcmixterApiResponse(missingFieldsFixture)[0]!;
    const result = mapRawApiUpload(rawUpload);

    expect(result.upload.uploadId).toBe('99999');
    expect(result.upload.licenseSummary).toBe('not specified');
    expect(result.warnings).toContain('API upload record did not include a recognized license summary or URL.');
    expect(result.warnings).toContain('No downloadable file candidates were mapped from recognized API fields.');
  });

  it('maps recorded related upload links without recursively resolving them', () => {
    const haze = parseCcmixterApiResponse(hazeFixture)[0]!;
    const soundbitch = parseCcmixterApiResponse(soundbitchFixture)[0]!;
    const hazeResult = mapRawApiUpload(haze);
    const soundbitchResult = mapRawApiUpload(soundbitch);

    expect(hazeResult.upload.relatedUploadUrls).toContain('https://ccmixter.org/files/Reiswerk/56402');
    expect(soundbitchResult.upload.relatedUploadUrls).toContain('https://ccmixter.org/files/zrox/2440');
    expect(hazeResult.warnings).toContain('Related upload links were found in API data but are not recursively resolved in this slice.');
    expect(soundbitchResult.warnings).toContain('Related upload links were found in API data but are not recursively resolved in this slice.');
  });
});
