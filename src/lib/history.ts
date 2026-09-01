import type { CriterionStatus, HistoryEntry, ScorecardResponse } from "../types";

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

/**
 * The transcript is by far the largest field on a scorecard — a 40-minute call
 * is ~50KB of text against ~4KB of verdicts — and fifty of them is what pushes
 * the store over quota. Since a quota failure discards the whole write, the
 * scorecard the user just produced would silently vanish from history. It is
 * kept on the in-memory card and in the JSON export, just not in storage.
 */
function forStorage(scorecard: ScorecardResponse): ScorecardResponse {
  const { transcript: _transcript, ...rest } = scorecard;
  return rest;
}

function persist(entries: HistoryEntry[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export function saveScorecard(scorecard: ScorecardResponse): {
  entry: HistoryEntry;
  persisted: boolean;
} {
  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    scorecard: forStorage(scorecard),
  };
  const next = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
  return { entry, persisted: persist(next) };
}

/**
 * Records a reviewer's corrections against a saved scorecard. The machine
 * verdicts stay on the card alongside them, so a corrected run is a labelled
 * example rather than an overwritten one.
 */
export function saveOverrides(
  id: string,
  scorecard: ScorecardResponse,
  overrides: Record<string, CriterionStatus>,
): boolean {
  const next = loadHistory().map((entry) =>
    entry.id === id
      ? { ...entry, scorecard: forStorage(scorecard), overrides, reviewedAt: new Date().toISOString() }
      : entry,
  );
  return persist(next);
}

/**
 * Every reviewer-corrected scorecard, in the shape the eval harness consumes.
 * This is how a labelled set accumulates without anyone doing extra work.
 */
export function exportLabelledSet(): string {
  const labelled = loadHistory().filter((e) => e.overrides && Object.keys(e.overrides).length > 0);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      entries: labelled.map((entry) => ({
        id: entry.id,
        savedAt: entry.savedAt,
        reviewedAt: entry.reviewedAt,
        producer: entry.scorecard.meta.producer,
        scoringVersion: entry.scorecard.meta.scoringVersion,
        facts: entry.scorecard.facts,
        measures: entry.scorecard.measures,
        machine: Object.fromEntries(
          entry.scorecard.sections
            .flatMap((s) => s.criteria)
            .map((c) => [c.id, c.machineStatus ?? c.status]),
        ),
        human: entry.overrides,
      })),
    },
    null,
    2,
  );
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do, and nothing the user needs to see */
  }
}
