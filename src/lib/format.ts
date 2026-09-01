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
  "not scored": { bg: "#F1F1F1", fg: "#6A7482", bd: "#D6DCE5" },
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
 * `metrics.talkShare` is now computed server-side as "N% producer", but a
 * scorecard saved by an older version carries a free-form model string
 * ("60% agent", "40% customer / 60% agent", "roughly even"). Taking the first
 * percentage regardless of whose it was rendered the bar backwards, which
 * points a coaching conversation in exactly the wrong direction — so match the
 * labelled half first and only then fall back.
 */
export function parseTalkShare(raw: string | undefined): number | null {
  if (!raw) return null;
  const labelled =
    raw.match(/(\d{1,3})\s*%\s*(?:agent|producer)/i) ??
    raw.match(/(?:agent|producer)[^0-9]{0,12}(\d{1,3})\s*%/i);
  const match = labelled ?? (/customer|client/i.test(raw) ? null : raw.match(/(\d{1,3})\s*%/));
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

/** Amber for a weak section, red for a failed one — the page uses red for failure everywhere else. */
export function barColor(pct: number): string {
  if (pct === 100) return "#2BBF7A";
  if (pct >= 60) return "#057BE5";
  return pct >= 40 ? "#F0A93B" : "#E5484D";
}

const SECTION_STATE_LABEL: Record<string, string> = {
  not_applicable: "Did not apply",
  not_reached: "Not reached",
  not_attempted: "Not attempted",
};

/**
 * A section that did not apply, one the call never reached, and one the
 * producer stalled before reaching all rendered as a bare em-dash, and they
 * mean completely different things to the person being coached.
 */
export function sectionScoreLabel(section: {
  state?: string;
  score: number;
  maxScore: number;
  forfeitedWeight?: number;
}): string {
  if (section.state === "not_attempted") {
    return `Not attempted — 0 of ${Math.round(section.forfeitedWeight ?? 0)}`;
  }
  if (section.state && section.state !== "graded") {
    return SECTION_STATE_LABEL[section.state] ?? "—";
  }
  return section.maxScore > 0 ? `${section.score}/${section.maxScore}` : "—";
}
