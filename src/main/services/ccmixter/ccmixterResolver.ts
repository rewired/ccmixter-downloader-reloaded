import {
  createDryRunPlanFromGroups,
  parseCcmixterInput,
  type CcmixterInput,
  type DryRunPlan,
  type MetadataSourceType,
  type ResolvedCcmixterMetadata,
  type StemGroup,
  type StemLibraryRoot,
  type TrackFile,
  type TrackUpload
} from '../../../shared/domain';
import { groupStemUploads } from '../grouping/stemGrouper';
import type { GroupingUploadCandidate } from '../grouping/groupingTypes';
import { HAZE_SMOKE_FIXTURE_ID, HAZE_SMOKE_STEM_GROUPS } from '../../sample-data';
import { CcmixterApiClient } from './ccmixterApiClient';
import { CcmixterHtmlClient } from './ccmixterHtmlClient';
import type {
  CcmixterApiUploadMapping,
  CcmixterHtmlEnrichment,
  CcmixterResolverDependencies,
  ResolveCcmixterMetadataOptions
} from './ccmixterTypes';

const DRY_RUN_ONLY_WARNINGS = [
  'Dry run only: resolved ccMixter metadata is shown for review.',
  'No files will be downloaded.',
  'No ZIP extraction happened.',
  'No attribution files were written.'
];

export class CcmixterResolver {
  private readonly apiClient: CcmixterResolverDependencies['apiClient'];
  private readonly htmlClient?: CcmixterResolverDependencies['htmlClient'];

  constructor(dependencies: Partial<CcmixterResolverDependencies> = {}) {
    this.apiClient = dependencies.apiClient ?? new CcmixterApiClient();
    this.htmlClient = dependencies.htmlClient ?? new CcmixterHtmlClient();
  }

  async resolveMetadata(
    rawInput: string,
    options: ResolveCcmixterMetadataOptions = { enrichHtml: true }
  ): Promise<ResolvedCcmixterMetadata> {
    const createdAt = new Date().toISOString();
    const input = parseCcmixterInput(rawInput);

    if (input.kind === 'fixture') {
      return resolveFixtureMetadata(input, createdAt);
    }

    const mappingsResult = await this.resolveApiMappings(input);

    if (!mappingsResult.ok) {
      return unresolvedMetadata(input, [mappingsResult.warning], createdAt);
    }

    if (mappingsResult.mappings.length === 0) {
      return unresolvedMetadata(input, ['ccMixter API returned no matching uploads.'], createdAt);
    }

    const enrichments = options.enrichHtml === false ? [] : await this.enrichUploads(mappingsResult.mappings);
    const groupingCandidates = buildGroupingCandidates(mappingsResult.mappings, enrichments);
    const groupingResult = groupStemUploads(groupingCandidates);
    const groups = groupingResult.groups;
    const uploads = groups.flatMap((group) => group.uploads);
    const files = groups.flatMap((group) => group.files);
    const warnings = [
      ...input.warnings.filter((warning) => !warning.includes('has not been verified')),
      ...mappingsResult.mappings.flatMap((mapping) => mapping.warnings),
      ...enrichments.flatMap((enrichment) => enrichment.warnings),
      ...groups.flatMap((group) => group.warnings),
      ...groupingResult.warnings
    ];
    const metadataSource = resolveMetadataSource(groups, enrichments);

    return {
      input: {
        ...input,
        warnings: warnings.filter((warning, index, all) => all.indexOf(warning) === index)
      },
      groups,
      uploads,
      files,
      warnings: warnings.filter((warning, index, all) => all.indexOf(warning) === index),
      status: groups.length > 0 && files.length > 0 ? 'resolved' : 'partial',
      metadataSource,
      createdAt
    };
  }

