import { useRef, type FormEvent } from "react";
import { AlertCircle, FileText, FileUp } from "lucide-react";
import { ACCEPTED_EXTENSIONS } from "../lib/transcript";

const tabButton = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 16px",
  border: 0,
  borderRadius: 6,
  fontSize: 14,
  fontWeight: active ? 600 : 500,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "background .15s",
  background: active ? "#FFFFFF" : "none",
  color: active ? "#057BE5" : "#6A7482",
  boxShadow: active ? "0 1px 3px rgba(0,23,45,0.12)" : "none",
});

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#6A7482",
  marginBottom: 8,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  fontSize: 15,
  color: "#0F1B2D",
  background: "#FFFFFF",
  border: "1px solid #D6DCE5",
  borderRadius: 6,
  outline: "none",
};

interface ScoreFormProps {
  producer: string;
  leadType: string;
  inputType: "file" | "paste";
  file: File | null;
  /** Set once the picked file has been parsed; null while it hasn't. */
  fileWordCount: number | null;
  transcriptText: string;
  error: string;
  onProducerChange: (value: string) => void;
  onLeadTypeChange: (value: string) => void;
  onInputTypeChange: (value: "file" | "paste") => void;
  onFileChange: (file: File | null) => void;
  onTranscriptChange: (value: string) => void;
  onSubmit: () => void;
}

export function ScoreForm({
  producer,
  leadType,
  inputType,
  file,
  fileWordCount,
  transcriptText,
  error,
  onProducerChange,
  onLeadTypeChange,
  onInputTypeChange,
  onFileChange,
  onTranscriptChange,
  onSubmit,
}: ScoreFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div data-screen-label="Score a new call" style={{ maxWidth: 720 }}>
      <form
        onSubmit={handleSubmit}
        className="goal-card"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E3E8EF",
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 2px 6px rgba(0,23,45,0.06)",
        }}
      >
        <h2 style={{ fontSize: 26, fontWeight: 800, color: "#0F1B2D", margin: "0 0 4px" }}>
          Score a new call
        </h2>
        <p style={{ margin: "0 0 28px", fontSize: 15, color: "#6A7482" }}>
          Upload a transcript file, or paste one in.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          <div>
            <label htmlFor="producer" style={label}>
              Producer
            </label>
            <input
              id="producer"
              className="goal-input"
              type="text"
              value={producer}
              onChange={(event) => onProducerChange(event.target.value)}
              placeholder="Producer name"
              style={field}
            />
          </div>
          <div>
            <label htmlFor="leadType" style={label}>
              Lead type
            </label>
            <select
              id="leadType"
              className="goal-input"
              value={leadType}
              onChange={(event) => onLeadTypeChange(event.target.value)}
              style={field}
            >
              <option value="">Auto-detect</option>
              <option value="internet">Internet</option>
              <option value="mailer">Mailer</option>
              <option value="winback">Winback</option>
              <option value="requote">Requote</option>
              <option value="cross_sell">Cross-sell</option>
              <option value="inbound_call">Inbound</option>
            </select>
          </div>
        </div>

        <span style={label}>Input source</span>
        <div
          style={{
            display: "inline-flex",
            padding: 3,
            background: "#EFF2F7",
            borderRadius: 8,
            gap: 2,
            marginBottom: 20,
          }}
        >
          <button type="button" onClick={() => onInputTypeChange("file")} style={tabButton(inputType === "file")}>
            <FileUp size={15} strokeWidth={2} />
            Upload file
          </button>
          <button
            type="button"
            onClick={() => onInputTypeChange("paste")}
            style={tabButton(inputType === "paste")}
          >
            <FileText size={15} strokeWidth={2} />
            Paste transcript
          </button>
        </div>

        {inputType === "file" ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(",")}
              style={{ display: "none" }}
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            />
            <div
              className="goal-hover-drop"
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              style={{
                border: "1.5px dashed #C6D0DE",
                background: "#F8FAFC",
                borderRadius: 12,
                padding: 36,
                textAlign: "center",
                cursor: "pointer",
                transition: "border-color .15s, background .15s",
              }}
            >
              <FileUp
                size={26}
                strokeWidth={2}
                color="#057BE5"
                style={{ display: "block", margin: "0 auto 12px" }}
              />
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0F1B2D" }}>
                {file ? file.name : "Click to upload a transcript"}
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: "#6A7482" }}>
                {fileWordCount === null
                  ? "TXT, MD, VTT, SRT, JSON · up to 3MB"
                  : `${fileWordCount.toLocaleString()} words · ready to score`}
              </div>
            </div>
          </>
        ) : (
          <textarea
            className="goal-input"
            value={transcriptText}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="Paste call transcript here…"
            style={{
              width: "100%",
              height: 190,
              padding: 14,
              fontSize: 14,
              lineHeight: 1.55,
              fontFamily: "var(--font-mono)",
              color: "#0F1B2D",
              background: "#F8FAFC",
              border: "1px solid #D6DCE5",
              borderRadius: 8,
              outline: "none",
              resize: "vertical",
            }}
          />
        )}

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginTop: 20,
              padding: "12px 14px",
              background: "#FDEDEE",
              border: "1px solid rgba(229,72,77,0.28)",
              borderRadius: 8,
            }}
          >
            <AlertCircle size={17} strokeWidth={2} color="#C13438" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 14, lineHeight: 1.5, color: "#C13438" }}>{error}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 28 }}>
          <button
            className="goal-hover-primary"
            type="submit"
            style={{
              padding: "13px 24px",
              background: "#057BE5",
              color: "#FFFFFF",
              border: 0,
              borderRadius: 4,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "0.02em",
              cursor: "pointer",
              transition: "background .15s",
            }}
          >
            Generate scorecard
          </button>
          <span style={{ fontSize: 13, color: "#6A7482" }}>
            Scoring usually takes under a minute.
          </span>
        </div>
      </form>
    </div>
  );
}
