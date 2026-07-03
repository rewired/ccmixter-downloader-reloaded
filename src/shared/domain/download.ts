import type { DryRunPlan, MetadataSourceType, PlannedFile, TrackFileKind } from './models';
import { sanitizePathSegment } from './planning';

export type DownloadStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'blocked';

export interface DownloadError {
  code: string;
  message: string;
  recoverable: boolean;
  technicalDetail?: string;
}

export interface DownloadProgress {
  jobId: string;
  fileJobId?: string;
  status: DownloadStatus;
  receivedBytes?: number;
  totalBytes?: number;
  completedFiles: number;
  totalFiles: number;
  skippedFiles: number;
  blockedFiles: number;
  failedFiles: number;
  warnings: string[];
  errors: DownloadError[];
}

export interface DownloadFileJob {
  fileJobId: string;
  groupId: string;
  sourceUrl?: string;
  targetRelativePath: string;
  targetAbsolutePath: string;
  fileKind: TrackFileKind;
  originalFilename: string;
  metadataSource: MetadataSourceType;
  provenance: PlannedFile['sourceFile'];
  status: DownloadStatus;
  receivedBytes?: number;
  totalBytes?: number;
  warnings: string[];
  errors: DownloadError[];
}

export interface DownloadJob {
  jobId: string;
  reviewSourcePlanCreatedAt: string;
  stemLibraryRootPath: string;
  conflictStrategy: 'fail';
  status: DownloadStatus;
  files: DownloadFileJob[];
  warnings: string[];
  errors: DownloadError[];
  createdAt: string;
}

export interface DownloadFileState {
  fileJobId: string;
  targetRelativePath: string;
  status: DownloadStatus;
  receivedBytes?: number;
  totalBytes?: number;
  warnings: string[];
  errors: DownloadError[];
}

export interface DownloadQueueState {
  jobId: string;
  status: DownloadStatus;
  files: DownloadFileState[];
  progress: DownloadProgress;
  warnings: string[];
  errors: DownloadError[];
}

export interface DownloadResult {
  jobId: string;
  status: DownloadStatus;
  completedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  cancelledFiles: number;
  warnings: string[];
  errors: DownloadError[];
}

export interface DownloadJobValidation {
  ok: boolean;
  blockingErrors: DownloadError[];
  warnings: string[];
}

export interface DownloadJobSummary {
  totalFiles: number;
  writableFiles: number;
  skippedFiles: number;
  blockedFiles: number;
  httpFiles: number;
  targetRoot: string;
  targetRelativePaths: string[];
  warnings: string[];
  errors: DownloadError[];
}

export interface CreateDownloadJobOptions {
  jobId?: string;
  createdAt?: string;
  existingTargetRelativePaths?: string[];
}

const CCMIXTER_HOST = 'ccmixter.org';

export function createDownloadJobFromReviewedPlan(plan: DryRunPlan, options: CreateDownloadJobOptions = {}): DownloadJob {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const jobId = options.jobId ?? `download-${stableId(plan.createdAt)}-${stableId(createdAt)}`;
  const existingTargets = new Set((options.existingTargetRelativePaths ?? []).map(normalizeRelativePathKey));
  const duplicateTargets = findDuplicateReviewedTargets(plan);
  const files = plan.plannedFiles.map((plannedFile, index) => {
    const pathResult = sanitizeReviewedTargetRelativePath(plannedFile.targetRelativePath);
    const targetRelativePath = pathResult.value ?? `blocked-${index}`;
    const targetAbsolutePath = joinDomainPath(plan.stemLibraryRoot.path, targetRelativePath);
    const urlResult = validateCcmixterDownloadUrl(plannedFile.sourceFile.downloadUrl);
    const warnings = mergeMessages(plannedFile.warnings, plannedFile.sourceFile.warnings, pathResult.warnings, urlResult.warnings);
    const errors = [...pathResult.errors, ...urlResult.errors];
    const existingTargetConflict = existingTargets.has(normalizeRelativePathKey(targetRelativePath));

    if (existingTargetConflict) {
      errors.push(
        downloadError(
          'DOWNLOAD_TARGET_EXISTS',
          `Target already exists and overwrite is disabled: ${targetRelativePath}`,
          true
        )
      );
    }

    if (duplicateTargets.has(normalizeRelativePathKey(targetRelativePath))) {
      errors.push(
        downloadError(
          'DOWNLOAD_DUPLICATE_TARGET',
          `Duplicate download target paths are not allowed: ${targetRelativePath}`,
          true
        )
      );
    }

    return {
      fileJobId: `${jobId}::file::${index}`,
      groupId: findGroupIdForPlannedFile(plan, plannedFile, index),
      sourceUrl: urlResult.value,
      targetRelativePath,
      targetAbsolutePath,
      fileKind: plannedFile.sourceFile.fileKind,
      originalFilename: plannedFile.sourceFile.originalFilename,
      metadataSource: plannedFile.sourceFile.metadataSource,
      provenance: plannedFile.sourceFile,
      status: resolveInitialFileStatus(urlResult.value, errors),
      warnings,
      errors
    } satisfies DownloadFileJob;
  });

  const validation = validateDownloadJob({
    jobId,
    reviewSourcePlanCreatedAt: plan.createdAt,
    stemLibraryRootPath: plan.stemLibraryRoot.path,
    conflictStrategy: 'fail',
    status: 'queued',
    files,
    warnings: [],
    errors: [],
    createdAt
  });

  return {
    jobId,
    reviewSourcePlanCreatedAt: plan.createdAt,
    stemLibraryRootPath: plan.stemLibraryRoot.path,
    conflictStrategy: 'fail',
    status: validation.ok ? 'queued' : 'failed',
    files,
    warnings: validation.warnings,
    errors: validation.blockingErrors,
    createdAt
  };
}

