import { analyzePitch, centsFromNearestTarget, median } from './pitchMath';
import { computeRms, detectPitchAutocorrelation } from './autocorrelation';

export type MicStatus = 'idle' | 'listening' | 'too_quiet' | 'no_pitch' | 'low_confidence';

export interface RawPitchFrame {
  timestampMs: number;
  status: MicStatus;
  frequencyHz: number | null;
  clarity: number;
  rms: number;
}

export interface SmoothedPitchFrame {
  timestampMs: number;
  status: MicStatus;
  frequencyHz: number | null;
  clarity: number;
  rms: number;
  midi: number | null;
  pitchClass: number | null;
  centsFromTarget: number | null;
}

export interface TrackerSettings {
  rmsThreshold: number;
  clarityThreshold: number;
  smoothingWindowMs: number;
}

const DEFAULT_SETTINGS: TrackerSettings = {
  rmsThreshold: 0.01,
  clarityThreshold: 0.5,
  smoothingWindowMs: 200
};

export class MicrophonePitchTracker {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private monitorGainNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private latest: RawPitchFrame = {
    timestampMs: 0,
    status: 'idle',
    frequencyHz: null,
    clarity: 0,
    rms: 0
  };
  private history: RawPitchFrame[] = [];
  private settings: TrackerSettings;

  constructor(settings?: Partial<TrackerSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  updateSettings(next: Partial<TrackerSettings>) {
    this.settings = { ...this.settings, ...next };
  }

  async start() {
    if (this.audioContext) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

    // ScriptProcessor fallback for prototype compatibility.
    this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.monitorGainNode = this.audioContext.createGain();
    this.monitorGainNode.gain.value = 0;

    this.processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const input = event.inputBuffer.getChannelData(0);
      const buffer = new Float32Array(input.length);
      buffer.set(input);

      const timestampMs = performance.now();
      const rms = computeRms(buffer);

      if (rms < this.settings.rmsThreshold) {
        this.latest = {
          timestampMs,
          status: 'too_quiet',
          frequencyHz: null,
          clarity: 0,
          rms
        };
        this.pushFrame(this.latest);
        return;
      }

      const result = detectPitchAutocorrelation(buffer, this.audioContext?.sampleRate ?? 44100);
      if (!result.frequencyHz) {
        this.latest = {
          timestampMs,
          status: 'no_pitch',
          frequencyHz: null,
          clarity: result.clarity,
          rms
        };
        this.pushFrame(this.latest);
        return;
      }

      if (result.clarity < this.settings.clarityThreshold) {
        this.latest = {
          timestampMs,
          status: 'low_confidence',
          frequencyHz: null,
          clarity: result.clarity,
          rms
        };
        this.pushFrame(this.latest);
        return;
      }

      this.latest = {
        timestampMs,
        status: 'listening',
        frequencyHz: result.frequencyHz,
        clarity: result.clarity,
        rms
      };
      this.pushFrame(this.latest);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.monitorGainNode);
    this.monitorGainNode.connect(this.audioContext.destination);
  }

  stop() {
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
    }

    this.sourceNode?.disconnect();
    this.processorNode?.disconnect();
    this.monitorGainNode?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.audioContext?.close();

    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.monitorGainNode = null;
    this.stream = null;
    this.history = [];
    this.latest = {
      timestampMs: performance.now(),
      status: 'idle',
      frequencyHz: null,
      clarity: 0,
      rms: 0
    };
  }

  getSmoothedFrame(targetPitchClass: number): SmoothedPitchFrame {
    const now = performance.now();
    const windowStart = now - this.settings.smoothingWindowMs;
    const recent = this.history.filter((frame) => frame.timestampMs >= windowStart);

    if (!recent.length) {
      return {
        timestampMs: now,
        status: this.latest.status,
        frequencyHz: null,
        clarity: 0,
        rms: 0,
        midi: null,
        pitchClass: null,
        centsFromTarget: null
      };
    }

    const valid = recent.filter((frame) => frame.frequencyHz !== null);
    if (!valid.length) {
      return {
        timestampMs: now,
        status: recent[recent.length - 1].status,
        frequencyHz: null,
        clarity: recent[recent.length - 1].clarity,
        rms: recent[recent.length - 1].rms,
        midi: null,
        pitchClass: null,
        centsFromTarget: null
      };
    }

    const frequencies = valid.map((f) => f.frequencyHz as number);
    const clarity = valid.reduce((sum, frame) => sum + frame.clarity, 0) / valid.length;
    const rms = valid.reduce((sum, frame) => sum + frame.rms, 0) / valid.length;

    const smoothedFrequency = median(frequencies);
    const pitch = analyzePitch(smoothedFrequency);

    return {
      timestampMs: now,
      status: 'listening',
      frequencyHz: smoothedFrequency,
      clarity,
      rms,
      midi: pitch.midi,
      pitchClass: pitch.pitchClass,
      centsFromTarget: centsFromNearestTarget(pitch.midi, targetPitchClass)
    };
  }

  private pushFrame(frame: RawPitchFrame) {
    this.history.push(frame);
    const keepAfter = frame.timestampMs - Math.max(1200, this.settings.smoothingWindowMs * 3);
    this.history = this.history.filter((f) => f.timestampMs >= keepAfter);
  }
}
