import type { AppError, CcmixterInput, DryRunPlan, ResolvedCcmixterMetadata, StemLibraryRoot } from '../domain';

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  chooseStemLibraryRoot: 'stem-library:choose-root',
  getStemLibraryRoot: 'stem-library:get-root',
  setStemLibraryRoot: 'stem-library:set-root',
  parseInput: 'ccmixter:parse-input',
  resolveMetadata: 'ccmixter:resolve-metadata',
  createDryRunPlan: 'ccmixter:create-dry-run-plan'
} as const;

export interface AppInfo {
  name: string;
  version: string;
}

export interface ChooseStemLibraryRootResult {
  cancelled: boolean;
  root: StemLibraryRoot | null;
}

export type IpcResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: AppError;
    };

export interface CcmixterDownloaderApi {
  getAppInfo(): Promise<AppInfo>;
  chooseStemLibraryRoot(): Promise<ChooseStemLibraryRootResult>;
  getStemLibraryRoot(): Promise<StemLibraryRoot | null>;
  setStemLibraryRoot(path: string): Promise<IpcResult<StemLibraryRoot>>;
  parseInput(rawInput: string): Promise<CcmixterInput>;
  resolveMetadata(rawInput: string): Promise<IpcResult<ResolvedCcmixterMetadata>>;
  createDryRunPlan(rawInput: string, rootFolder: StemLibraryRoot | null): Promise<IpcResult<DryRunPlan>>;
}
