import { useMemo, useState } from "react";
import { ChevronDown, ListFilter, RotateCcw } from "lucide-react";
import { StatusDot, StatusPill } from "./Pills";
import { barColor, pctWidth, sectionScoreLabel } from "../lib/format";
import type { CriterionStatus, ScorecardResponse } from "../types";

type Sections = ScorecardResponse["sections"];
type Criterion = Sections[number]["criteria"][number];

/**
 * A criterion the call was never eligible for is not a miss. `scope` is the
 * authority; `status` is the fallback for scorecards saved before scope
 * existed.
 */
const isGraded = (c: Criterion) => (c.scope ? c.scope === "in_scope" : c.status !== "na");
const isMiss = (c: Criterion) => isGraded(c) && (c.status === "missed" || c.status === "partial");

const OVERRIDE_OPTIONS: CriterionStatus[] = ["met", "partial", "missed", "na"];

/**
 * Sections carrying something to coach on start open; a clean sheet stays
 * open too. N/A doesn't count — a criterion that never applied is not a miss.
 */
function defaultOpenState(sections: Sections): Record<number, boolean> {
  const open: Record<number, boolean> = {};
  const withMisses = sections
    .map((section, index) => ({
      index,
      hasMiss: section.criteria.some(isMiss),
    }))
    .filter((s) => s.hasMiss);

  if (withMisses.length === 0) {
    sections.forEach((_, index) => {
      open[index] = true;
    });
    return open;
  }
  withMisses.forEach(({ index }) => {
    open[index] = true;
  });
  return open;
}

