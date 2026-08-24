import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API: female TTS + speech-to-text listening, with a live mic level meter.
export function useSpeech() {
  const [supported, setSupported] = useState({ tts: false, stt: false });
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0); // 0..1 audio amplitude

  const voiceRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  // pick a female-sounding english voice
  const pickVoice = useCallback(() => {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!voices.length) return;
    const prefer = [
      "samantha", "google uk english female", "google us english", "microsoft zira",
      "karen", "moira", "tessa", "fiona", "victoria", "serena", "female",
    ];
    let chosen = null;
    for (const name of prefer) {
      chosen = voices.find((v) => v.name.toLowerCase().includes(name));
      if (chosen) break;
    }
    if (!chosen) chosen = voices.find((v) => v.lang && v.lang.startsWith("en")) || voices[0];
    voiceRef.current = chosen;
  }, []);

  useEffect(() => {
    const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    setSupported({ tts: !!hasTTS, stt: !!SR });
    if (hasTTS) {
      pickVoice();
      window.speechSynthesis.onvoiceschanged = pickVoice;
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    };
  }, [pickVoice]);

  const speak = useCallback((text, opts = {}) => {
    if (!window.speechSynthesis || !text) {
      opts.onEnd && opts.onEnd();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utter.voice = voiceRef.current;
    utter.pitch = 1.08;
    utter.rate = 1.02;
    utter.volume = 1;
    let tick = null;
    utter.onstart = () => {
      setSpeaking(true);
      // simulate speaking amplitude for the visualizer
      tick = setInterval(() => {
        setLevel(0.35 + Math.random() * 0.5);
      }, 90);
      opts.onStart && opts.onStart();
    };
    const finish = () => {
      if (tick) clearInterval(tick);
      setSpeaking(false);
      setLevel(0);
      opts.onEnd && opts.onEnd();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  }, []);

  const cancelSpeak = useCallback(() => {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    setSpeaking(false);
    setLevel(0);
  }, []);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        setLevel(Math.min(1, avg * 2.2));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      // mic meter optional
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch (e) {}
      audioCtxRef.current = null;
    }
    setLevel(0);
  }, []);

  const startListening = useCallback((onResult, onEnd) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      onEnd && onEnd(null);
      return;
    }
    cancelSpeak();
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    recognitionRef.current = rec;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      onResult && onResult(finalText || interim, !!finalText);
    };
    rec.onend = () => {
      setListening(false);
      stopMeter();
      onEnd && onEnd(finalText.trim());
    };
    rec.onerror = () => {
      setListening(false);
      stopMeter();
    };
    setListening(true);
    startMeter();
    rec.start();
  }, [cancelSpeak, startMeter, stopMeter]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  }, []);

  return { supported, speaking, listening, level, speak, cancelSpeak, startListening, stopListening };
}
