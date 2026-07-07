import type { StemPackWarning } from '../../../shared/domain/stemPacking';

export interface ExtraZipEntry {
  name: string;
  content: string | Buffer;
}

export class StemPackError extends Error {
  readonly code: string;
  readonly details: StemPackWarning[];

  constructor(code: string, message: string, details: StemPackWarning[] = []) {
    super(message);
    this.name = 'StemPackError';
    this.code = code;
    this.details = details;
  }
}