export function ScorecardDetail({
  sections,
  openSections,
  onToggleSection,
  onOverride,
}: {
  sections: Sections;
  openSections: Record<number, boolean>;
  onToggleSection: (index: number, open?: boolean) => void;
  /** Set a criterion by hand. The score recomputes immediately. */
  onOverride?: (criterionId: string, status: CriterionStatus) => void;
}) {
  const [missesOnly, setMissesOnly] = useState(false);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const totals = useMemo(() => {
    const all = sections.flatMap((s) => s.criteria);
    const graded = all.filter(isGraded);
    return {
      graded: graded.length,
      missed: graded.filter((c) => c.status === "missed").length,
      partial: graded.filter((c) => c.status === "partial").length,
      na: all.length - graded.length,
    };
  }, [sections]);

  const allOpen = sections.every((_, index) => openSections[index]);

  const visible = sections
    .map((section, index) => ({
      section,
      index,
      rows: missesOnly ? section.criteria.filter(isMiss) : section.criteria,
    }))
    .filter((entry) => (missesOnly ? entry.rows.length > 0 : true));

  const toggleAll = () => {
    sections.forEach((_, index) => onToggleSection(index, !allOpen));
  };

  return (
    <div
      className="goal-card goal-detail"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E3E8EF",
        borderRadius: 12,
        boxShadow: "0 2px 6px rgba(0,23,45,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid #E3E8EF",
          background: "#F8FAFC",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0F1B2D", margin: 0 }}>
            Scorecard detail
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6A7482" }}>
            {totals.missed} missed · {totals.partial} partial of {totals.graded} graded criteria
            {totals.na > 0 ? ` · ${totals.na} did not apply` : ""}
            {missesOnly ? " · sections with nothing to coach hidden" : " · click a row for evidence"}
          </p>
        </div>
        <div className="goal-no-print" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setMissesOnly((value) => !value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 12px",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: missesOnly ? 600 : 500,
              cursor: "pointer",
              fontFamily: "inherit",
              background: missesOnly ? "#057BE5" : "#FFFFFF",
              border: `1px solid ${missesOnly ? "#057BE5" : "#D6DCE5"}`,
              color: missesOnly ? "#FFFFFF" : "#2B3442",
            }}
          >
            <ListFilter size={14} strokeWidth={2} />
            Misses only
          </button>
          <button
            onClick={toggleAll}
            style={{
              padding: "8px 12px",
              background: "#FFFFFF",
              border: "1px solid #D6DCE5",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              color: "#2B3442",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {missesOnly && (
        <div
          style={{
            padding: "10px 24px",
            background: "#FEF6EA",
            borderBottom: "1px solid #E3E8EF",
            fontSize: 13,
            color: "#B87613",
          }}
        >
          Filtered to misses only — criteria that were met are not shown.
        </div>
      )}

      {visible.map(({ section, index, rows }) => {
        const pct = pctWidth(section.score, section.maxScore);
        const isOpen = missesOnly ? true : !!openSections[index];
        const gradedCount = section.criteria.filter(isGraded).length;
        const partiallyGated = gradedCount > 0 && gradedCount < section.criteria.length;
        return (
          <div
            key={section.name + index}
            id={`sec-${index}`}
            className="goal-section"
            style={{ borderBottom: "1px solid #F1F1F1" }}
          >
            <button
              className="goal-hover-row"
              onClick={() => onToggleSection(index)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                width: "100%",
                textAlign: "left",
                padding: "18px 24px",
                background: "none",
                border: 0,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 16,
                    fontWeight: 700,
                    color: section.state && section.state !== "graded" ? "#6A7482" : "#0F1B2D",
                  }}
                >
                  {section.name}
                  {partiallyGated && (
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: "#6A7482" }}>
                      ({gradedCount} of {section.criteria.length} graded)
                    </span>
                  )}
                </span>
                {section.stateReason && (
                  <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "#6A7482" }}>
                    {section.stateReason}
                  </span>
                )}
              </span>
              {section.maxScore > 0 && (
                <span
                  style={{
                    width: 140,
                    height: 6,
                    background: "#EFF2F7",
                    borderRadius: 100,
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      borderRadius: 100,
                      background: barColor(pct),
                      width: `${pct}%`,
                    }}
                  />
                </span>
              )}
              <span
                style={{
                  minWidth: 64,
                  textAlign: "right",
                  fontSize: section.state === "not_attempted" ? 12 : 15,
                  fontWeight: section.state === "not_attempted" ? 600 : 800,
                  color: section.state === "not_attempted" ? "#C13438" : "#0F1B2D",
                  flexShrink: 0,
                }}
              >
                {sectionScoreLabel(section)}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  flexShrink: 0,
                  transition: "transform .2s",
                  transform: `rotate(${isOpen ? 180 : 0}deg)`,
                }}
              >
                <ChevronDown size={18} strokeWidth={2} color="#6A7482" />
              </span>
            </button>

            <div className="goal-section-body" hidden={!isOpen} style={{ padding: "0 24px 8px" }}>
                {rows.map((criterion, rowIndex) => {
                  const key = `${index}-${criterion.id || criterion.name}-${rowIndex}`;
                  const rowOpen = !!openRows[key];
                  const graded = isGraded(criterion);
                  return (
                    <div key={key} style={{ borderTop: "1px solid #F4F6FA" }}>
                      <button
                        className="goal-hover-row"
                        onClick={() => setOpenRows((rows_) => ({ ...rows_, [key]: !rows_[key] }))}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 14,
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 4px",
                          background: "none",
                          border: 0,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        <StatusDot status={criterion.status} />
                        <span
                          style={{
                            flex: 1,
                            fontSize: 14,
                            fontWeight: 500,
                            color: graded ? "#0F1B2D" : "#6A7482",
                          }}
                        >
                          {criterion.name}
                          {criterion.overridden && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: "#057BE5" }}>
                              adjusted
                            </span>
                          )}
                        </span>
                        <StatusPill status={criterion.status} />
                        <span
                          style={{
                            width: 70,
                            textAlign: "right",
                            fontSize: 12,
                            fontFamily: "var(--font-mono)",
                            color: "#6A7482",
                            flexShrink: 0,
                          }}
                        >
                          {criterion.timestamp || "—"}
                        </span>
                      </button>

                      <div
                        className="goal-evidence"
                        hidden={!rowOpen}
                        style={{
                          padding: "0 4px 16px 32px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                          {criterion.reason && (
                            <div style={{ fontSize: 13, color: "#6A7482" }}>{criterion.reason}</div>
                          )}
                          {criterion.evidence && (
                            <div
                              style={{
                                padding: "12px 16px",
                                background: "#F8FAFC",
                                borderLeft: "3px solid #308ED6",
                                borderRadius: "0 6px 6px 0",
                                fontSize: 14,
                                lineHeight: 1.6,
                                fontStyle: "italic",
                                color: "#2B3442",
                              }}
                            >
                              “{criterion.evidence}”
                            </div>
                          )}
                          {criterion.note && (
                            <div style={{ fontSize: 13, color: "#6A7482" }}>{criterion.note}</div>
                          )}
                          {onOverride && criterion.id && (
                            <div
                              className="goal-no-print"
                              style={{ display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <span style={{ fontSize: 12, color: "#6A7482" }}>
                                Reviewer verdict:
                              </span>
                              {OVERRIDE_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  onClick={() => onOverride(criterion.id, option)}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    fontSize: 12,
                                    fontWeight: criterion.status === option ? 700 : 500,
                                    fontFamily: "inherit",
                                    cursor: "pointer",
                                    background: criterion.status === option ? "#057BE5" : "#FFFFFF",
                                    color: criterion.status === option ? "#FFFFFF" : "#2B3442",
                                    border: `1px solid ${criterion.status === option ? "#057BE5" : "#D6DCE5"}`,
                                  }}
                                >
                                  {option === "na" ? "N/A" : option}
                                </button>
                              ))}
                              {criterion.overridden && criterion.machineStatus && (
                                <button
                                  onClick={() => onOverride(criterion.id, criterion.machineStatus!)}
                                  title={`Restore the scored verdict (${criterion.machineStatus})`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    fontSize: 12,
                                    fontFamily: "inherit",
                                    cursor: "pointer",
                                    background: "#FFFFFF",
                                    border: "1px solid #D6DCE5",
                                    color: "#6A7482",
                                  }}
                                >
                                  <RotateCcw size={12} strokeWidth={2} />
                                  Reset
                                </button>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { defaultOpenState };
