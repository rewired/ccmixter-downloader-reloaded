import { useMemo } from 'react';

import {
  getDownloadCandidateClassification,
  renameArtist,
  renameFile,
  renameGroup,
  toggleFileIncluded,
  type ArtistCatalogUploadCheck,
  type ReviewFile,
  type ReviewGroup,
  type ReviewSession,
  type StemGroup
} from '../../shared/domain';
import { t } from '../i18n';

export interface UploadRow {
  id: string;
  title: string;
  artist: string;
  bpm?: number;
  license?: string;
  fileCount: number;
  badges: string[];
}

export function toReviewRow(group: ReviewGroup): UploadRow {
  const firstUpload = group.originalGroup.uploads[0];

  return {
    id: group.reviewGroupId,
    title: group.songFolderName,
    artist: group.artistName,
    bpm: group.originalGroup.bpm,
    license: firstUpload?.licenseSummary,
    fileCount: group.files.filter((file) => file.included).length,
    badges: collectBadges(group.files.map((file) => file.originalFile))
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
    fileCount: group.files.length,
    badges: collectBadges(group.files)
  };
}

export type ListMode =
  | { kind: 'review'; reviewSession: ReviewSession; onChange: (session: ReviewSession) => void }
  | { kind: 'raw'; groups: StemGroup[] };

