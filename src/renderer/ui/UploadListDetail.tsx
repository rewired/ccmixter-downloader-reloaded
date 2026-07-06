import { useMemo } from 'react';

import {
  clearIncludedDownloadCandidates,
  excludeArchiveDownloadCandidates,
  excludePreviewDownloadCandidates,
  getDownloadCandidateClassification,
  includeRecommendedDownloadCandidates,
  markGroupAccepted,
  markGroupNeedsReview,
  mergeGroups,
  renameArtist,
  renameFile,
  renameGroup,
  resetGroupOverrides,
  splitGroup,
  toggleFileIncluded,
  type ReviewFile,
  type ReviewGroup,
  type ReviewSession,
  type StemGroup
} from '../../shared/domain';

export interface UploadRow {
  id: string;
  title: string;
  artist: string;
  bpm?: number;
  license?: string;
  sourceMode: string;
  fileCount: number;
  warningCount: number;
  status?: ReviewGroup['status'];
}

export function toReviewRow(group: ReviewGroup): UploadRow {
  const firstUpload = group.originalGroup.uploads[0];

  return {
    id: group.reviewGroupId,
    title: group.songFolderName,
    artist: group.artistName,
    bpm: group.originalGroup.bpm,
    license: firstUpload?.licenseSummary,
    sourceMode: group.originalGroup.metadataSource,
    fileCount: group.files.filter((file) => file.included).length,
    warningCount: group.warnings.length + group.overrideWarnings.length,
    status: group.status
  };
}

export function toRawRow(group: StemGroup): UploadRow {
  const firstUpload = group.uploads[0];

  return {
    id: group.groupId,
    title: group.canonicalSongTitle,
    artist: group.artist,
    bpm: group.bpm,
    license: firstUpload?.licenseSummary,
    sourceMode: group.metadataSource,
    fileCount: group.files.length,
    warningCount: group.warnings.length
  };
}

export type ListMode =
  | { kind: 'review'; reviewSession: ReviewSession; onChange: (session: ReviewSession) => void }
  | { kind: 'raw'; groups: StemGroup[] };

export function UploadListDetail({
  mode,
  selectedGroupId,
  onSelectGroup
}: {
  mode: ListMode;
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
}): JSX.Element {
  const rows = useMemo(
    () => (mode.kind === 'review' ? mode.reviewSession.groups.map(toReviewRow) : mode.groups.map(toRawRow)),
    [mode]
  );

  if (rows.length === 0) {
    return (
      <p className="empty">
        {mode.kind === 'review' ? 'No review groups are available yet.' : 'No resolver groups are available yet.'}
      </p>
    );
  }

  const selectedReviewGroup =
    mode.kind === 'review' ? mode.reviewSession.groups.find((group) => group.reviewGroupId === selectedGroupId) ?? null : null;
  const selectedRawGroup = mode.kind === 'raw' ? mode.groups.find((group) => group.groupId === selectedGroupId) ?? null : null;

  return (
    <div className="upload-list-detail">
      <div>
        {mode.kind === 'review' ? (
          <div className="review-actions candidate-actions" aria-label="Review file selection actions">
            <button
              type="button"
              className="secondary"
              onClick={() => mode.onChange(includeRecommendedDownloadCandidates(mode.reviewSession))}
            >
              Include recommended source/stem/archive files
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => mode.onChange(excludePreviewDownloadCandidates(mode.reviewSession))}
            >
              Exclude previews
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => mode.onChange(excludeArchiveDownloadCandidates(mode.reviewSession))}
            >
              Exclude archives
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => mode.onChange(clearIncludedDownloadCandidates(mode.reviewSession))}
            >
              Clear all included files
            </button>
          </div>
        ) : null}

        <ul className="upload-list" aria-label="Uploads">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`upload-list-row${row.id === selectedGroupId ? ' selected' : ''}`}
                onClick={() => onSelectGroup(row.id)}
                aria-pressed={row.id === selectedGroupId}
              >
                <div className="upload-list-row__top">
                  <span className="upload-list-row__title">{row.title}</span>
                  {row.status ? <span className={`source-badge status-${row.status}`}>{row.status}</span> : null}
                </div>
                <div className="upload-list-row__meta">
                  <span>{row.artist}</span>
                  {typeof row.bpm === 'number' ? <span>{row.bpm} BPM</span> : null}
                  {row.license ? <span>{row.license}</span> : null}
                  <span>
                    {row.fileCount} file{row.fileCount === 1 ? '' : 's'}
                  </span>
                  {row.warningCount > 0 ? <span className="upload-list-row__warning">⚠ {row.warningCount}</span> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {mode.kind === 'review' ? (
        selectedReviewGroup ? (
          <ReviewGroupDetail reviewSession={mode.reviewSession} group={selectedReviewGroup} onChange={mode.onChange} />
        ) : (
          <p className="empty">Select an upload to see details.</p>
        )
      ) : selectedRawGroup ? (
        <RawGroupDetail group={selectedRawGroup} />
      ) : (
        <p className="empty">Select an upload to see details.</p>
      )}
    </div>
  );
}