  async createDryRunPlan(rawInput: string, rootFolder: StemLibraryRoot): Promise<DryRunPlan> {
    const metadata = await this.resolveMetadata(rawInput);
    const planWarnings = [
      ...DRY_RUN_ONLY_WARNINGS,
      ...metadata.warnings,
      ...(metadata.groups.length === 0 ? ['No planned files were created because no resolver groups were available.'] : [])
    ];

    return createDryRunPlanFromGroups(rawInput, rootFolder, metadata.groups, {
      createdAt: metadata.createdAt,
      input: metadata.input,
      metadataSource: metadata.metadataSource,
      placeholderData: metadata.metadataSource === 'fixture',
      resolverStatus: metadata.status,
      warnings: planWarnings.filter((warning, index, all) => all.indexOf(warning) === index)
    });
  }

  private async resolveApiMappings(
    input: CcmixterInput
  ): Promise<{ ok: true; mappings: CcmixterApiUploadMapping[] } | { ok: false; warning: string }> {
    try {
      if (input.uploadId) {
        return {
          ok: true,
          mappings: await this.apiClient.resolveByUploadId(input.uploadId)
        };
      }

      if (input.normalizedArtistLogin) {
        return {
          ok: true,
          mappings: await this.apiClient.resolveByArtistLogin(input.normalizedArtistLogin)
        };
      }

      return {
        ok: false,
        warning: 'Input could not be resolved because no upload ID or artist login was parsed.'
      };
    } catch (error) {
      return {
        ok: false,
        warning: error instanceof Error ? error.message : 'ccMixter metadata resolution failed.'
      };
    }
  }

  private async enrichUploads(mappings: CcmixterApiUploadMapping[]): Promise<CcmixterHtmlEnrichment[]> {
    const htmlClient = this.htmlClient;
    if (!htmlClient) {
      return [];
    }

    const enrichments = await Promise.all(
      mappings.map(async (mapping): Promise<CcmixterHtmlEnrichment | null> => {
        try {
          return await htmlClient.enrichUploadPage(mapping.upload.sourceUrl);
        } catch (error) {
          return {
            sourceUrl: mapping.upload.sourceUrl,
            tags: [],
            fileCandidates: [],
            zipFileHints: [],
            relatedUploadUrls: [],
            warnings: [
              error instanceof Error
                ? `HTML enrichment failed for ${mapping.upload.sourceUrl}: ${error.message}`
                : `HTML enrichment failed for ${mapping.upload.sourceUrl}.`
            ]
          };
        }
      })
    );

    return enrichments.filter((enrichment): enrichment is CcmixterHtmlEnrichment => enrichment !== null);
  }
}

export function buildGroupingCandidates(
  mappings: CcmixterApiUploadMapping[],
  enrichments: CcmixterHtmlEnrichment[] = []
): GroupingUploadCandidate[] {
  return mappings.map((mapping) => {
    const enrichment = enrichments.find((item) => item.sourceUrl === mapping.upload.sourceUrl);
    const upload = applyHtmlEnrichment(mapping.upload, enrichment);
    const files = mergeFiles(mapping.files, enrichment);

    return {
      upload,
      files
    };
  });
}

function applyHtmlEnrichment(upload: TrackUpload, enrichment: CcmixterHtmlEnrichment | undefined): TrackUpload {
  if (!enrichment) {
    return upload;
  }

  const hasHtmlData = hasContributedHtmlData(enrichment);
  const tags = [...new Set([...upload.tags, ...enrichment.tags])];
  const warnings = [...upload.warnings, ...enrichment.warnings];

  if (enrichment.relatedUploadUrls.length > 0) {
    warnings.push('Related upload links were found in HTML but are not recursively resolved in this slice.');
  }

  return {
    ...upload,
    bpm: upload.bpm ?? enrichment.bpm,
    tags,
    licenseSummary: upload.licenseSummary !== 'not specified' ? upload.licenseSummary : enrichment.licenseSummary ?? upload.licenseSummary,
    metadataSource: hasHtmlData ? 'html-enriched' : upload.metadataSource,
    relatedUploadUrls: [...new Set([...(upload.relatedUploadUrls ?? []), ...enrichment.relatedUploadUrls])],
    warnings
  };
}

