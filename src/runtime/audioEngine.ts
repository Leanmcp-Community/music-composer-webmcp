import { Mp3Encoder } from "@breezystack/lamejs";
import Soundfont from "soundfont-player";
import type { CompositionState, DelayParams, DistortionParams, DistortionType, InstrumentName, LfoParams, MusicNote, MusicTrack, SynthParams } from "../types";

const GM_INSTRUMENT_MAP: Partial<Record<InstrumentName, string>> = {
  piano:          "acoustic_grand_piano",
  electric_piano: "electric_piano_1",
  strings:        "string_ensemble_1",
  pad:            "pad_2_warm",
  bass:           "electric_bass_finger",
  guitar:         "acoustic_guitar_nylon",
  pluck:          "pizzicato_strings",
  marimba:        "marimba",
  organ:          "rock_organ",
  flute:          "flute",
  bell:           "tubular_bells",
  synth_lead:     "lead_2_sawtooth",
};

const ALL_SAMPLED_INSTRUMENTS = Object.keys(GM_INSTRUMENT_MAP) as InstrumentName[];

type SoundfontPlayerInstance = Awaited<ReturnType<typeof Soundfont.instrument>>;

const soundfontCache = new Map<string, Promise<SoundfontPlayerInstance>>();

function getSoundfontPlayer(
  ctx: AudioContext | OfflineAudioContext,
  instrumentName: InstrumentName
): Promise<SoundfontPlayerInstance> | null {
  const gmName = GM_INSTRUMENT_MAP[instrumentName];
  if (!gmName) return null;
  const key = `${ctx === (globalThis as Record<string, unknown>).__sfCtx ? "live" : "offline"}_${gmName}`;
  if (!soundfontCache.has(key)) {
    soundfontCache.set(
      key,
      Soundfont.instrument(ctx as AudioContext, gmName, { soundfont: "MusyngKite", format: "mp3" })
    );
  }
  return soundfontCache.get(key)!;
}

export async function preloadAllInstruments(ctx: AudioContext): Promise<void> {
  (globalThis as Record<string, unknown>).__sfCtx = ctx;
  await Promise.all(
    ALL_SAMPLED_INSTRUMENTS.map((name) => {
      const gmName = GM_INSTRUMENT_MAP[name]!;
      const key = `live_${gmName}`;
      if (!soundfontCache.has(key)) {
        soundfontCache.set(key, Soundfont.instrument(ctx, gmName, { soundfont: "MusyngKite", format: "mp3" }));
      }
      return soundfontCache.get(key)!;
    })
  );
}

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

function makeDistortionCurve(type: DistortionType, drive: number): Float32Array {
  const n = 512;
  const curve = new Float32Array(n);
  const d = Math.max(0.001, Math.min(1, drive));

  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    switch (type) {
      case "overdrive": {
        const k = d * 200;
        curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
        break;
      }
      case "saturation": {
        const k = d * 50;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
        break;
      }
      case "hard_clip": {
        const threshold = 1 - d * 0.85;
        curve[i] = Math.max(-threshold, Math.min(threshold, x)) / threshold;
        break;
      }
      case "fuzz": {
        const k = d * 500 + 1;
        const sign = x < 0 ? -1 : 1;
        curve[i] = sign * (1 - Math.exp(-Math.abs(x) * k));
        break;
      }
      case "bitcrush": {
        const bits = Math.max(1, Math.round(16 - d * 14));
        const step = Math.pow(2, -(bits - 1));
        curve[i] = step * Math.floor(x / step + 0.5);
        break;
      }
    }
  }
  return curve;
}

function applyDistortion(
  ctx: AudioContext,
  input: AudioNode,
  params: DistortionParams
): AudioNode {
  const curve = makeDistortionCurve(params.type, params.drive);

  const shaper = ctx.createWaveShaper();
  shaper.curve = curve as Float32Array<ArrayBuffer>;
  shaper.oversample = "4x";

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const outputGain = ctx.createGain();

  const wet = Math.max(0, Math.min(1, params.mix));
  dryGain.gain.value = 1 - wet;
  wetGain.gain.value = wet;
  outputGain.gain.value = Math.max(0, Math.min(2, params.outputGain));

  input.connect(dryGain);
  input.connect(shaper);
  shaper.connect(wetGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);

  return outputGain;
}