export function validateDownloadJob(job: DownloadJob): DownloadJobValidation {
  const warnings = [...job.warnings];
  const blockingErrors = [...job.errors];
  const targetPaths = new Map<string, string>();

  if (!job.stemLibraryRootPath.trim()) {
    blockingErrors.push(downloadError('DOWNLOAD_ROOT_REQUIRED', 'Stem Library Root Folder is required.', true));
  }

  for (const file of job.files) {
    const pathResult = sanitizeReviewedTargetRelativePath(file.targetRelativePath);
    blockingErrors.push(...pathResult.errors);
    warnings.push(...pathResult.warnings);

    const targetKey = normalizeRelativePathKey(pathResult.value ?? file.targetRelativePath);
    const existingTarget = targetPaths.get(targetKey);
    if (existingTarget) {
      blockingErrors.push(
        downloadError(
          'DOWNLOAD_DUPLICATE_TARGET',
          `Duplicate download target paths are not allowed: ${existingTarget} and ${file.targetRelativePath}`,
          true
        )
      );
    } else {
      targetPaths.set(targetKey, file.targetRelativePath);
    }

    const urlResult = validateCcmixterDownloadUrl(file.sourceUrl);
    warnings.push(...urlResult.warnings);
    if (file.status !== 'skipped') {
      blockingErrors.push(...urlResult.errors);
    }

    blockingErrors.push(...file.errors.filter((error) => error.code !== 'DOWNLOAD_URL_MISSING'));
  }

  return {
    ok: blockingErrors.length === 0,
    blockingErrors: uniqueErrors(blockingErrors),
    warnings: unique(warnings)
  };
}

export function summarizeDownloadJob(job: DownloadJob): DownloadJobSummary {
  const validation = validateDownloadJob(job);
  const skippedFiles = job.files.filter((file) => file.status === 'skipped').length;
  const blockedFiles = job.files.filter((file) => file.status === 'blocked').length;
  const writableFiles = job.files.filter((file) => file.status === 'queued' && file.errors.length === 0).length;

  return {
    totalFiles: job.files.length,
    writableFiles,
    skippedFiles,
    blockedFiles,
    httpFiles: job.files.filter((file) => isHttpUrl(file.sourceUrl)).length,
    targetRoot: job.stemLibraryRootPath,
    targetRelativePaths: job.files.map((file) => file.targetRelativePath),
    warnings: unique([...job.warnings, ...validation.warnings, ...job.files.flatMap((file) => file.warnings)]),
    errors: uniqueErrors([...job.errors, ...validation.blockingErrors, ...job.files.flatMap((file) => file.errors)])
  };
}

