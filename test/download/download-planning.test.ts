import { describe, expect, it } from 'vitest';

import {
  createDownloadJobFromReviewedPlan,
  createDryRunPlanFromGroups,
  createReviewSessionFromDryRunPlan,
  buildReviewedDryRunPlan,
  isAllowedCcmixterHostname,
  renameFile,
  summarizeDownloadJob,
  toggleFileIncluded,
  validateCcmixterDownloadUrl,
  validateDownloadJob,
  type DryRunPlan,
  type StemGroup
} from '../../src/shared/domain';

describe('download job planning', () => {
  it('creates jobs from reviewed dry-run planned files and omits excluded files', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const excludedFileId = session.groups[0]!.files[1]!.fileId;
    const reviewed = toggleFileIncluded(session, excludedFileId);
    const plan = reviewedPlan(reviewed);
    const job = createDownloadJobFromReviewedPlan(plan, { jobId: 'job-a', createdAt: '2026-07-03T00:00:00.000Z' });

    expect(job.files.map((file) => file.originalFilename)).toEqual(['BASS.flac', 'VOCALS.flac']);
    expect(job.files.every((file) => file.status === 'queued')).toBe(true);
  });

  it('marks missing URLs as skipped with warning', () => {
    const job = createDownloadJobFromReviewedPlan(createPlan({ includeMissingUrl: true }), { jobId: 'job-a' });
    const missingUrlFile = job.files.find((file) => file.originalFilename === 'missing.wav');

    expect(missingUrlFile?.status).toBe('skipped');
    expect(missingUrlFile?.errors.map((error) => error.code)).toContain('DOWNLOAD_URL_MISSING');
    expect(summarizeDownloadJob(job).skippedFiles).toBe(1);
    expect(summarizeDownloadJob(job).blockedFiles).toBe(0);
  });

  it('allows HTTP ccMixter URLs with an explicit warning', () => {
    const result = validateCcmixterDownloadUrl('http://ccmixter.org/content/WiseMan/BASS.flac');

    expect(result.value).toBe('http://ccmixter.org/content/WiseMan/BASS.flac');
    expect(result.warnings[0]).toContain('HTTP transport');
    expect(result.errors).toEqual([]);
  });

  it('rejects arbitrary HTTPS URLs', () => {
    const result = validateCcmixterDownloadUrl('https://example.com/content/WiseMan/BASS.flac');

    expect(result.errors.map((error) => error.code)).toContain('DOWNLOAD_URL_HOST_BLOCKED');
  });

  it('uses parsed hostnames instead of substring matching for the allowlist', () => {
    expect(isAllowedCcmixterHostname('ccmixter.org')).toBe(true);
    expect(isAllowedCcmixterHostname('files.ccmixter.org')).toBe(true);
    expect(isAllowedCcmixterHostname('ccmixter.org.evil.test')).toBe(false);
    expect(isAllowedCcmixterHostname('evil-ccmixter.org')).toBe(false);
  });

  it('rejects root escape traversal and absolute path injection', () => {
    const traversalJob = createDownloadJobFromReviewedPlan(planWithTargetPath('Artist/../evil.flac'), { jobId: 'traversal' });
    const absoluteJob = createDownloadJobFromReviewedPlan(planWithTargetPath('C:/Users/name/evil.flac'), { jobId: 'absolute' });

    expect(validateDownloadJob(traversalJob).blockingErrors.map((error) => error.code)).toContain('DOWNLOAD_TARGET_TRAVERSAL');
    expect(validateDownloadJob(absoluteJob).blockingErrors.map((error) => error.code)).toContain('DOWNLOAD_TARGET_ABSOLUTE');
  });

  it('keeps Windows reserved names sanitized in target paths', () => {
    const session = createReviewSessionFromDryRunPlan(createPlan());
    const fileId = session.groups[0]!.files[0]!.fileId;
    const reviewed = renameFile(session, fileId, 'CON.wav');
    const job = createDownloadJobFromReviewedPlan(reviewedPlan(reviewed), { jobId: 'job-a' });

    expect(job.files[0]?.targetRelativePath).toContain('_CON.wav');
  });

  it('detects duplicate target paths before downloading', () => {
    const plan = createPlan();
    plan.plannedFiles[1] = {
      ...plan.plannedFiles[1]!,
      targetRelativePath: plan.plannedFiles[0]!.targetRelativePath
    };
    const job = createDownloadJobFromReviewedPlan(plan, { jobId: 'job-a' });

    expect(validateDownloadJob(job).blockingErrors.map((error) => error.code)).toContain('DOWNLOAD_DUPLICATE_TARGET');
    expect(job.files.map((file) => file.status)).toEqual(['blocked', 'blocked', 'queued']);
  });

  it('represents existing target files as blocking conflicts', () => {
    const plan = createPlan();
    const job = createDownloadJobFromReviewedPlan(plan, {
      jobId: 'job-a',
      existingTargetRelativePaths: [plan.plannedFiles[0]!.targetRelativePath]
    });

    expect(validateDownloadJob(job).blockingErrors.map((error) => error.code)).toContain('DOWNLOAD_TARGET_EXISTS');
    expect(job.files[0]?.status).toBe('blocked');
  });

  it('summarizes writable, skipped, and blocked files', () => {
    const plan = createPlan({ includeMissingUrl: true });
    plan.plannedFiles[1] = {
      ...plan.plannedFiles[1]!,
      targetRelativePath: plan.plannedFiles[0]!.targetRelativePath
    };
    const job = createDownloadJobFromReviewedPlan(plan, { jobId: 'job-a' });
    const summary = summarizeDownloadJob(job);

    expect(summary.writableFiles).toBeGreaterThan(0);
    expect(summary.skippedFiles).toBe(1);
    expect(summary.blockedFiles).toBe(2);
    expect(summary.errors.map((error) => error.code)).toContain('DOWNLOAD_DUPLICATE_TARGET');
  });
});

