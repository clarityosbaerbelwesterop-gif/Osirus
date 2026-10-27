"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Speaking with a bot in the browser: dictation (SpeechRecognition) and
// reading answers aloud (speechSynthesis). Recognition is the browser's own
// speech service (Chrome sends the audio to Google, Safari to Apple or the
// device); Osirus receives only the recognised text and records no audio.
// Absent APIs simply hide the buttons.

type RecognitionResult = { transcript: string };
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<RecognitionResult> & { isFinal: boolean }>;
};
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const subscribeNever = () => () => undefined;
const canDictate = () => recognitionCtor() !== null;
const canSpeak = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;
const onServer = () => false;

/** Markdown to plain speech: no symbols, no code blocks, no links. */
export function speechText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " Codeblock. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(\d+)\]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>|]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim()
    .slice(0, 4000);
}

export function useVoice(onText: (text: string, final: boolean) => void) {
  const dictation = useSyncExternalStore(subscribeNever, canDictate, onServer);
  const speech = useSyncExternalStore(subscribeNever, canSpeak, onServer);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const stopListening = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const listen = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    window.speechSynthesis?.cancel();
    const rec = new Ctor();
    rec.lang = document.documentElement.lang || "de-DE";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      let text = "";
      let final = false;
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        text += result[0]?.transcript ?? "";
        if (result.isFinal) final = true;
      }
      onTextRef.current(text.trim(), final);
    };
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, []);

  const speak = useCallback((markdown: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const text = speechText(markdown);
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = document.documentElement.lang || "de-DE";
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const hush = useCallback(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  useEffect(
    () => () => {
      recognition.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
    [],
  );

  return {
    dictation,
    speech,
    listening,
    speaking,
    listen,
    stopListening,
    speak,
    hush,
  };
}
