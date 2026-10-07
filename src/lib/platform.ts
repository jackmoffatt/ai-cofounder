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

export const SHORTCUTS = [
  { keys: "K", mod: true, label: "Command menu: search conversations, jump anywhere" },
  { keys: "⇧O", mod: true, label: "New chat" },
  { keys: "\\", mod: true, label: "Show or hide the sidebar" },
  { keys: "⇧D", mod: true, label: "Developer mode (traces)" },
  { keys: "Esc", mod: false, label: "Close a panel or menu" },
  { keys: "Enter", mod: false, label: "Send message (Shift+Enter for a new line)" },
] as const;
