import { Download, Printer } from "lucide-react";

const ghostButton: React.CSSProperties = {
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
};

interface TopBarProps {
  title: string;
  subtitle: string;
  showScorecardActions: boolean;
  onPrint: () => void;
  onDownloadJson: () => void;
  onNewScorecard: () => void;
}

export function TopBar({
  title,
  subtitle,
  showScorecardActions,
  onPrint,
  onDownloadJson,
  onNewScorecard,
}: TopBarProps) {
  return (
    <header
      className="goal-no-print"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #E3E8EF",
        padding: "0 40px",
        height: 68,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: "#0F1B2D", letterSpacing: "-0.01em" }}>
          {title}
        </span>
        <span
          style={{
            fontSize: 13,
            color: "#6A7482",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </span>
      </div>

      {showScorecardActions && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button className="goal-hover-ghost" style={ghostButton} onClick={onPrint}>
            <Printer size={15} strokeWidth={2} />
            Print
          </button>
          <button className="goal-hover-ghost" style={ghostButton} onClick={onDownloadJson}>
            <Download size={15} strokeWidth={2} />
            JSON
          </button>
          <button
            className="goal-hover-primary"
            onClick={onNewScorecard}
            style={{
              padding: "9px 16px",
              background: "#057BE5",
              color: "#FFFFFF",
              border: 0,
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            New scorecard
          </button>
        </div>
      )}
    </header>
  );
}