function mergeFiles(apiFiles: TrackFile[], enrichment: CcmixterHtmlEnrichment | undefined): TrackFile[] {
  const files = new Map<string, TrackFile>();

  for (const file of apiFiles) {
    files.set(fileKey(file), file);
  }

  if (enrichment) {
    for (const candidate of enrichment.fileCandidates) {
      const existing = files.get(fileKey(candidate.file));
      const zipFileHints = candidate.file.fileKind === 'archive' ? enrichment.zipFileHints : undefined;

      if (existing) {
        files.set(fileKey(existing), {
          ...existing,
          metadataSource: combineSource(existing.metadataSource, 'html-enriched'),
          zipFileHints,
          warnings: [...existing.warnings, 'Matching HTML file candidate was found for this API file.']
        });
      } else {
        files.set(fileKey(candidate.file), {
          ...candidate.file,
          zipFileHints
        });
      }
    }
  }

  return [...files.values()];
}

function fileKey(file: TrackFile): string {
  return `${file.originalFilename.toLowerCase()}::${file.downloadUrl ?? ''}`;
}

function combineSource(left: MetadataSourceType, right: MetadataSourceType): MetadataSourceType {
  if (left === 'html-enriched' || right === 'html-enriched') {
    return 'html-enriched';
  }

  if (left === 'api' || right === 'api') {
    return 'api';
  }

  if (left === 'fixture' || right === 'fixture') {
    return 'fixture';
  }

  return 'unresolved';
}

function resolveMetadataSource(groups: StemGroup[], enrichments: CcmixterHtmlEnrichment[]): MetadataSourceType {
  if (groups.some((group) => group.metadataSource === 'html-enriched') || enrichments.some(hasContributedHtmlData)) {
    return 'html-enriched';
  }

  if (groups.length > 0) {
    return 'api';
  }

  return 'unresolved';
}

function hasContributedHtmlData(enrichment: CcmixterHtmlEnrichment): boolean {
  return (
    typeof enrichment.bpm === 'number' ||
    enrichment.tags.length > 0 ||
    typeof enrichment.licenseSummary === 'string' ||
    enrichment.fileCandidates.length > 0 ||
    enrichment.zipFileHints.length > 0 ||
    enrichment.relatedUploadUrls.length > 0
  );
}

function unresolvedMetadata(input: CcmixterInput, warnings: string[], createdAt: string): ResolvedCcmixterMetadata {
  const uniqueWarnings = [...input.warnings, ...warnings].filter((warning, index, all) => all.indexOf(warning) === index);

  return {
    input: {
      ...input,
      warnings: uniqueWarnings
    },
    groups: [],
    uploads: [],
    files: [],
    warnings: uniqueWarnings,
    status: 'unresolved',
    metadataSource: 'unresolved',
    createdAt
  };
}

function resolveFixtureMetadata(input: CcmixterInput, createdAt: string): ResolvedCcmixterMetadata {
  if (input.fixtureId !== HAZE_SMOKE_FIXTURE_ID) {
    return unresolvedMetadata(input, [`Unknown fixture ID: ${input.fixtureId ?? 'not specified'}.`], createdAt);
  }

  const groups = HAZE_SMOKE_STEM_GROUPS;
  const uploads = groups.flatMap((group) => group.uploads);
  const files = groups.flatMap((group) => group.files);
  const warnings = [
    ...input.warnings,
    'Fixture/sample data: fixture:haze-smoke uses recorded ccMixter metadata for UI smoke testing.',
    'No recursive related-upload resolution happened.',
    ...groups.flatMap((group) => group.warnings),
    ...uploads.flatMap((upload) => upload.warnings),
    ...files.flatMap((file) => file.warnings)
  ].filter((warning, index, all) => all.indexOf(warning) === index);

  return {
    input: {
      ...input,
      warnings
    },
    groups,
    uploads,
    files,
    warnings,
    status: 'fixture',
    metadataSource: 'fixture',
    createdAt
  };
}
