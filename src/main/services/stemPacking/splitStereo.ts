import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { WaveFile } from 'wavefile';

import type { StemPackInputFile } from '../../../shared/domain/stemPacking';
import type { WavProbe } from './audioProbe';

export interface SplitStereoWavResult {
  files: StemPackInputFile[];
  tempPaths: string[];
}

/**
 * Splits a stereo WAV file into temporary mono L/R WAV files. The original
 * file is never modified. Callers are responsible for removing tempPaths.
 */
export async function splitStereoWavToTemp(filePath: string, probe: WavProbe): Promise<SplitStereoWavResult> {
  const buffer = await fs.readFile(filePath);
  const wav = new WaveFile(buffer);
  const samples = wav.getSamples(false) as unknown;

  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error('Could not read de-interleaved stereo channel data from WAV file.');
  }

  const [leftSamples, rightSamples] = samples as [ArrayLike<number>, ArrayLike<number>];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccmixter-stem-split-'));
  const { name } = path.parse(filePath);
  const leftPath = path.join(tempDir, `${name}-L.wav`);
  const rightPath = path.join(tempDir, `${name}-R.wav`);

  try {
    const leftWav = new WaveFile();
    leftWav.fromScratch(1, probe.sampleRate, probe.bitDepth, leftSamples);
    const rightWav = new WaveFile();
    rightWav.fromScratch(1, probe.sampleRate, probe.bitDepth, rightSamples);

    await fs.writeFile(leftPath, Buffer.from(leftWav.toBuffer()));
    await fs.writeFile(rightPath, Buffer.from(rightWav.toBuffer()));

    const [leftStats, rightStats] = await Promise.all([fs.stat(leftPath), fs.stat(rightPath)]);

    return {
      files: [
        { path: leftPath, sizeBytes: leftStats.size, extension: '.wav', kind: 'wav' },
        { path: rightPath, sizeBytes: rightStats.size, extension: '.wav', kind: 'wav' }
      ],
      tempPaths: [leftPath, rightPath, tempDir]
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
