import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const initSession = async (sessionId) => {
  const { data } = await axios.post(`${API}/init`, { session_id: sessionId });
  return data;
};

export const getMemory = async (sessionId) => {
  const { data } = await axios.get(`${API}/memory/${sessionId}`);
  return data;
};

export const addMemory = async (sessionId, content) => {
  const { data } = await axios.post(`${API}/memory`, { session_id: sessionId, content });
  return data;
};

export const deleteMemory = async (sessionId, id) => {
  await axios.delete(`${API}/memory/${sessionId}/${id}`);
};

export const clearMessages = async (sessionId) => {
  await axios.delete(`${API}/messages/${sessionId}`);
};

// Streams the assistant reply token-by-token. onDelta(text), onDone(fullText).
export const streamChat = async (sessionId, message, onDelta, onDone, onError) => {
  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
    });
    if (!res.ok || !res.body) {
      onError && onError(new Error(`HTTP ${res.status}`));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          onDone && onDone(full);
          return;
        }
        try {
          const obj = JSON.parse(payload);
          if (obj.delta) {
            full += obj.delta;
            onDelta && onDelta(obj.delta, full);
          } else if (obj.error) {
            onError && onError(new Error(obj.error));
          }
        } catch (e) {
          /* ignore partial */
        }
      }
    }
    onDone && onDone(full);
  } catch (e) {
    onError && onError(e);
  }
};
