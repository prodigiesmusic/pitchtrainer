import { useMemo } from 'react';
import type { NoteDefinition } from '../data/notes';
import { normalizeAssetPath } from '../data/notes';

interface TargetPanelProps {
  note: NoteDefinition;
  mode: 'random' | 'sequential';
  onModeChange: (mode: 'random' | 'sequential') => void;
  onNextNote: () => void;
  onReplay: () => void;
  bellIsActive: boolean;
  bellLoadError: boolean;
  onBellLoadError: () => void;
}

export function TargetPanel({
  note,
  mode,
  onModeChange,
  onNextNote,
  onReplay,
  bellIsActive,
  bellLoadError,
  onBellLoadError
}: TargetPanelProps) {
  const bellClassName = useMemo(() => `bell-image ${bellIsActive ? 'pulse' : ''}`, [bellIsActive]);
  const bellSrc = bellIsActive && note.bellActivePng ? note.bellActivePng : note.bellPng;

  return (
    <section className="target-panel" style={{ borderColor: note.hex }}>
      <div className="target-header">
        <h2>Target Note: {note.label}</h2>
        <div className="mode-toggle">
          <button className={mode === 'sequential' ? 'active' : ''} onClick={() => onModeChange('sequential')}>
            Sequential
          </button>
          <button className={mode === 'random' ? 'active' : ''} onClick={() => onModeChange('random')}>
            Random
          </button>
        </div>
      </div>

      <button className="bell-button" onClick={onReplay} aria-label="Replay target note">
        {bellLoadError ? (
          <div className="bell-placeholder">Bell image missing</div>
        ) : (
          <img
            className={bellClassName}
            src={normalizeAssetPath(bellSrc)}
            alt={`${note.label} desk bell`}
            onError={onBellLoadError}
          />
        )}
      </button>

      <div className="target-actions">
        <button onClick={onReplay}>Play Note</button>
        <button onClick={onNextNote}>Next Note</button>
      </div>
    </section>
  );
}