export function UploadListDetail({
  mode,
  selectedGroupId,
  onSelectGroup,
  noFilesFoundUploads,
  couldNotCheckFilesUploads
}: {
  mode: ListMode;
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
  noFilesFoundUploads: ArtistCatalogUploadCheck[];
  couldNotCheckFilesUploads: ArtistCatalogUploadCheck[];
}): JSX.Element {
  const rows = useMemo(
    () =>
      (mode.kind === 'review' ? mode.reviewSession.groups.map(toReviewRow) : mode.groups.map(toRawRow)).filter(
        (row) => row.fileCount > 0
      ),
    [mode]
  );

  const selectedReviewGroup =
    mode.kind === 'review' ? mode.reviewSession.groups.find((group) => group.reviewGroupId === selectedGroupId) ?? null : null;
  const selectedRawGroup = mode.kind === 'raw' ? mode.groups.find((group) => group.groupId === selectedGroupId) ?? null : null;

  return (
    <div className="upload-list-detail">
      <div className="song-list-column">
        {rows.length === 0 ? (
          <p className="empty">{t('review.empty')}</p>
        ) : (
          <ul className="upload-list" aria-label="Songs with downloadable files">
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
                    <span>{row.fileCount} file{row.fileCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="upload-list-row__meta">
                    <span>{row.artist}</span>
                    {typeof row.bpm === 'number' ? <span>{row.bpm} BPM</span> : null}
                    {row.license ? <span>{row.license}</span> : null}
                  </div>
                  {row.badges.length > 0 ? (
                    <div className="candidate-badges">
                      {row.badges.map((badge) => (
                        <span className="candidate-badge" key={badge}>
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}

        <UploadCheckSection
          title={t('review.noFiles.title')}
          body={t('review.noFiles.body')}
          uploads={noFilesFoundUploads}
        />
        <UploadCheckSection
          title={t('review.couldNotCheck.title')}
          body={t('review.couldNotCheck.body')}
          uploads={couldNotCheckFilesUploads}
        />
      </div>

      {mode.kind === 'review' ? (
        selectedReviewGroup ? (
          <ReviewGroupDetail reviewSession={mode.reviewSession} group={selectedReviewGroup} onChange={mode.onChange} />
        ) : (
          <p className="empty">{t('review.selectSong')}</p>
        )
      ) : selectedRawGroup ? (
        <RawGroupDetail group={selectedRawGroup} />
      ) : (
        <p className="empty">{t('review.selectSong')}</p>
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
  return (
    <section className="upload-detail" aria-label="Selected song files">
      <div className="group-heading">
        <div>
          <h2>{group.songFolderName}</h2>
          <span>by {group.artistName}</span>
        </div>
      </div>

      <div className="folder-preview">
        <span className="field-label">{t('review.folderPreview')}</span>
        <code>{group.artistName}/{group.songFolderName}</code>
      </div>

      <div className="edit-grid secondary-edit-grid">
        <label className="field">
          <span>{t('review.artistFolder')}</span>
          <input
            value={group.artistName}
            onChange={(event) => onChange(renameArtist(reviewSession, group.reviewGroupId, event.target.value))}
          />
        </label>
        <label className="field">
          <span>{t('review.songFolder')}</span>
          <input
            value={group.songFolderName}
            onChange={(event) => onChange(renameGroup(reviewSession, group.reviewGroupId, event.target.value))}
          />
        </label>
      </div>

      <div>
        <span className="field-label">{t('review.files')}</span>
        <ul className="candidate-list">
          {group.files.map((file) => (
            <li className={file.included ? undefined : 'excluded-file'} key={file.fileId}>
              <label className="file-toggle">
                <input
                  checked={file.included}
                  onChange={() => onChange(toggleFileIncluded(reviewSession, file.fileId))}
                  type="checkbox"
                />
                <span>{file.targetFilename}</span>
              </label>
              {file.targetFilename !== file.originalFilename ? <small>{t('review.originalFileName')}: {file.originalFilename}</small> : null}
              <label className="field file-name-field">
                <span>{t('review.targetFileName')}</span>
                <input
                  value={file.targetFilename}
                  onChange={(event) => onChange(renameFile(reviewSession, file.fileId, event.target.value))}
                />
              </label>
              <CandidateBadges file={file.originalFile} />
              {file.overrideWarnings.length > 0 ? <p className="user-note">This file name will be adjusted for your file system.</p> : null}
            </li>
          ))}
        </ul>
      </div>

      {group.warnings.length > 0 || group.overrideWarnings.length > 0 ? (
        <p className="user-note">Some metadata could not be verified.</p>
      ) : null}
    </section>
  );
}

function RawGroupDetail({ group }: { group: StemGroup }): JSX.Element {
  const firstUpload = group.uploads[0];

  return (
    <section className="upload-detail" aria-label="Selected song files">
      <div className="group-heading">
        <div>
          <h2>{group.canonicalSongTitle}</h2>
          <span>by {group.artist}</span>
        </div>
      </div>
      <dl className="details compact">
        <div>
          <dt>BPM</dt>
          <dd>{group.bpm ?? 'not specified'}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{firstUpload?.licenseSummary ?? 'not specified'}</dd>
        </div>
      </dl>
      <ul className="candidate-list">
        {group.files.map((file) => (
          <li key={`${file.originalFilename}-${file.downloadUrl ?? file.metadataSource}`}>
            <span>{file.originalFilename}</span>
            <CandidateBadges file={file} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CandidateBadges({ file }: { file: ReviewFile['originalFile'] }): JSX.Element {
  return (
    <div className="candidate-badges">
      {fileBadges(file).map((badge) => (
        <span className="candidate-badge" key={badge}>
          {badge}
        </span>
      ))}
    </div>
  );
}

function UploadCheckSection({
  title,
  body,
  uploads
}: {
  title: string;
  body: string;
  uploads: ArtistCatalogUploadCheck[];
}): JSX.Element | null {
  if (uploads.length === 0) {
    return null;
  }

  return (
    <details className="upload-check-section">
      <summary>
        {title} - {uploads.length} upload{uploads.length === 1 ? '' : 's'}
      </summary>
      <p>{body}</p>
      <ul>
        {uploads.map((item) => (
          <li key={item.upload.uploadId}>
            <span>{item.upload.title}</span>
            <small>{item.upload.artistName}</small>
          </li>
        ))}
      </ul>
    </details>
  );
}

function collectBadges(files: ReviewFile['originalFile'][]): string[] {
  return [...new Set(files.flatMap(fileBadges))];
}

function fileBadges(file: ReviewFile['originalFile']): string[] {
  const classification = getDownloadCandidateClassification(file);
  const badges = new Set<string>();

  if (classification.format !== 'other') {
    badges.add(classification.format.toUpperCase());
  }

  if (classification.role === 'preview') {
    badges.add('Preview');
  } else if (classification.role === 'archive') {
    badges.add('Archive');
  } else if (classification.role === 'stem') {
    badges.add('Stem');
  } else if (classification.role === 'source') {
    badges.add('Source');
  }

  return [...badges];
}