function ReviewGroupDetail({
  reviewSession,
  group,
  onChange
}: {
  reviewSession: ReviewSession;
  group: ReviewGroup;
  onChange: (session: ReviewSession) => void;
}): JSX.Element {
  const availableMergeTargets = reviewSession.groups.filter((candidate) => candidate.reviewGroupId !== group.reviewGroupId);

  return (
    <section className="upload-detail" aria-label="Selected upload details">
      <div className="group-heading">
        <div>
          <h2>{group.songFolderName}</h2>
          <span>by {group.artistName}</span>
        </div>
        <span className={`source-badge status-${group.status}`}>{group.status}</span>
      </div>

      <div className="review-actions">
        <button type="button" className="secondary" onClick={() => onChange(markGroupAccepted(reviewSession, group.reviewGroupId))}>
          Accept
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange(markGroupNeedsReview(reviewSession, group.reviewGroupId))}
        >
          Needs review
        </button>
        <button type="button" className="secondary" onClick={() => onChange(resetGroupOverrides(reviewSession, group.reviewGroupId))}>
          Reset
        </button>
        {availableMergeTargets.length > 0 ? (
          <select
            aria-label={`Merge ${group.songFolderName}`}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                onChange(mergeGroups(reviewSession, group.reviewGroupId, event.target.value));
                event.target.value = '';
              }
            }}
          >
            <option value="">Merge into...</option>
            {availableMergeTargets.map((targetGroup) => (
              <option key={targetGroup.reviewGroupId} value={targetGroup.reviewGroupId}>
                {targetGroup.songFolderName}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="edit-grid">
        <label className="field">
          <span>Artist folder</span>
          <input
            value={group.artistName}
            onChange={(event) => onChange(renameArtist(reviewSession, group.reviewGroupId, event.target.value))}
          />
        </label>
        <label className="field">
          <span>Song folder</span>
          <input
            value={group.songFolderName}
            onChange={(event) => onChange(renameGroup(reviewSession, group.reviewGroupId, event.target.value))}
          />
        </label>
      </div>

      {group.artistName !== group.originalGroup.artist || group.songFolderName !== group.originalGroup.canonicalSongTitle ? (
        <p className="original-note">
          Resolver: {group.originalGroup.artist} / {group.originalGroup.canonicalSongTitle}
        </p>
      ) : null}

      <ReviewMetadata group={group} />

      <ul className="candidate-list">
        {group.files.map((file) => (
          <li className={file.included ? undefined : 'excluded-file'} key={file.fileId}>
            <label className="file-toggle">
              <input
                checked={file.included}
                onChange={() => onChange(toggleFileIncluded(reviewSession, file.fileId))}
                type="checkbox"
              />
              <span>{file.included ? 'Included' : 'Excluded'}</span>
            </label>
            <label className="field file-name-field">
              <span>Target file name</span>
              <input
                value={file.targetFilename}
                onChange={(event) => onChange(renameFile(reviewSession, file.fileId, event.target.value))}
              />
            </label>
            {file.targetFilename !== file.originalFilename ? <small>Original: {file.originalFilename}</small> : null}
            <CandidateBadges file={file.originalFile} />
            {group.files.length > 1 ? (
              <button
                type="button"
                className="secondary compact-button"
                onClick={() => onChange(splitGroup(reviewSession, group.reviewGroupId, [file.fileId]))}
              >
                Split to new group
              </button>
            ) : null}
            {file.overrideWarnings.length > 0 ? (
              <ul className="warning-list warning-list--file">
                {file.overrideWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {file.warnings.length > 0 ? (
              <ul className="warning-list warning-list--file">
                {file.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {group.overrideWarnings.length > 0 ? (
        <ul className="warning-list warning-list--group">
          {group.overrideWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {group.warnings.length > 0 ? (
        <ul className="warning-list warning-list--group">
          {group.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RawGroupDetail({ group }: { group: StemGroup }): JSX.Element {
  const firstUpload = group.uploads[0];

  return (
    <section className="upload-detail" aria-label="Selected upload details">
      <div className="group-heading">
        <div>
          <h2>{group.canonicalSongTitle}</h2>
          <span>by {group.artist}</span>
        </div>
        <span className="source-badge">{group.metadataSource}</span>
      </div>
      <dl className="details compact">
        <div>
          <dt>Confidence</dt>
          <dd>{group.confidence}</dd>
        </div>
        <div>
          <dt>BPM</dt>
          <dd>{group.bpm ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{firstUpload?.licenseSummary ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>Tags</dt>
          <dd>{firstUpload && firstUpload.tags.length > 0 ? firstUpload.tags.join(', ') : 'not specified'}</dd>
        </div>
      </dl>
      {group.uploads.some((upload) => upload.title !== group.canonicalSongTitle) ? (
        <div className="title-map">
          <span className="field-label">Original upload titles</span>
          <ul>
            {group.uploads.map((upload) => (
              <li key={upload.uploadId}>
                <span>{upload.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {group.groupingReasons.length > 0 ? (
        <div className="reason-block">
          <span className="field-label">Grouping reasons</span>
          <ul className="reason-list">
            {group.groupingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="candidate-list">
        {group.files.map((file) => (
          <li key={`${file.originalFilename}-${file.downloadUrl ?? file.metadataSource}`}>
            <span>{file.originalFilename}</span>
            <CandidateBadges file={file} />
          </li>
        ))}
      </ul>
      {group.unverifiedFields.length > 0 ? <p className="unverified">Unverified: {group.unverifiedFields.join(', ')}</p> : null}
      {group.ambiguousUploads.length > 0 ? (
        <div className="reason-block">
          <span className="field-label">Ambiguous uploads</span>
          <ul className="reason-list">
            {group.ambiguousUploads.map((upload) => (
              <li key={upload.uploadId}>
                {upload.title} ({upload.uploadId})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {group.warnings.length > 0 ? (
        <ul className="warning-list warning-list--group">
          {group.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReviewMetadata({ group }: { group: ReviewGroup }): JSX.Element {
  const firstUpload = group.originalGroup.uploads[0];

  return (
    <>
      <dl className="details compact">
        <div>
          <dt>Confidence</dt>
          <dd>{group.originalGroup.confidence}</dd>
        </div>
        <div>
          <dt>BPM</dt>
          <dd>{group.originalGroup.bpm ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{firstUpload?.licenseSummary ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{group.originalGroup.metadataSource}</dd>
        </div>
      </dl>
      {group.originalGroup.groupingReasons.length > 0 ? (
        <div className="reason-block">
          <span className="field-label">Grouping reasons</span>
          <ul className="reason-list">
            {group.originalGroup.groupingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {group.originalGroup.ambiguousUploads.length > 0 ? (
        <div className="reason-block">
          <span className="field-label">Ambiguous uploads</span>
          <ul className="reason-list">
            {group.originalGroup.ambiguousUploads.map((upload) => (
              <li key={upload.uploadId}>
                {upload.title} ({upload.uploadId})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function CandidateBadges({ file }: { file: ReviewFile['originalFile'] }): JSX.Element {
  const classification = getDownloadCandidateClassification(file);
  const label = `${classification.role} / ${classification.format} / ${classification.quality}`;
  const title = classification.reasons.join(' ');

  return (
    <div className="candidate-badges" title={title}>
      <span className="candidate-badge">{label}</span>
      <span className="candidate-badge confidence-badge">{classification.confidence}</span>
      <span className="candidate-badge source-badge">{file.metadataSource}</span>
    </div>
  );
}
