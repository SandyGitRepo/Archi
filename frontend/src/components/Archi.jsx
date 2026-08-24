import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Send, Trash2, Plus, X } from "lucide-react";
import { Toaster, toast } from "sonner";
import VisualizerEngine from "./VisualizerEngine";
import HudPanel from "./HudPanel";
import AudioController from "./AudioController";
import { useSpeech } from "../hooks/useSpeech";
import { initSession, streamChat, getMemory, addMemory, deleteMemory, clearMessages } from "../lib/api";

const SESSION_KEY = "archi_session_id";
// Archi is a single-user personal assistant ("daddy"), so we use one stable
// identity for the vault. This makes memory + history persist across every
// session, browser, and device — never erased between visits.
const FIXED_SESSION_ID = "archi-daddy-main";
function getSessionId() {
  localStorage.setItem(SESSION_KEY, FIXED_SESSION_ID);
  return FIXED_SESSION_ID;
}

const STATE_LABEL = {
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
};

export default function Archi() {
  const sessionId = useRef(getSessionId());
  const { supported, speaking, listening, level, speak, cancelSpeak, startListening, stopListening } = useSpeech();

  const [messages, setMessages] = useState([]);
  const [memory, setMemory] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState(() => localStorage.getItem("archi_mode") || "orb");
  const [muted, setMuted] = useState(() => localStorage.getItem("archi_muted") === "1");
  const [thinking, setThinking] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [addingFact, setAddingFact] = useState(false);
  const [booted, setBooted] = useState(false);

  const mutedRef = useRef(muted);
  const streamingIdRef = useRef(null);
  const transcriptRef = useRef(null);

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // derive visualizer state
  const vizState = speaking ? "speaking" : listening ? "listening" : thinking ? "thinking" : "idle";

  const scrollDown = () => {
    requestAnimationFrame(() => {
      if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    });
  };

  // boot: init session + greet
  useEffect(() => {
    (async () => {
      try {
        const data = await initSession(sessionId.current);
        setMessages(data.messages || []);
        setMemory(data.memory || []);
        setBooted(true);
        scrollDown();
        if (data.is_new && data.greeting && !mutedRef.current) {
          // slight delay so voices are loaded
          setTimeout(() => speak(data.greeting), 700);
        }
      } catch (e) {
        toast.error("Could not reach Archi's core.");
        setBooted(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMemory = async () => {
    try {
      const m = await getMemory(sessionId.current);
      setMemory(m);
    } catch (e) {}
  };

  // Memory is extracted asynchronously on the backend (a follow-up LLM call that
  // can take several seconds), so poll a few times to surface it live.
  const pollMemory = () => {
    [2500, 6000, 11000, 17000, 24000].forEach((d) => setTimeout(refreshMemory, d));
  };

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || thinking) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setThinking(true);
    scrollDown();

    // placeholder assistant message for streaming
    const asstIdx = Date.now();
    streamingIdRef.current = asstIdx;
    setMessages((prev) => [...prev, { role: "assistant", content: "", _sid: asstIdx }]);

    let spokenStarted = false;
    await streamChat(
      sessionId.current,
      msg,
      (delta, full) => {
        setThinking(false);
        setMessages((prev) =>
          prev.map((m) => (m._sid === asstIdx ? { ...m, content: full } : m))
        );
        scrollDown();
      },
      (full) => {
        setThinking(false);
        setMessages((prev) => prev.map((m) => (m._sid === asstIdx ? { ...m, content: full } : m)));
        if (full && !mutedRef.current) speak(full);
        scrollDown();
        pollMemory();
      },
      (err) => {
        setThinking(false);
        toast.error("Archi hit a snag: " + (err?.message || "unknown"));
        setMessages((prev) => prev.filter((m) => m._sid !== asstIdx));
      }
    );
  };

  const pushToTalk = () => {
    cancelSpeak();
    startListening(
      () => {},
      (finalText) => {
        if (finalText && finalText.length) send(finalText);
      }
    );
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      localStorage.setItem("archi_muted", next ? "1" : "0");
      if (next) cancelSpeak();
      return next;
    });
  };

  const toggleMode = () => {
    setMode((mo) => {
      const next = mo === "orb" ? "circuit" : "orb";
      localStorage.setItem("archi_mode", next);
      return next;
    });
  };

  const handleAddFact = async () => {
    const f = newFact.trim();
    if (!f) return;
    try {
      const created = await addMemory(sessionId.current, f);
      setMemory((prev) => [...prev, created]);
      setNewFact("");
      setAddingFact(false);
      toast.success("Archi will remember that, daddy.");
    } catch (e) {
      toast.error("Could not save memory.");
    }
  };

  const handleDeleteFact = async (id) => {
    try {
      await deleteMemory(sessionId.current, id);
      setMemory((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {}
  };

  const handleClearChat = async () => {
    try {
      await clearMessages(sessionId.current);
      cancelSpeak();
      const data = await initSession(sessionId.current);
      setMessages(data.messages || []);
      if (data.greeting && !mutedRef.current) setTimeout(() => speak(data.greeting), 300);
      toast.success("Conversation reset.");
    } catch (e) {}
  };

  const visibleMessages = messages.filter((m) => m.content !== "" || thinking);

  return (
    <div className="archi-root" data-testid="archi-app">
      <Toaster position="top-center" theme="dark" richColors />

      {/* background layers */}
      <div className="archi-bg-grid" />
      <div className="archi-bg-vignette" />

      {/* central visualizer */}
      <div className="archi-viz-layer">
        <VisualizerEngine state={vizState} mode={mode} level={level} />
        <div className="archi-status-readout" data-testid="status-readout">
          <span className="archi-status-pill" data-state={vizState}>
            <span className="archi-status-dot" /> {STATE_LABEL[vizState]}
          </span>
        </div>
      </div>

      {/* top bar */}
      <div className="archi-topbar">
        <div className="archi-brand">
          <span className="archi-brand-mark">A</span>
          <div className="archi-brand-text">
            <span className="archi-brand-name">ARCHI</span>
            <span className="archi-brand-sub">personal intelligence · for daddy</span>
          </div>
        </div>
        <div className="archi-topbar-right">
          <span className="archi-topbar-tag">CLAUDE SONNET 5</span>
        </div>
      </div>

      {/* HUD grid */}
      <div className="archi-hud-layer">
        {/* Chat panel */}
        <div className="archi-col archi-col-left">
          <HudPanel
            title="CONVERSATION"
            side="left"
            testId="chat-panel"
            footer={
              <div className="archi-chat-input-row">
                <input
                  data-testid="chat-input"
                  className="archi-input"
                  value={input}
                  placeholder="Type to Archi…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                />
                <button data-testid="send-button" className="archi-send" onClick={() => send()} disabled={thinking}>
                  <Send size={16} />
                </button>
              </div>
            }
          >
            <div className="archi-transcript" ref={transcriptRef} data-testid="transcript">
              {visibleMessages.map((m, i) => (
                <div key={i} className={`archi-msg archi-msg-${m.role}`} data-testid={`message-${m.role}`}>
                  <span className="archi-msg-who">{m.role === "user" ? "DADDY" : "ARCHI"}</span>
                  <p>{m.content || (m.role === "assistant" && thinking ? "…" : "")}</p>
                </div>
              ))}
              {thinking && !visibleMessages.some((m) => m.role === "assistant" && m.content === "") && (
                <div className="archi-msg archi-msg-assistant">
                  <span className="archi-msg-who">ARCHI</span>
                  <p className="archi-typing"><i /><i /><i /></p>
                </div>
              )}
              {booted && visibleMessages.length === 0 && (
                <div className="archi-empty">Archi is listening for your first word, daddy.</div>
              )}
            </div>
          </HudPanel>
          <button className="archi-clear-btn" data-testid="clear-chat" onClick={handleClearChat}>
            <Trash2 size={13} /> reset conversation
          </button>
        </div>

        {/* Memory panel */}
        <div className="archi-col archi-col-right">
          <HudPanel
            title="MEMORY VAULT"
            side="right"
            accent="#B026FF"
            testId="memory-panel"
            footer={
              addingFact ? (
                <div className="archi-chat-input-row">
                  <input
                    data-testid="memory-input"
                    className="archi-input archi-input-mem"
                    value={newFact}
                    autoFocus
                    placeholder="Remember that…"
                    onChange={(e) => setNewFact(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddFact()}
                  />
                  <button data-testid="save-memory" className="archi-send archi-send-mem" onClick={handleAddFact}>
                    <Plus size={16} />
                  </button>
                </div>
              ) : (
                <button className="archi-add-mem" data-testid="add-memory-toggle" onClick={() => setAddingFact(true)}>
                  <Plus size={13} /> teach Archi something
                </button>
              )
            }
          >
            <div className="archi-memory-list" data-testid="memory-list">
              {memory.length === 0 && (
                <div className="archi-empty">
                  <Brain size={22} style={{ opacity: 0.5, marginBottom: 8 }} />
                  <div>Archi hasn't stored memories yet. Chat, and she'll learn about you automatically.</div>
                </div>
              )}
              <AnimatePresence>
                {memory.map((m) => (
                  <motion.div
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="archi-mem-item"
                    data-testid="memory-item"
                  >
                    <span>{m.content}</span>
                    <button className="archi-mem-del" onClick={() => handleDeleteFact(m.id)} data-testid="delete-memory">
                      <X size={13} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </HudPanel>
        </div>
      </div>

      {/* controls */}
      <AudioController
        listening={listening}
        speaking={speaking}
        muted={muted}
        onToggleMute={toggleMute}
        onPushToTalk={pushToTalk}
        onStopListening={stopListening}
        mode={mode}
        onToggleMode={toggleMode}
        sttSupported={supported.stt}
      />
    </div>
  );
}