function applyDelay(
  ctx: AudioContext,
  input: AudioNode,
  params: DelayParams
): AudioNode {
  const delayTime = Math.max(0.01, Math.min(1.0, params.time));
  const feedback = Math.max(0, Math.min(0.85, params.feedback));
  const wet = Math.max(0, Math.min(1, params.mix));

  const delay = ctx.createDelay(1.1);
  delay.delayTime.value = delayTime;

  const fbGain = ctx.createGain();
  fbGain.gain.value = feedback;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - wet;

  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;

  const output = ctx.createGain();
  output.gain.value = 1;

  delay.connect(fbGain);
  fbGain.connect(delay);

  input.connect(dryGain);
  input.connect(delay);
  delay.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  return output;
}

interface ScheduledNote {
  pitch: string;
  frequency: number;
  startTime: number;
  duration: number;
  velocity: number;
  instrument: InstrumentName;
  synthParams?: SynthParams;
  lfoParams?: LfoParams;
}


function synthesizeNoteSync(
  ctx: AudioContext,
  dest: GainNode,
  note: ScheduledNote,
  player?: SoundfontPlayerInstance
): void {
  if (player) {
    if (ctx.state === "closed") return;
    const gainVal = Math.max(0.01, Math.min(1, note.velocity / 127));
    const SUSTAINED_INSTRUMENTS: InstrumentName[] = ["pad", "strings", "organ", "flute", "bell", "electric_piano"];
    const tail = SUSTAINED_INSTRUMENTS.includes(note.instrument) ? 1.5 : 0.25;
    const durSecs = Math.max(0.05, note.duration + tail);
    player.play(pitchToMidi(note.pitch ?? ""), note.startTime, { gain: gainVal, duration: durSecs });
    return;
  }
  synthesizeNoteOsc(ctx, dest, note);
}


