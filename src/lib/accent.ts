"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ACCENT_STORAGE_KEY } from "./theme";

/** `key` matches the data-accent selector in tokens.css; "blue" is the default (no attribute). */
export const ACCENTS = [
  { key: "blue", label: "Blue", swatch: "#3b6fb6" },
  { key: "green", label: "Green", swatch: "#2f7d5b" },
  { key: "violet", label: "Violet", swatch: "#6b57c4" },
  { key: "orange", label: "Orange", swatch: "#b85a17" },
  { key: "graphite", label: "Graphite", swatch: "#3a3a3c" },
] as const;
export type AccentKey = (typeof ACCENTS)[number]["key"];

const listeners = new Set<() => void>();

function read(): AccentKey {
  try {
    const v = localStorage.getItem(ACCENT_STORAGE_KEY);
    return ACCENTS.some((a) => a.key === v) ? (v as AccentKey) : "blue";
  } catch {
    return "blue";
  }
}

export function useAccent() {
  const accent = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    read,
    () => "blue" as AccentKey,
  );
  const setAccent = useCallback((key: AccentKey) => {
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, key);
    } catch {
      /* storage unavailable: still apply for this session */
    }
    if (key === "blue") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = key;
    listeners.forEach((l) => l());
  }, []);
  return { accent, setAccent };
}
