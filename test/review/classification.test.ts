import { describe, expect, it } from 'vitest';

import {
  classifyDownloadCandidate,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  isRecommendedDownloadCandidate,
  type StemGroup,
  type TrackFile
} from '../../src/shared/domain';
import { HAZE_SMOKE_STEM_GROUPS } from '../../src/main/sample-data';

describe('download candidate classification', () => {
  it('classifies a preview MP3 with reasons', () => {
    const classification = classifyDownloadCandidate(file('mix-preview.mp3', 'mp3'), {
      uploadTags: ['preview']
    });

    expect(classification).toMatchObject({
      role: 'preview',
      format: 'mp3',
      quality: 'lossy',
      confidence: 'high'
    });
    expect(classification.reasons.length).toBeGreaterThan(0);
  });

  it('classifies ZIP/archive candidates', () => {
    const candidate = file('song-stems.zip', 'zip', {
      downloadUrl: 'https://ccmixter.org/content/WiseMan/song-stems.zip',
      zipFileHints: ['BASS.flac']
    });
    const classification = classifyDownloadCandidate(candidate, {
      uploadTags: ['stems', 'archive']
    });

    expect(classification).toMatchObject({
      role: 'archive',
      format: 'zip',
      quality: 'archive',
      confidence: 'high'
    });
    expect(isRecommendedDownloadCandidate({ ...candidate, classification })).toBe(true);
  });

  it('classifies FLAC/WAV source and stem candidates', () => {
    expect(
      classifyDownloadCandidate(file('BASS.flac', 'flac'), {
        uploadTags: ['stems']
      }).role
    ).toBe('stem');
    expect(
      classifyDownloadCandidate(file('vocals-source.wav', 'wav'), {
        uploadTags: ['source']
      }).role
    ).toBe('source');
  });

  it('classifies unknown files as other with reasons and warnings', () => {
    const classification = classifyDownloadCandidate(file('notes.bin', 'bin'));

    expect(classification.role).toBe('other');
    expect(classification.format).toBe('other');
    expect(classification.quality).toBe('unknown');
    expect(classification.reasons.length).toBeGreaterThan(0);
    expect(classification.warnings.length).toBeGreaterThan(0);
  });

  it('adds expected classifications to the haze smoke fixture dry run', () => {
    const plan = createDryRunPlanFromGroups('fixture:haze-smoke', root(), HAZE_SMOKE_STEM_GROUPS, {
      createdAt: '2026-07-03T00:00:00.000Z',
      metadataSource: 'fixture',
      placeholderData: true,
      resolverStatus: 'fixture',
      warnings: []
    });

    expect(plan.plannedFiles.map((plannedFile) => plannedFile.sourceFile.classification?.role)).toEqual([
      'preview',
      'archive',
      'source'
    ]);
    expect(plan.plannedFiles.map((plannedFile) => plannedFile.sourceFile.classification?.format)).toEqual([
      'mp3',
      'zip',
      'wav'
    ]);
    expect(plan.plannedFiles.every((plannedFile) => plannedFile.sourceFile.classification!.reasons.length > 0)).toBe(true);
  });

  it('keeps artist catalog files excluded until explicit review action', () => {
    const session = createReviewSessionFromDryRunPlan(
      createDryRunPlanFromGroups('airtone', root(), [catalogGroup()], {
        createdAt: '2026-07-03T00:00:00.000Z',
        metadataSource: 'api',
        placeholderData: false,
        resolverStatus: 'resolved',
        warnings: []
      })
    );

    expect(session.sourcePlan.input.kind).toBe('artist-name');
    expect(session.groups.flatMap((group) => group.files).map((reviewFile) => reviewFile.included)).toEqual([false]);
  });
});

function file(filename: string, extension: string, overrides: Partial<TrackFile> = {}): TrackFile {
  return {
    originalFilename: filename,
    fileKind: 'unknown',
    extension,
    metadataSource: 'api',
    warnings: [],
    ...overrides
  };
}

function catalogGroup(): StemGroup {
  return {
    groupId: 'catalog-a',
    artist: 'airtone',
    canonicalSongTitle: 'Catalog preview',
    uploads: [],
    files: [file('catalog-preview.mp3', 'mp3')],
    confidence: 'low',
    metadataSource: 'api',
    groupingReasons: [],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: []
  };
}

function root() {
  return {
    path: 'D:/Stem Library',
    selectedAt: '2026-07-03T00:00:00.000Z'
  };
}
