import { useEffect, useRef, useState } from "react";

const getNumberEnv = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const TYPEWRITER_SPEED_MULTIPLIER = 1.5;
const RAW_TYPEWRITER_TICK_MS = getNumberEnv(
  process.env.NEXT_PUBLIC_TYPEWRITER_TICK_MS,
  30,
  0,
  2000
);
const TYPEWRITER_TICK_MS =
  RAW_TYPEWRITER_TICK_MS <= 0
    ? RAW_TYPEWRITER_TICK_MS
    : Math.max(1, Math.round(RAW_TYPEWRITER_TICK_MS / TYPEWRITER_SPEED_MULTIPLIER));
const TYPEWRITER_CHARS_PER_TICK = getNumberEnv(
  process.env.NEXT_PUBLIC_TYPEWRITER_CHARS_PER_TICK,
  2,
  1,
  20
);

export function useTypewriter(text: string, active: boolean) {
  const [displayed, setDisplayed] = useState(active ? "" : text);
  const indexRef = useRef(active ? 0 : text.length);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
    if (!active || TYPEWRITER_TICK_MS <= 0) {
      indexRef.current = text.length;
      setDisplayed(text);
      return;
    }
    if (text.length < indexRef.current) {
      indexRef.current = 0;
      setDisplayed("");
    }
  }, [text, active]);

  useEffect(() => {
    if (!active || TYPEWRITER_TICK_MS <= 0) return;

    const timer = window.setInterval(() => {
      const target = textRef.current;
      if (indexRef.current >= target.length) {
        window.clearInterval(timer);
        return;
      }
      indexRef.current = Math.min(target.length, indexRef.current + TYPEWRITER_CHARS_PER_TICK);
      setDisplayed(target.slice(0, indexRef.current));
    }, TYPEWRITER_TICK_MS);

    return () => window.clearInterval(timer);
  }, [active, text]);

  return active ? displayed : text;
}
