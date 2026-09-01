import { BarChart3, Download } from "lucide-react";
import { BandPill } from "../components/Pills";
import { formatCallDate, humanize } from "../lib/format";
import type { HistoryEntry } from "../types";

const GRID = "1fr 1.7fr 1fr 1.3fr 70px 120px";

interface CallHistoryProps {
  entries: HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onScoreNewCall: () => void;
  onExportLabelled: () => void;
}

export function CallHistory({
  entries,
  onOpen,
  onScoreNewCall,
  onExportLabelled,
}: CallHistoryProps) {
  const reviewed = entries.filter((e) => e.overrides && Object.keys(e.overrides).length > 0).length;
  return (
    <div data-screen-label="Call history" style={{ maxWidth: 1100 }}>
      <div
        className="goal-card"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E3E8EF",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 2px 6px rgba(0,23,45,0.06)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 16,
            padding: "14px 24px",
            background: "#F8FAFC",
            whiteSpace: "nowrap",
            borderBottom: "1px solid #E3E8EF",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#6A7482",
          }}
        >
          <span>Producer</span>
          <span>Scored</span>
          <span>Lead type</span>
          <span>Outcome</span>
          <span style={{ textAlign: "right" }}>Score</span>
          <span style={{ textAlign: "right" }}>Band</span>
        </div>

        {entries.length === 0 ? (
          <EmptyHistory onScoreNewCall={onScoreNewCall} />
        ) : (
          entries.map((entry) => {
            const { meta, overallScore, gradeBand } = entry.scorecard;
            const leadType = meta.call_type?.split("/")[1]?.trim() || "—";
            return (
              <button
                key={entry.id}
                className="goal-hover-row"
                onClick={() => onOpen(entry)}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 16,
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "16px 24px",
                  background: "none",
                  border: 0,
                  borderBottom: "1px solid #F1F1F1",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: "#0F1B2D" }}>
                  {meta.producer || "Unknown"}
                </span>
                <span style={{ fontSize: 14, color: "#6A7482" }}>{formatCallDate(meta.date)}</span>
                <span style={{ fontSize: 14, color: "#2B3442" }}>{humanize(leadType)}</span>
                <span style={{ fontSize: 14, color: "#2B3442" }}>{humanize(meta.outcome)}</span>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    letterSpacing: "-0.01em",
                    color: "#0F1B2D",
                    textAlign: "right",
                  }}
                >
                  {overallScore === null ? "—" : Math.round(overallScore)}
                </span>
                <span style={{ justifySelf: "end" }}>
                  <BandPill band={gradeBand} bordered={false} />
                </span>
              </button>
            );
          })
        )}
      </div>
      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <span style={{ fontSize: 13, color: "#6A7482" }}>
          Scores are calculated against the Morrison rubric. History is stored in this browser only —
          transcripts are not kept.
        </span>
        {reviewed > 0 && (
          <button
            onClick={onExportLabelled}
            title="Every scorecard a reviewer has corrected, in the shape the eval harness reads"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 12px",
              background: "#FFFFFF",
              border: "1px solid #D6DCE5",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              color: "#2B3442",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            <Download size={14} strokeWidth={2} />
            Export {reviewed} reviewed {reviewed === 1 ? "call" : "calls"}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyHistory({ onScoreNewCall }: { onScoreNewCall: () => void }) {
  return (
    <div style={{ padding: "64px 24px", textAlign: "center" }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "#F1F7FE",
          color: "#057BE5",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <BarChart3 size={20} strokeWidth={2} />
      </div>
      <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0F1B2D", margin: "0 0 6px" }}>
        No calls scored yet
      </h3>
      <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6A7482" }}>
        Score your first call and it will show up here.
      </p>
      <button
        className="goal-hover-primary"
        onClick={onScoreNewCall}
        style={{
          padding: "10px 18px",
          background: "#057BE5",
          color: "#FFFFFF",
          border: 0,
          borderRadius: 4,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Score a new call
      </button>
    </div>
  );
}
