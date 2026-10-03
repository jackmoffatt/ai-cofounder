"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ThemePreference,
} from "./theme";

const listeners = new Set<() => void>();
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(pref, darkQuery().matches);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = darkQuery();
  const onSystemChange = () => {
    apply(readPreference());
    cb();
  };
  mq.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystemChange);
  };
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);

  const setPreference = useCallback((pref: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      /* storage unavailable: still apply for this session */
    }
    apply(pref);
    listeners.forEach((l) => l());
  }, []);

  return { preference, setPreference };
}
