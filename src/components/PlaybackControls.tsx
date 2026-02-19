import React from "react";
import type { CompositionState } from "../types";

interface PlaybackControlsProps {
  composition: CompositionState;
  isPlaying: boolean;
  isAgentRunning: boolean;
  onPlay: () => void;
  onStop: () => void;
  onExport: () => void;
  onExportMp3: () => void;
  onExportStems: () => void;
  onShare: () => void;
  shareUrl: string | null;
  isExportingMp3: boolean;
  isExportingStems: boolean;
  onStopAgent?: () => void;
}

export function PlaybackControls({
  composition,
  isPlaying,
  isAgentRunning,
  onPlay,
  onStop,
  onExport,
  onExportMp3,
  onExportStems,
  onShare,
  shareUrl,
  isExportingMp3,
  isExportingStems,
  onStopAgent
}: PlaybackControlsProps) {
  const hasNotes = composition.notes.length > 0;
  const canPlay = hasNotes;

  const totalSeconds =
    composition.totalBeats > 0 && composition.bpm > 0
      ? (composition.totalBeats / composition.bpm) * 60
      : 0;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const durationLabel =
    totalSeconds > 0
      ? `${minutes}:${String(seconds).padStart(2, "0")}`
      : "--:--";

  return (
    <div className="playback-controls">
      <div className="playback-controls-left">
        {!isPlaying ? (
          <button
            className={`playback-btn play-btn ${canPlay ? "ready" : "disabled"}`}
            onClick={canPlay ? onPlay : undefined}
            disabled={!canPlay}
            title={!hasNotes ? "No notes to play" : "Play composition"}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <polygon points="4,2 16,9 4,16" />
            </svg>
            <span>Play</span>
          </button>
        ) : (
          <button className="playback-btn stop-btn" onClick={onStop}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <rect x="3" y="3" width="12" height="12" rx="1.5" />
            </svg>
            <span>Stop</span>
          </button>
        )}

        {isAgentRunning && (
          <button
            className="playback-btn stop-agent-btn"
            onClick={onStopAgent}
            title="Stop the agent"
            style={{ marginLeft: "8px", opacity: 0.85 }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="1" />
            </svg>
            <span>Stop Agent</span>
          </button>
        )}

        <div className="playback-duration">
          <span className="playback-duration-label">Duration</span>
          <span className="playback-duration-value">{durationLabel}</span>
        </div>
      </div>

      <div className="playback-controls-right">
        <button
          className="playback-btn secondary-btn mp3-btn"
          onClick={onExportMp3}
          disabled={!hasNotes || isExportingMp3}
          title="Export as 320kbps MP3"
        >
          {isExportingMp3 ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 4">
                <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.8s" repeatCount="indefinite" />
              </circle>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          )}
          <span>{isExportingMp3 ? "Rendering..." : "MP3"}</span>
        </button>

        <button
          className="playback-btn secondary-btn"
          onClick={onExportStems}
          disabled={!hasNotes || isExportingStems}
          title="Export each track as a separate WAV stem"
        >
          {isExportingStems ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 4">
                <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.8s" repeatCount="indefinite" />
              </circle>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2 3h10M2 7h7M2 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              <path d="M10 8v4M8 10l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
            </svg>
          )}
          <span>{isExportingStems ? "Rendering..." : "Stems"}</span>
        </button>

        <button
          className="playback-btn secondary-btn"
          onClick={onExport}
          disabled={!hasNotes}
          title="Export composition as JSON"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
          <span>JSON</span>
        </button>

        <button
          className="playback-btn secondary-btn"
          onClick={onShare}
          disabled={!hasNotes}
          title="Copy share link"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="11" cy="3" r="1.5" />
            <circle cx="3" cy="7" r="1.5" />
            <circle cx="11" cy="11" r="1.5" />
            <line x1="4.5" y1="6.2" x2="9.5" y2="3.8" stroke="currentColor" strokeWidth="1.2" />
            <line x1="4.5" y1="7.8" x2="9.5" y2="10.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span>Share</span>
        </button>

        {shareUrl && (
          <div className="share-url-badge">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
            <span>Link copied</span>
          </div>
        )}
      </div>
    </div>
  );
}