function synthesizeNoteOsc(
  ctx: AudioContext,
  master: GainNode,
  note: ScheduledNote
): void {
  const { frequency, startTime, duration, velocity, instrument, synthParams: sp, lfoParams: lfo } = note;
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

    case "kick": {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const env1 = ctx.createGain();
      const env2 = ctx.createGain();
      const out = ctx.createGain();

      osc1.type = "triangle";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(150, startTime);
      osc1.frequency.exponentialRampToValueAtTime(0.001, startTime + 0.35);
      osc2.frequency.setValueAtTime(60, startTime);
      osc2.frequency.exponentialRampToValueAtTime(0.001, startTime + 0.4);

      env1.gain.setValueAtTime(gain * 0.9, startTime);
      env1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
      env2.gain.setValueAtTime(gain * 0.7, startTime);
      env2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

      out.gain.value = 1;
      osc1.connect(env1); env1.connect(out);
      osc2.connect(env2); env2.connect(out);
      out.connect(master);

      osc1.start(startTime); osc2.start(startTime);
      osc1.stop(startTime + 0.5); osc2.stop(startTime + 0.5);
      break;
    }

    case "snare": {
      const bufSize = Math.floor(ctx.sampleRate * 0.1);
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) noiseData[i] = Math.random() * 2 - 1;

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuf;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = 1800;
      noiseFilter.Q.value = 0.7;

      const noiseEnv = ctx.createGain();
      noiseEnv.gain.setValueAtTime(gain * 0.7, startTime);
      noiseEnv.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);

      const snapOsc = ctx.createOscillator();
      snapOsc.type = "triangle";
      snapOsc.frequency.value = 180;
      const snapEnv = ctx.createGain();
      snapEnv.gain.setValueAtTime(gain * 0.5, startTime);
      snapEnv.gain.exponentialRampToValueAtTime(0.001, startTime + 0.06);

      const out = ctx.createGain();
      out.gain.value = 1;
      noiseSource.connect(noiseFilter); noiseFilter.connect(noiseEnv); noiseEnv.connect(out);
      snapOsc.connect(snapEnv); snapEnv.connect(out);
      out.connect(master);

      noiseSource.start(startTime); snapOsc.start(startTime);
      noiseSource.stop(startTime + 0.25); snapOsc.stop(startTime + 0.1);
      break;
    }

    case "hihat": {
      const bufSize = Math.floor(ctx.sampleRate * 0.05);
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) noiseData[i] = Math.random() * 2 - 1;

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuf;

      const hipassFilter = ctx.createBiquadFilter();
      hipassFilter.type = "highpass";
      hipassFilter.frequency.value = 7000;
      hipassFilter.Q.value = 0.5;

      const decayTime = atkOvr ?? Math.min(duration * 0.8, 0.12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(gain * 0.6, startTime);
      env.gain.exponentialRampToValueAtTime(0.001, startTime + decayTime);

      noiseSource.connect(hipassFilter); hipassFilter.connect(env); env.connect(master);
      noiseSource.start(startTime);
      noiseSource.stop(startTime + decayTime + 0.02);
      break;
    }

    case "clap": {
      const offsets = [0, 0.008, 0.016];
      offsets.forEach((offset) => {
        const bufSize = Math.floor(ctx.sampleRate * 0.06);
        const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const noiseData = noiseBuf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) noiseData[i] = Math.random() * 2 - 1;

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1200;
        filter.Q.value = 0.9;

        const env = ctx.createGain();
        const t = startTime + offset;
        env.gain.setValueAtTime(gain * (offset === 0 ? 0.6 : 0.4), t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        noiseSource.connect(filter); filter.connect(env); env.connect(master);
        noiseSource.start(t);
        noiseSource.stop(t + 0.12);
      });
      break;
    }

    case "guitar": {
      const sampleRate = ctx.sampleRate;
      const period = Math.round(sampleRate / frequency);
      const bufSize = period * 2;
      const buf = ctx.createBuffer(1, bufSize, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = frequency;
      bandpass.Q.value = fQ ?? Math.max(5, frequency / 40);

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = fCut !== undefined ? frequency * fCut : Math.min(frequency * 6, 4000);
      lowpass.Q.value = 0.5;

      const rel = relOvr ?? Math.min(duration + 0.5, 2.5);
      const env = ctx.createGain();
      env.gain.setValueAtTime(gain * 0.8, startTime);
      env.gain.exponentialRampToValueAtTime(0.001, startTime + rel);

      source.connect(bandpass); bandpass.connect(lowpass); lowpass.connect(env); env.connect(master);
      source.start(startTime);
      source.stop(startTime + rel + 0.05);
      break;
    }

    case "electric_piano": {
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const env = ctx.createGain();

      carrier.type = "sine";
      carrier.frequency.value = frequency;
      modulator.type = "sine";
      modulator.frequency.value = frequency * 14;

      const modIndex = (fCut ?? 1) * 0.3 * frequency;
      modGain.gain.value = modIndex;
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      const atk = atkOvr ?? 0.005;
      const rel = relOvr ?? Math.min(duration + 0.4, 1.8);
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(gain * 0.75, startTime + atk);
      env.gain.exponentialRampToValueAtTime(gain * 0.45, startTime + Math.max(atk + 0.01, 0.08));
      env.gain.exponentialRampToValueAtTime(0.0001, startTime + rel);

      if (lfo && lfo.type === "tremolo") {
        const lfoOsc = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfoOsc.frequency.value = lfo.rate;
        lfoGain.gain.value = lfo.depth * 0.3;
        lfoOsc.connect(lfoGain);
        lfoGain.connect(env.gain);
        lfoOsc.start(startTime);
        lfoOsc.stop(startTime + rel + 0.1);
      }

      carrier.connect(env); env.connect(master);
      carrier.start(startTime); modulator.start(startTime);
      carrier.stop(startTime + rel + 0.1); modulator.stop(startTime + rel + 0.1);
      break;
    }

    default:
      break;
  }

  if (lfo && instrument !== "electric_piano") {
    void lfo;
  }
}

function stopAllSoundfontVoices(): void {
  for (const [key, promise] of soundfontCache) {
    if (!key.startsWith("live_")) continue;
    promise.then((player) => {
      try { player.stop(); } catch { /* */ }
    }).catch(() => { /* */ });
  }
}

type TrackSoundfontPlayers = Map<string, SoundfontPlayerInstance>;

