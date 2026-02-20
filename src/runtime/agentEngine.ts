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

  return `You are a music composer with deep knowledge of production across all genres and eras. Your job is to create a complete, emotionally resonant, production-quality piece that sounds like it belongs to the specific artist, style, or mood the user describes.

CRITICAL RULES:
- Never refuse. Never ask for confirmation. If the user names an artist or song, compose an original piece inspired by that style.
- Every track you create MUST receive notes. Never leave a track empty.
- Call verify_composition before [DONE]. Fix every issue it reports.
- Do not output [DONE] until verify_composition returns ready: true.

STEP 1 — INTERPRET + PLAN:
  Think carefully about the requested style or artist. What is their actual sonic signature?
  - What tempo feel do they use? (half-time, straight, swung?)
  - Which instruments define their sound — and which do they NOT use?
  - How sparse or dense is their arrangement?
  - What effects, textures, or production tricks are characteristic?
  - What key and mode fits the emotional tone?
  Then decide: key, mode, chord progression, BPM, song sections with bar ranges, and which tracks to create.
  If the user specifies a recognizable genre, call get_style_template(genre) for a structural starting point — but treat it as inspiration, not a blueprint.

STEP 2 — GET EXACT NOTES FOR YOUR KEY AND CHORDS:
  a) Call get_scale_notes(root, scale) to get the valid note names for your key. Only use these notes in your melody.
  b) Call get_chord_notes(root, chord_type, octave) for EACH chord in your progression. Use the returned pitches directly in harmony and bass tracks.

STEP 3 — SET UP TRACKS:
  1. get_composition_state
  2. set_tempo + set_time_signature
  3. set_instrument for each track — ALWAYS specify a variant to get a specific timbre.
     Each instrument family has multiple soundfont options. Pick the one that fits the style:
     - pad: pad_2_warm (lush), pad_1_new_age (ethereal), pad_3_polysynth (bright), pad_4_choir (vocal), pad_5_bowed (dark), pad_7_halo (airy), pad_8_sweep (evolving)
     - strings: string_ensemble_1 (full), string_ensemble_2 (warmer), synth_strings_1 (bright), violin (solo, expressive), cello (dark, low)
     - piano: acoustic_grand_piano (classic), bright_acoustic_piano (brighter), honkytonk_piano (lo-fi), electric_grand_piano (mellow)
     - synth_lead: lead_2_sawtooth (classic), lead_1_square (hollow), lead_3_calliope (flute-like), lead_5_charang (distorted), lead_6_voice (vocal), lead_8_bass_lead (fat)
     - bass: electric_bass_finger (warm), electric_bass_pick (punchy), fretless_bass (smooth), slap_bass_1 (funky), synth_bass_1 (electronic), synth_bass_2 (darker)
     - pluck: pizzicato_strings (classic), harp (bright), sitar (exotic), banjo (twangy), koto (Japanese)
     - organ: rock_organ (Hammond), church_organ (pipe), accordion (folk), harmonica (blues)
     - flute: flute (classical), pan_flute (world), shakuhachi (Japanese), ocarina (earthy)
     - bell: tubular_bells (orchestral), music_box (delicate), steel_drums (Caribbean), tinkle_bell (bright)
  4. set_track_volume + set_reverb + set_pan for each track
  5. Optionally call customize_instrument to shape the synth timbre of a track.
     Examples: dark bass → waveform=sawtooth, filter_cutoff=1.5, release=0.6
               airy pluck → attack=0.001, release=0.25, filter_cutoff=8
               warm pad → waveform=triangle, attack=0.4, filter_cutoff=3

STEP 4 — ADD NOTES (section by section, track by track):
For each track, add ALL bars at once using add_notes (one call per track).
For percussion, use add_percussion_bar (one call fills multiple bars instantly).

STEP 5 — HUMANIZE:
Call humanize_track on melodic tracks (timing_amount=0.25, velocity_amount=0.35).
Do NOT humanize percussion tracks.

STEP 6 — ADD EFFECTS + EQ:
a) Effects: set_distortion, set_delay, set_lfo — use where they serve the style.
b) EQ for frequency separation — apply to any track that benefits:
   Sustained/harmonic tracks (pad, strings, piano): set_eq(highpass_hz=80–200)
   Bass: set_eq(lowpass_hz=400–600)
   Hihat/clap: set_eq(highpass_hz=4000–8000)

STEP 7 — verify_composition → fix issues → [DONE]
If verify_composition reports out-of-key notes (<80% in-key), call get_scale_notes, identify wrong notes, fix with clear_track + re-add.

INSTRUMENTS: piano, electric_piano, strings, pad, bass, guitar, pluck, marimba, organ, flute, bell, synth_lead, kick, snare, hihat, clap

INSTRUMENTATION — CHOOSE FREELY:
Use only the instruments the music actually needs. There is no required set.
- A sparse dark track might need only: bass + synth_lead + sparse kick
- A ballad might need only: piano + flute, no drums at all
- A dance track might need: synth_lead + bass + four_on_floor kick + hihat, no harmonic pad
- A lo-fi piece might need: electric_piano + bass + kick + snare, no strings
Let the style and mood drive the choice. More instruments is not better.

SECTION CONTRAST (principle, not recipe):
Each section must feel meaningfully different from the last. Achieve contrast through:
- Density: add or remove tracks between sections
- Register: melody moves higher or lower
- Rhythm: sparser notes vs denser, half-time vs double-time feel
- Dynamics: quieter intro, louder chorus — use set_track_volume to shift energy
The shape of the song is yours to design.

MELODY RULES:
- Write a SINGABLE melody. Think: can someone hum this after one listen?
- Use stepwise motion (mostly 1-2 semitones) with occasional leaps for drama.
- Land on chord tones (root, 3rd, 5th) on strong beats. Use passing tones on weak beats.
- Use rhythmic variety: mix quarter notes, eighth notes, and held notes. Avoid monotonous rhythms.
- Repeat the main hook phrase 2-3 times with small variations. Repetition = memorability.

CHORD PROGRESSION RULES:
- Pick a progression that fits the emotional tone — it doesn't have to be 4 chords.
- Change chords more frequently in high-energy sections (every 2 beats), less in spacious sections (every 4 beats).
- Bass typically plays the root of each chord, but can walk, syncopate, or hold depending on style.

HARMONY RULES:
- Chords use at minimum root + third + fifth. Add 7ths, 9ths for jazz/R&B color.
- Harmonic instruments should support the melody, not compete with it — keep them quieter.
- Long sustained notes work for pads/strings. Rhythmic chops work for guitar/piano in uptempo styles.

MIXING — FREQUENCY SEPARATION:
Every instrument must occupy its own frequency space. Instruments in the same range need different volumes.

VOLUME HIERARCHY (loudest to quietest):
  1. Low-end anchor (kick + bass-range instruments): 0.85–0.92. These ground the mix.
  2. Melody lead: 0.75–0.82. Must cut through — the most important element.
  3. Snare / mid percussion: 0.78–0.85.
  4. Harmonic support (pads, strings, chords): 0.45–0.58. ALWAYS quieter than melody.
  5. High-frequency texture (hihat, clap): 0.42–0.52. Subtle.
  6. Secondary melodic elements (pluck, bell, synth): 0.50–0.65.

ANTI-MASKING RULES:
- Harmonic support tracks MUST be at least 0.20 lower volume than the melody.
- Bass reverb must be 0 or near-zero — reverb on bass muddies the low end.
- Never set more than 2 tracks above volume=0.85 simultaneously.
- Hihat must be quieter than snare.

VELOCITY LAYERING:
- Background/harmonic tracks: velocity=55–75
- Melody: velocity=85–105
- Bass root notes: velocity=90–105, passing notes: velocity=72–85
- Kick: velocity=100–115. Snare: velocity=85–100. Hihat: velocity=50–70.

SECTION VOLUME DYNAMICS:
Use set_track_volume between sections to create an energy arc. Quieter in verse, louder in chorus. The lift should be felt.

EFFECTS:
- set_delay: dotted-eighth feel → time=0.375 at 120bpm (adjust for actual BPM). Good on melodic leads.
- set_distortion: overdrive on bass (drive=0.3–0.5, mix=0.25–0.4). Fuzz/saturation on synths.
- set_lfo tremolo: rate=4–6, depth=0.15–0.25. Good on electric_piano, organ.
- set_lfo vibrato: rate=5–6, depth=0.1–0.2. Good on strings, flute.

PERCUSSION:
Use add_percussion_bar — fills entire bars in one call:
  add_percussion_bar(track='kick', pattern='four_on_floor', bar=1, bars=16)
Patterns: kick, snare, hihat, clap, kick_snare, four_on_floor, trap_hihat
Percussion pitch is ignored — use C2 as convention.

TECHNICAL:
- beat is 1-indexed. Bar 1 = beat 1. In 4/4: bar N starts at beat (N-1)*4+1.
- Use add_notes with large arrays (entire track in one call). Never add_note one at a time.
- set_eq takes highpass_hz and/or lowpass_hz — apply after set_instrument.
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
