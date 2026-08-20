import { useState, type FormEvent } from "react";

interface SignInProps {
  onSubmit: (passcode: string) => Promise<void>;
  error: string;
  busy: boolean;
}

export function SignIn({ onSubmit, error, busy }: SignInProps) {
  const [passcode, setPasscode] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(passcode);
  };

  return (
    <div
      data-screen-label="Sign in"
      style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(320px,42%) 1fr" }}
    >
      <div
        style={{
          background: "#00172D",
          padding: "56px 48px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <img
          src="/assets/goal-wordmark-white.png"
          alt="GOAL"
          style={{ height: 30, width: "auto", objectFit: "contain", objectPosition: "left" }}
        />
        <div>
          <div
            style={{
              fontSize: 13,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#3BEECA",
              fontWeight: 600,
              marginBottom: 20,
            }}
          >
            Call scoring
          </div>
          <h1
            style={{
              fontSize: 44,
              lineHeight: 1.08,
              letterSpacing: "-0.01em",
              fontWeight: 900,
              color: "#FFFFFF",
              margin: 0,
            }}
          >
            Morrison
            <br />
            Call Scoring
          </h1>
          <p
            style={{
              margin: "20px 0 0",
              fontSize: 16,
              lineHeight: 1.55,
              color: "rgba(242,242,242,0.66)",
              maxWidth: 340,
            }}
          >
            Upload a recording or paste a transcript. Every call is scored against the Morrison
            rubric and returned as a coaching scorecard.
          </p>
        </div>
        <div style={{ fontSize: 13, color: "rgba(242,242,242,0.45)" }}>
          Prepared by your GOAL account team.
        </div>
      </div>

      <div
        style={{
          background: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 48,
        }}
      >
        <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 360 }}>
          <img
            src="/assets/goal-mark.png"
            alt=""
            style={{ width: 36, height: 36, objectFit: "contain", marginBottom: 24 }}
          />
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "#0F1B2D", margin: "0 0 8px" }}>
            Sign in
          </h2>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: "#6A7482" }}>
            Enter the agency passcode to access the tool.
          </p>
          <label
            htmlFor="passcode"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#6A7482",
              marginBottom: 8,
            }}
          >
            Passcode
          </label>
          <input
            id="passcode"
            className="goal-input"
            type="password"
            required
            autoFocus
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="••••••••"
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 15,
              color: "#0F1B2D",
              background: "#FFFFFF",
              border: "1px solid #D6DCE5",
              borderRadius: 6,
              outline: "none",
              marginBottom: error ? 12 : 20,
            }}
          />
          {error && (
            <p style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 500, color: "#C13438" }}>
              {error}
            </p>
          )}
          <button
            className="goal-hover-primary"
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              padding: "13px 20px",
              background: busy ? "#97C2E8" : "#057BE5",
              color: "#FFFFFF",
              border: 0,
              borderRadius: 4,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "0.02em",
              cursor: busy ? "default" : "pointer",
              transition: "background .15s",
            }}
          >
            {busy ? "Checking…" : "Access tool"}
          </button>
          <div style={{ marginTop: 20, fontSize: 13, color: "#6A7482" }}>
            Access is managed by your GOAL account team.
          </div>
        </form>
      </div>
    </div>
  );
}
