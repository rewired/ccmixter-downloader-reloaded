import { WaveFile } from 'wavefile';

function toneSamples(count: number, amplitude: number): number[] {
  return Array.from({ length: count }, (_, index) => (index % 2 === 0 ? amplitude : -amplitude));
}

export function createStereoWavBuffer(samplesPerChannel = 400, sampleRate = 8000): Buffer {
  const interleaved = toneSamples(samplesPerChannel * 2, 1000);
  const wav = new WaveFile();
  wav.fromScratch(2, sampleRate, '16', interleaved);
  return Buffer.from(wav.toBuffer());
}

export function createMonoWavBuffer(samplesPerChannel = 20, sampleRate = 8000, amplitude = 500): Buffer {
  const samples = toneSamples(samplesPerChannel, amplitude);
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, '16', samples);
  return Buffer.from(wav.toBuffer());
}
