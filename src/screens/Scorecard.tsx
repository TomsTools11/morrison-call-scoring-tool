import { AlertTriangle, Check } from "lucide-react";
import { BandPill, OutcomePill } from "../components/Pills";
import { ScoreRing } from "../components/ScoreRing";
import { ScorecardDetail } from "../components/ScorecardDetail";
import { formatCallDate, humanize, parseTalkShare } from "../lib/format";
import type { ScorecardResponse } from "../types";

const card: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E3E8EF",
  borderRadius: 12,
  boxShadow: "0 2px 6px rgba(0,23,45,0.06)",
};

const metricLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#6A7482",
  marginBottom: 10,
};

const metricValue: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
  letterSpacing: "-0.01em",
  color: "#0F1B2D",
};

interface ScorecardProps {
  data: ScorecardResponse;
  openSections: Record<number, boolean>;
  onToggleSection: (index: number, open?: boolean) => void;
}

export function Scorecard({ data, openSections, onToggleSection }: ScorecardProps) {
  const score = Math.round(data.overallScore);
  const fullMarks = data.sections.filter((s) => s.maxScore > 0 && s.score === s.maxScore).length;
  const agentShare = parseTalkShare(data.metrics?.talkShare);

  return (
    <div
      data-screen-label="Scorecard"
      style={{ maxWidth: 1100, display: "flex", flexDirection: "column", gap: 20 }}
    >
      {data.red_flags && data.red_flags.length > 0 && (
        <div
          style={{
            ...card,
            borderColor: "rgba(229,72,77,0.28)",
            background: "#FDEDEE",
            boxShadow: "none",
            padding: "18px 24px",
            display: "flex",
            gap: 14,
          }}
        >
          <AlertTriangle size={20} strokeWidth={2} color="#C13438" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#C13438", margin: "0 0 6px" }}>
              Red flags on this call
            </h3>
            <ul style={{ margin: 0, paddingLeft: 18, color: "#C13438", fontSize: 14, lineHeight: 1.6 }}>
              {data.red_flags.map((flag, index) => (
                <li key={index}>{humanize(flag)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div
        className="goal-card"
        style={{
          ...card,
          padding: "28px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 32,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#308ED6",
              marginBottom: 10,
            }}
          >
            Producer scorecard
          </div>
          <h2
            style={{
              fontSize: 40,
              lineHeight: 1.05,
              fontWeight: 900,
              letterSpacing: "-0.02em",
              color: "#0F1B2D",
              margin: 0,
            }}
          >
            {data.meta.producer || "Unknown producer"}
          </h2>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 18px",
              fontSize: 14,
              color: "#6A7482",
            }}
          >
            <span style={{ whiteSpace: "nowrap" }}>{formatCallDate(data.meta.date)}</span>
            <span style={{ whiteSpace: "nowrap" }}>{data.meta.call_type}</span>
            <OutcomePill outcome={humanize(data.meta.outcome)} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, justifyContent: "flex-end" }}>
              <span
                style={{
                  fontSize: 44,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  color: "#0F1B2D",
                  lineHeight: 1,
                }}
              >
                {score}
              </span>
              <span style={{ fontSize: 18, fontWeight: 600, color: "#6A7482" }}>/100</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <BandPill band={data.gradeBand} />
            </div>
          </div>
          <ScoreRing score={score} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <div className="goal-card" style={{ ...card, padding: "22px 24px" }}>
          <div style={metricLabel}>Duration</div>
          <div style={metricValue}>{data.metrics?.duration || "—"}</div>
        </div>

        <div className="goal-card" style={{ ...card, padding: "22px 24px" }}>
          <div style={metricLabel}>Producer talk share</div>
          {agentShare === null ? (
            <div style={metricValue}>{data.metrics?.talkShare || "—"}</div>
          ) : (
            <>
              <div style={metricValue}>
                {agentShare}% <span style={{ fontSize: 15, fontWeight: 600, color: "#6A7482" }}>agent</span>
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  height: 6,
                  borderRadius: 100,
                  overflow: "hidden",
                  background: "#EFF2F7",
                }}
              >
                <div style={{ width: `${agentShare}%`, background: "#057BE5" }} />
                <div style={{ width: `${100 - agentShare}%`, background: "#97C2E8" }} />
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#6A7482" }}>
                {100 - agentShare}% customer
              </div>
            </>
          )}
        </div>

        <div className="goal-card" style={{ ...card, padding: "22px 24px" }}>
          <div style={metricLabel}>Pace</div>
          <div style={metricValue}>{data.metrics?.pace || "—"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 20, alignItems: "start" }}>
        <div className="goal-card" style={{ ...card, padding: 24 }}>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0F1B2D", margin: "0 0 4px" }}>
            Done well
          </h3>
          <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6A7482" }}>
            {fullMarks} of {data.sections.length} sections at full marks
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.strengths.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: "#6A7482" }}>
                Nothing flagged as a standout on this call.
              </p>
            ) : (
              data.strengths.map((strength, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: 14,
                    background: "#F8FAFC",
                    border: "1px solid #E7EDF5",
                    borderRadius: 8,
                  }}
                >
                  <Check
                    size={17}
                    strokeWidth={2.4}
                    color="#2BBF7A"
                    style={{ flexShrink: 0, marginTop: 2 }}
                  />
                  <span style={{ fontSize: 14, lineHeight: 1.55, color: "#2B3442" }}>{strength}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="goal-card" style={{ ...card, padding: 24 }}>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0F1B2D", margin: "0 0 4px" }}>
            Top {data.priorities.length || 3} priorities
          </h3>
          <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6A7482" }}>
            Highest-value fixes for the next call
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {data.priorities.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: "#6A7482" }}>
                No coaching priorities were returned for this call.
              </p>
            ) : (
              data.priorities.map((priority, index) => (
                <div key={index} style={{ display: "flex", gap: 14 }}>
                  <div
                    style={{
                      flexShrink: 0,
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: "#00172D",
                      color: "#FFFFFF",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span
                        style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, color: "#0F1B2D" }}
                      >
                        {priority.whatHappened}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                          color: "#6A7482",
                          flexShrink: 0,
                        }}
                      >
                        {priority.timestamp || "—"}
                      </span>
                    </div>
                    {priority.scriptLine && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "12px 14px",
                          background: "#F8FAFC",
                          borderLeft: "3px solid #057BE5",
                          borderRadius: "0 6px 6px 0",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: "#308ED6",
                            marginBottom: 6,
                          }}
                        >
                          Run this line next time
                        </div>
                        <p style={{ margin: 0, fontSize: 14, fontStyle: "italic", color: "#2B3442" }}>
                          “{priority.scriptLine}”
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ScorecardDetail
        sections={data.sections}
        openSections={openSections}
        onToggleSection={onToggleSection}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 0" }}>
        <img
          src="/assets/goal-mark.png"
          alt=""
          style={{ width: 18, height: 18, objectFit: "contain", opacity: 0.7 }}
        />
        <span style={{ fontSize: 13, color: "#6A7482" }}>Prepared by your GOAL account team.</span>
      </div>
    </div>
  );
}
