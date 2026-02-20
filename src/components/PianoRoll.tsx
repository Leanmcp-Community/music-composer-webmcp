import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import type { CompositionState, MusicNote } from "../types";
import { getTrackColor, pitchToMidi } from "../runtime/audioEngine";

const KEYBOARD_WIDTH = 52;
const ROW_HEIGHT = 10;
const BEAT_WIDTH = 48;
const MIDI_MIN = 21;
const MIDI_MAX = 108;
const TOTAL_ROWS = MIDI_MAX - MIDI_MIN + 1;
const CANVAS_HEIGHT = TOTAL_ROWS * ROW_HEIGHT;
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const MIN_CANVAS_BEATS = 64;

function isBlackKey(midi: number): boolean {
  return BLACK_KEYS.has(midi % 12);
}

function midiToRow(midi: number): number {
  return MIDI_MAX - midi;
}

function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  activeNotes: Set<number>,
  flashMap: Map<number, number>
): void {
  const now = performance.now();
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    const y = midiToRow(midi) * ROW_HEIGHT;
    const black = isBlackKey(midi);
    const active = activeNotes.has(midi);
    const flashStart = flashMap.get(midi);
    const flashAge = flashStart !== undefined ? (now - flashStart) / 200 : 1;
    const flashing = !active && flashAge < 1;
    const fi = flashing ? 1 - flashAge : 0;

    if (active) {
      ctx.fillStyle = black ? "#1a7acc" : "#42d7ff";
      ctx.shadowColor = black ? "#1a7acc" : "#42d7ff";
      ctx.shadowBlur = black ? 6 : 14;
    } else if (flashing) {
      const g = Math.round(160 + 95 * fi);
      const b = Math.round(200 + 55 * fi);
      ctx.fillStyle = black ? `rgb(20,${g - 40},${b - 20})` : `rgb(60,${g},${b})`;
      ctx.shadowColor = `rgba(66,215,255,${fi * 0.6})`;
      ctx.shadowBlur = 10 * fi;
    } else {
      ctx.fillStyle = black ? "#1a1a2e" : "#2a2a3e";
      ctx.shadowBlur = 0;
    }

    ctx.fillRect(0, y, KEYBOARD_WIDTH, ROW_HEIGHT);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (!black) {
      ctx.fillStyle = (active || flashing) ? `rgba(66,215,255,${0.25 + fi * 0.25})` : "#3a3a50";
      ctx.fillRect(0, y + ROW_HEIGHT - 1, KEYBOARD_WIDTH, 1);
    }

    if (midi % 12 === 0) {
      const octave = Math.floor(midi / 12) - 1;
      ctx.fillStyle = active ? "#ffffff" : "#5a5a7a";
      ctx.font = "8px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`C${octave}`, KEYBOARD_WIDTH - 3, y + ROW_HEIGHT - 2);
    }
  }
  ctx.fillStyle = "rgba(100,100,180,0.5)";
  ctx.fillRect(KEYBOARD_WIDTH - 1, 0, 1, CANVAS_HEIGHT);
}

function computeWaterfallOffsetY(notes: MusicNote[], canvasHeight: number): number {
  if (notes.length === 0) return 0;
  const midis = notes.map((n) => pitchToMidi(n.pitch)).sort((a, b) => a - b);
  const medianMidi = midis[Math.floor(midis.length / 2)];
  const noteY = midiToRow(medianMidi) * ROW_HEIGHT + ROW_HEIGHT / 2;
  const offset = canvasHeight / 2 - noteY;
  const minOffset = canvasHeight - CANVAS_HEIGHT;
  return Math.min(0, Math.max(minOffset, offset));
}

function drawWaterfallBackground(ctx: CanvasRenderingContext2D, width: number): void {
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    const y = midiToRow(midi) * ROW_HEIGHT;
    const black = isBlackKey(midi);
    ctx.fillStyle = black ? "#111120" : "#171726";
    ctx.fillRect(0, y, width, ROW_HEIGHT);
    if (!black) {
      ctx.fillStyle = "#1c1c2e";
      ctx.fillRect(0, y + ROW_HEIGHT - 1, width, 1);
    }
  }
}

