import React from "react";
import { Mic, Square, Volume2, VolumeX, Sparkles, CircleDot } from "lucide-react";

export const AudioController = ({
  listening,
  speaking,
  muted,
  onToggleMute,
  onPushToTalk,
  onStopListening,
  mode,
  onToggleMode,
  sttSupported,
}) => {
  return (
    <div className="archi-control-bar" data-testid="control-bar">
      <button
        data-testid="mute-toggle"
        className="archi-icon-btn"
        onClick={onToggleMute}
        title={muted ? "Voice muted" : "Voice on"}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      <button
        data-testid="face-style-toggle"
        className="archi-icon-btn"
        onClick={onToggleMode}
        title="Switch face"
      >
        {mode === "orb" ? <CircleDot size={18} /> : <Sparkles size={18} />}
        <span className="archi-btn-label">{mode === "orb" ? "ORB" : "CIRCUIT"}</span>
      </button>

      {listening ? (
        <button
          data-testid="push-to-talk-button"
          className="archi-talk-btn is-listening"
          onClick={onStopListening}
        >
          <span className="archi-talk-rings" />
          <Square size={20} />
          <span>Listening…</span>
        </button>
      ) : (
        <button
          data-testid="push-to-talk-button"
          className="archi-talk-btn"
          onClick={onPushToTalk}
          disabled={!sttSupported || speaking}
          title={sttSupported ? "Tap to talk" : "Speech recognition not supported in this browser"}
        >
          <Mic size={20} />
          <span>{speaking ? "Archi speaking…" : "Tap to talk"}</span>
        </button>
      )}
    </div>
  );
};

export default AudioController;
