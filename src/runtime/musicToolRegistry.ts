import type { ModelContextTool } from "../types";
import type { CompositionState, DelayParams, DistortionParams, DistortionType, EqParams, InstrumentName, LfoParams, MusicNote, MusicTrack, SynthParams } from "../types";
import { buildDefaultTrack } from "./audioEngine";

const INSTRUMENT_NAMES: InstrumentName[] = ["piano", "strings", "bass", "pad", "pluck", "marimba", "organ", "flute", "bell", "synth_lead", "kick", "snare", "hihat", "clap", "guitar", "electric_piano"];

const PERCUSSION_PATTERNS: Record<string, Array<{ pitch: string; beat: number; duration: number; velocity: number }>> = {
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
  clap: [
    { pitch: "D2", beat: 1, duration: 0.25, velocity: 90 },
    { pitch: "D2", beat: 3, duration: 0.25, velocity: 85 }
  ],
  kick_snare: [
    { pitch: "C2", beat: 0, duration: 0.25, velocity: 110 },
    { pitch: "D2", beat: 1, duration: 0.25, velocity: 95 },
    { pitch: "C2", beat: 2, duration: 0.25, velocity: 105 },
    { pitch: "D2", beat: 3, duration: 0.25, velocity: 90 }
  ],
  four_on_floor: [
    { pitch: "C2", beat: 0, duration: 0.25, velocity: 115 },
    { pitch: "C2", beat: 1, duration: 0.25, velocity: 110 },
    { pitch: "C2", beat: 2, duration: 0.25, velocity: 115 },
    { pitch: "C2", beat: 3, duration: 0.25, velocity: 110 }
  ],
  trap_hihat: [
    { pitch: "F#2", beat: 0, duration: 0.0625, velocity: 80 },
    { pitch: "F#2", beat: 0.25, duration: 0.0625, velocity: 55 },
    { pitch: "F#2", beat: 0.5, duration: 0.0625, velocity: 70 },
    { pitch: "F#2", beat: 0.75, duration: 0.0625, velocity: 50 },
    { pitch: "F#2", beat: 1, duration: 0.0625, velocity: 80 },
    { pitch: "F#2", beat: 1.25, duration: 0.0625, velocity: 55 },
    { pitch: "F#2", beat: 1.5, duration: 0.0625, velocity: 70 },
    { pitch: "F#2", beat: 1.75, duration: 0.0625, velocity: 50 },
    { pitch: "F#2", beat: 2, duration: 0.0625, velocity: 80 },
    { pitch: "F#2", beat: 2.25, duration: 0.0625, velocity: 55 },
    { pitch: "F#2", beat: 2.5, duration: 0.0625, velocity: 70 },
    { pitch: "F#2", beat: 2.75, duration: 0.0625, velocity: 50 },
    { pitch: "F#2", beat: 3, duration: 0.0625, velocity: 80 },
    { pitch: "F#2", beat: 3.25, duration: 0.0625, velocity: 55 },
    { pitch: "F#2", beat: 3.5, duration: 0.0625, velocity: 70 },
    { pitch: "F#2", beat: 3.75, duration: 0.0625, velocity: 50 }
  ]
};

const NAMED_PATTERNS: Record<string, Array<{ pitch: string; beat: number; duration: number; velocity: number }>> = {
  ...PERCUSSION_PATTERNS,
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

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALE_INTERVALS: Record<string, number[]> = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues:            [0, 3, 5, 6, 7, 10]
};

const CHORD_INTERVALS: Record<string, number[]> = {
  major:  [0, 4, 7],
  minor:  [0, 3, 7],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  dom7:   [0, 4, 7, 10],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8]
};