function drawWaterfallNotes(
  ctx: CanvasRenderingContext2D,
  notes: MusicNote[],
  tracks: CompositionState["tracks"],
  playheadBeat: number,
  viewWidth: number,
  mutedTracks: Set<string>
): void {
  const visibleBeats = viewWidth / BEAT_WIDTH;
  const viewEnd = playheadBeat + visibleBeats;

  for (const note of notes) {
    const midi = pitchToMidi(note.pitch);
    if (midi < MIDI_MIN || midi > MIDI_MAX) continue;
    const noteStart = note.beat;
    const noteEnd = note.beat + note.duration;
    if (noteEnd < playheadBeat || noteStart > viewEnd) continue;

    const track = tracks[note.track];
    const isMuted = mutedTracks.has(note.track);
    const color = getTrackColor(track?.instrument ?? "piano");
    const alpha = isMuted ? 0.12 : (0.55 + (note.velocity / 127) * 0.45);
    const xLeft = (noteStart - playheadBeat) * BEAT_WIDTH;
    const xRight = (noteEnd - playheadBeat) * BEAT_WIDTH;
    const x = Math.max(0, xLeft);
    const w = Math.max(2, Math.min(xRight, viewWidth) - x - 1);
    const y = midiToRow(midi) * ROW_HEIGHT + 1;
    const h = ROW_HEIGHT - 2;
    const isActive = noteStart <= playheadBeat && noteEnd > playheadBeat;
    const distToHit = Math.max(0, noteStart - playheadBeat);
    const approachGlow = distToHit < 2 ? (1 - distToHit / 2) * 0.5 : 0;

    ctx.globalAlpha = alpha;
    if (isActive || approachGlow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = isActive ? 10 : 6 * approachGlow;
    }
    ctx.fillStyle = color;

    const r = Math.min(3, h / 2, w / 2);
    if (w > r * 2) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(x, y, Math.max(2, w), h);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
}

function drawStaticGrid(
  ctx: CanvasRenderingContext2D,
  totalBeats: number,
  beatsPerBar: number,
  canvasWidth: number
): void {
  const endBeat = Math.max(totalBeats + 4, MIN_CANVAS_BEATS);
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    const y = midiToRow(midi) * ROW_HEIGHT;
    const black = isBlackKey(midi);
    ctx.fillStyle = black ? "#1c1c30" : "#1e1e32";
    ctx.fillRect(0, y, canvasWidth, ROW_HEIGHT);
    if (!black) {
      ctx.fillStyle = "#252538";
      ctx.fillRect(0, y + ROW_HEIGHT - 1, canvasWidth, 1);
    }
  }
  for (let beat = 0; beat <= endBeat; beat++) {
    const x = beat * BEAT_WIDTH;
    const isBar = beat % beatsPerBar === 0;
    ctx.fillStyle = isBar ? "#2e2e48" : "#252538";
    ctx.fillRect(x, 0, 1, CANVAS_HEIGHT);
    if (isBar) {
      ctx.fillStyle = "#4a4a6a";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${Math.floor(beat / beatsPerBar) + 1}`, x + 3, 10);
    }
  }
}

function drawStaticNotes(
  ctx: CanvasRenderingContext2D,
  notes: MusicNote[],
  tracks: CompositionState["tracks"],
  canvasWidth: number,
  glowNoteId: string | null,
  mutedTracks: Set<string>
): void {
  for (const note of notes) {
    const midi = pitchToMidi(note.pitch);
    if (midi < MIDI_MIN || midi > MIDI_MAX) continue;
    const x = note.beat * BEAT_WIDTH;
    const w = Math.max(3, note.duration * BEAT_WIDTH - 2);
    if (x + w < 0 || x > canvasWidth) continue;
    const y = midiToRow(midi) * ROW_HEIGHT + 1;
    const h = ROW_HEIGHT - 2;
    const track = tracks[note.track];
    const isMuted = mutedTracks.has(note.track);
    const color = getTrackColor(track?.instrument ?? "piano");
    const isGlowing = note.id === glowNoteId;
    if (isGlowing) { ctx.shadowColor = color; ctx.shadowBlur = 22; }
    const baseAlpha = isMuted ? 0.12 : (0.55 + (note.velocity / 127) * 0.45);
    ctx.globalAlpha = isGlowing ? Math.min(1, baseAlpha + 0.3) : baseAlpha;
    ctx.fillStyle = color;
    const r = Math.min(3, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();
    if (isGlowing) {
      ctx.globalAlpha = 0.25;
      ctx.shadowBlur = 30;
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
  }
}

interface PianoRollProps {
  composition: CompositionState;
  playheadBeat: number;
  latestNoteId: string | null;
  isPlaying: boolean;
  activeNotes?: Set<number>;
  mutedTracks: Set<string>;
  onToggleMute: (trackName: string) => void;
  trackVolumes?: Record<string, number>;
  onTrackVolumeChange?: (trackName: string, volume: number) => void;
  isAgentRunning?: boolean;
}

export interface PianoRollHandle {
  centerOnNotes: () => void;
}

export const PianoRoll = forwardRef<PianoRollHandle, PianoRollProps>(function PianoRoll({ composition, playheadBeat, latestNoteId, isPlaying, activeNotes, mutedTracks, onToggleMute, trackVolumes, onTrackVolumeChange, isAgentRunning }: PianoRollProps, ref) {
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glowNoteIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const flashMapRef = useRef<Map<number, number>>(new Map());
  const prevActiveRef = useRef<Set<number>>(new Set());
  const playheadRef = useRef(playheadBeat);
  const compositionRef = useRef(composition);
  const activeNotesRef = useRef(activeNotes ?? new Set<number>());
  const centeredRef = useRef(false);

  playheadRef.current = playheadBeat;
  compositionRef.current = composition;
  activeNotesRef.current = activeNotes ?? new Set<number>();

  const centerOnNotes = useCallback((notes: typeof composition.notes) => {
    const sc = scrollContainerRef.current;
    if (!sc || notes.length === 0) return;
    const midis = notes.map((n) => pitchToMidi(n.pitch)).sort((a, b) => a - b);
    const medianMidi = midis[Math.floor(midis.length / 2)];
    const noteY = midiToRow(medianMidi) * ROW_HEIGHT;
    const targetY = noteY - sc.clientHeight * 0.5;
    sc.scrollTop = Math.max(0, Math.min(CANVAS_HEIGHT - sc.clientHeight, targetY));
  }, []);

  useImperativeHandle(ref, () => ({
    centerOnNotes: () => centerOnNotes(compositionRef.current.notes),
  }), [centerOnNotes]);

  const totalBeats = Math.max(composition.totalBeats + 8, MIN_CANVAS_BEATS);
  const gridWidth = totalBeats * BEAT_WIDTH;

  useEffect(() => {
    const prev = prevActiveRef.current;
    const curr = activeNotes ?? new Set<number>();
    const now = performance.now();
    curr.forEach((midi) => {
      if (!prev.has(midi)) flashMapRef.current.set(midi, now);
    });
    prevActiveRef.current = new Set(curr);
  }, [activeNotes]);

  const mutedTracksRef = useRef(mutedTracks);
  mutedTracksRef.current = mutedTracks;

  const renderWaterfall = useCallback(() => {
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const gridW = width - KEYBOARD_WIDTH;
    const notes = compositionRef.current.notes;
    const offsetY = computeWaterfallOffsetY(notes, height);

    ctx.save();
    ctx.translate(KEYBOARD_WIDTH, offsetY);
    drawWaterfallBackground(ctx, gridW);
    drawWaterfallNotes(ctx, notes, compositionRef.current.tracks, playheadRef.current, gridW, mutedTracksRef.current);
    ctx.restore();

    ctx.save();
    ctx.translate(0, offsetY);
    drawKeyboard(ctx, activeNotesRef.current, flashMapRef.current);
    ctx.restore();
  }, []);

  const renderStatic = useCallback(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width } = canvas;
    ctx.clearRect(0, 0, width, CANVAS_HEIGHT);
    const beatsPerBar = compositionRef.current.timeSignatureNumerator || 4;
    drawStaticGrid(ctx, compositionRef.current.totalBeats, beatsPerBar, width);
    drawStaticNotes(ctx, compositionRef.current.notes, compositionRef.current.tracks, width, glowNoteIdRef.current, mutedTracksRef.current);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      const loop = () => {
        renderWaterfall();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } else {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      renderWaterfall();
      renderStatic();
    }
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [isPlaying, renderWaterfall, renderStatic]);

  useEffect(() => {
    if (!isPlaying) {
      renderStatic();
      if (!centeredRef.current && composition.notes.length > 0) {
        centeredRef.current = true;
        centerOnNotes(composition.notes);
      }
    }
  }, [composition, isPlaying, renderStatic, mutedTracks, centerOnNotes]);

  useEffect(() => {
    if (!isPlaying) renderWaterfall();
  }, [activeNotes, isPlaying, renderWaterfall, mutedTracks]);


  useEffect(() => {
    const canvas = waterfallCanvasRef.current;
    const outer = outerRef.current;
    if (!canvas || !outer) return;
    const observer = new ResizeObserver(() => {
      canvas.width = outer.clientWidth;
      canvas.height = outer.clientHeight;
      if (!isPlaying) renderWaterfall();
    });
    observer.observe(outer);
    canvas.width = outer.clientWidth;
    canvas.height = outer.clientHeight;
    return () => observer.disconnect();
  }, [isPlaying, renderWaterfall]);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    canvas.width = gridWidth;
    canvas.height = CANVAS_HEIGHT;
    if (!isPlaying) renderStatic();
  }, [gridWidth, isPlaying, renderStatic]);

  useEffect(() => {
    if (!latestNoteId) return;
    glowNoteIdRef.current = latestNoteId;
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    renderStatic();
    glowTimerRef.current = setTimeout(() => {
      glowNoteIdRef.current = null;
      renderStatic();
    }, 1200);

    const note = composition.notes.find((n) => n.id === latestNoteId);
    if (!note || !scrollContainerRef.current) return;
    const sc = scrollContainerRef.current;
    const noteX = note.beat * BEAT_WIDTH;
    const noteY = midiToRow(pitchToMidi(note.pitch)) * ROW_HEIGHT;
    const viewW = sc.clientWidth;
    const viewH = sc.clientHeight;
    const targetX = Math.max(0, noteX - viewW * 0.6);
    const targetY = noteY - viewH * 0.5;
    const clampedY = Math.max(0, Math.min(CANVAS_HEIGHT - viewH, targetY));
    sc.scrollTo({ left: targetX, top: clampedY, behavior: "smooth" });
  }, [latestNoteId, composition.notes, renderStatic]);

  const noteCount = composition.notes.length;
  const totalBars = composition.totalBeats > 0
    ? Math.ceil(composition.totalBeats / (composition.timeSignatureNumerator || 4))
    : 0;

  return (
    <div className="piano-roll-wrapper">
      <div className="piano-roll-info-bar">
        <span className="piano-roll-stat">
          <span className="piano-roll-stat-label">BPM</span>
          <span className="piano-roll-stat-value">{composition.bpm}</span>
        </span>
        <span className="piano-roll-stat">
          <span className="piano-roll-stat-label">TIME</span>
          <span className="piano-roll-stat-value">
            {composition.timeSignatureNumerator}/{composition.timeSignatureDenominator}
          </span>
        </span>
        <span className="piano-roll-stat">
          <span className="piano-roll-stat-label">BARS</span>
          <span className="piano-roll-stat-value">{totalBars}</span>
        </span>
        <span className="piano-roll-stat">
          <span className="piano-roll-stat-label">NOTES</span>
          <span className="piano-roll-stat-value">{noteCount}</span>
        </span>
        <span className="piano-roll-stat">
          <span className="piano-roll-stat-label">TRACKS</span>
          <span className="piano-roll-stat-value">{Object.keys(composition.tracks).length}</span>
        </span>
        <div className="piano-roll-track-legend">
          {Object.entries(composition.tracks).map(([name, track]) => {
            const isMuted = mutedTracks.has(name);
            const color = getTrackColor(track.instrument);
            const vol = trackVolumes?.[name] ?? track.volume ?? 1;
            const volPct = Math.round(vol * 100);
            const isExpanded = expandedTrack === name;
            return (
              <div key={name} className="piano-roll-track-chip-group">
                <button
                  className={`piano-roll-track-chip ${isMuted ? "muted" : ""}`}
                  style={{ borderColor: isMuted ? "#3a3a50" : color }}
                  onClick={() => onToggleMute(name)}
                  title={isMuted ? `Unmute ${name}` : `Mute ${name}`}
                >
                  <span className="piano-roll-track-dot" style={{ background: isMuted ? "#3a3a50" : color }} />
                  {name}
                </button>
                {onTrackVolumeChange && (
                  <button
                    className={`piano-roll-track-vol-btn ${isExpanded ? "active" : ""}`}
                    onClick={() => setExpandedTrack(isExpanded ? null : name)}
                    title="Adjust volume"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <rect x="1" y="6" width="2" height="4" rx="0.5" fill="currentColor" opacity={volPct > 5 ? "1" : "0.3"} />
                      <rect x="4" y="3" width="2" height="7" rx="0.5" fill="currentColor" opacity={volPct > 40 ? "1" : "0.3"} />
                      <rect x="7" y="0" width="2" height="10" rx="0.5" fill="currentColor" opacity={volPct > 75 ? "1" : "0.3"} />
                    </svg>
                  </button>
                )}
                {isExpanded && onTrackVolumeChange && (
                  <div className="piano-roll-track-vol-popup">
                    <input
                      type="range"
                      min="0"
                      max="150"
                      step="1"
                      value={volPct}
                      className="piano-roll-track-vol-slider"
                      onChange={(e) => onTrackVolumeChange(name, parseInt(e.target.value, 10) / 100)}
                    />
                    <span className="piano-roll-track-vol-label">{volPct}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div ref={outerRef} className="piano-roll-canvas-container">
        {isPlaying ? (
          <canvas ref={waterfallCanvasRef} className="piano-roll-waterfall-canvas" />
        ) : (
          <>
            <canvas
              ref={waterfallCanvasRef}
              className="piano-roll-keyboard-canvas"
              width={KEYBOARD_WIDTH}
              height={CANVAS_HEIGHT}
            />
            <div ref={scrollContainerRef} className="piano-roll-scroll-area">
              <canvas ref={gridCanvasRef} className="piano-roll-grid-canvas" width={gridWidth} height={CANVAS_HEIGHT} />
              {noteCount === 0 && (
                <div className="piano-roll-empty-state">
                  {isAgentRunning ? (
                    <>
                      <div className="piano-roll-composing-animation">
                        <div className="bar bar1"></div>
                        <div className="bar bar2"></div>
                        <div className="bar bar3"></div>
                        <div className="bar bar4"></div>
                        <div className="bar bar5"></div>
                      </div>
                      <p className="piano-roll-empty-text">Agent is composing...</p>
                      <p className="piano-roll-empty-subtext">Setting up tracks, tempo, and instruments</p>
                    </>
                  ) : (
                    <>
                      <div className="piano-roll-empty-icon">
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                          <rect x="4" y="8" width="6" height="32" rx="2" fill="#3a3a5a" />
                          <rect x="14" y="14" width="6" height="26" rx="2" fill="#3a3a5a" />
                          <rect x="24" y="10" width="6" height="30" rx="2" fill="#3a3a5a" />
                          <rect x="34" y="18" width="6" height="22" rx="2" fill="#3a3a5a" />
                          <rect x="8" y="6" width="4" height="20" rx="1.5" fill="#2a2a48" />
                          <rect x="18" y="12" width="4" height="16" rx="1.5" fill="#2a2a48" />
                          <rect x="28" y="8" width="4" height="18" rx="1.5" fill="#2a2a48" />
                        </svg>
                      </div>
                      <p className="piano-roll-empty-text">Awaiting composition</p>
                      <p className="piano-roll-empty-subtext">Start the agent to begin composing</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
