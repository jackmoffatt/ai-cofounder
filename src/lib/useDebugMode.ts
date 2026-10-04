"use client";

import { useSyncExternalStore } from "react";

const KEY = "debug";
const listeners = new Set<() => void>();

const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function setDebugMode(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: no-op */
  }
  listeners.forEach((l) => l());
}

export const toggleDebugMode = () => setDebugMode(!read());

/** Developer mode: shows per-reply traces. Toggle with Ctrl/Cmd+Shift+D. */
export function useDebugMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    read,
    () => false,
  );
}
