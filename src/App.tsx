import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { PianoRoll } from "./components/PianoRoll";
import { PlaybackControls } from "./components/PlaybackControls";
import { AudioEngine, exportMp3 } from "./runtime/audioEngine";
import { AgentEngine } from "./runtime/agentEngine";
import { createMusicTools, createInitialCompositionState } from "./runtime/musicToolRegistry";
import { ReplayEngine } from "./runtime/replayEngine";
import { WebMcpRuntime, type RuntimeSnapshot } from "./runtime/webmcpRuntime";
import type { AgentRunConfig, CompositionState, MusicNote } from "./types";

const runtimeSingleton = new WebMcpRuntime();
const replaySingleton = new ReplayEngine();
const agentSingleton = new AgentEngine(runtimeSingleton, replaySingleton);
const audioEngine = new AudioEngine();

const DEFAULT_CONFIG: AgentRunConfig = {
  objective:
    "Compose a melancholic jazz nocturne in D minor, 3/4 time, 72 BPM. Use piano for the melody and strings for lush chords. At least 16 bars.",
  endpoint: "/v1/anthropic/v1/messages",
  model: "claude-sonnet-4-5",
  apiKey: "",
  speed: "balanced"
};

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(withPadding);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeComposition(comp: CompositionState): string {
  return toBase64Url(JSON.stringify(comp));
}

function decodeComposition(value: string): CompositionState {
  return JSON.parse(fromBase64Url(value)) as CompositionState;
}

function readCompHash(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const comp = params.get("comp");
  return comp && comp.trim().length > 0 ? comp : null;
}

function buildCompHash(encoded: string): string {
  const params = new URLSearchParams();
  params.set("comp", encoded);
  return `#${params.toString()}`;
}

function formatRuntimeMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSuccessRate(total: number, success: number): string {
  if (total === 0) {
    return "100%";
  }
  return `${Math.max(0, Math.round((success / total) * 100))}%`;
}

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

interface MetricCard {
  label: string;
  value: string;
}