export function validateCcmixterDownloadUrl(value: string | undefined): {
  value?: string;
  warnings: string[];
  errors: DownloadError[];
} {
  if (!value) {
    return {
      warnings: ['File has no download URL and will be skipped.'],
      errors: [downloadError('DOWNLOAD_URL_MISSING', 'File has no download URL.', true)]
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      warnings: [],
      errors: [downloadError('DOWNLOAD_URL_INVALID', `Download URL is invalid: ${value}`, true)]
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      warnings: [],
      errors: [downloadError('DOWNLOAD_URL_PROTOCOL_BLOCKED', `Download URL protocol is not allowed: ${parsed.protocol}`, true)]
    };
  }

  if (!isAllowedCcmixterHostname(parsed.hostname)) {
    return {
      warnings: [],
      errors: [downloadError('DOWNLOAD_URL_HOST_BLOCKED', `Download URL host is not allowed: ${parsed.hostname}`, true)]
    };
  }

  const warnings = parsed.protocol === 'http:' ? [`HTTP transport is allowed only for ccMixter downloads: ${parsed.toString()}`] : [];

  return {
    value: parsed.toString(),
    warnings,
    errors: []
  };
}

export function isAllowedCcmixterHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === CCMIXTER_HOST || normalized.endsWith(`.${CCMIXTER_HOST}`);
}

function sanitizeReviewedTargetRelativePath(relativePath: string): {
  value?: string;
  warnings: string[];
  errors: DownloadError[];
} {
  const warnings: string[] = [];
  const errors: DownloadError[] = [];

  if (isAbsolutePathInjection(relativePath)) {
    errors.push(downloadError('DOWNLOAD_TARGET_ABSOLUTE', `Target path must be relative: ${relativePath}`, true));
    return { warnings, errors };
  }

  const rawSegments = relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (rawSegments.length === 0) {
    errors.push(downloadError('DOWNLOAD_TARGET_EMPTY', 'Target path is empty.', true));
    return { warnings, errors };
  }

  if (rawSegments.some((segment) => segment === '..' || segment === '.')) {
    errors.push(downloadError('DOWNLOAD_TARGET_TRAVERSAL', `Target path cannot contain traversal segments: ${relativePath}`, true));
    return { warnings, errors };
  }

  const sanitizedSegments = rawSegments.map((segment) => sanitizePathSegment(segment));
  const sanitizedPath = sanitizedSegments.join('/');
  if (sanitizedPath !== relativePath.replace(/\\/g, '/')) {
    warnings.push(`Target path was sanitized to ${sanitizedPath}.`);
  }

  return {
    value: sanitizedPath,
    warnings,
    errors
  };
}

function isAbsolutePathInjection(relativePath: string): boolean {
  return (
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(relativePath) ||
    /^[a-zA-Z]:$/.test(relativePath) ||
    relativePath.startsWith('\\\\')
  );
}

function findGroupIdForPlannedFile(plan: DryRunPlan, plannedFile: PlannedFile, fallbackIndex: number): string {
  const group = plan.groups.find((candidate) =>
    candidate.files.some(
      (file) =>
        file.originalFilename === plannedFile.sourceFile.originalFilename &&
        file.downloadUrl === plannedFile.sourceFile.downloadUrl
    )
  );

  return group?.groupId ?? `reviewed-group-${fallbackIndex}`;
}

function joinDomainPath(root: string, relativePath: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/g, '');
  return `${normalizedRoot}/${relativePath}`;
}

function normalizeRelativePathKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').toLowerCase();
}

function findDuplicateReviewedTargets(plan: DryRunPlan): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const file of plan.plannedFiles) {
    const pathResult = sanitizeReviewedTargetRelativePath(file.targetRelativePath);
    const targetKey = normalizeRelativePathKey(pathResult.value ?? file.targetRelativePath);

    if (seen.has(targetKey)) {
      duplicates.add(targetKey);
    } else {
      seen.add(targetKey);
    }
  }

  return duplicates;
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job';
}

function resolveInitialFileStatus(sourceUrl: string | undefined, errors: DownloadError[]): DownloadStatus {
  if (sourceUrl && errors.length === 0) {
    return 'queued';
  }

  if (errors.length > 0 && errors.every((error) => error.code === 'DOWNLOAD_URL_MISSING')) {
    return 'skipped';
  }

  return 'blocked';
}

function downloadError(code: string, message: string, recoverable: boolean, technicalDetail?: string): DownloadError {
  return {
    code,
    message,
    recoverable,
    technicalDetail
  };
}

function mergeMessages(...groups: string[][]): string[] {
  return unique(groups.flat().filter((message) => message.length > 0));
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function uniqueErrors(errors: DownloadError[]): DownloadError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.code}:${error.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).protocol === 'http:';
  } catch {
    return false;
  }
}