function reviewedPlan(session: ReturnType<typeof createReviewSessionFromDryRunPlan>): DryRunPlan {
  return session.sourcePlan.groups.length > 0 ? buildReviewedDryRunPlan(session, root()) : session.sourcePlan;
}

function planWithTargetPath(targetRelativePath: string): DryRunPlan {
  const plan = createPlan();
  plan.plannedFiles[0] = {
    ...plan.plannedFiles[0]!,
    targetRelativePath
  };
  return plan;
}

function createPlan(options: { includeMissingUrl?: boolean } = {}): DryRunPlan {
  return createDryRunPlanFromGroups('WiseMan', root(), [groupA(options), groupB()], {
    createdAt: '2026-07-03T00:00:00.000Z',
    metadataSource: 'api',
    placeholderData: false,
    resolverStatus: 'resolved',
    warnings: ['Reviewed download source.']
  });
}

function root() {
  return {
    path: 'D:/Stem Library',
    selectedAt: '2026-07-03T00:00:00.000Z'
  };
}

function groupA(options: { includeMissingUrl?: boolean }): StemGroup {
  return {
    groupId: 'group-a',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    bpm: 145,
    uploads: [],
    files: [
      {
        originalFilename: 'BASS.flac',
        fileKind: 'stem',
        extension: 'flac',
        downloadUrl: 'https://ccmixter.org/content/WiseMan/BASS.flac',
        metadataSource: 'api',
        warnings: []
      },
      {
        originalFilename: 'preview.mp3',
        fileKind: 'preview',
        extension: 'mp3',
        downloadUrl: 'https://files.ccmixter.org/content/WiseMan/preview.mp3',
        metadataSource: 'api',
        warnings: []
      },
      ...(options.includeMissingUrl
        ? [
            {
              originalFilename: 'missing.wav',
              fileKind: 'stem' as const,
              extension: 'wav',
              metadataSource: 'api' as const,
              warnings: []
            }
          ]
        : [])
    ],
    confidence: 'high',
    metadataSource: 'api',
    groupingReasons: [],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: []
  };
}

function groupB(): StemGroup {
  return {
    groupId: 'group-b',
    artist: 'Wiseman',
    canonicalSongTitle: 'Boxcar heading West',
    bpm: 145,
    uploads: [],
    files: [
      {
        originalFilename: 'VOCALS.flac',
        fileKind: 'stem',
        extension: 'flac',
        downloadUrl: 'https://ccmixter.org/content/WiseMan/VOCALS.flac',
        metadataSource: 'api',
        warnings: []
      }
    ],
    confidence: 'high',
    metadataSource: 'api',
    groupingReasons: [],
    ambiguousUploads: [],
    unverifiedFields: [],
    warnings: []
  };
}
