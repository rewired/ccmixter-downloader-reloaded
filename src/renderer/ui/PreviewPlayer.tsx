import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

import type { TrackFile } from '../../shared/domain';

interface PreviewPlayerProps {
  file: TrackFile;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}

export function PreviewPlayer({ file, isActive, onActivate, onDeactivate }: PreviewPlayerProps): JSX.Element | null {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const onDeactivateRef = useRef(onDeactivate);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformFailed, setWaveformFailed] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const sourceUrl = file.downloadUrl;
  const label = file.displayLabel ?? file.originalFilename;

  useEffect(() => {
    onDeactivateRef.current = onDeactivate;
  }, [onDeactivate]);

  useEffect(() => {
    if (!sourceUrl || !waveformRef.current) {
      return undefined;
    }

    setIsPlaying(false);
    setWaveformFailed(false);
    setPlaybackError(null);

    const fallbackAudio = new Audio(sourceUrl);
    fallbackAudio.preload = 'none';
    fallbackAudioRef.current = fallbackAudio;

    const colors = resolveWaveformColors(waveformRef.current);
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: sourceUrl,
      height: 32,
      waveColor: colors.wave,
      progressColor: colors.progress,
      cursorColor: colors.cursor,
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 1,
      hideScrollbar: true,
      normalize: true
    });
    wavesurferRef.current = wavesurfer;

    wavesurfer.on('play', () => setIsPlaying(true));
    wavesurfer.on('pause', () => setIsPlaying(false));
    wavesurfer.on('finish', () => {
      setIsPlaying(false);
      onDeactivateRef.current();
    });
    // WaveSurfer may fail to fetch/decode cross-origin MP3s even when a media element can play them.
    // Keep playback available through the fallback audio element and hide the waveform failure quietly.
    wavesurfer.on('error', () => setWaveformFailed(true));

    const handleFallbackPlay = (): void => setIsPlaying(true);
    const handleFallbackPause = (): void => setIsPlaying(false);
    const handleFallbackEnded = (): void => {
      setIsPlaying(false);
      onDeactivateRef.current();
    };
    const handleFallbackError = (): void => {
      setIsPlaying(false);
      setPlaybackError('Preview could not be played.');
    };

    fallbackAudio.addEventListener('play', handleFallbackPlay);
    fallbackAudio.addEventListener('pause', handleFallbackPause);
    fallbackAudio.addEventListener('ended', handleFallbackEnded);
    fallbackAudio.addEventListener('error', handleFallbackError);

    return () => {
      fallbackAudio.pause();
      fallbackAudio.removeAttribute('src');
      fallbackAudio.load();
      fallbackAudio.removeEventListener('play', handleFallbackPlay);
      fallbackAudio.removeEventListener('pause', handleFallbackPause);
      fallbackAudio.removeEventListener('ended', handleFallbackEnded);
      fallbackAudio.removeEventListener('error', handleFallbackError);
      fallbackAudioRef.current = null;
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (isActive) {
      void playPreview();
    } else {
      pausePreview();
    }
  }, [isActive]);

  if (!isPlayablePreviewFile(file) || !sourceUrl) {
    return null;
  }

  async function playPreview(): Promise<void> {
    setPlaybackError(null);
    pauseOtherPlayer(waveformFailed ? 'fallback' : 'wavesurfer');

    if (!waveformFailed && wavesurferRef.current) {
      try {
        await wavesurferRef.current.play();
        return;
      } catch {
        setWaveformFailed(true);
      }
    }

    try {
      await fallbackAudioRef.current?.play();
    } catch {
      setIsPlaying(false);
      setPlaybackError('Preview could not be played.');
    }
  }

  function pausePreview(): void {
    wavesurferRef.current?.pause();
    fallbackAudioRef.current?.pause();
    setIsPlaying(false);
  }

  function pauseOtherPlayer(activePlayer: 'wavesurfer' | 'fallback'): void {
    if (activePlayer === 'wavesurfer') {
      fallbackAudioRef.current?.pause();
    } else {
      wavesurferRef.current?.pause();
    }
  }

  function togglePlayback(): void {
    if (isActive && isPlaying) {
      pausePreview();
      onDeactivate();
      return;
    }

    onActivate();
    void playPreview();
  }

  return (
    <div className="preview-player">
      <button
        type="button"
        className="preview-player__button"
        aria-label={isPlaying ? `Pause preview ${label}` : `Play preview ${label}`}
        title={isPlaying ? 'Pause preview' : 'Play preview'}
        onClick={togglePlayback}
      >
        {isPlaying ? '||' : '>'}
      </button>
      <div
        ref={waveformRef}
        className={`preview-player__waveform${waveformFailed ? ' preview-player__waveform--unavailable' : ''}`}
        aria-hidden="true"
      />
      {playbackError ? <small className="preview-player__error">{playbackError}</small> : null}
    </div>
  );
}

export function isPlayablePreviewFile(file: TrackFile): boolean {
  const role = file.classification?.role ?? file.fileKind;

  return Boolean(file.downloadUrl) && file.extension.toLowerCase() === 'mp3' && role === 'preview';
}

function resolveWaveformColors(element: HTMLElement): { wave: string; progress: string; cursor: string } {
  const styles = getComputedStyle(element);

  return {
    wave: styles.getPropertyValue('--color-border-strong').trim() || '#3a3a3a',
    progress: styles.getPropertyValue('--color-accent').trim() || '#0099ff',
    cursor: styles.getPropertyValue('--color-muted').trim() || '#999999'
  };
}
