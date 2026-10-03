"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import type { ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

const order: ThemePreference[] = ["system", "light", "dark"];
const icons = { system: Monitor, light: Sun, dark: Moon } as const;
const labels = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" } as const;

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const Icon = icons[preference];
  const next = order[(order.indexOf(preference) + 1) % order.length];
  return (
    <IconButton label={labels[preference]} onClick={() => setPreference(next)}>
      <Icon size={16} />
    </IconButton>
  );
}
