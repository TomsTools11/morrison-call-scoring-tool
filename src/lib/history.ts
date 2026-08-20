import type { HistoryEntry, ScorecardResponse } from "../types";

const STORAGE_KEY = "morrison.scorecards.v1";
const MAX_ENTRIES = 50;

/**
 * History lives in this browser only — there is no server-side store. Two
 * people scoring calls on different machines will not see each other's runs.
 */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveScorecard(scorecard: ScorecardResponse): HistoryEntry {
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    scorecard,
  };
  const next = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded (a long transcript on a full store) — the scorecard on
    // screen is still valid, it just won't appear in history.
    console.warn("Could not persist scorecard to history");
  }
  return entry;
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do, and nothing the user needs to see */
  }
}
