type VoiceMode = 'auto' | 'treble' | 'bass';

interface SettingsProps {
  holdSeconds: number;
  centsTolerance: number;
  voiceMode: VoiceMode;
  resolvedVoiceMode: Exclude<VoiceMode, 'auto'>;
  onHoldSecondsChange: (value: number) => void;
  onCentsToleranceChange: (value: number) => void;
  onVoiceModeChange: (mode: VoiceMode) => void;
}

export function Settings({
  holdSeconds,
  centsTolerance,
  voiceMode,
  resolvedVoiceMode,
  onHoldSecondsChange,
  onCentsToleranceChange,
  onVoiceModeChange
}: SettingsProps) {
  return (
    <section className="settings-panel">
      <h3>Settings</h3>
      <label>
        Voice range
        <select value={voiceMode} onChange={(event) => onVoiceModeChange(event.target.value as VoiceMode)}>
          <option value="auto">Auto ({resolvedVoiceMode})</option>
          <option value="treble">Treble (A3-G5)</option>
          <option value="bass">Bass (A2-G4)</option>
        </select>
      </label>
      <label>
        Hold seconds
        <input
          type="number"
          min={1}
          max={12}
          step={0.5}
          value={holdSeconds}
          onChange={(event) => onHoldSecondsChange(Number(event.target.value))}
        />
      </label>
      <label>
        Cents tolerance (+/-)
        <input
          type="number"
          min={10}
          max={80}
          step={1}
          value={centsTolerance}
          onChange={(event) => onCentsToleranceChange(Number(event.target.value))}
        />
      </label>
    </section>
  );
}
