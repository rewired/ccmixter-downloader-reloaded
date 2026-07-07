import { promises as fs } from 'fs';
import { WaveFile } from 'wavefile';

export interface WavProbe {
  numChannels: number;
  sampleRate: number;
  bitDepth: string;
}

/**
 * Parses only enough of a WAV file to decide whether it is a stereo-splitting
 * candidate. Throws when the file cannot be read as a valid WAV container.
 */
export async function probeWavFormat(filePath: string): Promise<WavProbe> {
  const buffer = await fs.readFile(filePath);
  const wav = new WaveFile(buffer);
  const fmt = wav.fmt as { numChannels?: number; sampleRate?: number };

  if (typeof fmt.numChannels !== 'number' || typeof fmt.sampleRate !== 'number' || !wav.bitDepth) {
    throw new Error('WAV file is missing required format fields (channels, sample rate, or bit depth).');
  }

  return { numChannels: fmt.numChannels, sampleRate: fmt.sampleRate, bitDepth: wav.bitDepth };
}