function noteNameToIndex(root: string): number {
  const flat: Record<string, string> = { Db: "C#", Eb: "D#", Fb: "E", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B" };
  const r = flat[root] ?? root;
  return NOTE_NAMES.indexOf(r.toUpperCase().replace(/^([a-g])/, (c) => c.toUpperCase()));
}

function buildNoteList(root: string, intervals: number[]): string[] {
  const rootIdx = noteNameToIndex(root);
  if (rootIdx === -1) return [];
  return intervals.map((i) => NOTE_NAMES[(rootIdx + i) % 12]);
}

function buildChordPitches(root: string, intervals: number[], octave: number): string[] {
  const rootIdx = noteNameToIndex(root);
  if (rootIdx === -1) return [];
  return intervals.map((i) => {
    const noteIdx = (rootIdx + i) % 12;
    const octaveOffset = Math.floor((rootIdx + i) / 12);
    return `${NOTE_NAMES[noteIdx]}${octave + octaveOffset}`;
  });
}

function detectKey(notes: Array<{ pitch: string }>): { root: string; scale: string; matchPct: number } {
  let bestRoot = "C";
  let bestScale = "major";
  let bestCount = -1;

  const pitchClasses = new Set(
    notes.map((n) => {
      const m = n.pitch.match(/^([A-Ga-g][#b]?)/);
      return m ? m[1].toUpperCase() : "";
    }).filter(Boolean)
  );

  for (const scale of ["major", "minor"] as const) {
    for (const root of NOTE_NAMES) {
      const scaleNotes = new Set(buildNoteList(root, SCALE_INTERVALS[scale]));
      let count = 0;
      for (const pc of pitchClasses) {
        if (scaleNotes.has(pc)) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestRoot = root;
        bestScale = scale;
      }
    }
  }

  const scaleNotes = new Set(buildNoteList(bestRoot, SCALE_INTERVALS[bestScale]));
  const total = notes.length;
  const inKey = notes.filter((n) => {
    const m = n.pitch.match(/^([A-Ga-g][#b]?)/);
    return m ? scaleNotes.has(m[1].toUpperCase()) : false;
  }).length;

  return { root: bestRoot, scale: bestScale, matchPct: total > 0 ? Math.round((inKey / total) * 100) : 100 };
}

const STYLE_TEMPLATES: Record<string, object> = {
  modern_pop: {
    bpm_range: [100, 120],
    key_suggestion: "A minor or C major",
    chord_progression: "Am - F - C - G  (i-VI-III-VII) or C - G - Am - F (I-V-vi-IV)",
    structure: [
      { section: "Intro",    bars: "1-4",   energy: "low",    notes: "Piano or pad only. No drums." },
      { section: "Verse 1",  bars: "5-12",  energy: "medium", notes: "Add bass + melody. Light hihat only." },
      { section: "Chorus",   bars: "13-20", energy: "high",   notes: "Full drums (kick+snare+hihat), full harmony, melody at highest pitch." },
      { section: "Verse 2",  bars: "21-28", energy: "medium", notes: "Same as verse 1 but add a counter-melody or harmony." },
      { section: "Chorus",   bars: "29-36", energy: "high",   notes: "Repeat chorus. Add clap or extra percussion layer." },
      { section: "Outro",    bars: "37-40", energy: "low",    notes: "Strip back to piano or pad. Mirror intro." }
    ],
    instrumentation: { melody: "piano or electric_piano", harmony: "strings or pad", bass: "bass", drums: "kick + snare + hihat" },
    effects: "Reverb on strings (0.5). Delay on melody (time=0.375, feedback=0.35). Overdrive on bass (mix=0.3)."
  },
  edm: {
    bpm_range: [124, 130],
    key_suggestion: "F minor or A minor",
    chord_progression: "Fm - Db - Ab - Eb  (i-VI-III-VII)",
    structure: [
      { section: "Intro",    bars: "1-8",   energy: "low",    notes: "Pad + bass only. Build tension." },
      { section: "Build",    bars: "9-16",  energy: "medium", notes: "Add hihat + snare rolls. Synth lead teaser." },
      { section: "Drop",     bars: "17-32", energy: "peak",   notes: "four_on_floor kick, snare on 2+4, hihat, full bass, synth_lead with delay." },
      { section: "Break",    bars: "33-40", energy: "low",    notes: "Pad only. Silence before second drop." },
      { section: "Drop 2",   bars: "41-56", energy: "peak",   notes: "Same as first drop. Add extra percussion layer." },
      { section: "Outro",    bars: "57-64", energy: "low",    notes: "Fade pad and bass." }
    ],
    instrumentation: { melody: "synth_lead", harmony: "pad", bass: "bass", drums: "four_on_floor kick + snare + hihat" },
    effects: "Delay on synth_lead (time=0.375, feedback=0.45, mix=0.4). Heavy reverb on pad (0.7). Overdrive on bass (mix=0.4)."
  },
  lofi_hiphop: {
    bpm_range: [75, 90],
    key_suggestion: "C minor or D minor",
    chord_progression: "Cm - Ab - Eb - Bb  (i-VI-III-VII)",
    structure: [
      { section: "Intro",   bars: "1-4",   energy: "low",    notes: "Electric piano + bass only." },
      { section: "Main",    bars: "5-20",  energy: "medium", notes: "Add kick + snare + trap_hihat + pluck melody." },
      { section: "Break",   bars: "21-24", energy: "low",    notes: "Electric piano solo. No drums." },
      { section: "Main 2",  bars: "25-36", energy: "medium", notes: "Full arrangement returns." },
      { section: "Outro",   bars: "37-40", energy: "low",    notes: "Electric piano fades." }
    ],
    instrumentation: { melody: "pluck", harmony: "electric_piano", bass: "bass", drums: "kick + snare + trap_hihat" },
    effects: "Tremolo on electric_piano (rate=5, depth=0.3). Bitcrush on electric_piano (drive=0.3, mix=0.35). Saturation on bass (mix=0.3)."
  },
  ballad: {
    bpm_range: [65, 85],
    key_suggestion: "D major or B minor",
    chord_progression: "D - A - Bm - G  (I-V-vi-IV)",
    structure: [
      { section: "Intro",   bars: "1-4",   energy: "low",    notes: "Piano only." },
      { section: "Verse",   bars: "5-16",  energy: "low",    notes: "Piano + strings. No drums." },
      { section: "Chorus",  bars: "17-24", energy: "medium", notes: "Add bass. Strings swell. Melody at highest." },
      { section: "Verse 2", bars: "25-32", energy: "low",    notes: "Piano + strings. Add subtle bass." },
      { section: "Chorus",  bars: "33-40", energy: "high",   notes: "Full strings + bass. Most emotional moment." },
      { section: "Outro",   bars: "41-44", energy: "low",    notes: "Piano alone. Resolve to tonic." }
    ],
    instrumentation: { melody: "piano", harmony: "strings", bass: "bass", drums: "none or very soft snare" },
    effects: "Heavy reverb on strings (0.65). Light reverb on piano (0.3). No distortion."
  },
  rnb: {
    bpm_range: [85, 100],
    key_suggestion: "E minor or G major",
    chord_progression: "Em - C - G - D  (vi-IV-I-V)",
    structure: [
      { section: "Intro",   bars: "1-4",   energy: "low",    notes: "Electric piano + bass." },
      { section: "Verse",   bars: "5-16",  energy: "medium", notes: "Add kick + snare. Electric piano chords. Pluck melody." },
      { section: "Chorus",  bars: "17-24", energy: "high",   notes: "Full arrangement. Strings swell. Melody peaks." },
      { section: "Bridge",  bars: "25-28", energy: "medium", notes: "Chord change. Sparse texture." },
      { section: "Chorus",  bars: "29-36", energy: "high",   notes: "Final chorus. Add clap." },
      { section: "Outro",   bars: "37-40", energy: "low",    notes: "Electric piano alone." }
    ],
    instrumentation: { melody: "pluck or synth_lead", harmony: "electric_piano + strings", bass: "bass", drums: "kick + snare + hihat" },
    effects: "Tremolo on electric_piano (rate=5, depth=0.2). Reverb on strings (0.45). Overdrive on bass (mix=0.25)."
  },
  bedroom_pop: {
    bpm_range: [70, 88],
    key_suggestion: "A minor or C major",
    chord_progression: "Am - F - C - G",
    structure: [
      { section: "Intro",   bars: "1-4",   energy: "low",    notes: "Piano or electric_piano only." },
      { section: "Verse",   bars: "5-16",  energy: "low",    notes: "Add bass. Sparse kick (no hihat). Keep it minimal." },
      { section: "Chorus",  bars: "17-24", energy: "medium", notes: "Add snare. Maybe one extra instrument. Still sparse." },
      { section: "Verse 2", bars: "25-32", energy: "low",    notes: "Same as verse 1." },
      { section: "Chorus",  bars: "33-40", energy: "medium", notes: "Repeat chorus." },
      { section: "Outro",   bars: "41-44", energy: "low",    notes: "Piano alone." }
    ],
    instrumentation: { melody: "piano or electric_piano", harmony: "pad (very quiet)", bass: "bass", drums: "sparse kick + snare only" },
    effects: "Overdrive on bass (drive=0.5, mix=0.4). Light reverb on piano (0.25). No hihat."
  },
  acoustic: {
    bpm_range: [90, 115],
    key_suggestion: "G major or D major",
    chord_progression: "G - D - Em - C  (I-V-vi-IV)",
    structure: [
      { section: "Intro",   bars: "1-4",   energy: "low",    notes: "Guitar fingerpicking alone." },
      { section: "Verse",   bars: "5-16",  energy: "medium", notes: "Guitar + bass. Strings enter quietly." },
      { section: "Chorus",  bars: "17-24", energy: "high",   notes: "Full guitar strumming + bass + strings. Melody peaks." },
      { section: "Verse 2", bars: "25-32", energy: "medium", notes: "Same as verse 1." },
      { section: "Chorus",  bars: "33-40", energy: "high",   notes: "Final chorus. Strings swell." },
      { section: "Outro",   bars: "41-44", energy: "low",    notes: "Guitar alone. Resolve." }
    ],
    instrumentation: { melody: "guitar", harmony: "strings", bass: "bass", drums: "none" },
    effects: "Reverb on strings (0.5). Light reverb on guitar (0.2). No distortion."
  }
};

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
      description: "Assign an instrument to a named track. Use 'variant' to pick a specific soundfont timbre within the instrument family — this is the primary way to get diverse sounds. Instruments and their variants:\n- piano: acoustic_grand_piano, bright_acoustic_piano, honkytonk_piano, electric_grand_piano\n- electric_piano: electric_piano_1, electric_piano_2, harpsichord, clavi\n- strings: string_ensemble_1, string_ensemble_2, synth_strings_1, synth_strings_2, violin, viola, cello\n- pad: pad_2_warm, pad_1_new_age, pad_3_polysynth, pad_4_choir, pad_5_bowed, pad_6_metallic, pad_7_halo, pad_8_sweep\n- bass: electric_bass_finger, electric_bass_pick, fretless_bass, slap_bass_1, acoustic_bass, synth_bass_1, synth_bass_2\n- guitar: acoustic_guitar_nylon, acoustic_guitar_steel, electric_guitar_jazz, electric_guitar_clean, electric_guitar_muted, overdriven_guitar, distortion_guitar\n- pluck: pizzicato_strings, harp, sitar, banjo, shamisen, koto\n- marimba: marimba, xylophone, vibraphone, glockenspiel, tubular_bells, dulcimer\n- organ: rock_organ, church_organ, reed_organ, accordion, harmonica, drawbar_organ\n- flute: flute, recorder, pan_flute, blown_bottle, shakuhachi, whistle, ocarina\n- bell: tubular_bells, music_box, steel_drums, tinkle_bell, agogo, woodblock\n- synth_lead: lead_2_sawtooth, lead_1_square, lead_3_calliope, lead_4_chiff, lead_5_charang, lead_6_voice, lead_7_fifths, lead_8_bass_lead",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name, e.g. 'melody', 'chords', 'bass'" },
          instrument: {
            type: "string",
            enum: ["piano", "electric_piano", "strings", "pad", "bass", "guitar", "pluck", "marimba", "organ", "flute", "bell", "synth_lead"],
            description: "Instrument family"
          },
          variant: {
            type: "string",
            enum: [
              "acoustic_grand_piano", "bright_acoustic_piano", "honkytonk_piano", "electric_grand_piano",
              "electric_piano_1", "electric_piano_2", "harpsichord", "clavi",
              "string_ensemble_1", "string_ensemble_2", "synth_strings_1", "synth_strings_2", "violin", "viola", "cello",
              "pad_2_warm", "pad_1_new_age", "pad_3_polysynth", "pad_4_choir", "pad_5_bowed", "pad_6_metallic", "pad_7_halo", "pad_8_sweep",
              "electric_bass_finger", "electric_bass_pick", "fretless_bass", "slap_bass_1", "acoustic_bass", "synth_bass_1", "synth_bass_2",
              "acoustic_guitar_nylon", "acoustic_guitar_steel", "electric_guitar_jazz", "electric_guitar_clean", "electric_guitar_muted", "overdriven_guitar", "distortion_guitar",
              "pizzicato_strings", "harp", "sitar", "banjo", "shamisen", "koto",
              "marimba", "xylophone", "vibraphone", "glockenspiel", "tubular_bells", "dulcimer",
              "rock_organ", "church_organ", "reed_organ", "accordion", "harmonica", "drawbar_organ",
              "flute", "recorder", "pan_flute", "blown_bottle", "shakuhachi", "whistle", "ocarina",
              "music_box", "steel_drums", "tinkle_bell", "agogo", "woodblock",
              "lead_2_sawtooth", "lead_1_square", "lead_3_calliope", "lead_4_chiff", "lead_5_charang", "lead_6_voice", "lead_7_fifths", "lead_8_bass_lead"
            ],
            description: "Required. Soundfont variant for this instrument. Must match the instrument family chosen above."
          }
        },
        required: ["track", "instrument", "variant"]
      },
      execute: ({ track, instrument, variant }) => {
        const trackName = normalizeTrackName(track);
        const inst = normalizeInstrument(instrument);
        const existing = state.tracks[trackName];
        state.tracks[trackName] = existing
          ? { ...existing, instrument: inst, variant: variant ? String(variant) : existing.variant }
          : buildDefaultTrack(inst);
        state.tracks[trackName].name = trackName;
        if (variant) state.tracks[trackName].variant = String(variant);
        onStateChanged();
        return { track: trackName, instrument: inst, variant: state.tracks[trackName].variant ?? null };
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
      name: "set_distortion",
      description: "Apply distortion/saturation to a track. type: overdrive=warm soft-clip (good for bass, leads), saturation=subtle tube warmth (any instrument), hard_clip=aggressive bright crunch (leads, synths), fuzz=extreme broken noise (leads, pads for texture), bitcrush=lo-fi digital degradation (retro, lofi). drive: 0.0-1.0 (intensity). mix: 0.0-1.0 dry/wet blend — use 0.3-0.5 for bass to preserve fundamentals, 0.7-1.0 for leads. output_gain: 0.0-2.0 to compensate for volume increase from distortion (typically 0.6-0.9). Set mix to 0 to remove distortion.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          type: { type: "string", enum: ["overdrive", "saturation", "hard_clip", "fuzz", "bitcrush"], description: "Distortion algorithm" },
          drive: { type: "number", description: "Drive intensity 0.0-1.0" },
          mix: { type: "number", description: "Dry/wet blend 0.0-1.0" },
          output_gain: { type: "number", description: "Output gain 0.0-2.0 to compensate for volume increase" }
        },
        required: ["track", "type", "drive", "mix"]
      },
      execute: ({ track, type, drive, mix, output_gain }) => {
        const trackName = normalizeTrackName(track);
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        const validTypes: DistortionType[] = ["overdrive", "saturation", "hard_clip", "fuzz", "bitcrush"];
        const distType = validTypes.includes(String(type) as DistortionType) ? String(type) as DistortionType : "overdrive";
        const params: DistortionParams = {
          type: distType,
          drive: Math.max(0, Math.min(1, Number(drive) || 0.5)),
          mix: Math.max(0, Math.min(1, Number(mix) || 0.5)),
          outputGain: Math.max(0, Math.min(2, Number(output_gain) || 0.8))
        };
        if (params.mix === 0) {
          delete state.tracks[trackName].distortion;
        } else {
          state.tracks[trackName].distortion = params;
        }
        onStateChanged();
        return { track: trackName, distortion: state.tracks[trackName].distortion ?? null };
      }
    },

    {
      name: "set_delay",
      description: "Add a delay/echo effect to a track. Essential for leads, plucks, and EDM sounds. time: delay time in seconds (0.1-1.0; tip: 0.375s = dotted eighth at 120bpm, 0.25s = eighth note at 120bpm). feedback: 0.0-0.8 (number of repeats — keep under 0.6 for clean results). mix: 0.0-1.0 dry/wet (0.2-0.4 for subtle echo, 0.5-0.7 for prominent delay). Set mix to 0 to remove delay.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          time: { type: "number", description: "Delay time in seconds (0.1-1.0)" },
          feedback: { type: "number", description: "Feedback amount 0.0-0.8" },
          mix: { type: "number", description: "Dry/wet blend 0.0-1.0. Set to 0 to remove delay." }
        },
        required: ["track", "time", "feedback", "mix"]
      },
      execute: ({ track, time, feedback, mix }) => {
        const trackName = normalizeTrackName(track);
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        const mixVal = Math.max(0, Math.min(1, Number(mix) || 0));
        if (mixVal === 0) {
          delete state.tracks[trackName].delayParams;
        } else {
          const params: DelayParams = {
            time: Math.max(0.01, Math.min(1.0, Number(time) || 0.375)),
            feedback: Math.max(0, Math.min(0.85, Number(feedback) || 0.4)),
            mix: mixVal
          };
          state.tracks[trackName].delayParams = params;
        }
        onStateChanged();
        return { track: trackName, delayParams: state.tracks[trackName].delayParams ?? null };
      }
    },

    {
      name: "set_lfo",
      description: "Add vibrato (pitch wobble) or tremolo (volume wobble) to a track. vibrato: LFO modulates pitch — good for strings, flute, synth leads. tremolo: LFO modulates volume — good for electric_piano (classic Rhodes effect), guitar, organ. rate: LFO speed in Hz (1-8 typical). depth: modulation intensity 0.0-1.0 (keep under 0.4 for subtle, 0.5-0.8 for pronounced). Set depth to 0 to remove LFO.",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          type: { type: "string", enum: ["vibrato", "tremolo"], description: "LFO type" },
          rate: { type: "number", description: "LFO rate in Hz (1-10)" },
          depth: { type: "number", description: "Modulation depth 0.0-1.0. Set to 0 to remove." }
        },
        required: ["track", "type", "rate", "depth"]
      },
      execute: ({ track, type, rate, depth }) => {
        const trackName = normalizeTrackName(track);
        if (!state.tracks[trackName]) {
          state.tracks[trackName] = buildDefaultTrack("piano");
          state.tracks[trackName].name = trackName;
        }
        const depthVal = Math.max(0, Math.min(1, Number(depth) || 0));
        if (depthVal === 0) {
          delete state.tracks[trackName].lfoParams;
        } else {
          const lfoType = String(type) === "tremolo" ? "tremolo" : "vibrato";
          const params: LfoParams = {
            type: lfoType,
            rate: Math.max(0.1, Math.min(20, Number(rate) || 5)),
            depth: depthVal
          };
          state.tracks[trackName].lfoParams = params;
        }
        onStateChanged();
        return { track: trackName, lfoParams: state.tracks[trackName].lfoParams ?? null };
      }
    },

    {
      name: "add_percussion_bar",
      description: "Add a full bar of percussion notes to a track in one call. Much more efficient than add_notes for drums. pattern: kick=beats 1+3, snare=beats 2+4, hihat=eighth notes, clap=beats 2+4, kick_snare=kick+snare together, four_on_floor=kick every beat (EDM), trap_hihat=16th note hi-hats (trap/hip-hop). bar: which bar to place it (1-indexed). bars: how many consecutive bars to fill (default 1). The track instrument should match the pattern (kick track uses kick pattern, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          track: { type: "string", description: "Track name" },
          pattern: { type: "string", enum: ["kick", "snare", "hihat", "clap", "kick_snare", "four_on_floor", "trap_hihat"], description: "Percussion pattern" },
          bar: { type: "number", description: "Starting bar number (1-indexed)" },
          bars: { type: "number", description: "Number of bars to fill (default 1)" }
        },
        required: ["track", "pattern", "bar"]
      },
      execute: ({ track, pattern, bar, bars }) => {
        const trackName = normalizeTrackName(track);
        const patternNotes = PERCUSSION_PATTERNS[String(pattern)];
        if (!patternNotes) return { error: `Unknown pattern: ${pattern}. Valid: ${Object.keys(PERCUSSION_PATTERNS).join(", ")}` };

        const beatsPerBar = state.timeSignatureNumerator || 4;
        const startBar = Math.max(1, Math.round(Number(bar) || 1));
        const numBars = Math.max(1, Math.round(Number(bars) || 1));

        if (!state.tracks[trackName]) {
          const instrMap: Record<string, InstrumentName> = {
            kick: "kick", snare: "snare", hihat: "hihat", clap: "clap",
            kick_snare: "kick", four_on_floor: "kick", trap_hihat: "hihat"
          };
          const instr = instrMap[String(pattern)] ?? "kick";
          state.tracks[trackName] = buildDefaultTrack(instr);
          state.tracks[trackName].name = trackName;
        }

        const addedNotes: MusicNote[] = [];
        for (let b = 0; b < numBars; b++) {
          const barOffset = (startBar - 1 + b) * beatsPerBar;
          for (const n of patternNotes) {
            const note: MusicNote = {
              id: generateNoteId(),
              track: trackName,
              pitch: n.pitch,
              beat: barOffset + n.beat,
              duration: n.duration,
              velocity: n.velocity,
              addedAt: Date.now()
            };
            state.notes.push(note);
            addedNotes.push(note);
          }
        }

        state.totalBeats = state.notes.reduce((max, n) => Math.max(max, n.beat + n.duration), 0);
        onStateChanged();
        if (addedNotes.length > 0) onNoteAdded(addedNotes[addedNotes.length - 1]);
        return { added: addedNotes.length, track: trackName, pattern, startBar, bars: numBars };
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
      name: "set_eq",
      description: "Set a high-pass and/or low-pass EQ filter on a track to reduce frequency masking. Use highpass on pad/strings (200Hz) to remove muddy low-end. Use lowpass on bass (500Hz) to keep it focused. Use highpass on hihat (6000Hz) for crispness.",
      inputSchema: {
        type: "object",
        properties: {
          track:       { type: "string", description: "Track name" },
          highpass_hz: { type: "number", description: "High-pass filter cutoff in Hz. Removes frequencies below this. E.g. 200 for pad/strings, 6000 for hihat." },
          lowpass_hz:  { type: "number", description: "Low-pass filter cutoff in Hz. Removes frequencies above this. E.g. 500 for bass." }
        },
        required: ["track"]
      },
      execute: ({ track, highpass_hz, lowpass_hz }) => {
        const trackName = normalizeTrackName(track);
        if (!state.tracks[trackName]) {
          return { error: `Track "${trackName}" not found.` };
        }
        const eq: EqParams = {};
        if (highpass_hz !== undefined && highpass_hz !== null) eq.highpassHz = Math.max(20, Number(highpass_hz));
        if (lowpass_hz !== undefined && lowpass_hz !== null) eq.lowpassHz = Math.min(20000, Number(lowpass_hz));
        state.tracks[trackName].eq = eq;
        onStateChanged();
        return { track: trackName, eq };
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
      name: "verify_composition",
      description: "Audit the composition before finishing. Returns a list of issues: empty tracks, tracks with very few notes, total bar count, and whether the piece feels complete. You MUST call this before outputting [DONE] and fix any issues it reports.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      },
      annotations: { readOnlyHint: true },
      execute: () => {
        const beatsPerBar = state.timeSignatureNumerator || 4;
        const totalBars = Math.ceil(state.totalBeats / beatsPerBar);
        const issues: string[] = [];
        const trackSummary: Array<{ track: string; instrument: string; noteCount: number; status: string }> = [];

        for (const [name, track] of Object.entries(state.tracks)) {
          const noteCount = state.notes.filter((n) => n.track === name).length;
          let status = "ok";
          if (noteCount === 0) {
            issues.push(`Track "${name}" (${track.instrument}) has NO notes — add notes or remove it.`);
            status = "EMPTY";
          } else if (noteCount < 4) {
            issues.push(`Track "${name}" (${track.instrument}) only has ${noteCount} note(s) — too sparse, add more.`);
            status = "sparse";
          }
          trackSummary.push({ track: name, instrument: track.instrument, noteCount, status });
        }

        if (totalBars < 8) {
          issues.push(`Only ${totalBars} bars — composition is too short. Aim for at least 16 bars.`);
        } else if (totalBars < 16) {
          issues.push(`${totalBars} bars — consider extending to 16+ bars for a complete piece.`);
        }

        if (Object.keys(state.tracks).length < 2) {
          issues.push("Only 1 track — add at least bass + melody + harmony for a full arrangement.");
        }

        const totalNotes = state.notes.length;
        if (totalNotes < 20) {
          issues.push(`Only ${totalNotes} total notes — the piece is too sparse. Add more notes.`);
        }

        const percussionInstruments = new Set(["kick", "snare", "hihat", "clap"]);
        const melodicNotes = state.notes.filter((n) => {
          const track = state.tracks[n.track];
          return track && !percussionInstruments.has(track.instrument);
        });

        let keyInfo: { root: string; scale: string; matchPct: number } | null = null;
        if (melodicNotes.length >= 8) {
          keyInfo = detectKey(melodicNotes);
          if (keyInfo.matchPct < 80) {
            issues.push(
              `Only ${keyInfo.matchPct}% of melodic notes are in the detected key (${keyInfo.root} ${keyInfo.scale}). ` +
              `Use get_scale_notes to check which notes belong to your key, then fix out-of-key notes.`
            );
          }
        }

        return {
          ready: issues.length === 0,
          totalBars,
          totalNotes,
          detectedKey: keyInfo ? `${keyInfo.root} ${keyInfo.scale} (${keyInfo.matchPct}% in-key)` : "not enough notes to detect",
          tracks: trackSummary,
          issues: issues.length > 0 ? issues : ["No issues — composition looks complete."]
        };
      }
    },

    {
      name: "get_scale_notes",
      description: "Returns the note names in a given scale. Use this before writing melody or harmony to ensure your notes are in-key.",
      inputSchema: {
        type: "object",
        properties: {
          root:  { type: "string", description: "Root note, e.g. 'A', 'C#', 'Bb'" },
          scale: {
            type: "string",
            enum: ["major", "minor", "dorian", "phrygian", "pentatonic_major", "pentatonic_minor", "blues"],
            description: "Scale type"
          }
        },
        required: ["root", "scale"]
      },
      annotations: { readOnlyHint: true },
      execute: ({ root, scale }) => {
        const rootStr = String(root || "C").trim();
        const scaleStr = String(scale || "major").toLowerCase();
        const intervals = SCALE_INTERVALS[scaleStr];
        if (!intervals) return { error: `Unknown scale: ${scaleStr}` };
        const notes = buildNoteList(rootStr, intervals);
        if (!notes.length) return { error: `Unknown root note: ${rootStr}` };
        const octave4 = notes.map((n, i) => {
          const rootIdx = noteNameToIndex(rootStr);
          const noteIdx = (rootIdx + intervals[i]) % 12;
          const octaveOffset = Math.floor((rootIdx + intervals[i]) / 12);
          return `${NOTE_NAMES[noteIdx]}${4 + octaveOffset}`;
        });
        return { root: rootStr, scale: scaleStr, notes, octave_example: octave4 };
      }
    },

    {
      name: "get_chord_notes",
      description: "Returns the exact pitches for a chord voicing. Use this to get correct note names before writing harmony or bass tracks.",
      inputSchema: {
        type: "object",
        properties: {
          root:       { type: "string", description: "Root note, e.g. 'A', 'C#', 'Bb'" },
          chord_type: {
            type: "string",
            enum: ["major", "minor", "maj7", "min7", "dom7", "sus2", "sus4", "dim", "aug"],
            description: "Chord type"
          },
          octave: { type: "integer", description: "Base octave for the chord, e.g. 3 or 4. Default 3." }
        },
        required: ["root", "chord_type"]
      },
      annotations: { readOnlyHint: true },
      execute: ({ root, chord_type, octave }) => {
        const rootStr = String(root || "C").trim();
        const chordStr = String(chord_type || "major").toLowerCase();
        const oct = Math.max(1, Math.min(6, Math.round(Number(octave) || 3)));
        const intervals = CHORD_INTERVALS[chordStr];
        if (!intervals) return { error: `Unknown chord type: ${chordStr}` };
        const pitches = buildChordPitches(rootStr, intervals, oct);
        if (!pitches.length) return { error: `Unknown root note: ${rootStr}` };
        return { root: rootStr, chord_type: chordStr, octave: oct, pitches, name: `${rootStr} ${chordStr}` };
      }
    },

    {
      name: "humanize_track",
      description: "Adds micro-timing and velocity variation to a track's notes to make them sound less robotic and more human. Call this on melody and bass tracks after adding notes.",
      inputSchema: {
        type: "object",
        properties: {
          track:           { type: "string", description: "Track name" },
          timing_amount:   { type: "number", description: "How much to vary note timing, 0.0–1.0. Default 0.3. Higher = more variation." },
          velocity_amount: { type: "number", description: "How much to vary note velocity, 0.0–1.0. Default 0.4. Higher = more variation." }
        },
        required: ["track"]
      },
      execute: ({ track, timing_amount, velocity_amount }) => {
        const trackName = normalizeTrackName(track);
        const timingAmt = Math.max(0, Math.min(1, Number(timing_amount ?? 0.3)));
        const velocityAmt = Math.max(0, Math.min(1, Number(velocity_amount ?? 0.4)));
        const trackNotes = state.notes.filter((n) => n.track === trackName);
        if (!trackNotes.length) return { error: `No notes found on track "${trackName}"` };

        for (const note of trackNotes) {
          const timingShift = (Math.random() - 0.5) * timingAmt * 0.12;
          note.beat = Math.max(0, Math.round((note.beat + timingShift) * 1000) / 1000);
          const velocityShift = (Math.random() - 0.5) * velocityAmt * 32;
          note.velocity = Math.max(40, Math.min(127, Math.round(note.velocity + velocityShift)));
        }

        onStateChanged();
        return { track: trackName, humanized: trackNotes.length, timing_amount: timingAmt, velocity_amount: velocityAmt };
      }
    },

    {
      name: "get_style_template",
      description: "Returns a detailed genre blueprint: BPM range, key suggestion, chord progression, song structure, instrumentation, and effects. Call this first when the user specifies a genre.",
      inputSchema: {
        type: "object",
        properties: {
          genre: {
            type: "string",
            enum: ["modern_pop", "edm", "lofi_hiphop", "ballad", "rnb", "bedroom_pop", "acoustic"],
            description: "Genre to get a template for"
          }
        },
        required: ["genre"]
      },
      annotations: { readOnlyHint: true },
      execute: ({ genre }) => {
        const key = String(genre || "modern_pop").toLowerCase();
        const template = STYLE_TEMPLATES[key];
        if (!template) return { error: `Unknown genre: ${key}. Available: ${Object.keys(STYLE_TEMPLATES).join(", ")}` };
        return { genre: key, ...template };
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
