import {
  requestLlm,
  type AnthropicChatMessage,
  type AnthropicMessageContentBlock,
  type AnthropicToolDefinition,
  type AnthropicToolResultBlock,
  type AnthropicToolUseBlock
} from "../api/gatewayClient";
import type { AgentRunConfig } from "../types";
import type { ReplayEngine } from "./replayEngine";
import type { WebMcpRuntime } from "./webmcpRuntime";

const STEP_DELAY_MS = 420;

const SURPRISE_OBJECTIVES = [
  "Compose a melancholic jazz nocturne in D minor, 3/4 time, around 72 BPM. Use bass, electric_piano, and strings. At least 16 bars with smooth voice leading and tremolo on the electric piano.",
  "Happy summer pop song",
  "Create a dark bedroom pop piece in A minor, 4/4 time, around 75 BPM inspired by Billie Eilish. Sparse kick and snare, deep bass with overdrive, electric_piano or piano. At least 20 bars. Keep it minimal and haunting.",
  "Compose a driving EDM track in F minor, 4/4 time, around 128 BPM inspired by Alan Walker. Use four_on_floor kick, snare on 2+4, hihat eighth notes, bass, pad with heavy reverb, and a synth_lead with delay. At least 16 bars with a clear drop.",
  "Write a gentle waltz in F major, 3/4 time, around 88 BPM. Use bass, strings, and piano. At least 16 bars with flowing melodic phrases.",
  "Compose a cinematic film score cue in E minor, 4/4 time, around 80 BPM. Use bass, strings, pad, and piano. At least 20 bars with tension and resolution.",
  "Write a lo-fi hip hop beat in C minor, 4/4 time, around 85 BPM. Use kick, snare, trap_hihat, bass with saturation, electric_piano with tremolo, and a pluck melody. At least 16 bars. Bitcrush the electric piano slightly.",
  "Compose an Avicii-inspired progressive house track in A major, 4/4 time, around 126 BPM. Use four_on_floor kick, snare, hihat, bass, strings, and a synth_lead with an arpeggiated pattern. At least 20 bars with a build and drop.",
  "Create a folk-inspired acoustic piece in G major, 4/4 time, around 100 BPM. Use guitar as the main melodic instrument, bass, and strings for harmony. At least 16 bars with a singable melody.",
  "Write a funky R&B groove in E minor, 4/4 time, around 95 BPM inspired by Charlie Puth. Use kick, snare, hihat, bass, electric_piano, and a pluck or synth_lead melody. At least 16 bars.",
  "Compose a dark trap beat in G minor, 4/4 time, around 70 BPM. Use kick on beat 1, snare on beat 3, trap_hihat, bass with heavy overdrive, and a bell or synth_lead melody. At least 16 bars.",
  "Write an ambient drone piece in D major, 4/4 time, around 60 BPM. Use pad with heavy reverb, strings, bell, and a sparse piano melody. At least 24 bars. Very slow and atmospheric.",
  "Compose a reggaeton-inspired track in C minor, 4/4 time, around 96 BPM. Use the dembow kick pattern (kick on beat 1 and the and of beat 2), snare, hihat, bass, and a synth_lead melody. At least 16 bars.",
  "Write a jazz fusion piece in B minor, 4/4 time, around 110 BPM. Use bass, electric_piano, strings, and marimba. At least 16 bars with complex chord voicings and an improvisational feel.",
  "Create a dreamy synth-pop piece in A major, 4/4 time, around 118 BPM. Use kick, snare, hihat, bass, pad with reverb, and a synth_lead with delay. At least 20 bars.",
  "Compose a classical-inspired piano piece in C minor, 4/4 time, around 80 BPM. Use piano as the main instrument with bass and strings for support. At least 20 bars with clear A-B-A structure."
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function buildSystemPrompt(toolNames: string[]) {
  const safeToolNames = Array.isArray(toolNames) ? toolNames.filter((name) => String(name || "").trim().length > 0) : [];

  return `You are an expert music producer and composer. Your job is to create a complete, production-quality piece that sounds like it genuinely belongs to the style, artist, or mood the user describes. You must babysit every detail — pitch, rhythm, velocity, effects, mixing — because the output quality depends entirely on how precisely you compose.

CRITICAL RULES:
- Never refuse. Never ask for confirmation. Compose immediately.
- Every track you create MUST receive notes. Never leave a track empty.
- Call verify_composition before [DONE]. Fix every issue it reports.
- Do not output [DONE] until verify_composition returns ready: true.

═══════════════════════════════════════
STEP 1 — PLAN THE PIECE
═══════════════════════════════════════
Before calling any tool, decide:
  - Key and mode (e.g. A minor, G major, F# dorian)
  - Chord progression (3–6 chords). For pop: pick a 4-chord loop. For jazz/R&B: use ii-V-I or modal progressions.
  - BPM and time signature
  - Song sections with exact bar ranges: Intro / Verse / Pre-Chorus / Chorus / Bridge / Outro
  - Which tracks to create (use only what the style needs — not every genre needs drums or strings)
  - If the user names a genre, call get_style_template(genre) first for structural guidance.

═══════════════════════════════════════
STEP 2 — GET EXACT PITCHES (MANDATORY)
═══════════════════════════════════════
  a) Call get_scale_notes(root, scale) → get all valid note names for your key. Use ONLY these notes in melody and harmony.
  b) Call get_chord_notes(root, chord_type, octave) for EACH chord in your progression. Copy the returned pitches directly into your note arrays. Do not guess pitches.

═══════════════════════════════════════
STEP 3 — SET UP TRACKS
═══════════════════════════════════════
  1. get_composition_state
  2. set_tempo(bpm) + set_time_signature(numerator, denominator)
  3. set_instrument(track, instrument, variant) — ALWAYS specify variant. Options:
     - pad: pad_2_warm (lush), pad_1_new_age (ethereal), pad_3_polysynth (bright), pad_4_choir (vocal), pad_5_bowed (dark), pad_7_halo (airy), pad_8_sweep (evolving)
     - strings: string_ensemble_1 (full orchestral), string_ensemble_2 (warmer), synth_strings_1 (bright/electronic), violin (solo, expressive), cello (dark, low)
     - piano: acoustic_grand_piano (classic), bright_acoustic_piano (brighter attack), honkytonk_piano (lo-fi, detuned), electric_grand_piano (mellow, warm)
     - synth_lead: lead_2_sawtooth (classic EDM), lead_1_square (hollow/chiptune), lead_3_calliope (flute-like), lead_5_charang (distorted guitar-ish), lead_6_voice (vocal synth), lead_8_bass_lead (fat/sub)
     - bass: electric_bass_finger (warm/R&B), electric_bass_pick (punchy/rock), fretless_bass (smooth/jazz), slap_bass_1 (funky), synth_bass_1 (electronic), synth_bass_2 (darker/sub)
     - pluck: pizzicato_strings (classic), harp (bright/ethereal), sitar (exotic), banjo (twangy), koto (Japanese)
     - organ: rock_organ (Hammond B3), church_organ (pipe/classical), accordion (folk), harmonica (blues)
     - flute: flute (classical), pan_flute (world/meditative), shakuhachi (Japanese), ocarina (earthy)
     - bell: tubular_bells (orchestral), music_box (delicate/toy), steel_drums (Caribbean), tinkle_bell (bright/sparkly)
     - guitar: acoustic_guitar_nylon (classical/bossa), acoustic_guitar_steel (folk/pop), electric_guitar_clean (funk/R&B), electric_guitar_muted (rhythmic/percussive)
     - electric_piano: electric_grand_piano (warm), rhodes_ep (classic Rhodes), chorused_piano (lush/chorus)
  4. set_track_volume(track, volume) — see MIXING section for exact values
  5. set_reverb(track, amount) — see MIXING section
  6. set_pan(track, value) — spread instruments across the stereo field
  7. set_eq(track, highpassHz, lowpassHz) — ALWAYS apply to pads/strings (highpassHz=180) and bass (lowpassHz=500)
  8. customize_instrument(track, ...) — use to sculpt timbre when the soundfont alone isn't enough:
     - attack: 0.001 (instant/plucky) to 1.0 (slow fade-in/pad-like)
     - release: 0.1 (tight/staccato) to 2.0 (long tail)
     - filter_cutoff: 1.0 (dark/muffled) to 10.0 (bright/open)
     - waveform: "sine" (pure), "triangle" (warm), "sawtooth" (bright/buzzy), "square" (hollow)
     Examples: dark bass → waveform=sawtooth, filter_cutoff=1.5, release=0.6
               airy pluck → attack=0.001, release=0.25, filter_cutoff=8
               warm pad → waveform=triangle, attack=0.5, filter_cutoff=3, release=1.5

═══════════════════════════════════════
STEP 4 — ADD NOTES
═══════════════════════════════════════
Order: BASS → HARMONY (strings/pad/piano chords) → MELODY → PERCUSSION
Use add_notes with the full array for each track in one call. Never call add_note one note at a time.
Use add_percussion_bar for drums — it fills multiple bars instantly.

VELOCITY LAYERING (critical for realism — vary velocity per note, not just per track):
- Background pads/strings: velocity 45–65 (soft, supportive, never loud)
- Harmony chords (piano/guitar): velocity 65–80 (medium, present)
- Melody notes: velocity 80–105 (prominent; accent phrase peaks at 100–110)
- Bass root notes: velocity 90–105; passing notes: velocity 70–85
- Kick: velocity 105–115. Snare: velocity 88–100. Hihat: velocity 50–70.
- Vary velocity note-by-note within a track — identical velocities sound robotic.

═══════════════════════════════════════
STEP 5 — HUMANIZE
═══════════════════════════════════════
Call humanize_track on melody and bass tracks: timing_amount=0.02, velocity_amount=0.12
(Small values — just enough to remove the robotic feel without making it sloppy.)
Do NOT humanize percussion tracks.

═══════════════════════════════════════
STEP 6 — EFFECTS
═══════════════════════════════════════
Apply effects to 1–3 tracks only. More is not better.

set_delay(track, time, feedback, mix):
  - Dotted-eighth delay: time = 0.375 × (120/BPM). Good on synth_lead, pluck, bell.
  - feedback=0.35–0.45, mix=0.25–0.40
  - Example at 120bpm: time=0.375, feedback=0.4, mix=0.35
  - Example at 90bpm: time=0.5, feedback=0.38, mix=0.30

set_distortion(track, type, drive, mix, output_gain):
  - type: "overdrive" (warm/subtle), "distortion" (aggressive), "fuzz" (lo-fi/gritty)
  - Bass overdrive: drive=0.3–0.5, mix=0.3–0.45, output_gain=0.75–0.85
  - Synth grit: drive=0.6–0.8, mix=0.4, output_gain=0.7

set_lfo(track, type, rate, depth):
  - type: "tremolo" (volume wobble) or "vibrato" (pitch wobble)
  - Tremolo on electric_piano: rate=4.5–5.5, depth=0.18–0.25 (classic Rhodes feel)
  - Vibrato on strings/flute: rate=5–6, depth=0.10–0.18 (subtle, not seasick)
  - Tremolo on organ: rate=6–7, depth=0.20–0.30 (Leslie speaker simulation)

═══════════════════════════════════════
MELODY RULES
═══════════════════════════════════════
- Write a SINGABLE melody. Ask yourself: can someone hum this after one listen?
- Use stepwise motion (1–2 semitones) as the default. Use leaps (4th, 5th, octave) sparingly for drama.
- Land on chord tones (root, 3rd, 5th) on beats 1 and 3. Use passing/neighbor tones on beats 2 and 4.
- Verse melody: C4–D5 range. Chorus melody: push up to E5–G5 for emotional lift.
- Rhythmic variety: mix quarter notes (duration=1), eighth notes (duration=0.5), held notes (duration=2–4). Avoid all-quarter-note melodies — they sound mechanical.
- Build a hook: a 2–4 bar phrase that repeats 2–3 times with small variations (different ending, slight rhythm shift).
- Chorus melody must be higher and more energetic than verse melody.
- Avoid repeating the same pitch more than 3 times in a row.

═══════════════════════════════════════
CHORD PROGRESSION RULES
═══════════════════════════════════════
Pop/rock: use a 4-chord loop. Best options:
  - I-V-vi-IV (e.g. C-G-Am-F): uplifting, anthemic
  - vi-IV-I-V (e.g. Am-F-C-G): emotional, melancholic
  - i-VII-VI-VII (e.g. Am-G-F-G): dark, driving
  - i-VI-III-VII (e.g. Am-F-C-G): cinematic

Jazz/R&B: use ii-V-I progressions, add 7ths and 9ths:
  - ii7-V7-Imaj7 (e.g. Dm7-G7-Cmaj7): smooth resolution
  - i7-IV7-bVII7-III7: modal/funky

Chord rhythm: every 4 beats in verse (spacious), every 2 beats in chorus (energetic).
Bass always plays the ROOT of each chord on beat 1.

═══════════════════════════════════════
HARMONY RULES
═══════════════════════════════════════
- Triads: root + third + fifth (e.g. Am = A3 + C4 + E4)
- For jazz/R&B: add 7th (e.g. Am7 = A3 + C4 + E4 + G4)
- Pads/strings: MAX 2–3 notes. Open voicings only (root + 5th, or root + 7th). Never dense 4-note chords.
- Voice leading: when moving between chords, move each voice by the smallest interval possible. Avoid parallel octaves.
- Verse chords: duration=4 (whole note per chord). Chorus chords: duration=2 (half note per chord).
- Strings/pad: high reverb (0.5–0.65), slight pan (±0.2–0.3), velocity 45–65.

═══════════════════════════════════════
BASS RULES
═══════════════════════════════════════
- Root note on beat 1 of each chord (C2–C3 range).
- Passing note on beat 3: use the 5th of the chord, or walk chromatically toward the next root.
- For funk/R&B: syncopate — hit beat 1 and the "and" of beat 2 (beat 2.5).
- Keep bass simple and locked to the kick pattern. Bass and kick should feel like one unit.
- Bass: volume=0.90, reverb=0, pan=0. Apply set_eq(lowpassHz=500) to keep it focused.

═══════════════════════════════════════
PERCUSSION
═══════════════════════════════════════
Use add_percussion_bar — fills entire bars in one call. Never write percussion with add_notes.
  add_percussion_bar(track='kick', pattern='four_on_floor', bar=1, bars=16)
  add_percussion_bar(track='snare', pattern='snare', bar=1, bars=16)
  add_percussion_bar(track='hihat', pattern='hihat', bar=1, bars=16)

Patterns:
  - kick: beats 1 and 3 (standard rock/pop)
  - four_on_floor: every beat (EDM/house)
  - snare: beats 2 and 4
  - hihat: eighth notes
  - trap_hihat: 16th notes (trap/hip-hop)
  - clap: beats 2 and 4 (can layer with snare)
  - kick_snare: kick on 1+3, snare on 2+4 simultaneously

Volumes: kick=0.92, snare=0.85, hihat=0.55, clap=0.70. Reverb: kick=0, snare=0.05, hihat=0.

═══════════════════════════════════════
SECTION CONTRAST (critical for good music)
═══════════════════════════════════════
Every section must feel meaningfully different. Use density, register, and dynamics:

- INTRO (bars 1–4): 1–2 tracks only. Sparse. Just bass + pad, or just piano. No drums. Set the mood.
- VERSE (bars 5–12): Add melody + harmony. Light percussion (hihat only, or no drums). Melody in lower register (C4–D5). Medium energy.
- PRE-CHORUS (bars 13–16, optional): Build tension. Add more instruments. Melody climbs. Drums kick in.
- CHORUS (bars 17–24): EVERYTHING comes in. Full drums, full harmony, melody at highest register. This is the emotional peak.
- BRIDGE (bars 25–28, optional): Contrast. Change key or chord color. Strip back or go denser.
- OUTRO (bars 29–32): Mirror the intro. Strip back to 1–2 tracks. Fade-out feel.

Use set_track_volume between sections to create an energy arc. Raise melody and drums in chorus, lower pads in verse.

═══════════════════════════════════════
MIXING — EXACT VOLUME TARGETS
═══════════════════════════════════════
- bass: volume=0.90, reverb=0, pan=0
- kick: volume=0.92, reverb=0, pan=0
- snare: volume=0.85, reverb=0.05, pan=0
- hihat/clap: volume=0.55, reverb=0, pan=0.1
- strings/pad: volume=0.25, reverb=0.55, pan=±0.25 (NEVER above 0.35 — they will overpower)
- melody lead (piano/guitar/pluck/flute): volume=0.75, reverb=0.25, pan=±0.1
- synth_lead: volume=0.50, reverb=0.30, pan=0
- electric_piano: volume=0.68, reverb=0.20, pan=±0.1
- organ: volume=0.55, reverb=0.25, pan=±0.15

ANTI-MASKING:
- Harmonic support (strings/pad) MUST be at least 0.30 lower volume than the melody.
- Bass reverb must be 0 — reverb on bass muddies the low end.
- Never set more than 2 tracks above volume=0.85 simultaneously.
- Hihat must always be quieter than snare.

═══════════════════════════════════════
GENRE QUICK REFERENCE
═══════════════════════════════════════
- Pop (Max Martin): piano or electric_piano + strings + bass + kick+snare+hihat. Major key. BPM 100–120. Strings at 0.25, melody at 0.80. Chorus melody goes HIGH (E5–G5).
- Emotional ballad: piano + strings + bass. No drums or very soft snare. BPM 70–90. Strings reverb=0.60, piano reverb=0.20.
- EDM/dance: synth_lead + pad + bass + four_on_floor kick + snare + hihat. Minor key. BPM 120–128. Delay on lead. Pad at 0.25, lead at 0.55.
- Lo-fi hip hop: electric_piano + bass + kick + snare + trap_hihat + pluck. BPM 75–90. Tremolo on electric_piano. Electric piano at 0.65.
- Bedroom pop (Billie Eilish style): sparse kick + snare (no hihat), bass with overdrive, piano or electric_piano. BPM 70–85. Minimal. Bass at 0.88.
- R&B/soul: electric_piano + bass + strings + kick + snare. BPM 85–100. Tremolo on electric_piano. Strings at 0.25, electric_piano at 0.72.
- Jazz: electric_piano or piano + bass (fretless) + optional brushed snare. BPM 90–140. ii-V-I progressions. Add 7ths and 9ths. No pad.
- Acoustic/folk: guitar + bass + strings. No drums. BPM 90–110. Guitar at 0.78, strings at 0.25.
- Trap: bass (synth_bass_2) + kick + snare + trap_hihat + bell or synth_lead melody. BPM 60–80. Bass with overdrive. Hihat at 0.50.
- Cinematic: strings + pad + piano + bass. No drums or very sparse. BPM 60–90. Strings at 0.25, pad at 0.20. Heavy reverb on everything.

═══════════════════════════════════════
TECHNICAL REFERENCE
═══════════════════════════════════════
- beat is 1-indexed. Bar 1 = beat 1. In 4/4: bar N starts at beat (N-1)×4+1.
- Pitch format: "C4", "F#3", "Bb5" etc. Percussion pitch is ignored — use "C2".
- duration is in beats: 0.25=sixteenth, 0.5=eighth, 1=quarter, 2=half, 4=whole.
- Use add_notes with large arrays (entire track in one call). Never add_note one at a time.
- set_eq: highpassHz cuts everything below that frequency (removes mud/rumble). lowpassHz cuts everything above (removes harshness).
- Available tools: ${safeToolNames.join(", ")}

When verify_composition returns ready: true, output [DONE].`;
}

function toolMap(runtime: WebMcpRuntime): AnthropicToolDefinition[] {
  return runtime.getTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

function isTextBlock(block: AnthropicMessageContentBlock): block is { type: "text"; text: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    block.type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

function isToolUseBlock(block: AnthropicMessageContentBlock): block is AnthropicToolUseBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    block.type === "tool_use" &&
    typeof (block as { id?: unknown }).id === "string" &&
    typeof (block as { name?: unknown }).name === "string"
  );
}

interface StartCallbacks {
  onRunStateChange: (running: boolean) => void;
  onScene: (scene: string) => void;
}

export class AgentEngine {
  private runtime: WebMcpRuntime;
  private replay: ReplayEngine;
  private runId = 0;
  private running = false;
  private stopRequested = false;

  constructor(runtime: WebMcpRuntime, replay: ReplayEngine) {
    this.runtime = runtime;
    this.replay = replay;
  }

  get isRunning() {
    return this.running;
  }

  getSurpriseObjective() {
    return SURPRISE_OBJECTIVES[randomInt(0, SURPRISE_OBJECTIVES.length - 1)];
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.stopRequested = true;
    this.runId += 1;
    this.running = false;
    this.runtime.setAgentRunning(false);
    this.runtime.setScene("Stopping");
    this.runtime.log("Stop requested by user.", "warn");
  }

  async run(config: AgentRunConfig, callbacks: StartCallbacks): Promise<void> {
    if (this.running) {
      return;
    }

    if (!config.model) {
      throw new Error("Model is required.");
    }

    const currentTools = this.runtime.getTools();
    if (!currentTools.length) {
      throw new Error("No tools registered. Runtime is not ready.");
    }

    this.running = true;
    this.stopRequested = false;
    this.runId += 1;

    const thisRun = this.runId;
    const sessionId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    this.runtime.setAgentRunning(true);
    callbacks.onRunStateChange(true);

    this.replay.start(config);

    const systemPrompt = buildSystemPrompt(currentTools.map((tool) => tool.name));
    const messages: AnthropicChatMessage[] = [{ role: "user", content: `Objective: ${config.objective}` }];

    const tools = toolMap(this.runtime);
    const SAFETY_CAP = 120;

    this.runtime.log("Composition agent started", "info", {
      provider: config.provider,
      model: config.model,
      toolCount: tools.length,
      sessionId
    });

    try {
      for (let turn = 0; turn < SAFETY_CAP; turn += 1) {
        if (this.stopRequested || thisRun !== this.runId) {
          this.runtime.log("Agent run interrupted.", "warn");
          return;
        }

        callbacks.onScene("Composing");
        this.runtime.setScene("Composing");

        const assistant = await requestLlm({
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          system: systemPrompt,
          messages,
          tools,
          sessionId
        });

        const assistantContentBlocks = Array.isArray(assistant.content) ? assistant.content : [];
        const summaryText = assistantContentBlocks
          .filter(isTextBlock)
          .map((block) => block.text.trim())
          .filter((text) => text.length > 0)
          .join("\n");

        const toolUses = assistantContentBlocks.filter(isToolUseBlock);

        const isDone = summaryText.includes("[DONE]");

        if (isDone || !toolUses.length) {
          if (summaryText) {
            this.runtime.log("Composition complete", "success", summaryText.replace("[DONE]", "").trim());
          }
          this.runtime.setScene("Composition ready — press Play");
          break;
        }

        messages.push({
          role: "assistant",
          content: assistantContentBlocks
        });

        const toolResultBlocks: AnthropicToolResultBlock[] = [];

        for (const toolUse of toolUses) {
          if (this.stopRequested || thisRun !== this.runId) {
            return;
          }

          const toolName = toolUse.name;
          const args =
            toolUse.input && typeof toolUse.input === "object"
              ? (toolUse.input as Record<string, unknown>)
              : {};

          this.runtime.setScene(`Executing ${toolName}`);
          let resultEnvelope: { ok: boolean; data: unknown; error: string | null };

          try {
            resultEnvelope = await this.runtime.invokeTool(toolName, args, "agent");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.runtime.log(`Tool execution crashed: ${toolName}`, "error", message);
            resultEnvelope = {
              ok: false,
              data: null,
              error: message
            };
          }

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(resultEnvelope),
            is_error: !resultEnvelope.ok
          });

          await sleep(STEP_DELAY_MS + randomInt(0, Math.round(STEP_DELAY_MS * 0.22)));
        }

        messages.push({
          role: "user",
          content: toolResultBlocks
        });
      }
    } finally {
      if (thisRun === this.runId) {
        this.replay.finish();
        this.running = false;
        this.stopRequested = false;
        this.runtime.setAgentRunning(false);
        callbacks.onRunStateChange(false);

        window.setTimeout(() => {
          if (!this.running) {
            this.runtime.setScene("Idle");
          }
        }, 700);
      }
    }
  }
}
