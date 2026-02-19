import { Mp3Encoder } from "@breezystack/lamejs";
import type { CompositionState, InstrumentName, MusicNote, MusicTrack, SynthParams } from "../types";

const MIDI_NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
];

export function pitchToMidi(pitch: string): number {
  const match = pitch.trim().match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) {
    return 60;
  }

  const noteName = match[1].toUpperCase().replace("B", "b");
  const octave = parseInt(match[2], 10);

  let noteIndex = MIDI_NOTE_NAMES.indexOf(noteName);
  if (noteIndex === -1) {
    const flatMap: Record<string, string> = {
      "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B"
    };
    const enharmonic = flatMap[noteName];
    noteIndex = enharmonic ? MIDI_NOTE_NAMES.indexOf(enharmonic) : 0;
  }

  return (octave + 1) * 12 + noteIndex;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchToFrequency(pitch: string): number {
  return midiToFrequency(pitchToMidi(pitch));
}

export function midiToPitchName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${MIDI_NOTE_NAMES[noteIndex]}${octave}`;
}

function createReverb(ctx: AudioContext | OfflineAudioContext, decayTime = 1.8): { input: GainNode; output: GainNode } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  output.gain.value = 1;

  const dry = ctx.createGain();
  dry.gain.value = 1;
  input.connect(dry);
  dry.connect(output);

  const wet = ctx.createGain();
  wet.gain.value = 0.45;

  const preDelay = ctx.createDelay(0.1);
  preDelay.delayTime.value = 0.02;

  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437];
  const combFeedback = Math.min(0.92, 0.7 + decayTime * 0.08);
  const merge = ctx.createGain();
  merge.gain.value = 0.25;

  combDelays.forEach((time) => {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = time;
    const fb = ctx.createGain();
    fb.gain.value = combFeedback;
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 3500;
    lpf.Q.value = 0.2;
    preDelay.connect(delay);
    delay.connect(lpf);
    lpf.connect(fb);
    fb.connect(delay);
    lpf.connect(merge);
  });

  const ap1 = ctx.createDelay(0.02);
  ap1.delayTime.value = 0.005;
  const ap1fb = ctx.createGain();
  ap1fb.gain.value = 0.5;
  merge.connect(ap1);
  ap1.connect(ap1fb);
  ap1fb.connect(merge);

  input.connect(preDelay);
  ap1.connect(wet);
  wet.connect(output);

  return { input, output };
}

interface ScheduledNote {
  frequency: number;
  startTime: number;
  duration: number;
  velocity: number;
  instrument: InstrumentName;
  synthParams?: SynthParams;
}

function synthesizeNote(
  ctx: AudioContext,
  master: GainNode,
  note: ScheduledNote
): void {
  const { frequency, startTime, duration, velocity, instrument, synthParams: sp } = note;
  const gain = velocity / 127;
  const endTime = startTime + duration;
  const wave = sp?.waveform;
  const fCut = sp?.filterCutoff;
  const fQ = sp?.filterQ;
  const atkOvr = sp?.attack;
  const relOvr = sp?.release;
  const detOvr = sp?.detune;

  switch (instrument) {
    case "piano": {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc1.type = wave ?? "triangle";
      osc1.frequency.value = frequency;
      osc2.type = "sine";
      osc2.frequency.value = frequency * 2.01;
      if (detOvr !== undefined) osc2.detune.value = detOvr;

      filter.type = "lowpass";
      filter.frequency.value = fCut !== undefined ? frequency * fCut : 3200;
      filter.Q.value = fQ ?? 0.8;

      const atk = atkOvr ?? 0.008;
      const rel = relOvr ?? 0.0;
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.9, startTime + atk);
      env.gain.exponentialRampToValueAtTime(gain * 0.4, startTime + Math.max(atk + 0.01, 0.12));
      env.gain.exponentialRampToValueAtTime(0.0001, Math.max(endTime + rel, startTime + 0.1));

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(env);
      env.connect(master);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(endTime + rel + 0.3);
      osc2.stop(endTime + rel + 0.3);
      break;
    }

    case "strings": {
      const baseDetune = detOvr ?? 8;
      const detuneVals = [-baseDetune, 0, baseDetune];
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      filter.type = "lowpass";
      filter.Q.value = fQ ?? 0.5;

      const attackTime = atkOvr ?? Math.min(0.3, duration * 0.35);
      const releaseTime = relOvr ?? Math.min(0.4, duration * 0.25);
      const sustainStart = Math.max(startTime + attackTime, endTime - releaseTime);
      const cutBase = fCut ?? 5;

      filter.frequency.setValueAtTime(frequency * (cutBase * 0.3), startTime);
      filter.frequency.linearRampToValueAtTime(frequency * cutBase, startTime + attackTime);
      filter.frequency.setValueAtTime(frequency * cutBase, sustainStart);
      filter.frequency.linearRampToValueAtTime(frequency * (cutBase * 0.4), endTime + releaseTime);

      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.5, startTime + attackTime);
      env.gain.setValueAtTime(gain * 0.5, sustainStart);
      env.gain.linearRampToValueAtTime(0, endTime + releaseTime);

      detuneVals.forEach((detune) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = wave ?? "sawtooth";
        o.frequency.value = frequency;
        o.detune.value = detune;
        og.gain.value = detune === 0 ? 0.5 : 0.3;
        o.connect(og);
        og.connect(filter);
        o.start(startTime);
        o.stop(endTime + releaseTime + 0.1);
      });

      filter.connect(env);
      env.connect(master);
      break;
    }

    case "bass": {
      const fundamental = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const harmonicGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      fundamental.type = wave ?? "sine";
      fundamental.frequency.value = frequency;
      harmonic.type = "triangle";
      harmonic.frequency.value = frequency * 2;
      harmonicGain.gain.value = 0.18;
      if (detOvr !== undefined) harmonic.detune.value = detOvr;

      filter.type = "lowpass";
      filter.frequency.value = fCut !== undefined ? Math.min(frequency * fCut, 1200) : Math.min(frequency * 6, 900);
      filter.Q.value = fQ ?? 0.5;

      const atk = atkOvr ?? 0.012;
      const rel = relOvr ?? Math.min(0.12, duration * 0.15);
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.9, startTime + atk);
      env.gain.exponentialRampToValueAtTime(gain * 0.72, startTime + Math.max(atk + 0.01, 0.06));
      env.gain.setValueAtTime(gain * 0.72, Math.max(startTime + atk + 0.02, endTime - rel));
      env.gain.linearRampToValueAtTime(0.0001, endTime + rel);

      fundamental.connect(filter);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(filter);
      filter.connect(env);
      env.connect(master);

      fundamental.start(startTime);
      harmonic.start(startTime);
      fundamental.stop(endTime + rel + 0.1);
      harmonic.stop(endTime + rel + 0.1);
      break;
    }

    case "pad": {
      const baseDetune = detOvr ?? 12;
      const detuneValues = [-baseDetune, -baseDetune * 0.4, 0, baseDetune * 0.4, baseDetune];
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      filter.type = "lowpass";
      filter.Q.value = fQ ?? 0.4;

      const attackTime = atkOvr ?? Math.min(0.55, duration * 0.4);
      const releaseTime = relOvr ?? Math.min(0.7, duration * 0.35);
      const sustainStart = Math.max(startTime + attackTime, endTime - releaseTime);
      const cutBase = fCut ?? 4.5;

      filter.frequency.setValueAtTime(frequency * (cutBase * 0.27), startTime);
      filter.frequency.linearRampToValueAtTime(frequency * cutBase, startTime + attackTime);
      filter.frequency.setValueAtTime(frequency * cutBase, sustainStart);
      filter.frequency.linearRampToValueAtTime(frequency * (cutBase * 0.33), endTime + releaseTime);

      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.42, startTime + attackTime);
      env.gain.setValueAtTime(gain * 0.42, sustainStart);
      env.gain.linearRampToValueAtTime(0, endTime + releaseTime);

      detuneValues.forEach((detune) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = wave ?? (detune === 0 ? "triangle" : "sawtooth");
        o.frequency.value = frequency;
        o.detune.value = detune;
        og.gain.value = detune === 0 ? 0.55 : 0.22;
        o.connect(og);
        og.connect(filter);
        o.start(startTime);
        o.stop(endTime + releaseTime + 0.1);
      });

      filter.connect(env);
      env.connect(master);
      break;
    }

    case "pluck": {
      const bufferSize = ctx.sampleRate * 0.5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = fQ ?? frequency / 20;

      const rel = relOvr ?? Math.min(duration + 0.4, 2.0);
      const env = ctx.createGain();
      env.gain.setValueAtTime(gain * 0.7, startTime);
      env.gain.exponentialRampToValueAtTime(0.0001, startTime + rel);

      source.connect(filter);
      filter.connect(env);
      env.connect(master);

      source.start(startTime);
      source.stop(startTime + rel + 0.1);
      break;
    }

    case "marimba": {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = wave ?? "sine";
      osc.frequency.value = frequency;
      osc2.type = "sine";
      osc2.frequency.value = frequency * 4.07;
      if (detOvr !== undefined) osc2.detune.value = detOvr;

      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.18;

      const rel = relOvr ?? Math.min(duration + 0.15, 0.8);
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.8, startTime + (atkOvr ?? 0.004));
      env.gain.exponentialRampToValueAtTime(0.0001, startTime + rel);

      osc.connect(env);
      osc2.connect(osc2Gain);
      osc2Gain.connect(env);
      env.connect(master);

      osc.start(startTime);
      osc2.start(startTime);
      osc.stop(startTime + rel + 0.2);
      osc2.stop(startTime + rel + 0.2);
      break;
    }

    case "organ": {
      const drawbars = [1, 2, 3, 4, 6];
      const drawbarGains = [0.5, 0.35, 0.15, 0.1, 0.06];
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = "lowpass";
      filter.frequency.value = fCut !== undefined ? frequency * fCut : Math.min(frequency * 8, 5000);
      filter.Q.value = fQ ?? 0.3;

      const atk = atkOvr ?? 0.006;
      const rel = relOvr ?? 0.02;
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.6, startTime + atk);
      env.gain.setValueAtTime(gain * 0.5, startTime + Math.max(atk, 0.02));
      env.gain.setValueAtTime(gain * 0.5, endTime - 0.01);
      env.gain.linearRampToValueAtTime(0, endTime + rel);

      drawbars.forEach((harmonic, i) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = wave ?? "sine";
        o.frequency.value = frequency * harmonic;
        og.gain.value = drawbarGains[i];
        o.connect(og);
        og.connect(filter);
        o.start(startTime);
        o.stop(endTime + rel + 0.03);
      });

      filter.connect(env);
      env.connect(master);
      break;
    }

    case "flute": {
      const osc = ctx.createOscillator();
      const breathNoise = ctx.createOscillator();
      const breathGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = wave ?? "sine";
      osc.frequency.value = frequency;

      breathNoise.type = "sawtooth";
      breathNoise.frequency.value = frequency * 2.01;
      breathGain.gain.value = 0.04;

      filter.type = "lowpass";
      filter.frequency.value = fCut !== undefined ? frequency * fCut : frequency * 3;
      filter.Q.value = fQ ?? 0.3;

      const attackTime = atkOvr ?? Math.min(0.08, duration * 0.2);
      const releaseTime = relOvr ?? Math.min(0.12, duration * 0.15);
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.55, startTime + attackTime);
      env.gain.setValueAtTime(gain * 0.5, Math.max(startTime + attackTime, endTime - releaseTime));
      env.gain.linearRampToValueAtTime(0, endTime + releaseTime);

      osc.connect(filter);
      breathNoise.connect(breathGain);
      breathGain.connect(filter);
      filter.connect(env);
      env.connect(master);

      osc.start(startTime);
      breathNoise.start(startTime);
      osc.stop(endTime + releaseTime + 0.1);
      breathNoise.stop(endTime + releaseTime + 0.1);
      break;
    }

    case "bell": {
      const ratios = [1, 2.76, 4.07, 5.58];
      const amps = [0.5, 0.25, 0.15, 0.08];
      const decays = [1.5, 0.8, 0.5, 0.3];

      ratios.forEach((ratio, i) => {
        const o = ctx.createOscillator();
        const e = ctx.createGain();
        o.type = wave ?? "sine";
        o.frequency.value = frequency * ratio;
        if (detOvr !== undefined) o.detune.value = detOvr * (i > 0 ? 1 : 0);
        const decayTime = relOvr ?? Math.min(decays[i], duration + 0.5);
        e.gain.setValueAtTime(gain * amps[i], startTime);
        e.gain.exponentialRampToValueAtTime(0.0001, startTime + decayTime);
        o.connect(e);
        e.connect(master);
        o.start(startTime);
        o.stop(startTime + decayTime + 0.05);
      });
      break;
    }

    case "synth_lead": {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc1.type = wave ?? "sawtooth";
      osc1.frequency.value = frequency;
      osc2.type = wave === "sine" ? "triangle" : "square";
      osc2.frequency.value = frequency * 1.002;
      if (detOvr !== undefined) osc2.detune.value = detOvr;

      const osc2g = ctx.createGain();
      osc2g.gain.value = 0.35;

      filter.type = "lowpass";
      filter.Q.value = fQ ?? 1.5;

      const attackTime = atkOvr ?? Math.min(0.02, duration * 0.1);
      const releaseTime = relOvr ?? Math.min(0.15, duration * 0.2);
      const sustainStart = Math.max(startTime + attackTime, endTime - releaseTime);
      const cutBase = fCut ?? 8;

      filter.frequency.setValueAtTime(frequency * (cutBase * 0.25), startTime);
      filter.frequency.linearRampToValueAtTime(frequency * cutBase, startTime + attackTime);
      filter.frequency.setValueAtTime(frequency * (cutBase * 0.75), sustainStart);
      filter.frequency.linearRampToValueAtTime(frequency * (cutBase * 0.25), endTime + releaseTime);

      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.55, startTime + attackTime);
      env.gain.setValueAtTime(gain * 0.5, sustainStart);
      env.gain.linearRampToValueAtTime(0, endTime + releaseTime);

      osc1.connect(filter);
      osc2.connect(osc2g);
      osc2g.connect(filter);
      filter.connect(env);
      env.connect(master);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(endTime + releaseTime + 0.1);
      osc2.stop(endTime + releaseTime + 0.1);
      break;
    }

    default:
      break;
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbBus: { input: GainNode; output: GainNode } | null = null;
  private isPlaying = false;
  private playStartTime = 0;
  private animFrameId: number | null = null;
  private onPlayheadUpdate: ((beat: number) => void) | null = null;
  private onPlaybackEnd: (() => void) | null = null;
  private onActiveNotesUpdate: ((midiNotes: Set<number>) => void) | null = null;
  private totalBeats = 0;
  private bpm = 120;
  private currentComposition: CompositionState | null = null;

  private ensureContext(): { ctx: AudioContext; master: GainNode; reverbBus: { input: GainNode; output: GainNode } } {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.ctx.destination);
      this.reverbBus = createReverb(this.ctx);
      this.reverbBus.output.connect(this.master);
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    return { ctx: this.ctx, master: this.master!, reverbBus: this.reverbBus! };
  }

  setCallbacks(
    onPlayheadUpdate: (beat: number) => void,
    onPlaybackEnd: () => void,
    onActiveNotesUpdate?: (midiNotes: Set<number>) => void
  ) {
    this.onPlayheadUpdate = onPlayheadUpdate;
    this.onPlaybackEnd = onPlaybackEnd;
    this.onActiveNotesUpdate = onActiveNotesUpdate ?? null;
  }

  play(composition: CompositionState): void {
    if (this.isPlaying) {
      this.stop();
    }

    const { ctx, master, reverbBus } = this.ensureContext();
    this.bpm = composition.bpm;
    this.totalBeats = composition.totalBeats;
    this.isPlaying = true;
    this.currentComposition = composition;

    const secondsPerBeat = 60 / composition.bpm;
    const startTime = ctx.currentTime + 0.05;
    this.playStartTime = startTime;

    const trackChains = new Map<string, { gain: GainNode; pan: StereoPannerNode }>();
    for (const [name, track] of Object.entries(composition.tracks)) {
      const g = ctx.createGain();
      g.gain.value = track.volume ?? 1;
      const p = ctx.createStereoPanner();
      p.pan.value = track.pan ?? 0;
      g.connect(p);
      p.connect(master);
      const reverbAmount = track.reverb ?? 0.2;
      if (reverbAmount > 0) {
        const reverbSend = ctx.createGain();
        reverbSend.gain.value = reverbAmount;
        g.connect(reverbSend);
        reverbSend.connect(reverbBus.input);
      }
      trackChains.set(name, { gain: g, pan: p });
    }

    for (const note of composition.notes) {
      const track = composition.tracks[note.track];
      if (!track) continue;

      const chain = trackChains.get(note.track);
      const dest = chain ? chain.gain : master;
      const noteStartTime = startTime + note.beat * secondsPerBeat;
      const noteDuration = note.duration * secondsPerBeat;

      synthesizeNote(ctx, dest, {
        frequency: pitchToFrequency(note.pitch),
        startTime: noteStartTime,
        duration: noteDuration,
        velocity: note.velocity,
        instrument: track.instrument,
        synthParams: track.synthParams
      });
    }

    const endTime = startTime + this.totalBeats * secondsPerBeat + 2.0;

    const tick = () => {
      if (!this.isPlaying || !this.ctx) return;

      const elapsed = this.ctx.currentTime - this.playStartTime;
      const currentBeat = elapsed * (this.bpm / 60);

      if (this.onPlayheadUpdate) {
        this.onPlayheadUpdate(Math.max(0, currentBeat));
      }

      if (this.onActiveNotesUpdate && this.currentComposition) {
        const active = new Set<number>();
        for (const note of this.currentComposition.notes) {
          if (currentBeat >= note.beat && currentBeat < note.beat + note.duration) {
            active.add(pitchToMidi(note.pitch));
          }
        }
        this.onActiveNotesUpdate(active);
      }

      if (this.ctx.currentTime >= endTime) {
        this.isPlaying = false;
        if (this.onActiveNotesUpdate) this.onActiveNotesUpdate(new Set());
        if (this.onPlaybackEnd) this.onPlaybackEnd();
        return;
      }

      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.isPlaying = false;
    this.currentComposition = null;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.ctx) {
      const oldCtx = this.ctx;
      this.ctx = null;
      this.master = null;
      void oldCtx.close();
    }

    if (this.onActiveNotesUpdate) this.onActiveNotesUpdate(new Set());
    if (this.onPlayheadUpdate) this.onPlayheadUpdate(-1);
  }

  get playing(): boolean {
    return this.isPlaying;
  }
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = 2;
  const dataSize = numChannels * numSamples * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  const writeU32 = (offset: number, val: number) => view.setUint32(offset, val, true);
  const writeU16 = (offset: number, val: number) => view.setUint16(offset, val, true);

  writeStr(0, "RIFF");
  writeU32(4, 36 + dataSize);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  writeU32(16, 16);
  writeU16(20, 1);
  writeU16(22, numChannels);
  writeU32(24, sampleRate);
  writeU32(28, sampleRate * numChannels * bytesPerSample);
  writeU16(32, numChannels * bytesPerSample);
  writeU16(34, 16);
  writeStr(36, "data");
  writeU32(40, dataSize);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export async function exportMp3(composition: CompositionState): Promise<Blob> {
  const secondsPerBeat = 60 / composition.bpm;
  const totalDuration = composition.totalBeats * secondsPerBeat + 2.5;
  const sampleRate = 44100;
  const numSamples = Math.ceil(sampleRate * totalDuration);
  const offlineCtx = new OfflineAudioContext(2, numSamples, sampleRate);

  const master = offlineCtx.createGain();
  master.gain.value = 0.72;
  master.connect(offlineCtx.destination);

  const reverbBus = createReverb(offlineCtx);
  reverbBus.output.connect(master);

  const trackChains = new Map<string, GainNode>();
  for (const [name, track] of Object.entries(composition.tracks)) {
    const g = offlineCtx.createGain();
    g.gain.value = track.volume ?? 1;
    const p = offlineCtx.createStereoPanner();
    p.pan.value = track.pan ?? 0;
    g.connect(p);
    p.connect(master);
    const reverbAmount = track.reverb ?? 0.2;
    if (reverbAmount > 0) {
      const reverbSend = offlineCtx.createGain();
      reverbSend.gain.value = reverbAmount;
      g.connect(reverbSend);
      reverbSend.connect(reverbBus.input);
    }
    trackChains.set(name, g);
  }

  for (const note of composition.notes) {
    const track = composition.tracks[note.track];
    if (!track) continue;

    const dest = trackChains.get(note.track) ?? master;
    const noteStart = note.beat * secondsPerBeat + 0.05;
    const noteDuration = note.duration * secondsPerBeat;

    synthesizeNote(offlineCtx as unknown as AudioContext, dest, {
      frequency: pitchToFrequency(note.pitch),
      startTime: noteStart,
      duration: noteDuration,
      velocity: note.velocity,
      instrument: track.instrument,
      synthParams: track.synthParams
    });
  }

  const rendered = await offlineCtx.startRendering();

  const encoder = new Mp3Encoder(2, sampleRate, 320);

  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;

  const toInt16 = (floatArr: Float32Array): Int16Array => {
    const int16 = new Int16Array(floatArr.length);
    for (let i = 0; i < floatArr.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(floatArr[i] * 32767)));
    }
    return int16;
  };

  const leftInt = toInt16(left);
  const rightInt = toInt16(right);

  const parts: ArrayBuffer[] = [];
  const blockSize = 1152;

  for (let i = 0; i < leftInt.length; i += blockSize) {
    const leftChunk = leftInt.subarray(i, i + blockSize);
    const rightChunk = rightInt.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(leftChunk, rightChunk);
    if (encoded.length > 0) {
      const buf = new ArrayBuffer(encoded.length);
      new Int8Array(buf).set(encoded);
      parts.push(buf);
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) {
    const buf = new ArrayBuffer(flushed.length);
    new Int8Array(buf).set(flushed);
    parts.push(buf);
  }

  return new Blob(parts, { type: "audio/mpeg" });
}

export const TRACK_COLORS: Record<string, string> = {
  piano: "#42d7ff",
  strings: "#a38cff",
  bass: "#3fe8b5",
  pad: "#ffcb57",
  pluck: "#ff8aa6",
  marimba: "#89ff9c",
  organ: "#ff9f43",
  flute: "#a0e8af",
  bell: "#e8d5a0",
  synth_lead: "#ff6b9d",
  default: "#c0ceff"
};

export function getTrackColor(instrument: string): string {
  return TRACK_COLORS[instrument] ?? TRACK_COLORS.default;
}

export function buildDefaultTrack(instrument: InstrumentName): MusicTrack {
  return { name: instrument, instrument, volume: 0.85, reverb: 0.2, pan: 0 };
}
