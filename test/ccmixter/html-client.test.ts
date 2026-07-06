import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  CcmixterHtmlClient,
  parseCatalogViewingRange,
  parseCcmixterArtistCatalogHtml,
  parseCcmixterUploadHtml
} from '../../src/main/services/ccmixter/ccmixterHtmlClient';

describe('CcmixterHtmlClient download action file resolution', () => {
  const pageUrl = 'https://ccmixter.org/files/JeffSpeed68/70836';
  const noFileHtml = '<html><body><td id="upload_menu_box"></td></body></html>';

  it('resolves file candidates via the ccMixter download action when the static page exposes none', async () => {
    const client = new CcmixterHtmlClient({
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.startsWith(pageUrl)) {
          return jsonOrTextResponse(noFileHtml, 'text/html');
        }

        expect(url).toContain('dataview=files');
        expect(url).toContain('ids=70836');

        return jsonOrTextResponse(
          JSON.stringify([
            {
              upload_id: 70836,
              user_name: 'JeffSpeed68',
              upload_name: 'Cold Current',
              files: [
                {
                  file_name: 'JeffSpeed68_-_Cold_Current.mp3',
                  download_url: 'https://ccmixter.org/content/JeffSpeed68/JeffSpeed68_-_Cold_Current.mp3'
                },
                {
                  file_name: 'JeffSpeed68_-_Cold_Current.flac',
                  download_url: 'https://ccmixter.org/content/JeffSpeed68/JeffSpeed68_-_Cold_Current.flac'
                }
              ]
            }
          ]),
          'application/json'
        );
      }) as typeof fetch
    });

    const enrichment = await client.enrichUploadPage(pageUrl);

    expect(enrichment.fileCandidates.map((candidate) => candidate.file.originalFilename)).toEqual([
      'JeffSpeed68_-_Cold_Current.mp3',
      'JeffSpeed68_-_Cold_Current.flac'
    ]);
    expect(enrichment.fileCandidates.every((candidate) => typeof candidate.file.downloadUrl === 'string')).toBe(true);
    expect(enrichment.warnings).not.toContain('HTML enrichment did not find visible downloadable file candidates.');
  });

  it('falls back to whatever the static page found when the download action lookup fails', async () => {
    const client = new CcmixterHtmlClient({
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.startsWith(pageUrl)) {
          return jsonOrTextResponse(noFileHtml, 'text/html');
        }

        throw new Error('network unreachable');
      }) as typeof fetch
    });

    const enrichment = await client.enrichUploadPage(pageUrl);

    expect(enrichment.fileCandidates).toEqual([]);
    expect(enrichment.warnings).toContain('HTML enrichment did not find visible downloadable file candidates.');
  });

  it('does not call the download action lookup when the static page already exposes enough file candidates', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/upload-page.html'), 'utf8');
    const client = new CcmixterHtmlClient({
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = input.toString();

        if (url.startsWith(pageUrl)) {
          return jsonOrTextResponse(html, 'text/html');
        }

        throw new Error('download action lookup should not have been called');
      }) as typeof fetch
    });

    const enrichment = await client.enrichUploadPage(pageUrl);

    expect(enrichment.fileCandidates.map((candidate) => candidate.file.originalFilename)).toEqual([
      'GUITAR-main.flac',
      'Boxcar-stems.zip'
    ]);
  });
});

function jsonOrTextResponse(body: string, contentType: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

describe('parseCcmixterUploadHtml', () => {
  it('extracts conservative metadata from an upload-page fixture', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/upload-page.html'), 'utf8');
    const enrichment = parseCcmixterUploadHtml(html, 'https://ccmixter.org/files/WiseMan/64501');

    expect(enrichment.bpm).toBe(145);
    expect(enrichment.tags).toEqual(['stems', 'flac', 'zip']);
    expect(enrichment.licenseSummary).toBe('Creative Commons Attribution 3.0');
    expect(enrichment.fileCandidates.map((candidate) => candidate.file.originalFilename)).toEqual([
      'GUITAR-main.flac',
      'Boxcar-stems.zip'
    ]);
    expect(enrichment.fileCandidates[1]?.file.fileKind).toBe('archive');
    expect(enrichment.zipFileHints).toContain('BASS.flac');
    expect(enrichment.zipFileHints).toContain('DRUMS.wav');
    expect(enrichment.relatedUploadUrls).toEqual(['https://ccmixter.org/files/WiseMan/64502']);
  });

  it('returns warnings when visible fields are absent', () => {
    const enrichment = parseCcmixterUploadHtml('<html><body><h1>No download section</h1></body></html>');

    expect(enrichment.warnings).toContain('HTML enrichment did not find a reliable BPM value.');
    expect(enrichment.warnings).toContain('HTML enrichment did not find visible upload tags.');
    expect(enrichment.warnings).toContain('HTML enrichment did not find visible license summary.');
    expect(enrichment.warnings).toContain('HTML enrichment did not find visible downloadable file candidates.');
  });

  it('extracts recorded Haze upload-page enrichment without live network', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/haze-56384-page.html'), 'utf8');
    const enrichment = parseCcmixterUploadHtml(html, 'https://ccmixter.org/files/Zutsuri/56384');

    expect(enrichment.bpm).toBe(97);
    expect(enrichment.tags).toContain('pells');
    expect(enrichment.licenseSummary).toContain('Attribution');
    expect(enrichment.fileCandidates.map((candidate) => candidate.file.originalFilename)).toContain('Zutsuri_-_Haze_1.mp3');
    expect(enrichment.relatedUploadUrls).toContain('https://ccmixter.org/files/Reiswerk/56402');
  });

  it('models each recorded Haze ZIP archive as its own hint group instead of one flat page-wide list', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/haze-56384-page.html'), 'utf8');
    const enrichment = parseCcmixterUploadHtml(html, 'https://ccmixter.org/files/Zutsuri/56384');

    expect(enrichment.archiveHintGroups).toHaveLength(2);
    expect(enrichment.archiveHintGroups[0]?.label).toBe('Stems, Second Half');
    expect(enrichment.archiveHintGroups[0]?.entries).toContain('haze - Vox 3.02_01-01.flac (927.47KB)');
    expect(enrichment.archiveHintGroups[0]?.entries).not.toContain('haze - Airy Organ_01.flac (20.55MB)');
    expect(enrichment.archiveHintGroups[1]?.label).toBe('Stems, First Half');
    expect(enrichment.archiveHintGroups[1]?.entries).toContain('haze - Airy Organ_01.flac (20.55MB)');
    expect(enrichment.archiveHintGroups[1]?.entries).not.toContain('haze - Vox 3.02_01-01.flac (927.47KB)');
  });

  it('extracts recorded related remix-child upload links without live network', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/soundbitch-1883-page.html'), 'utf8');
    const enrichment = parseCcmixterUploadHtml(html, 'https://ccmixter.org/files/soundbitch/1883');

    expect(enrichment.bpm).toBe(90);
    expect(enrichment.tags).toContain('stems');
    expect(enrichment.tags).toContain('mp3');
    expect(enrichment.licenseSummary).toContain('Sampling Plus');
    expect(enrichment.fileCandidates.map((candidate) => candidate.file.originalFilename)).toEqual([
      'soundbitch_-_pls-crepman-grunge-90bpm.mp3'
    ]);
    expect(enrichment.relatedUploadUrls).toContain('https://ccmixter.org/files/zrox/2440');
    expect(enrichment.relatedUploadUrls).toContain('https://ccmixter.org/files/zrox/5220');
  });
});