const SCHEDULER_LOOKAHEAD = 0.35;
const SCHEDULER_INTERVAL = 40;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbBus: { input: GainNode; output: GainNode } | null = null;
  private trackGains: Map<string, GainNode> = new Map();
  private trackBaseVolumes: Map<string, number> = new Map();
  private isPlaying = false;
  private playStartTime = 0;
  private animFrameId: number | null = null;
  private looping = false;
  private lastMutedTracks: Set<string> | undefined = undefined;
  private playId = 0;
  private onPlayheadUpdate: ((beat: number) => void) | null = null;
  private onPlaybackEnd: (() => void) | null = null;
  private onActiveNotesUpdate: ((midiNotes: Set<number>) => void) | null = null;
  private totalBeats = 0;
  private bpm = 120;
  private currentComposition: CompositionState | null = null;
  private playTrackChains: Map<string, { gain: GainNode; pan: StereoPannerNode }> = new Map();
  private sortedNotes: MusicNote[] = [];
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private schedulerIndex = 0;
  private loopRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;

  private ensureContext(): { ctx: AudioContext; master: GainNode; reverbBus: { input: GainNode; output: GainNode } } {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.ctx.destination);
      this.reverbBus = createReverb(this.ctx);
      this.reverbBus.output.connect(this.master);
      (globalThis as Record<string, unknown>).__sfCtx = this.ctx;
    }

    return { ctx: this.ctx, master: this.master!, reverbBus: this.reverbBus! };
  }

  private trackSoundfontPlayers: TrackSoundfontPlayers = new Map();

  private cleanupPlayback(): void {
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.loopRestartTimer !== null) {
      clearTimeout(this.loopRestartTimer);
      this.loopRestartTimer = null;
    }
    this.schedulerIndex = 0;

    stopAllSoundfontVoices();

    for (const [, chain] of this.playTrackChains) {
      try { chain.gain.disconnect(); } catch { /* */ }
      try { chain.pan.disconnect(); } catch { /* */ }
    }
    this.playTrackChains.clear();
    this.trackGains.clear();
    this.trackBaseVolumes.clear();
    this.trackSoundfontPlayers.clear();

    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.suspend();
    }
  }

  async preloadSoundfonts(): Promise<void> {
    const { ctx } = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    await preloadAllInstruments(ctx);
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

  play(composition: CompositionState, mutedTracks?: Set<string>, options?: { loop?: boolean }): void {
    if (this.isPlaying) {
      this.stop();
    }
    this.looping = options?.loop ?? false;
    this.lastMutedTracks = mutedTracks;
    void this._playAsync(composition, mutedTracks);
  }

  private async _playAsync(composition: CompositionState, mutedTracks?: Set<string>): Promise<void> {
    const { ctx, master, reverbBus } = this.ensureContext();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    this.bpm = composition.bpm;
    this.totalBeats = composition.totalBeats;
    this.isPlaying = true;
    this.currentComposition = composition;

    const usedInstruments = new Set(
      composition.notes
        .map((n) => composition.tracks[n.track]?.instrument)
        .filter((i): i is InstrumentName => !!i && !!GM_INSTRUMENT_MAP[i as InstrumentName])
    );
    await Promise.all([...usedInstruments].map((inst) => getSoundfontPlayer(ctx, inst)));

    if (!this.isPlaying) return;

    const secondsPerBeat = 60 / composition.bpm;
    const startTime = ctx.currentTime + 0.15;
    this.playStartTime = startTime;

    const trackChains = new Map<string, { gain: GainNode; pan: StereoPannerNode }>();
    for (const [name, track] of Object.entries(composition.tracks)) {
      const g = ctx.createGain();
      g.gain.value = track.volume ?? 1;
      const p = ctx.createStereoPanner();
      p.pan.value = track.pan ?? 0;

      let postGain: AudioNode = g;
      if (track.distortion) {
        postGain = applyDistortion(ctx, g, track.distortion);
      }
      if (track.delayParams) {
        postGain = applyDelay(ctx, postGain, track.delayParams);
      }
      if (track.eq) {
        if (track.eq.highpassHz) {
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.value = track.eq.highpassHz;
          hp.Q.value = 0.5;
          postGain.connect(hp);
          postGain = hp;
        }
        if (track.eq.lowpassHz) {
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = track.eq.lowpassHz;
          lp.Q.value = 0.5;
          postGain.connect(lp);
          postGain = lp;
        }
      }
      postGain.connect(p);
      p.connect(master);

      const reverbAmount = track.reverb ?? 0.2;
      if (reverbAmount > 0) {
        const reverbSend = ctx.createGain();
        reverbSend.gain.value = reverbAmount;
        postGain.connect(reverbSend);
        reverbSend.connect(reverbBus.input);
      }
      trackChains.set(name, { gain: g, pan: p });
    }

    this.trackGains.clear();
    this.trackBaseVolumes.clear();
    for (const [name, chain] of trackChains) {
      this.trackGains.set(name, chain.gain);
      this.trackBaseVolumes.set(name, composition.tracks[name]?.volume ?? 1);
      if (mutedTracks?.has(name)) chain.gain.gain.value = 0;
    }

    this.playTrackChains = trackChains;

    // Create one soundfont player instance per track (not shared per instrument).
    // Soundfont-player.connect() is additive — sharing a player across tracks
    // means all tracks receive all voices. Per-track instances give isolated routing.
    // Audio buffers are browser-cached (same URL), so only the JS wrapper is duplicated.
    this.trackSoundfontPlayers.clear();
    const trackPlayerPromises: Promise<void>[] = [];
    for (const [trackName, track] of Object.entries(composition.tracks)) {
      const gmName = GM_INSTRUMENT_MAP[track.instrument];
      if (!gmName) continue;
      const chain = trackChains.get(trackName);
      if (!chain) continue;
      const dest = chain.gain;
      const p = Soundfont.instrument(ctx, gmName, { soundfont: "MusyngKite", format: "mp3" })
        .then((player) => {
          if (!this.isPlaying || ctx.state === "closed") return;
          player.connect(dest);
          this.trackSoundfontPlayers.set(trackName, player);
        })
        .catch(() => { /* fall back to oscillator */ });
      trackPlayerPromises.push(p);
    }
    await Promise.all(trackPlayerPromises);
    if (!this.isPlaying) return;

    const thisPlayId = ++this.playId;

    this.sortedNotes = [...composition.notes].sort((a, b) => a.beat - b.beat);
    this.schedulerIndex = 0;

    const scheduleChunk = () => {
      if (!this.isPlaying || this.playId !== thisPlayId || !this.ctx) return;
      const currentMuted = this.lastMutedTracks;
      const lookAheadEnd = this.ctx.currentTime + SCHEDULER_LOOKAHEAD;
      while (this.schedulerIndex < this.sortedNotes.length) {
        const mn = this.sortedNotes[this.schedulerIndex];
        const noteStartTime = startTime + mn.beat * secondsPerBeat;
        if (noteStartTime > lookAheadEnd) break;

        const track = composition.tracks[mn.track];
        if (track && !(currentMuted?.has(mn.track))) {
          const chain = trackChains.get(mn.track);
          const dest = chain ? chain.gain : master;
          const sfPlayer = this.trackSoundfontPlayers.get(mn.track);
          synthesizeNoteSync(ctx, dest, {
            pitch: mn.pitch,
            frequency: pitchToFrequency(mn.pitch),
            startTime: noteStartTime,
            duration: mn.duration * secondsPerBeat,
            velocity: mn.velocity,
            instrument: track.instrument,
            synthParams: track.synthParams,
            lfoParams: track.lfoParams
          }, sfPlayer);
        }
        this.schedulerIndex++;
      }
      this.schedulerTimer = setTimeout(scheduleChunk, SCHEDULER_INTERVAL);
    };
    scheduleChunk();

    const loopEndTime = startTime + this.totalBeats * secondsPerBeat;
    const endTime = loopEndTime + 0.5;
    let noteSearchStart = 0;

    if (this.looping) {
      const msUntilLoopEnd = (loopEndTime - ctx.currentTime) * 1000;
      const msUntilRestart = Math.max(0, msUntilLoopEnd - 120);
      this.loopRestartTimer = setTimeout(() => {
        if (!this.isPlaying || this.playId !== thisPlayId || !this.currentComposition) return;
        const comp = this.currentComposition;
        const muted = this.lastMutedTracks;
        this.cleanupPlayback();
        this.isPlaying = false;
        if (this.onActiveNotesUpdate) this.onActiveNotesUpdate(new Set());
        this.play(comp, muted, { loop: true });
      }, msUntilRestart);
    }

    const tick = () => {
      if (!this.isPlaying || !this.ctx || this.playId !== thisPlayId) return;

      const elapsed = this.ctx.currentTime - this.playStartTime;
      const currentBeat = elapsed * (this.bpm / 60);

      if (this.onPlayheadUpdate) {
        this.onPlayheadUpdate(Math.max(0, currentBeat));
      }

      if (this.onActiveNotesUpdate && this.sortedNotes.length > 0) {
        const active = new Set<number>();
        const currentMuted = this.lastMutedTracks;
        while (noteSearchStart < this.sortedNotes.length && this.sortedNotes[noteSearchStart].beat + this.sortedNotes[noteSearchStart].duration < currentBeat) {
          noteSearchStart++;
        }
        for (let i = noteSearchStart; i < this.sortedNotes.length; i++) {
          const n = this.sortedNotes[i];
          if (n.beat > currentBeat) break;
          if (currentBeat < n.beat + n.duration && !(currentMuted?.has(n.track))) {
            active.add(pitchToMidi(n.pitch));
          }
        }
        this.onActiveNotesUpdate(active);
      }

      if (!this.looping && this.ctx.currentTime >= endTime) {
        this.cleanupPlayback();
        this.isPlaying = false;
        if (this.onActiveNotesUpdate) this.onActiveNotesUpdate(new Set());
        if (this.onPlaybackEnd) this.onPlaybackEnd();
        return;
      }

      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  playWithCrossfade(composition: CompositionState, mutedTracks?: Set<string>, options?: { loop?: boolean }): void {
    if (!this.isPlaying) {
      this.play(composition, mutedTracks, options);
      return;
    }
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    const FADE_MS = 220;
    const FADE_S = FADE_MS / 1000;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + FADE_S);
    }
    this.crossfadeTimer = setTimeout(() => {
      this.crossfadeTimer = null;
      this.play(composition, mutedTracks, options);
      if (this.master && this.ctx) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(0, now);
        this.master.gain.linearRampToValueAtTime(0.72, now + FADE_S);
      }
    }, FADE_MS);
  }

  updateMutedTracks(mutedTracks: Set<string>): void {
    this.lastMutedTracks = mutedTracks;
    for (const [name, gainNode] of this.trackGains) {
      const baseVol = this.trackBaseVolumes.get(name) ?? 1;
      gainNode.gain.value = mutedTracks.has(name) ? 0 : baseVol;
    }
  }


  stop(): void {
    this.playId++;
    this.isPlaying = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    this.cleanupPlayback();
    this.currentComposition = null;
    this.sortedNotes = [];

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

async function renderToBuffer(
  composition: CompositionState,
  trackFilter?: Set<string>
): Promise<AudioBuffer> {
  const secondsPerBeat = 60 / composition.bpm;
  const totalDuration = composition.totalBeats * secondsPerBeat + 2.5;
  const sampleRate = 44100;
  const numSamples = Math.ceil(sampleRate * totalDuration);
  const offlineCtx = new OfflineAudioContext(2, numSamples, sampleRate);
  const ctx = offlineCtx as unknown as AudioContext;

  const tracksToRender = trackFilter
    ? Object.fromEntries(Object.entries(composition.tracks).filter(([k]) => trackFilter.has(k)))
    : composition.tracks;

  const notesToRender = trackFilter
    ? composition.notes.filter((n) => trackFilter.has(n.track))
    : composition.notes;

  const usedInstruments = new Set(
    notesToRender
      .map((n) => composition.tracks[n.track]?.instrument)
      .filter((i): i is InstrumentName => !!i && !!GM_INSTRUMENT_MAP[i])
  );

  const localPlayers = new Map<string, SoundfontPlayerInstance>();
  await Promise.all([...usedInstruments].map(async (inst) => {
    const gmName = GM_INSTRUMENT_MAP[inst]!;
    const player = await Soundfont.instrument(ctx, gmName, { soundfont: "MusyngKite", format: "mp3" });
    localPlayers.set(inst, player);
  }));

  const master = offlineCtx.createGain();
  master.gain.value = 0.72;
  master.connect(offlineCtx.destination);

  const reverbBus = createReverb(offlineCtx);
  reverbBus.output.connect(master);

  const trackChains = new Map<string, GainNode>();
  for (const [name, track] of Object.entries(tracksToRender)) {
    const g = offlineCtx.createGain();
    g.gain.value = track.volume ?? 1;
    const p = offlineCtx.createStereoPanner();
    p.pan.value = track.pan ?? 0;

    let postGain: AudioNode = g;
    if (track.distortion) postGain = applyDistortion(ctx, g, track.distortion);
    if (track.delayParams) postGain = applyDelay(ctx, postGain, track.delayParams);
    postGain.connect(p);
    p.connect(master);

    const reverbAmount = track.reverb ?? 0.2;
    if (reverbAmount > 0) {
      const reverbSend = offlineCtx.createGain();
      reverbSend.gain.value = reverbAmount;
      postGain.connect(reverbSend);
      reverbSend.connect(reverbBus.input);
    }
    trackChains.set(name, g);
  }

  for (const note of notesToRender) {
    const track = composition.tracks[note.track];
    if (!track) continue;
    const dest = trackChains.get(note.track) ?? master;
    const noteStart = note.beat * secondsPerBeat + 0.05;
    const noteDuration = note.duration * secondsPerBeat;
    const player = localPlayers.get(track.instrument);
    if (player) {
      const midiNote = pitchToMidi(note.pitch);
      const gainVal = Math.max(0.01, Math.min(1, note.velocity / 127));
      player.connect(dest);
      player.play(midiNote, noteStart, { gain: gainVal, duration: Math.max(0.05, noteDuration) });
    } else {
      synthesizeNoteSync(ctx, dest, {
        pitch: note.pitch,
        frequency: pitchToFrequency(note.pitch),
        startTime: noteStart,
        duration: noteDuration,
        velocity: note.velocity,
        instrument: track.instrument,
        synthParams: track.synthParams,
        lfoParams: track.lfoParams
      });
    }
  }

  return offlineCtx.startRendering();
}

function bufferToMp3(rendered: AudioBuffer): Blob {
  const sampleRate = rendered.sampleRate;
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
    const encoded = encoder.encodeBuffer(leftInt.subarray(i, i + blockSize), rightInt.subarray(i, i + blockSize));
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

export async function exportMp3(composition: CompositionState): Promise<Blob> {
  const rendered = await renderToBuffer(composition);
  return bufferToMp3(rendered);
}

export async function exportStems(
  composition: CompositionState,
  trackNames?: string[]
): Promise<Array<{ name: string; blob: Blob }>> {
  const tracks = trackNames ?? Object.keys(composition.tracks);
  const results = await Promise.all(
    tracks.map(async (trackName) => {
      const filter = new Set([trackName]);
      const buffer = await renderToBuffer(composition, filter);
      return { name: trackName, blob: audioBufferToWav(buffer) };
    })
  );
  return results;
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
  kick: "#e05050",
  snare: "#e08050",
  hihat: "#c8c840",
  clap: "#e0a030",
  guitar: "#80c060",
  electric_piano: "#60b8d0",
  default: "#c0ceff"
};

export function getTrackColor(instrument: string): string {
  return TRACK_COLORS[instrument] ?? TRACK_COLORS.default;
}

const DEFAULT_VOLUMES: Record<InstrumentName, number> = {
  piano:         0.80,
  strings:       0.75,
  bass:          0.90,
  pad:           0.65,
  pluck:         0.75,
  marimba:       0.72,
  organ:         0.65,
  flute:         0.72,
  bell:          0.60,
  synth_lead:    0.55,
  kick:          0.95,
  snare:         0.85,
  hihat:         0.60,
  clap:          0.75,
  guitar:        0.72,
  electric_piano:0.75,
};

const DEFAULT_REVERBS: Record<InstrumentName, number> = {
  piano:         0.20,
  strings:       0.45,
  bass:          0.00,
  pad:           0.60,
  pluck:         0.20,
  marimba:       0.25,
  organ:         0.30,
  flute:         0.35,
  bell:          0.55,
  synth_lead:    0.30,
  kick:          0.00,
  snare:         0.05,
  hihat:         0.00,
  clap:          0.08,
  guitar:        0.25,
  electric_piano:0.20,
};

export function buildDefaultTrack(instrument: InstrumentName): MusicTrack {
  return {
    name: instrument,
    instrument,
    volume: DEFAULT_VOLUMES[instrument] ?? 0.75,
    reverb: DEFAULT_REVERBS[instrument] ?? 0.2,
    pan: 0
  };
}
