import { useEffect, useRef } from 'react';

interface MicPanelProps {
  micRunning: boolean;
  lineOffsetCents: number;
  micLevel: number;
  displayRangeCents: number;
  targetHex: string;
  inTune: boolean;
  hasPitch: boolean;
  guidance: 'higher' | 'lower' | null;
  statusText: string;
  progress: number;
  holdSeconds: number;
  elapsedSeconds: number;
  success: boolean;
  onToggleMic: () => void;
}

export function MicPanel({
  micRunning,
  lineOffsetCents,
  micLevel,
  displayRangeCents,
  targetHex,
  inTune,
  hasPitch,
  guidance,
  statusText,
  progress,
  holdSeconds,
  elapsedSeconds,
  success,
  onToggleMic
}: MicPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Array<{ x: number; y: number; amp: number }>>([]);
  const lastTimeRef = useRef<number | null>(null);
  const smoothCentsRef = useRef(0);
  const smoothLevelRef = useRef(0);
  const hasPitchRef = useRef(hasPitch);
  const lineOffsetRef = useRef(lineOffsetCents);
  const micLevelRef = useRef(micLevel);
  const micRunningRef = useRef(micRunning);
  const targetHexRef = useRef(targetHex);
  const displayRangeRef = useRef(displayRangeCents);

  useEffect(() => {
    hasPitchRef.current = hasPitch;
    lineOffsetRef.current = lineOffsetCents;
    micLevelRef.current = micLevel;
    micRunningRef.current = micRunning;
    targetHexRef.current = targetHex;
    displayRangeRef.current = displayRangeCents;
  }, [displayRangeCents, hasPitch, lineOffsetCents, micLevel, micRunning, targetHex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mapCentsToY = (cents: number, height: number) => {
      const range = displayRangeRef.current;
      const clamped = Math.max(-range, Math.min(range, cents));
      const normalized = (range - clamped) / (2 * range);
      return normalized * height;
    };

    const draw = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        requestAnimationFrame(draw);
        return;
      }

      const dt = lastTimeRef.current === null ? 16 : Math.max(1, time - lastTimeRef.current);
      lastTimeRef.current = time;

      const pitchTauMs = 150;
      const alpha = 1 - Math.exp(-dt / pitchTauMs);
      if (hasPitchRef.current) {
        const targetCents = lineOffsetRef.current;
        smoothCentsRef.current += (targetCents - smoothCentsRef.current) * alpha;
      }

      const levelTauMs = 140;
      const levelAlpha = 1 - Math.exp(-dt / levelTauMs);
      const noiseFloor = 0.008;
      const strongLevel = 0.08;
      const normalizedLevel = Math.max(
        0,
        Math.min(1, (micLevelRef.current - noiseFloor) / (strongLevel - noiseFloor))
      );
      const targetAmp = Math.sqrt(normalizedLevel);
      smoothLevelRef.current += (targetAmp - smoothLevelRef.current) * levelAlpha;

      const speedPxPerSec = 150;
      const dx = (speedPxPerSec * dt) / 1000;
      pointsRef.current = pointsRef.current
        .map((point) => ({ ...point, x: point.x - dx }))
        .filter((point) => point.x >= -16);

      const y = mapCentsToY(smoothCentsRef.current, height);
      if (micRunningRef.current) {
        pointsRef.current.push({ x: width, y, amp: smoothLevelRef.current });
      }

      ctx.clearRect(0, 0, width, height);

      // Center reference line = perfect in tune.
      ctx.strokeStyle = '#8ea0c2';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const points = pointsRef.current;
      if (points.length > 1) {
        for (let i = 1; i < points.length; i += 1) {
          const prev = points[i - 1];
          const current = points[i];
          const life = Math.max(0, Math.min(1, current.x / width));
          const localAmp = Math.max(0.08, current.amp);
          const fade = 0.35 + 0.65 * life;

          // Outer glow band.
          ctx.strokeStyle = `${targetHexRef.current}${Math.round(0.14 * life * 255)
            .toString(16)
            .padStart(2, '0')}`;
          ctx.lineWidth = (7 + 24 * localAmp) * fade;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(current.x, current.y);
          ctx.stroke();

          // Main colored snake body.
          ctx.strokeStyle = `${targetHexRef.current}${Math.round(0.75 * life * 255)
            .toString(16)
            .padStart(2, '0')}`;
          ctx.lineWidth = (2 + 12 * localAmp) * fade;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(current.x, current.y);
          ctx.stroke();

          // Melodyne-style center spine line.
          ctx.strokeStyle = `rgba(70, 34, 52, ${Math.max(0.18, 0.8 * life)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(current.x, current.y);
          ctx.stroke();
        }

        const head = points[points.length - 1];
        ctx.fillStyle = targetHexRef.current;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 3.5 + 6 * Math.max(0.08, head.amp), 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(draw);
    };

    const rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      lastTimeRef.current = null;
    };
  }, []);

  return (
    <section className="mic-panel" style={{ backgroundColor: inTune ? `${targetHex}33` : '#f6f8fb' }}>
      <div className="mic-header">
        <h2>Live Microphone</h2>
        <button onClick={onToggleMic}>{micRunning ? 'Stop Mic' : 'Start Mic'}</button>
      </div>

      <div className="pitch-lane">
        <canvas ref={canvasRef} className="pitch-canvas" />
        {guidance && <div className="range-guidance">Sing {guidance} to enter range (±6 semitones)</div>}
      </div>

      <div className="status-row">
        <p>{statusText}</p>
        <p>
          Hold: {elapsedSeconds.toFixed(1)}s / {holdSeconds.toFixed(1)}s
        </p>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: targetHex }} />
      </div>

      {success && (
        <div className="success-banner">
          <span className="checkmark">✓</span>
          <span>Success!</span>
          <div className="confetti" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
