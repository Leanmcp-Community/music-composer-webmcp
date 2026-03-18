import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import posthog from "posthog-js";
import { saveShare, loadShare } from "./runtime/shareService";
import { useAuth } from "./runtime/useAuth";
import { PianoRoll, type PianoRollHandle } from "./components/PianoRoll";
import { PlaybackControls } from "./components/PlaybackControls";
import { AudioEngine, exportMp3, exportStems } from "./runtime/audioEngine";
import { AgentEngine } from "./runtime/agentEngine";
import { createMusicTools, createInitialCompositionState } from "./runtime/musicToolRegistry";
import { ReplayEngine } from "./runtime/replayEngine";
import { WebMcpRuntime, type RuntimeSnapshot } from "./runtime/webmcpRuntime";
import type { AgentRunConfig, CompositionState, MusicNote } from "./types";
import { MODEL_OPTIONS, DEFAULT_MODEL, type ModelOption } from "./config/models";

const runtimeSingleton = new WebMcpRuntime();
const replaySingleton = new ReplayEngine();
const agentSingleton = new AgentEngine(runtimeSingleton, replaySingleton);
const audioEngine = new AudioEngine();

const DEFAULT_CONFIG: AgentRunConfig = {
  objective:
    "Happy summer pop song",
  provider: DEFAULT_MODEL.provider,
  model: DEFAULT_MODEL.model,
  apiKey: "",
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(withPadding);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function compactify(comp: CompositionState): object {
  return {
    b: comp.bpm,
    n: comp.timeSignatureNumerator,
    d: comp.timeSignatureDenominator,
    t: comp.totalBeats,
    tr: Object.fromEntries(
      Object.entries(comp.tracks).map(([k, v]) => [k, {
        i: v.instrument, v: v.volume, p: v.pan, r: v.reverb,
        ...(v.synthParams ? { s: v.synthParams } : {}),
        ...(v.lfoParams ? { l: v.lfoParams } : {}),
        ...(v.distortion ? { dt: v.distortion } : {}),
        ...(v.delayParams ? { dl: v.delayParams } : {}),
      }])
    ),
    ns: comp.notes.map(n => [
      n.id, n.track, n.pitch, n.beat, n.duration, n.velocity, n.addedAt
    ])
  };
}

function decompactify(raw: Record<string, unknown>): CompositionState {
  const tr = raw.tr as Record<string, Record<string, unknown>>;
  const tracks: Record<string, import("./types").MusicTrack> = {};
  for (const [k, v] of Object.entries(tr)) {
    tracks[k] = {
      name: k,
      instrument: v.i as import("./types").InstrumentName,
      volume: (v.v as number) ?? 0.75,
      pan: (v.p as number) ?? 0,
      reverb: (v.r as number) ?? 0.2,
      ...(v.s ? { synthParams: v.s as import("./types").SynthParams } : {}),
      ...(v.l ? { lfoParams: v.l as import("./types").LfoParams } : {}),
      ...(v.dt ? { distortion: v.dt as import("./types").DistortionParams } : {}),
      ...(v.dl ? { delayParams: v.dl as import("./types").DelayParams } : {}),
    };
  }
  const ns = raw.ns as unknown[][];
  return {
    bpm: raw.b as number,
    timeSignatureNumerator: raw.n as number,
    timeSignatureDenominator: raw.d as number,
    totalBeats: raw.t as number,
    tracks,
    notes: ns.map(a => ({
      id: a[0] as string, track: a[1] as string, pitch: a[2] as string,
      beat: a[3] as number, duration: a[4] as number, velocity: a[5] as number,
      addedAt: (a[6] as number) ?? 0
    }))
  };
}

async function deflateBytes(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

async function inflateBytes(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

async function encodeComposition(comp: CompositionState): Promise<string> {
  const json = JSON.stringify(compactify(comp));
  const raw = new TextEncoder().encode(json);
  const compressed = await deflateBytes(raw);
  return "z" + bytesToBase64Url(compressed);
}

async function decodeComposition(value: string): Promise<CompositionState> {
  if (value.startsWith("z")) {
    const compressed = base64UrlToBytes(value.slice(1));
    const inflated = await inflateBytes(compressed);
    const json = new TextDecoder().decode(inflated);
    return decompactify(JSON.parse(json));
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
  const binary = atob(withPadding);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as CompositionState;
}

function readShareParam(): { type: "id"; value: string } | { type: "comp"; value: string } | null {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  if (id && id.trim().length > 0) return { type: "id", value: id.trim() };
  const hash = window.location.hash.replace(/^#/, "");
  const hashParams = new URLSearchParams(hash);
  const comp = hashParams.get("comp");
  if (comp && comp.trim().length > 0) return { type: "comp", value: comp.trim() };
  return null;
}

function buildShareUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?id=${id}`;
}

function snapComposition(c: CompositionState): CompositionState {
  return {
    bpm: c.bpm,
    timeSignatureNumerator: c.timeSignatureNumerator,
    timeSignatureDenominator: c.timeSignatureDenominator,
    tracks: { ...c.tracks },
    notes: c.notes.slice(),
    totalBeats: c.totalBeats
  };
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
  const [isExportingStems, setIsExportingStems] = useState(false);
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const mutedTracksRef = useRef<Set<string>>(new Set());
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const pianoRollRef = useRef<PianoRollHandle>(null);
  const { user, login, logout } = useAuth();
  const [freeRunsUsed, setFreeRunsUsed] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("webmcp_free_runs") ?? "0", 10) || 0; } catch { return 0; }
  });
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
        setComposition(snapComposition(c));

        if (isAgentRunningRef.current && c.totalBeats >= 2) {
          const prevCount = tracksWithNotesRef.current.size;
          const newTracksWithNotes = new Set<string>();
          for (const n of c.notes) newTracksWithNotes.add(n.track);
          const newCount = newTracksWithNotes.size;
          tracksWithNotesRef.current = newTracksWithNotes;

          if (layeredRestartTimerRef.current) clearTimeout(layeredRestartTimerRef.current);
          layeredRestartTimerRef.current = setTimeout(() => {
            const latest = compositionRef.current;
            const snap = snapComposition(latest);
            if (audioEngine.getIsPlaying()) {
              audioEngine.updateComposition(snap);
            } else {
              audioEngine.play(snap, mutedTracksRef.current, { loop: true });
              setIsPlaying(true);
              setPlayheadBeat(0);
            }
          }, 350);
        }
      },
      () => {
        const c = compositionRef.current;
        setComposition(snapComposition(c));
      }
    );

    runtimeSingleton.registerTools(tools);

    posthog.init("phc_EoMHKFbx6j2wUFsf8ywqgHntY4vEXC3ZzLFoPJVjRRT", {
      api_host: "https://d18m0xvdtnkibr.cloudfront.net",
      session_recording: { maskAllInputs: false },
      capture_pageview: true,
      capture_pageleave: true,
    });


    const shareParam = readShareParam();
    if (shareParam) {
      if (shareParam.type === "id") {
        setStatusMessage("Loading shared composition...");
        loadShare(shareParam.value).then((payload) => {
          if (!payload) { setStatusMessage("Share link not found."); return; }
          const comp = compositionRef.current;
          const loaded = payload.composition;
          comp.bpm = loaded.bpm;
          comp.timeSignatureNumerator = loaded.timeSignatureNumerator;
          comp.timeSignatureDenominator = loaded.timeSignatureDenominator;
          comp.tracks = loaded.tracks;
          comp.notes = loaded.notes;
          comp.totalBeats = loaded.totalBeats;
          setComposition({ ...comp });
          if (payload.prompt) {
            setConfig((prev) => ({ ...prev, objective: payload.prompt }));
          }
          if (payload.metrics && payload.toolCallHistory) {
            runtimeSingleton.restoreFromShare(payload.metrics, payload.toolCallHistory);
          }
          setStatusMessage(`Shared composition loaded — press Play`);
        }).catch(() => setStatusMessage("Failed to load share link."));
      } else {
        decodeComposition(shareParam.value).then((loaded) => {
          const comp = compositionRef.current;
          comp.bpm = loaded.bpm;
          comp.timeSignatureNumerator = loaded.timeSignatureNumerator;
          comp.timeSignatureDenominator = loaded.timeSignatureDenominator;
          comp.tracks = loaded.tracks;
          comp.notes = loaded.notes;
          comp.totalBeats = loaded.totalBeats;
          setComposition({ ...comp });
          setStatusMessage("Shared composition loaded — press Play");
        }).catch(() => setStatusMessage("Invalid share link."));
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

  useEffect(() => {
    if (user) {
      posthog.identify(user.uid, {
        email: user.email,
        name: user.displayName,
      });
    } else {
      posthog.reset();
    }
  }, [user]);

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
    const selectedModel = MODEL_OPTIONS.find((m) => m.model === config.model);
    if (selectedModel?.loginRequired && !user) {
      login();
      setStatusMessage("Sign in to use this model");
      return;
    }

    if (!user && freeRunsUsed >= 1) {
      login();
      setStatusMessage("Sign in to continue composing");
      return;
    }

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
      if (!user) setFreeRunsUsed((n) => {
        const next = n + 1;
        try { localStorage.setItem("webmcp_free_runs", String(next)); } catch { /* */ }
        return next;
      });
      if (window.lmcp && !window.lmcp.hasCredits()) {
        window.lmcp.showCreditsModal();
        return;
      }
      await agentSingleton.run({ ...config, apiKey: "" }, {
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

  const handleTrackVolumeChange = useCallback((trackName: string, volume: number) => {
    setTrackVolumes((prev) => ({ ...prev, [trackName]: volume }));
    audioEngine.updateTrackVolume(trackName, volume);
  }, []);

  const handlePlay = useCallback(() => {
    const comp = compositionRef.current;
    if (!comp.notes.length) return;
    pianoRollRef.current?.centerOnNotes();
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
    setStatusMessage("Saving share link...");
    try {
      const currentSnapshot = runtimeSingleton.getSnapshot();
      const replayRun = replaySingleton.getCurrent();
      const id = await saveShare({
        composition: snapComposition(comp),
        prompt: config.objective,
        model: config.model,
        endpoint: `gateway/${config.provider}`,
        metrics: currentSnapshot.metrics,
        toolCallHistory: replayRun?.toolCalls ?? [],
        replayRun: replayRun ?? null,
        ...(user?.uid ? { firebaseUid: user.uid } : {}),
      });
      const url = buildShareUrl(id);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard blocked */
      }
      window.history.replaceState(null, "", `?id=${id}`);
      setShareUrl(url);
      setStatusMessage("Share link copied");
      setTimeout(() => setShareUrl(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Share failed: ${msg}`);
    }
  }, [config]);

  const handleExportStems = useCallback(async () => {
    const comp = compositionRef.current;
    if (!comp.notes.length) {
      setStatusMessage("No composition to export.");
      return;
    }
    setIsExportingStems(true);
    setStatusMessage("Rendering stems...");
    try {
      const stems = await exportStems(comp);
      for (const stem of stems) {
        const url = URL.createObjectURL(stem.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${stem.name}-${Date.now()}.wav`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      setStatusMessage(`${stems.length} stem${stems.length !== 1 ? "s" : ""} exported`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Stem export failed: ${msg}`);
    } finally {
      setIsExportingStems(false);
    }
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
    const shareParam = readShareParam();
    if (!shareParam) {
      setStatusMessage("No share link found in URL.");
      return;
    }
    try {
      let loaded: CompositionState;
      if (shareParam.type === "id") {
        const payload = await loadShare(shareParam.value);
        if (!payload) { setStatusMessage("Share link not found."); return; }
        loaded = payload.composition;
        if (payload.prompt) setConfig((prev) => ({ ...prev, objective: payload.prompt }));
      } else {
        loaded = await decodeComposition(shareParam.value);
      }
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
          <div className="badge">WebMCP Music Composer</div>
          <div className="scene">{snapshot.scene}</div>
        </div>

        <PianoRoll
          ref={pianoRollRef}
          composition={composition}
          playheadBeat={playheadBeat}
          latestNoteId={latestNoteId}
          isPlaying={isPlaying}
          activeNotes={activeNotes}
          mutedTracks={mutedTracks}
          onToggleMute={handleToggleMute}
          trackVolumes={trackVolumes}
          onTrackVolumeChange={handleTrackVolumeChange}
          isAgentRunning={isRunning}
        />

        <PlaybackControls
          composition={composition}
          isPlaying={isPlaying}
          isAgentRunning={isRunning}
          onPlay={handlePlay}
          onStop={handleStop}
          onExport={handleExport}
          onExportMp3={handleExportMp3}
          onExportStems={handleExportStems}
          onShare={handleShare}
          shareUrl={shareUrl}
          isExportingMp3={isExportingMp3}
          isExportingStems={isExportingStems}
          onStopAgent={stopAgent}
        />
      </section>

      <aside className="control-panel">
        <section className="panel hero">
          <h1>WebMCP Music Composer</h1>
          <p>
            An AI agent composes a full piece via WebMCP tool calls. Watch notes appear on the piano roll,
            then press Play to hear the result.
          </p>
          <div className="status-line">
            <span className={`status-dot ${snapshot.isNativeSupported ? "native" : "polyfill"}`} />
            <strong>{snapshot.isNativeSupported ? "Native WebMCP" : "Polyfill runtime"}</strong>
            <span>{statusMessage}</span>
          </div>
          {user ? (
            <div className="auth-bar">
              {user.photoURL && <img className="auth-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
              <span className="auth-email">{user.displayName ?? user.email}</span>
              <button className="btn btn-sm" onClick={logout}>Sign out</button>
            </div>
          ) : (
            <div className="auth-bar">
              <button className="btn primary" onClick={login}>Sign in with Google</button>
              <span className="auth-hint">1 free generation, then sign in</span>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Composition Prompt</h2>

          <label className="field">
            <span>Describe the piece</span>
            <textarea
              value={config.objective}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateConfig("objective", event.target.value)}
              rows={4}
            />
          </label>

          <label className="field">
            <span>Model</span>
            <select
              value={config.model}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const opt = MODEL_OPTIONS.find((m) => m.model === event.target.value);
                if (opt) setConfig((prev) => ({ ...prev, provider: opt.provider, model: opt.model }));
              }}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.model} value={opt.model} disabled={opt.loginRequired && !user}>
                  {opt.label}{opt.loginRequired ? " (sign in)" : ""}
                </option>
              ))}
            </select>
          </label>

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
