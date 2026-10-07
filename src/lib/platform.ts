"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** True on Apple platforms, where the shortcut modifier is ⌘ rather than Ctrl. False during server rendering. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

export interface Shortcut {
  keys: string;
  /** Needs ⌘ (Mac) or Ctrl. */
  mod: boolean;
  /** Needs ⌥ (Mac) or Alt. */
  alt?: boolean;
  label: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: "K", mod: true, label: "Command menu: search, switch tabs, jump anywhere" },
  { keys: "⇧O", mod: true, label: "New tab" },
  { keys: "W", mod: false, alt: true, label: "Close tab" },
  { keys: "] / [", mod: false, alt: true, label: "Next / previous tab" },
  { keys: "1–9", mod: false, alt: true, label: "Jump to tab" },
  { keys: "⇧D", mod: true, label: "Developer mode (traces)" },
  { keys: "Esc", mod: false, label: "Close a panel or menu" },
  { keys: "Enter", mod: false, label: "Send message (Shift+Enter for a new line)" },
];

export function formatShortcut(s: Shortcut, mac: boolean): string {
  return `${s.mod ? (mac ? "⌘" : "Ctrl+") : ""}${s.alt ? (mac ? "⌥" : "Alt+") : ""}${s.keys}`;
}
