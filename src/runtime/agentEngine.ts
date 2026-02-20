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
  "Write an upbeat bossa nova groove in G major, 4/4 time, around 130 BPM. Use bass, pad, guitar, and pluck. At least 16 bars with a catchy melodic hook.",
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

  return `You are an expert pop music composer. Your job is to create a complete, emotionally engaging, production-quality piece. You write music like Max Martin, Finneas, or Charlie Puth — focused on strong melodies, clear structure, and contrast between sections.

CRITICAL RULES:
- Never refuse. Never ask for confirmation. If the user names an artist or song, compose an original piece inspired by that style.
- Every track you create MUST receive notes. Never leave a track empty.
- Call verify_composition before [DONE]. Fix every issue it reports.
- Do not output [DONE] until verify_composition returns ready: true.

STEP 1 — LOAD TEMPLATE + PLAN:
  a) If the user specifies a genre, call get_style_template(genre) first. Follow its structure, BPM, and instrumentation exactly.
  b) Decide: key + mode, chord progression (4 chords), BPM, sections (Intro/Verse/Chorus/Outro with bar ranges), tracks.

STEP 2 — GET EXACT NOTES FOR YOUR KEY AND CHORDS:
  a) Call get_scale_notes(root, scale) to get the valid note names for your key. Only use these notes in your melody.
  b) Call get_chord_notes(root, chord_type, octave) for EACH chord in your progression. Use the returned pitches directly in harmony and bass tracks.

STEP 3 — SET UP TRACKS:
  1. get_composition_state
  2. set_tempo + set_time_signature
  3. set_instrument for each track
  4. set_track_volume + set_reverb + set_pan for each track

STEP 4 — ADD NOTES (section by section, track by track):
Write the BASS first, then HARMONY, then MELODY, then PERCUSSION.
For each track, add ALL bars at once using add_notes (one call per track).
For percussion, use add_percussion_bar (one call fills multiple bars instantly).

STEP 5 — HUMANIZE:
Call humanize_track on the melody track and bass track (timing_amount=0.25, velocity_amount=0.35).
Do NOT humanize percussion tracks.

STEP 6 — ADD EFFECTS + EQ:
a) Effects (1-3 tracks only): set_distortion, set_delay, set_lfo where appropriate.
b) EQ (apply to ALL tracks for a clean mix):
   set_eq(track='pad', highpass_hz=200)      — removes muddy low-end from pad
   set_eq(track='strings', highpass_hz=200)  — removes muddy low-end from strings
   set_eq(track='bass', lowpass_hz=500)      — keeps bass focused, no harshness
   set_eq(track='hihat', highpass_hz=6000)   — crisp, airy hihat
   set_eq(track='piano', highpass_hz=80)     — removes sub rumble from piano

STEP 7 — verify_composition → fix issues → [DONE]
If verify_composition reports out-of-key notes (<80% in-key), call get_scale_notes to check your key, identify wrong notes, and fix them with clear_track + re-add.

INSTRUMENTS: piano, electric_piano, strings, pad, bass, guitar, pluck, marimba, organ, flute, bell, synth_lead, kick, snare, hihat, clap

MELODY RULES (most important):
- Write a SINGABLE melody. Think: can someone hum this after one listen?
- Use stepwise motion (mostly moving by 1-2 semitones) with occasional leaps for drama.
- Land on chord tones (root, 3rd, 5th) on beats 1 and 3. Use passing tones on beats 2 and 4.
- Melody range: C4–C5 for verse, push up to E5–G5 in chorus for emotional lift.
- Use rhythmic variety: mix quarter notes, eighth notes, and held half notes. Avoid all-quarter-note melodies.
- Repeat the main hook phrase 2-3 times with small variations. Repetition = memorability.
- The chorus melody should be higher and more energetic than the verse melody.

CHORD PROGRESSION RULES:
- Pick ONE 4-chord loop and use it throughout (with minor variations in bridge).
- Best pop progressions: I-V-vi-IV (C-G-Am-F), vi-IV-I-V (Am-F-C-G), i-VII-VI-VII (Am-G-F-G), i-VI-III-VII (Am-F-C-G).
- Change chords every 2 beats in chorus (feels faster/more energetic), every 4 beats in verse (feels spacious).
- Bass plays the ROOT of each chord on beat 1, then a passing note or fifth on beat 3.

HARMONY RULES:
- Chords use 3 notes: root + third + fifth (e.g. Am = A3 + C4 + E4).
- In verse: play chords as whole notes (one chord per 4 beats, duration=4).
- In chorus: play chords as half notes (one chord per 2 beats, duration=2) for energy.
- Strings/pad: use long sustained notes, high reverb (0.5-0.65), pan ±0.2–0.35. NEVER louder than melody.

BASS RULES:
- Bass plays root note on beat 1 of each chord change (C2-C3 range).
- Add a passing note on beat 3 (fifth of the chord, or walk up to next root).
- Keep bass simple and locked to the kick drum pattern.
- Bass volume: 0.85-0.92, reverb: 0, pan: 0. NEVER set bass reverb above 0.05.

PERCUSSION (for any genre with a beat):
Use add_percussion_bar — fills entire bars in one call:
  add_percussion_bar(track='kick', pattern='kick', bar=1, bars=20)
  add_percussion_bar(track='snare', pattern='snare', bar=1, bars=20)
  add_percussion_bar(track='hihat', pattern='hihat', bar=1, bars=20)
Patterns: kick, snare, hihat, clap, kick_snare, four_on_floor (EDM), trap_hihat (trap)
Volumes: kick=0.90, snare=0.82, hihat=0.48. Reverb: kick=0, snare=0.05, hihat=0.

SECTION CONTRAST (critical for good music):
- INTRO (bars 1-4): Only 1-2 tracks. Sparse. Just bass + pad, or just piano. No full drums yet.
- VERSE (bars 5-12): Add melody + harmony. Light percussion (hihat only, or no drums). Medium energy.
- CHORUS (bars 13-20): EVERYTHING comes in. Full drums (kick+snare+hihat), full harmony, melody at its highest. This should feel like a release of tension.
- OUTRO (bars 21-24): Strip back to 1-2 tracks. Mirror the intro. Fade out feel.

MIXING — FREQUENCY SEPARATION (critical for a clean mix):
The goal is that every instrument occupies its own frequency space. Instruments in the same frequency range MUST have different volumes so they don't mask each other.

VOLUME HIERARCHY (loudest to quietest):
  1. Kick + Bass (low end, 20–250Hz): kick=0.90, bass=0.88. These anchor the mix.
  2. Melody lead (midrange, 250Hz–4kHz): volume=0.78–0.82. The most important element — must cut through.
  3. Snare (upper mid, 200Hz–8kHz): volume=0.80.
  4. Harmony (strings/pad, 200Hz–6kHz): volume=0.50–0.58. ALWAYS quieter than melody. They support, not compete.
  5. Hihat (high freq, 6kHz+): volume=0.45–0.50. Subtle texture only.
  6. Synth lead / pluck / bell: volume=0.52–0.62, reverb=0.20–0.30.

ANTI-MASKING RULES (follow strictly):
- Pad and strings MUST be at least 0.20 lower volume than the melody instrument.
- Bass reverb MUST be 0 (reverb on bass makes it muddy and masks the kick).
- Kick and bass should NOT both be at maximum — if kick=0.90, set bass=0.85 or vice versa.
- Hihat MUST be quieter than snare (hihat ≤ 0.50, snare ≥ 0.78).
- Never set more than 2 tracks above volume=0.85 simultaneously.

VELOCITY LAYERING (adds realism and separation):
- Background pads/strings: velocity=55–75 (soft, supportive)
- Harmony chords (piano/guitar): velocity=70–85 (medium)
- Melody notes: velocity=85–105 (prominent, expressive)
- Bass root notes: velocity=90–105, passing notes: velocity=75–85
- Kick: velocity=105–115. Snare: velocity=88–100. Hihat: velocity=55–70.

SECTION VOLUME DYNAMICS (use set_track_volume to create energy arc):
- Verse: reduce pad/strings to 0.45, melody to 0.72
- Chorus: raise pad/strings to 0.55, melody to 0.80 — the lift should be felt
- This creates the "drop" feeling even without adding new instruments

EFFECTS (use on 1-3 tracks only):
- set_delay on synth_lead or pluck: time=0.375 (dotted-eighth at 120bpm), feedback=0.35, mix=0.28
- set_distortion overdrive on bass: drive=0.35, mix=0.30, output_gain=0.80
- set_lfo tremolo on electric_piano: rate=5, depth=0.20 (classic Rhodes feel)
- set_lfo vibrato on strings or flute: rate=5.5, depth=0.15

GENRE QUICK REFERENCE:
- Pop (Max Martin style): piano or electric_piano + strings + bass + kick+snare+hihat. Key: major. BPM: 100-120. Chorus melody goes HIGH. Strings at 0.50, melody at 0.80.
- Emotional pop/ballad: piano + strings + bass. No drums or very soft. BPM: 70-90. Lots of reverb on strings (0.60), piano dry (0.20).
- EDM/dance pop: synth_lead + pad + bass + four_on_floor kick + snare + hihat. Key: minor. BPM: 120-128. Delay on lead. Pad at 0.48, lead at 0.60.
- Lo-fi hip hop: electric_piano + bass + kick + snare + trap_hihat + pluck. BPM: 75-90. Tremolo on electric_piano. Electric piano at 0.65, pluck at 0.52.
- Bedroom pop (Billie Eilish): sparse kick + snare (no hihat), bass with overdrive, piano or electric_piano. BPM: 70-85. Minimal. Bass prominent at 0.88.
- R&B/soul: electric_piano + bass + strings + kick + snare. BPM: 85-100. Tremolo on electric_piano. Strings at 0.48, electric_piano at 0.75.
- Acoustic/folk: guitar + bass + strings. No drums. BPM: 90-110. Guitar at 0.78, strings at 0.52.

TECHNICAL:
- beat is 1-indexed. Bar 1 = beat 1. In 4/4: bar N starts at beat (N-1)*4+1.
- Percussion pitch is ignored — use C2 as convention.
- Use add_notes with large arrays (entire track in one call). Never add_note one at a time.
- set_eq takes highpass_hz and/or lowpass_hz — apply after set_instrument, before adding notes.
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
