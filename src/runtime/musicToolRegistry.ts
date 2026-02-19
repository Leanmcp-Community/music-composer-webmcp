import type { ModelContextTool } from "../types";
import type { CompositionState, InstrumentName, MusicNote, MusicTrack, SynthParams } from "../types";
import { buildDefaultTrack } from "./audioEngine";

const INSTRUMENT_NAMES: InstrumentName[] = ["piano", "strings", "bass", "pad", "pluck", "marimba", "organ", "flute", "bell", "synth_lead"];

const NAMED_PATTERNS: Record<string, Array<{ pitch: string; beat: number; duration: number; velocity: number }>> = {
  kick: [
    { pitch: "C2", beat: 0, duration: 0.25, velocity: 110 },
    { pitch: "C2", beat: 2, duration: 0.25, velocity: 100 }
  ],
  snare: [
    { pitch: "D2", beat: 1, duration: 0.25, velocity: 95 },
    { pitch: "D2", beat: 3, duration: 0.25, velocity: 90 }
  ],
  hihat: [
    { pitch: "F#2", beat: 0, duration: 0.125, velocity: 70 },
    { pitch: "F#2", beat: 0.5, duration: 0.125, velocity: 55 },
    { pitch: "F#2", beat: 1, duration: 0.125, velocity: 70 },
    { pitch: "F#2", beat: 1.5, duration: 0.125, velocity: 55 },
    { pitch: "F#2", beat: 2, duration: 0.125, velocity: 70 },
    { pitch: "F#2", beat: 2.5, duration: 0.125, velocity: 55 },
    { pitch: "F#2", beat: 3, duration: 0.125, velocity: 70 },
    { pitch: "F#2", beat: 3.5, duration: 0.125, velocity: 55 }
  ],
  bass_walk: [
    { pitch: "C2", beat: 0, duration: 0.5, velocity: 90 },
    { pitch: "E2", beat: 1, duration: 0.5, velocity: 85 },
    { pitch: "G2", beat: 2, duration: 0.5, velocity: 88 },
    { pitch: "B2", beat: 3, duration: 0.5, velocity: 82 }
  ]
};

let noteIdCounter = 0;

function generateNoteId(): string {
  noteIdCounter += 1;
  return `n${Date.now()}_${noteIdCounter}`;
}

function clampVelocity(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 80;
  return Math.max(1, Math.min(127, Math.round(n)));
}

