interface AnalyzingProps {
  steps: string[];
  /** Index of the step currently running; equals steps.length when finished. */
  step: number;
  detail: string;
}

export function Analyzing({ steps, step, detail }: AnalyzingProps) {
  const progress = Math.round((step / steps.length) * 100);

  return (
    <div data-screen-label="Analyzing" style={{ maxWidth: 560, margin: "48px auto 0" }}>
      <div
        className="goal-card"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E3E8EF",
          borderRadius: 12,
          padding: 36,
          boxShadow: "0 4px 14px rgba(0,23,45,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
          <div
            style={{
              width: 20,
              height: 20,
              border: "2px solid #DCE6F3",
              borderTopColor: "#057BE5",
              borderRadius: "50%",
              animation: "goalspin .8s linear infinite",
            }}
          />
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F1B2D", margin: 0 }}>
            Analyzing call
          </h2>
        </div>
        <p style={{ margin: "0 0 28px", fontSize: 15, color: "#6A7482" }}>{detail}</p>

        <div
          style={{
            height: 6,
            background: "#EFF2F7",
            borderRadius: 100,
            overflow: "hidden",
            marginBottom: 28,
          }}
        >
          <div
            style={{
              height: "100%",
              background: "#057BE5",
              borderRadius: 100,
              transition: "width .5s cubic-bezier(.2,.7,.2,1)",
              width: `${progress}%`,
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((stepLabel, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <div key={stepLabel} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                    background: done ? "#2BBF7A" : active ? "#057BE5" : "#EFF2F7",
                    color: done || active ? "#FFFFFF" : "#6A7482",
                    animation: active ? "goalpulse 1.4s ease-in-out infinite" : undefined,
                  }}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: done || active ? "#0F1B2D" : "#6A7482",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {stepLabel}
                </span>
              </div>
            );
          })}
        </div>

        <p style={{ margin: "28px 0 0", fontSize: 13, color: "#6A7482" }}>
          Keep this tab open until the scorecard appears.
        </p>
      </div>
    </div>
  );
}
