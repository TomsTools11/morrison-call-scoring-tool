import { bandSwatch, statusOf } from "../lib/format";

export function BandPill({ band, bordered = true }: { band: string; bordered?: boolean }) {
  const swatch = bandSwatch(band);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: bordered ? "4px 12px" : "3px 11px",
        borderRadius: 100,
        background: swatch.bg,
        border: bordered ? `1px solid ${swatch.bd}` : "1px solid transparent",
        color: swatch.fg,
        fontSize: bordered ? 12 : 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {band}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = statusOf(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: 100,
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const s = statusOf(status);
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: s.color,
        flexShrink: 0,
        boxShadow: `0 0 0 3px ${s.bg}`,
      }}
    />
  );
}

export function OutcomePill({ outcome }: { outcome: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 100,
        background: "#F1F7FE",
        color: "#057BE5",
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {outcome}
    </span>
  );
}
