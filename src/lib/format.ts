import type { CriterionStatus } from "../types";

export interface Swatch {
  bg: string;
  fg: string;
  bd: string;
}

/**
 * Keyed off the grade bands the server actually emits — "On System",
 * "Solid", "Needs Work", "Off Script" — and matched case-insensitively so a
 * casing drift can't fall through to an unstyled pill.
 */
const BANDS: Record<string, Swatch> = {
  "on system": { bg: "#EAF9F1", fg: "#1E8F5C", bd: "rgba(43,191,122,0.28)" },
  solid: { bg: "#F1F7FE", fg: "#057BE5", bd: "rgba(5,123,229,0.22)" },
  "needs work": { bg: "#FEF6EA", fg: "#B87613", bd: "rgba(240,169,59,0.3)" },
  "off script": { bg: "#FDEDEE", fg: "#C13438", bd: "rgba(229,72,77,0.28)" },
};

const FALLBACK_BAND: Swatch = { bg: "#F1F1F1", fg: "#6A7482", bd: "#D6DCE5" };

export function bandSwatch(band: string | undefined): Swatch {
  if (!band) return FALLBACK_BAND;
  return BANDS[band.trim().toLowerCase()] ?? FALLBACK_BAND;
}

export const STATUS: Record<CriterionStatus, { color: string; label: string; bg: string; fg: string }> = {
  met: { color: "#2BBF7A", label: "Met", bg: "#EAF9F1", fg: "#1E8F5C" },
  partial: { color: "#F0A93B", label: "Partial", bg: "#FEF6EA", fg: "#B87613" },
  missed: { color: "#E5484D", label: "Missed", bg: "#FDEDEE", fg: "#C13438" },
  na: { color: "#C6D0DE", label: "N/A", bg: "#F1F1F1", fg: "#6A7482" },
};

export function statusOf(status: string | undefined) {
  const key = (status || "").toLowerCase() as CriterionStatus;
  return STATUS[key] ?? STATUS.na;
}

/**
 * `metrics.talkShare` is a free-form model string ("60%", "60% agent",
 * "roughly even"). Pull a leading percentage when there is one; callers fall
 * back to showing the raw string when there isn't.
 */
export function parseTalkShare(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d{1,3})\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export function formatCallDate(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "quoted_not_closed" → "Quoted not closed" */
export function humanize(value: string | undefined): string {
  if (!value) return "—";
  const spaced = value.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function pctWidth(score: number, maxScore: number): number {
  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

export function barColor(pct: number): string {
  return pct === 100 ? "#2BBF7A" : pct >= 60 ? "#057BE5" : "#F0A93B";
}