export default function App() {
  const initializedRef = useRef(false);
  const compositionRef = useRef<CompositionState>(createInitialCompositionState());

  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(runtimeSingleton.getSnapshot());
  const [config, setConfig] = useState<AgentRunConfig>(DEFAULT_CONFIG);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");
  const [composition, setComposition] = useState<CompositionState>(compositionRef.current);
  const [latestNoteId, setLatestNoteId] = useState<string | null>(null);
  const [playheadBeat, setPlayheadBeat] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [isExportingMp3, setIsExportingMp3] = useState(false);
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const mutedTracksRef = useRef<Set<string>>(new Set());
  const tracksWithNotesRef = useRef<Set<string>>(new Set());
  const layeredRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAgentRunningRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    runtimeSingleton.install();

    const comp = compositionRef.current;

    const tools = createMusicTools(
      comp,
      (note: MusicNote) => {
        const c = compositionRef.current;
        setLatestNoteId(note.id);
        const snap = {
          bpm: c.bpm,
          timeSignatureNumerator: c.timeSignatureNumerator,
          timeSignatureDenominator: c.timeSignatureDenominator,
          tracks: { ...c.tracks },
          notes: c.notes.slice(),
          totalBeats: c.totalBeats
        };
        setComposition(snap);

        if (isAgentRunningRef.current && c.totalBeats >= 2) {
          const prevCount = tracksWithNotesRef.current.size;
          const newTracksWithNotes = new Set<string>();
          for (const n of c.notes) newTracksWithNotes.add(n.track);
          const newCount = newTracksWithNotes.size;
          tracksWithNotesRef.current = newTracksWithNotes;

          if (newCount > prevCount || (prevCount === 0 && newCount === 1)) {
            if (layeredRestartTimerRef.current) clearTimeout(layeredRestartTimerRef.current);
            layeredRestartTimerRef.current = setTimeout(() => {
              const latest = compositionRef.current;
              audioEngine.play(
                {
                  bpm: latest.bpm,
                  timeSignatureNumerator: latest.timeSignatureNumerator,
                  timeSignatureDenominator: latest.timeSignatureDenominator,
                  tracks: { ...latest.tracks },
                  notes: latest.notes.slice(),
                  totalBeats: latest.totalBeats
                },
                mutedTracksRef.current,
                { loop: true }
              );
              setIsPlaying(true);
              setPlayheadBeat(0);
            }, 350);
          }
        }
      },
      () => {
        const c = compositionRef.current;
        setComposition({
          bpm: c.bpm,
          timeSignatureNumerator: c.timeSignatureNumerator,
          timeSignatureDenominator: c.timeSignatureDenominator,
          tracks: { ...c.tracks },
          notes: c.notes.slice(),
          totalBeats: c.totalBeats
        });
      }
    );

    runtimeSingleton.registerTools(tools);

    const compHash = readCompHash();
    if (compHash) {
      try {
        const loaded = decodeComposition(compHash);
        const comp = compositionRef.current;
        comp.bpm = loaded.bpm;
        comp.timeSignatureNumerator = loaded.timeSignatureNumerator;
        comp.timeSignatureDenominator = loaded.timeSignatureDenominator;
        comp.tracks = loaded.tracks;
        comp.notes = loaded.notes;
        comp.totalBeats = loaded.totalBeats;
        setComposition({ ...comp });
        setStatusMessage("Shared composition loaded — press Play");
      } catch {
        setStatusMessage("Invalid share link.");
      }
    }
  }, []);

  useEffect(() => {
    audioEngine.setCallbacks(
      (beat) => setPlayheadBeat(beat),
      () => {
        setIsPlaying(false);
        setPlayheadBeat(-1);
        setActiveNotes(new Set());
      },
      (notes) => setActiveNotes(new Set(notes))
    );

    const unsubSnapshot = runtimeSingleton.subscribe(setSnapshot);
    const unsubToolCalls = runtimeSingleton.subscribeToolCalls((record) => {
      replaySingleton.recordToolCall(record);
    });

    return () => {
      unsubSnapshot();
      unsubToolCalls();
    };
  }, []);

  const metrics: MetricCard[] = useMemo(() => {
    return [
      { label: "Tool Calls", value: String(snapshot.metrics.totalCalls) },
      { label: "Success Rate", value: formatSuccessRate(snapshot.metrics.totalCalls, snapshot.metrics.successCalls) },
      { label: "Queue Depth", value: String(snapshot.metrics.queueDepth) },
      { label: "Runtime", value: formatRuntimeMs(snapshot.metrics.runtimeMs) }
    ];
  }, [snapshot.metrics]);

  const isRunning = snapshot.agentRunning;

  const updateConfig = <K extends keyof AgentRunConfig>(key: K, value: AgentRunConfig[K]) => {
    setConfig((prev: AgentRunConfig) => ({ ...prev, [key]: value }));
  };

  const startAgent = async () => {
    const comp = compositionRef.current;
    comp.bpm = 120;
    comp.timeSignatureNumerator = 4;
    comp.timeSignatureDenominator = 4;
    comp.tracks = {};
    comp.notes = [];
    comp.totalBeats = 0;
    setComposition({ ...comp });
    setLatestNoteId(null);
    setPlayheadBeat(-1);
    setIsPlaying(false);
    audioEngine.stop();
    tracksWithNotesRef.current = new Set();
    if (layeredRestartTimerRef.current) clearTimeout(layeredRestartTimerRef.current);
    isAgentRunningRef.current = true;

    try {
      setStatusMessage("Loading instruments...");
      await audioEngine.preloadSoundfonts();
      setStatusMessage("Composing — playback starts automatically...");
      await agentSingleton.run(config, {
        onRunStateChange: (running) => {
          isAgentRunningRef.current = running;
          if (!running) {
            setStatusMessage("Composition complete — looping");
          }
        },
        onScene: (scene) => {
          runtimeSingleton.setScene(scene);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeSingleton.log("Agent failed", "error", message);
      setStatusMessage(`Run failed: ${message}`);
    } finally {
      isAgentRunningRef.current = false;
    }
  };

  const stopAgent = () => {
    agentSingleton.stop();
    setStatusMessage("Stopped");
  };

  const surpriseObjective = () => {
    updateConfig("objective", agentSingleton.getSurpriseObjective());
    setStatusMessage("Loaded surprise objective");
  };

  useEffect(() => {
    if (isPlaying) {
      audioEngine.updateMutedTracks(mutedTracks);
    }
  }, [mutedTracks, isPlaying]);

  const handleToggleMute = useCallback((trackName: string) => {
    const next = new Set(mutedTracksRef.current);
    if (next.has(trackName)) next.delete(trackName);
    else next.add(trackName);
    mutedTracksRef.current = next;
    setMutedTracks(next);
  }, []);

  const handlePlay = useCallback(() => {
    const comp = compositionRef.current;
    if (!comp.notes.length) return;
    setIsPlaying(true);
    setPlayheadBeat(0);
    audioEngine.play(comp, mutedTracksRef.current);
  }, []);

  const handleStop = useCallback(() => {
    audioEngine.stop();
    setIsPlaying(false);
    setPlayheadBeat(-1);
    setActiveNotes(new Set());
  }, []);

  const handleExport = useCallback(() => {
    const comp = compositionRef.current;
    if (!comp.notes.length) {
      setStatusMessage("No composition to export.");
      return;
    }
    const blob = new Blob([JSON.stringify(comp, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `webmcp-composition-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatusMessage("Composition exported");
  }, []);

  const handleShare = useCallback(async () => {
    const comp = compositionRef.current;
    if (!comp.notes.length) {
      setStatusMessage("No composition to share.");
      return;
    }
    const encoded = encodeComposition(comp);
    const hash = buildCompHash(encoded);
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked */
    }
    window.history.replaceState(null, "", hash);
    setShareUrl(url);
    setStatusMessage("Share link copied");
    setTimeout(() => setShareUrl(null), 3000);
  }, []);

  const handleExportMp3 = useCallback(async () => {
    const comp = compositionRef.current;
    if (!comp.notes.length) {
      setStatusMessage("No composition to export.");
      return;
    }
    setIsExportingMp3(true);
    setStatusMessage("Rendering MP3...");
    try {
      const blob = await exportMp3(comp);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `composition-${Date.now()}.mp3`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatusMessage("MP3 exported");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`MP3 export failed: ${msg}`);
    } finally {
      setIsExportingMp3(false);
    }
  }, []);

  const replayFromHash = async () => {
    const encoded = readCompHash();
    if (!encoded) {
      setStatusMessage("No share link found in URL.");
      return;
    }
    try {
      const loaded = decodeComposition(encoded);
      const comp = compositionRef.current;
      comp.bpm = loaded.bpm;
      comp.timeSignatureNumerator = loaded.timeSignatureNumerator;
      comp.timeSignatureDenominator = loaded.timeSignatureDenominator;
      comp.tracks = loaded.tracks;
      comp.notes = loaded.notes;
      comp.totalBeats = loaded.totalBeats;
      setComposition({ ...comp });
      setStatusMessage("Composition loaded — press Play");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Load failed: ${message}`);
    }
  };

  return (
    <div className="app-shell">
      <section className="stage-panel">
        <div className="stage-header">
          <div className="badge">WebMCP Music Sequencer</div>
          <div className="scene">{snapshot.scene}</div>
        </div>

        <PianoRoll
          composition={composition}
          playheadBeat={playheadBeat}
          latestNoteId={latestNoteId}
          isPlaying={isPlaying}
          activeNotes={activeNotes}
          mutedTracks={mutedTracks}
          onToggleMute={handleToggleMute}
        />

        <PlaybackControls
          composition={composition}
          isPlaying={isPlaying}
          isAgentRunning={isRunning}
          onPlay={handlePlay}
          onStop={handleStop}
          onExport={handleExport}
          onExportMp3={handleExportMp3}
          onShare={handleShare}
          shareUrl={shareUrl}
          isExportingMp3={isExportingMp3}
          onStopAgent={stopAgent}
        />
      </section>

      <aside className="control-panel">
        <section className="panel hero">
          <h1>Autonomous MCP Composer</h1>
          <p>
            An AI agent composes a full piece via WebMCP tool calls. Watch notes appear on the piano roll,
            then press Play to hear the result.
          </p>
          <div className="status-line">
            <span className={`status-dot ${snapshot.isNativeSupported ? "native" : "polyfill"}`} />
            <strong>{snapshot.isNativeSupported ? "Native WebMCP" : "Polyfill runtime"}</strong>
            <span>{statusMessage}</span>
          </div>
        </section>

        <section className="panel">
          <h2>Composition Objective</h2>

          <label className="field">
            <span>Describe the piece</span>
            <textarea
              value={config.objective}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateConfig("objective", event.target.value)}
              rows={4}
            />
          </label>

          <div className="field-grid">
            <label className="field">
              <span>Gateway Endpoint</span>
              <input
                value={config.endpoint}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateConfig("endpoint", event.target.value)}
                placeholder="/v1/anthropic/v1/messages"
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={config.model}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateConfig("model", event.target.value)}
                placeholder="claude-sonnet-4-5"
              />
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={config.apiKey}
                onChange={(event: ChangeEvent<HTMLInputElement>) => updateConfig("apiKey", event.target.value)}
                placeholder="Bearer token..."
              />
            </label>
            <label className="field">
              <span>Speed</span>
              <select
                value={config.speed}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateConfig("speed", event.target.value as AgentRunConfig["speed"])
                }
              >
                <option value="cinematic">Cinematic</option>
                <option value="balanced">Balanced</option>
                <option value="rapid">Rapid</option>
              </select>
            </label>
          </div>

          <div className="button-row">
            <button className="btn primary" onClick={startAgent} disabled={isRunning}>
              {isRunning ? "Composing..." : "Start Agent"}
            </button>
            <button className="btn" onClick={stopAgent} disabled={!isRunning}>
              Stop
            </button>
            <button className="btn accent" onClick={surpriseObjective} disabled={isRunning}>
              Surprise
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Replay + Share</h2>
          <div className="button-row">
            <button className="btn" onClick={handleShare}>
              Copy Share Link
            </button>
            <button className="btn" onClick={replayFromHash}>
              Replay from Link
            </button>
            <button className="btn" onClick={handleExport}>
              Export JSON
            </button>
          </div>
          <p className="hint">
            URL hash format: <code>#run=...</code>. No backend required.
          </p>
        </section>

        <section className="panel">
          <h2>Live Metrics</h2>
          <div className="metrics-grid">
            {metrics.map((metric) => (
              <article key={metric.label} className="metric">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Registered Tools ({snapshot.tools.length})</h2>
          <div className="tool-list">
            {snapshot.tools.map((tool) => (
              <article key={tool.name} className="tool-item">
                <header>
                  <strong>{tool.name}</strong>
                  <span>{Object.keys(tool.inputSchema.properties || {}).length} params</span>
                </header>
                <p>{tool.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Event Stream</h2>
          <div className="log-panel">
            {snapshot.logs.map((entry, index) => (
              <div className="log-entry" key={`${entry.at}-${index}`}>
                <span className="log-time">{formatLogTime(entry.at)}</span>
                <span className={`log-text ${entry.level}`}>{entry.message}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
