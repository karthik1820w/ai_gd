/** Scene colours come from the room's own CSS variables, so the 3D table follows the sage, paper and night reading modes. */
export type Theme = {
  bg: string; card: string; ink: string; muted: string; line: string; ring: string;
  accent: string; speak: string; gold: string; good: string; bad: string; face: string;
};

export const FALLBACK_THEME: Theme = {
  bg: "#e4ebe3", card: "#f3f6f1", ink: "#1f2a25", muted: "#5c6a62", line: "#cfd9cf", ring: "#cbd8cb",
  accent: "#3f7d73", speak: "#3f7d73", gold: "#c4973e", good: "#3f8f5a", bad: "#a3463f", face: "#0b6b3a",
};

const NAMES: Record<keyof Theme, string> = {
  bg: "--rt-bg", card: "--rt-card", ink: "--rt-ink", muted: "--rt-muted", line: "--rt-line", ring: "--rt-ring",
  accent: "--rt-accent", speak: "--rt-speak", gold: "--rt-gold", good: "--rt-good", bad: "--rt-bad", face: "--rt-face",
};

export function readTheme(element: Element): Theme {
  const style = getComputedStyle(element);
  const next = { ...FALLBACK_THEME };
  (Object.keys(NAMES) as Array<keyof Theme>).forEach((key) => {
    const value = style.getPropertyValue(NAMES[key]).trim();
    // three.js reads hex, rgb() and hsl(); anything else keeps the fallback rather than warning.
    if (/^(#|rgb|hsl)/i.test(value)) next[key] = value;
  });
  return next;
}

export function sameTheme(a: Theme, b: Theme) {
  return (Object.keys(NAMES) as Array<keyof Theme>).every((key) => a[key] === b[key]);
}

/** Night mode is the one reading mode with a dark background. Read from the colour itself, so a future dark mode is picked up too. */
export function isDarkTheme(theme: Theme) {
  const match = /^#([0-9a-f]{6})$/i.exec(theme.bg.trim());
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const luminance = (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
  return luminance < 0.35;
}
