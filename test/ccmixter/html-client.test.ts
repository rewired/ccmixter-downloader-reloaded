import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { parseCcmixterUploadHtml } from '../../src/main/services/ccmixter/ccmixterHtmlClient';

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