function clampBeat(b: unknown): number {
  const n = Number(b);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function clampDuration(d: unknown): number {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  return Math.max(0.0625, Math.round(n * 100) / 100);
}

function normalizePitch(p: unknown): string {
  const s = String(p || "C4").trim();
  const match = s.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return "C4";
  return `${match[1].toUpperCase()}${match[2]}`;
}

function normalizeInstrument(i: unknown): InstrumentName {
  const s = String(i || "piano").toLowerCase().trim() as InstrumentName;
  return INSTRUMENT_NAMES.includes(s) ? s : "piano";
}

function normalizeTrackName(t: unknown): string {
  const s = String(t || "main").trim();
  return s.length > 0 ? s : "main";
}

export function createMusicTools(
  state: CompositionState,
  onNoteAdded: (note: MusicNote) => void,
  onStateChanged: () => void
): ModelContextTool[] {
  return [
    {
      name: "set_tempo",
      description: "Set the composition tempo in BPM (beats per minute). Range: 40–200.",
      inputSchema: {
        type: "object",
        properties: {
          bpm: { type: "number", description: "Beats per minute, e.g. 120" }
        },
        required: ["bpm"]
      },
      execute: ({ bpm }) => {
        const n = Number(bpm);
        state.bpm = Math.max(40, Math.min(200, Number.isFinite(n) ? Math.round(n) : 120));
        onStateChanged();
        return { bpm: state.bpm };
      }
    },

    {
      name: "set_time_signature",
      description: "Set the time signature. Common values: 4/4, 3/4, 6/8.",
      inputSchema: {
        type: "object",
        properties: {
          numerator: { type: "integer", description: "Beats per bar, e.g. 4" },
          denominator: { type: "integer", description: "Note value, e.g. 4 for quarter note" }
        },
        required: ["numerator", "denominator"]
      },
      execute: ({ numerator, denominator }) => {
        const num = Math.max(1, Math.min(16, Math.round(Number(numerator) || 4)));
        const den = [2, 4, 8, 16].includes(Math.round(Number(denominator))) ? Math.round(Number(denominator)) : 4;
        state.timeSignatureNumerator = num;
        state.timeSignatureDenominator = den;
        onStateChanged();
        return { timeSignature: `${num}/${den}` };
      }
    },

    {
      name: "set_instrument",
      description: "Assign a synthesized instrument to a named track. Instruments: piano, strings, bass, pad, pluck, marimba, organ, flute, bell, synth_lead.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name, e.g. 'melody', 'chords', 'bass'" },
          instrument: {
            type: "string",
            enum: ["piano", "strings", "bass", "pad", "pluck", "marimba", "organ", "flute", "bell", "synth_lead"],
            description: "Instrument timbre"
          }
        },
        required: ["track", "instrument"]
      },
      execute: ({ track, instrument }) => {
        const trackName = normalizeTrackName(track);
        const inst = normalizeInstrument(instrument);
        const existing = state.tracks[trackName];
        state.tracks[trackName] = existing
          ? { ...existing, instrument: inst }
          : buildDefaultTrack(inst);
        state.tracks[trackName].name = trackName;
        onStateChanged();
        return { track: trackName, instrument: inst };
      }
    },

    {
      name: "set_track_volume",
      description: "Set the volume of a track. Range: 0.0 (silent) to 1.0 (full).",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          volume: { type: "number", description: "Volume 0.0–1.0" }
        },
        required: ["track", "volume"]
      },
      execute: ({ track, volume }) => {
        const trackName = normalizeTrackName(track);
        const vol = Math.max(0, Math.min(1, Number(volume) || 0.85));
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        state.tracks[trackName].volume = vol;
        onStateChanged();
        return { track: trackName, volume: vol };
      }
    },

    {
      name: "set_reverb",
      description: "Set the reverb send amount for a track. 0.0 = completely dry, 1.0 = maximum reverb. Default is 0.2.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          amount: { type: "number", description: "Reverb send 0.0-1.0" }
        },
        required: ["track", "amount"]
      },
      execute: ({ track, amount }) => {
        const trackName = normalizeTrackName(track);
        const amt = Math.max(0, Math.min(1, Number(amount) || 0.2));
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        state.tracks[trackName].reverb = amt;
        onStateChanged();
        return { track: trackName, reverb: amt };
      }
    },

    {
      name: "set_pan",
      description: "Set the stereo pan position of a track. -1.0 = hard left, 0.0 = center, 1.0 = hard right.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          pan: { type: "number", description: "Pan position -1.0 to 1.0" }
        },
        required: ["track", "pan"]
      },
      execute: ({ track, pan }) => {
        const trackName = normalizeTrackName(track);
        const p = Math.max(-1, Math.min(1, Number(pan) || 0));
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        state.tracks[trackName].pan = p;
        onStateChanged();
        return { track: trackName, pan: p };
      }
    },

    {
      name: "customize_instrument",
      description: "Fine-tune the synth parameters of a track's instrument. All parameters are optional — only set the ones you want to change. waveform: oscillator type. filter_cutoff: frequency multiplier relative to note frequency (0.5=dark, 5=bright, 15=open). filter_q: resonance (0.1=smooth, 3=resonant). attack: seconds (0.001=percussive, 0.5=slow). release: seconds (0.01=tight, 1.0=long tail). detune: cents spread for layered oscillators (0=unison, 20=wide chorus).",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          waveform: { type: "string", enum: ["sine", "sawtooth", "square", "triangle"], description: "Oscillator waveform" },
          filter_cutoff: { type: "number", description: "Filter cutoff as frequency multiplier (0.5-20)" },
          filter_q: { type: "number", description: "Filter resonance (0.1-5)" },
          attack: { type: "number", description: "Attack time in seconds (0.001-2.0)" },
          release: { type: "number", description: "Release time in seconds (0.01-3.0)" },
          detune: { type: "number", description: "Detune spread in cents (0-50)" }
        },
        required: ["track"]
      },
      execute: ({ track, waveform, filter_cutoff, filter_q, attack, release, detune }) => {
        const trackName = normalizeTrackName(track);
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        const params: SynthParams = { ...state.tracks[trackName].synthParams };
        if (waveform && ["sine", "sawtooth", "square", "triangle"].includes(String(waveform))) {
          params.waveform = String(waveform) as SynthParams["waveform"];
        }
        if (filter_cutoff !== undefined) params.filterCutoff = Math.max(0.5, Math.min(20, Number(filter_cutoff) || 5));
        if (filter_q !== undefined) params.filterQ = Math.max(0.1, Math.min(5, Number(filter_q) || 0.5));
        if (attack !== undefined) params.attack = Math.max(0.001, Math.min(2.0, Number(attack) || 0.01));
        if (release !== undefined) params.release = Math.max(0.01, Math.min(3.0, Number(release) || 0.1));
        if (detune !== undefined) params.detune = Math.max(0, Math.min(50, Number(detune) || 0));
        state.tracks[trackName].synthParams = params;
        onStateChanged();
        return { track: trackName, synthParams: params };
      }
    },

    {
      name: "add_note",
      description:
        "Add a single note to a track. pitch: note name like C4, F#3, Bb2. beat: position in beats (1-indexed, e.g. 1.0 = bar 1 beat 1). duration: length in beats (0.25=sixteenth, 0.5=eighth, 1=quarter, 2=half). velocity: 1–127.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          pitch: { type: "string", description: "Note name, e.g. C4, F#3, Bb2" },
          beat: { type: "number", description: "Start position in beats (1-indexed)" },
          duration: { type: "number", description: "Duration in beats" },
          velocity: { type: "number", description: "Velocity 1–127" }
        },
        required: ["track", "pitch", "beat", "duration"]
      },
      execute: ({ track, pitch, beat, duration, velocity }) => {
        const trackName = normalizeTrackName(track);
        const normalizedPitch = normalizePitch(pitch);
        const normalizedBeat = Math.max(0, clampBeat(beat) - 1);
        const normalizedDuration = clampDuration(duration);
        const normalizedVelocity = clampVelocity(velocity ?? 80);

        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }

        const note: MusicNote = {
          id: generateNoteId(),
          track: trackName,
          pitch: normalizedPitch,
          beat: normalizedBeat,
          duration: normalizedDuration,
          velocity: normalizedVelocity,
          addedAt: Date.now()
        };

        state.notes.push(note);
        const endBeat = normalizedBeat + normalizedDuration;
        if (endBeat > state.totalBeats) {
          state.totalBeats = endBeat;
        }

        onNoteAdded(note);
        return { id: note.id, track: trackName, pitch: normalizedPitch, beat: normalizedBeat + 1 };
      }
    },

    {
      name: "add_notes",
      description:
        "Add multiple notes to a track in one call. Each note has pitch, beat, duration, and optional velocity. This is the most efficient way to add notes — use it instead of calling add_note repeatedly.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          notes: {
            type: "array",
            description: "Array of note objects",
            items: {
              type: "object",
              properties: {
                pitch: { type: "string", description: "Note name, e.g. C4, F#3" },
                beat: { type: "number", description: "Start position in beats (1-indexed)" },
                duration: { type: "number", description: "Duration in beats" },
                velocity: { type: "number", description: "Velocity 1-127" }
              },
              required: ["pitch", "beat", "duration"]
            }
          }
        },
        required: ["track", "notes"]
      },
      execute: ({ track, notes: noteArr }) => {
        const trackName = normalizeTrackName(track);
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        const items = Array.isArray(noteArr) ? noteArr : [];
        let addedCount = 0;
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const normalizedPitch = normalizePitch(item.pitch);
          const normalizedBeat = Math.max(0, clampBeat(item.beat) - 1);
          const normalizedDuration = clampDuration(item.duration);
          const normalizedVelocity = clampVelocity(item.velocity ?? 80);
          const note: MusicNote = {
            id: generateNoteId(),
            track: trackName,
            pitch: normalizedPitch,
            beat: normalizedBeat,
            duration: normalizedDuration,
            velocity: normalizedVelocity,
            addedAt: Date.now()
          };
          state.notes.push(note);
          const endBeat = normalizedBeat + normalizedDuration;
          if (endBeat > state.totalBeats) state.totalBeats = endBeat;
          onNoteAdded(note);
          addedCount++;
        }
        return { added: addedCount, track: trackName };
      }
    },

    {
      name: "add_chord",
      description:
        "Add multiple simultaneous notes (a chord) to a track. pitches: array of note names like ['C4','E4','G4'].",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          pitches: {
            type: "array",
            description: "Array of note names",
            items: { type: "string" }
          },
          beat: { type: "number", description: "Start position in beats (1-indexed)" },
          duration: { type: "number", description: "Duration in beats" },
          velocity: { type: "number", description: "Velocity 1–127" }
        },
        required: ["track", "pitches", "beat", "duration"]
      },
      execute: ({ track, pitches, beat, duration, velocity }) => {
        const trackName = normalizeTrackName(track);
        const pitchList = Array.isArray(pitches) ? pitches.map(normalizePitch) : ["C4"];
        const normalizedBeat = Math.max(0, clampBeat(beat) - 1);
        const normalizedDuration = clampDuration(duration);
        const normalizedVelocity = clampVelocity(velocity ?? 80);

        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }

        const addedIds: string[] = [];
        for (const pitch of pitchList) {
          const note: MusicNote = {
            id: generateNoteId(),
            track: trackName,
            pitch,
            beat: normalizedBeat,
            duration: normalizedDuration,
            velocity: normalizedVelocity,
            addedAt: Date.now()
          };
          state.notes.push(note);
          const endBeat = normalizedBeat + normalizedDuration;
          if (endBeat > state.totalBeats) {
            state.totalBeats = endBeat;
          }
          onNoteAdded(note);
          addedIds.push(note.id);
        }

        return { added: addedIds.length, track: trackName, beat: normalizedBeat + 1 };
      }
    },

    {
      name: "add_pattern",
      description:
        "Add a named rhythmic pattern to a track starting at a beat position. Patterns: kick, snare, hihat, bass_walk. repeats: how many times to repeat.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          pattern: {
            type: "string",
            enum: ["kick", "snare", "hihat", "bass_walk"],
            description: "Pattern name"
          },
          start_beat: { type: "number", description: "Start position in beats (1-indexed)" },
          repeats: { type: "integer", description: "Number of times to repeat (1–8)" }
        },
        required: ["track", "pattern", "start_beat"]
      },
      execute: ({ track, pattern, start_beat, repeats }) => {
        const trackName = normalizeTrackName(track);
        const patternName = String(pattern || "kick").toLowerCase();
        const patternNotes = NAMED_PATTERNS[patternName];

        if (!patternNotes) {
          return { error: `Unknown pattern: ${patternName}. Use: kick, snare, hihat, bass_walk` };
        }

        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }

        const startBeat = Math.max(0, clampBeat(start_beat) - 1);
        const repeatCount = Math.max(1, Math.min(8, Math.round(Number(repeats) || 1)));
        const patternLength = 4;

        let addedCount = 0;
        for (let rep = 0; rep < repeatCount; rep++) {
          for (const template of patternNotes) {
            const note: MusicNote = {
              id: generateNoteId(),
              track: trackName,
              pitch: template.pitch,
              beat: startBeat + rep * patternLength + template.beat,
              duration: template.duration,
              velocity: template.velocity,
              addedAt: Date.now()
            };
            state.notes.push(note);
            const endBeat = note.beat + note.duration;
            if (endBeat > state.totalBeats) {
              state.totalBeats = endBeat;
            }
            onNoteAdded(note);
            addedCount++;
          }
        }

        return { added: addedCount, track: trackName, pattern: patternName, repeats: repeatCount };
      }
    },

    {
      name: "get_composition_state",
      description:
        "Get the current composition state: BPM, time signature, tracks, note count, and total length in beats.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      },
      annotations: { readOnlyHint: true },
      execute: () => {
        return {
          bpm: state.bpm,
          timeSignature: `${state.timeSignatureNumerator}/${state.timeSignatureDenominator}`,
          tracks: Object.entries(state.tracks).map(([name, t]: [string, MusicTrack]) => ({
            name,
            instrument: t.instrument,
            volume: t.volume,
            reverb: t.reverb,
            pan: t.pan
          })),
          noteCount: state.notes.length,
          totalBeats: state.totalBeats,
          totalBars: Math.ceil(state.totalBeats / state.timeSignatureNumerator)
        };
      }
    },

    {
      name: "clear_track",
      description: "Remove all notes from a specific track.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name to clear" }
        },
        required: ["track"]
      },
      execute: ({ track }) => {
        const trackName = normalizeTrackName(track);
        const before = state.notes.length;
        state.notes = state.notes.filter((n) => n.track !== trackName);
        const removed = before - state.notes.length;
        state.totalBeats = state.notes.reduce((max, n) => Math.max(max, n.beat + n.duration), 0);
        onStateChanged();
        return { track: trackName, removed };
      }
    }
  ];
}

export function createInitialCompositionState(): CompositionState {
  return {
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    tracks: {},
    notes: [],
    totalBeats: 0
  };
}
