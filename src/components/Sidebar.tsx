import { BarChart3, Plus } from "lucide-react";
import type { ScorecardResponse, Screen } from "../types";

const navButton = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: 0,
  borderRadius: 8,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: active ? 600 : 500,
  transition: "background .15s",
  background: active ? "rgba(5,123,229,0.18)" : "none",
  color: active ? "#FFFFFF" : "rgba(242,242,242,0.66)",
});

interface SidebarProps {
  screen: Screen;
  scorecard: ScorecardResponse | null;
  onGoHistory: () => void;
  onGoForm: () => void;
  onJumpToSection: (index: number) => void;
  onSignOut: () => void;
}

export function Sidebar({
  screen,
  scorecard,
  onGoHistory,
  onGoForm,
  onJumpToSection,
  onSignOut,
}: SidebarProps) {
  const showSectionNav = screen === "scorecard" && !!scorecard;

  return (
    <aside
      className="goal-no-print"
      style={{
        width: 272,
        flex: "0 0 272px",
        background: "#00172D",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "28px 0",
      }}
    >
      <div style={{ padding: "0 24px 24px", borderBottom: "1px solid rgba(255,255,255,0.09)" }}>
        <img
          src="/assets/goal-wordmark-white.png"
          alt="GOAL"
          style={{ height: 24, width: "auto", objectFit: "contain", objectPosition: "left", display: "block" }}
        />
        <div
          style={{
            marginTop: 14,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(242,242,242,0.5)",
          }}
        >
          Morrison Call Scoring
        </div>
      </div>

      <nav style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
        <button className="goal-hover-nav" onClick={onGoHistory} style={navButton(screen === "history")}>
          <BarChart3 size={17} strokeWidth={2} />
          Call history
        </button>
        <button className="goal-hover-nav" onClick={onGoForm} style={navButton(screen === "form")}>
          <Plus size={17} strokeWidth={2} />
          Score a new call
        </button>
      </nav>

      {showSectionNav && (
        <div
          style={{
            padding: "8px 16px 20px",
            borderTop: "1px solid rgba(255,255,255,0.09)",
            marginTop: 8,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "16px 8px 12px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(242,242,242,0.4)",
            }}
          >
            Scorecard sections
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {scorecard!.sections.map((section, index) => {
              const full = section.maxScore > 0 && section.score === section.maxScore;
              return (
                <button
                  key={section.name + index}
                  className="goal-hover-nav"
                  onClick={() => onJumpToSection(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: 0,
                    padding: 8,
                    borderRadius: 6,
                    cursor: "pointer",
                    color: "rgba(242,242,242,0.72)",
                    // A section that did not apply must not read as a weak one.
                    opacity: section.maxScore > 0 ? 1 : 0.55,
                    fontSize: 13,
                    lineHeight: 1.35,
                    fontFamily: "inherit",
                  }}
                >
                  <span>{section.name}</span>
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: full ? "#3BEECA" : "rgba(242,242,242,0.5)",
                    }}
                  >
                    {section.maxScore > 0 ? `${section.score}/${section.maxScore}` : "N/A"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: "auto",
          padding: "20px 24px 0",
          borderTop: "1px solid rgba(255,255,255,0.09)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <img
          src="/assets/agency-avatar.png"
          alt=""
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            objectFit: "cover",
            background: "rgba(255,255,255,0.1)",
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#F2F2F2" }}>Mike Morrison Agency</div>
          <button
            onClick={onSignOut}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              fontSize: 12,
              color: "rgba(242,242,242,0.45)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