describe('parseCcmixterArtistCatalogHtml', () => {
  it('extracts visible catalog uploads without requiring BPM or downloadable files', async () => {
    const html = await readFile(path.resolve('test/fixtures/ccmixter/artist-catalog-page.html'), 'utf8');
    const catalog = parseCcmixterArtistCatalogHtml(html, 'https://ccmixter.org/people/7OOP3D', '7OOP3D');

    expect(catalog.mappings.map((mapping) => mapping.upload.uploadId)).toEqual(['70001', '70002', '70003']);
    expect(catalog.mappings.map((mapping) => mapping.upload.title)).toEqual(['Pulse Map', 'Night Voltage', 'No Tempo Sketch']);
    expect(catalog.mappings.map((mapping) => mapping.upload.bpm)).toEqual([121, 83, undefined]);
    expect(catalog.mappings.every((mapping) => mapping.files.length === 0)).toBe(true);
    expect(catalog.nextPageUrls).toEqual(['https://ccmixter.org/people/7OOP3D?offset=12']);
    expect(catalog.totalCount).toBe(96);
  });

  it('decodes HTML-entity-encoded ampersands in pagination hrefs and resolves them against the source URL', () => {
    const html = `
      <div id="upload_listing"></div>
      <p>Viewing 1 through 12 of 96</p>
      <nav class="paging">
        <a href="https://ccmixter.org/people/7OOP3D?limit=12&amp;offset=12">More &gt;&gt;&gt;</a>
      </nav>
    `;

    const catalog = parseCcmixterArtistCatalogHtml(html, 'https://ccmixter.org/people/7OOP3D', '7OOP3D');

    expect(catalog.nextPageUrls).toEqual(['https://ccmixter.org/people/7OOP3D?limit=12&offset=12']);
  });

  it('prefers the immediate next offset over a "last page" link and ignores other-artist links', () => {
    const html = `
      <div id="upload_listing"></div>
      <nav class="paging">
        <a href="https://ccmixter.org/people/other_artist?offset=12">Other artist</a>
        <a href="https://ccmixter.org/people/7OOP3D?offset=84">Last page &gt;&gt;</a>
        <a href="https://ccmixter.org/people/7OOP3D?offset=12">Next</a>
      </nav>
    `;

    const catalog = parseCcmixterArtistCatalogHtml(html, 'https://ccmixter.org/people/7OOP3D', '7OOP3D');

    expect(catalog.nextPageUrls[0]).toBe('https://ccmixter.org/people/7OOP3D?offset=12');
    expect(catalog.nextPageUrls).not.toContain('https://ccmixter.org/people/other_artist?offset=12');
  });
});

describe('parseCatalogViewingRange', () => {
  it('parses a plain "Viewing X through Y of Z" string', () => {
    const range = parseCatalogViewingRange('<p>Viewing 1 through 12 of 96</p>');
    expect(range).toEqual({ visibleStart: 1, visibleEnd: 12, totalCount: 96 });
  });

  it('parses when the numbers are separated by &nbsp;', () => {
    const range = parseCatalogViewingRange('<p>Viewing&nbsp;1 through 12 of 96</p>');
    expect(range).toEqual({ visibleStart: 1, visibleEnd: 12, totalCount: 96 });
  });

  it('parses when nested tags wrap the individual numbers', () => {
    const range = parseCatalogViewingRange(
      '<p>Viewing <b>1</b> through <b>12</b> of <b>96</b></p>'
    );
    expect(range).toEqual({ visibleStart: 1, visibleEnd: 12, totalCount: 96 });
  });

  it('parses when line breaks separate words and numbers', () => {
    const range = parseCatalogViewingRange('Viewing\n1\nthrough\n12\nof\n96');
    expect(range).toEqual({ visibleStart: 1, visibleEnd: 12, totalCount: 96 });
  });

  it('returns undefined when no viewing range text is present', () => {
    expect(parseCatalogViewingRange('<p>No paging info here.</p>')).toBeUndefined();
  });
});
