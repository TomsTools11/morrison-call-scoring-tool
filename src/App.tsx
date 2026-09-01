import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { defaultOpenState } from "./components/ScorecardDetail";
import { SignIn } from "./screens/SignIn";
import { CallHistory } from "./screens/CallHistory";
import { ScoreForm } from "./screens/ScoreForm";
import { Analyzing } from "./screens/Analyzing";
import { Scorecard } from "./screens/Scorecard";
import { ApiError, runContextPass, runScoringPass, verifyPasscode } from "./lib/api";
import { readTranscriptFile, TranscriptFileError } from "./lib/transcript";
import { exportLabelledSet, loadHistory, saveOverrides, saveScorecard } from "./lib/history";
import { recomputeScores } from "@/lib/rubric";
import { formatCallDate } from "./lib/format";
import type { CriterionStatus, HistoryEntry, ScorecardResponse, Screen } from "./types";

const STEPS = ["Reading call context", "Scoring against the Morrison rubric"];

export default function App() {
  const [passcode, setPasscode] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const [screen, setScreen] = useState<Screen>("history");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [inputType, setInputType] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [fileWordCount, setFileWordCount] = useState<number | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [producer, setProducer] = useState("");
  const [leadType, setLeadType] = useState("");
  const [formError, setFormError] = useState("");

  const [step, setStep] = useState(0);
  const [stepDetail, setStepDetail] = useState("");

  const [scorecard, setScorecard] = useState<ScorecardResponse | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const [refusal, setRefusal] = useState("");
  const [historyWarning, setHistoryWarning] = useState("");

  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isAuthenticated) setHistory(loadHistory());
  }, [isAuthenticated]);

  const go = useCallback((next: Screen) => {
    setScreen(next);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, []);

  const handleSignIn = async (candidate: string) => {
    setSigningIn(true);
    setSignInError("");
    try {
      if (await verifyPasscode(candidate)) {
        setPasscode(candidate);
        setIsAuthenticated(true);
        setScreen("history");
      } else {
        setSignInError("Invalid passcode.");
      }
    } catch (error) {
      setSignInError(
        error instanceof ApiError
          ? error.message
          : "Network error. Please try again.",
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = () => {
    setIsAuthenticated(false);
    setPasscode("");
    setScorecard(null);
    setScreen("history");
  };

  /** Files are parsed the moment they're picked, so errors surface before submit. */
  const handleFileChange = async (picked: File | null) => {
    setFile(picked);
    setFileText("");
    setFileWordCount(null);
    setFormError("");
    if (!picked) return;

    try {
      const { text, wordCount } = await readTranscriptFile(picked);
      setFileText(text);
      setFileWordCount(wordCount);
    } catch (error) {
      setFile(null);
      setFormError(
        error instanceof TranscriptFileError ? error.message : "Could not read that file.",
      );
    }
  };

  const runPipeline = async () => {
    const transcript = inputType === "file" ? fileText : transcriptText;

    if (!transcript.trim()) {
      setFormError(
        inputType === "file"
          ? file
            ? "That file has no readable transcript."
            : "Please choose a transcript file."
          : "Please paste a transcript.",
      );
      return;
    }

    setStep(0);
    setStepDetail(`${STEPS[0]}…`);
    setFormError("");
    setRefusal("");
    go("analyzing");

    try {
      const context = await runContextPass(transcript, passcode);
      if ("refusal" in context) {
        setRefusal(context.refusal);
        go("refused");
        return;
      }

      setStep(1);
      setStepDetail(`${STEPS[1]}…`);
      const result = await runScoringPass(transcript, context.context, producer, leadType, passcode);

      setStep(STEPS.length);
      setScorecard(result);
      setOpenSections(defaultOpenState(result.sections));
      const saved = saveScorecard(result);
      setEntryId(saved.entry.id);
      setHistoryWarning(
        saved.persisted
          ? ""
          : "This scorecard could not be saved to history — the browser store is full.",
      );
      setHistory(loadHistory());

      // Nothing used to clear these, so the natural flow — score, "new
      // scorecard", type the next producer's name, generate — silently
      // re-scored the PREVIOUS transcript and filed it under the new name.
      setFile(null);
      setFileText("");
      setFileWordCount(null);
      setTranscriptText("");
      setLeadType("");
      go("scorecard");
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "Failed to score the call. Please try again.";
      setFormError(message);
      go("form");
    }
  };

  const handleOpenHistoryEntry = (entry: HistoryEntry) => {
    setScorecard(entry.scorecard);
    setEntryId(entry.id);
    setHistoryWarning("");
    setOpenSections(defaultOpenState(entry.scorecard.sections));
    go("scorecard");
  };

  /**
   * A reviewer correcting a verdict. The score recomputes here rather than on
   * the server — `lib/rubric` holds the arithmetic and imports nothing, so the
   * browser can run exactly the same function the API route does.
   *
   * The machine verdict is kept alongside the correction, which is what turns
   * a reviewed scorecard into a labelled example for calibration.
   */
  const handleOverride = (criterionId: string, status: CriterionStatus) => {
    setScorecard((current) => {
      if (!current) return current;

      const overrides: Record<string, CriterionStatus> = {};
      const sections = current.sections.map((section) => ({
        ...section,
        criteria: section.criteria.map((criterion) => {
          const next =
            criterion.id === criterionId
              ? {
                  ...criterion,
                  machineStatus: criterion.machineStatus ?? criterion.status,
                  status,
                  // A reviewer marking something N/A is asserting it did not
                  // apply, so it leaves the denominator the same way a
                  // structural exclusion does.
                  scope:
                    status === "na" ? ("not_applicable" as const) : ("in_scope" as const),
                  reason:
                    status === "na"
                      ? "Marked not applicable by the reviewer."
                      : criterion.scope === "in_scope"
                        ? criterion.reason
                        : "",
                }
              : criterion;
          const overridden = !!next.machineStatus && next.machineStatus !== next.status;
          if (overridden) overrides[next.id] = next.status;
          return { ...next, overridden };
        }),
      }));

      const totals = recomputeScores(sections, current.amnesty ?? false);
      const updated: ScorecardResponse = {
        ...current,
        sections,
        overallScore: totals.overallScore,
        gradeBand: totals.gradeBand,
        scoredWeight: totals.scoredWeight,
      };

      if (entryId) saveOverrides(entryId, updated, overrides);
      setHistory(loadHistory());
      return updated;
    });
  };

  const handleToggleSection = (index: number, open?: boolean) => {
    setOpenSections((current) => ({
      ...current,
      [index]: open === undefined ? !current[index] : open,
    }));
  };

  const handleJumpToSection = (index: number) => {
    setOpenSections((current) => ({ ...current, [index]: true }));
    const element = document.getElementById(`sec-${index}`);
    const main = mainRef.current;
    if (main && element) main.scrollTop = Math.max(0, element.offsetTop - 24);
  };

  const download = (body: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /** The reviewed scorecards, as the calibration set for the eval harness. */
  const handleExportLabelled = () => {
    download(exportLabelledSet(), `morrison-labelled-set-${new Date().toISOString()}.json`);
  };

  const handleDownloadJson = () => {
    if (!scorecard) return;
    download(
      JSON.stringify(scorecard, null, 2),
      `scorecard-${scorecard.meta.producer || "call"}-${new Date().toISOString()}.json`,
    );
  };

  if (!isAuthenticated) {
    return <SignIn onSubmit={handleSignIn} error={signInError} busy={signingIn} />;
  }

  const titles: Record<Screen, [string, string]> = {
    history: ["Call history", "Mike Morrison Insurance Agency"],
    form: ["Score a new call", "Morrison rubric"],
    analyzing: ["Scoring in progress", "Do not close this tab"],
    scorecard: [
      "Scorecard",
      scorecard ? `${scorecard.meta.producer} · ${formatCallDate(scorecard.meta.date)}` : "",
    ],
    refused: ["Not scored", "This call was not gradeable"],
  };
  const [title, subtitle] = titles[screen];

  return (
    <div className="goal-shell" style={{ display: "flex", height: "100vh", overflow: "hidden", alignItems: "stretch" }}>
      <Sidebar
        screen={screen}
        scorecard={screen === "scorecard" ? scorecard : null}
        onGoHistory={() => go("history")}
        onGoForm={() => go("form")}
        onJumpToSection={handleJumpToSection}
        onSignOut={handleSignOut}
      />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar
          title={title}
          subtitle={subtitle}
          showScorecardActions={screen === "scorecard" && !!scorecard}
          onPrint={() => window.print()}
          onDownloadJson={handleDownloadJson}
          onNewScorecard={() => go("form")}
        />

        <main
          ref={mainRef}
          className="goal-scroll"
          style={{
            position: "relative",
            flex: 1,
            overflowY: "auto",
            scrollBehavior: "smooth",
            padding: "32px 40px 64px",
          }}
        >
          {screen === "history" && (
            <CallHistory
              entries={history}
              onOpen={handleOpenHistoryEntry}
              onScoreNewCall={() => go("form")}
              onExportLabelled={handleExportLabelled}
            />
          )}

          {screen === "form" && (
            <ScoreForm
              producer={producer}
              leadType={leadType}
              inputType={inputType}
              file={file}
              fileWordCount={fileWordCount}
              transcriptText={transcriptText}
              error={formError}
              onProducerChange={setProducer}
              onLeadTypeChange={setLeadType}
              onInputTypeChange={setInputType}
              onFileChange={(picked) => void handleFileChange(picked)}
              onTranscriptChange={setTranscriptText}
              onSubmit={() => void runPipeline()}
            />
          )}

          {screen === "analyzing" && <Analyzing steps={STEPS} step={step} detail={stepDetail} />}

          {screen === "refused" && <NotASalesCall message={refusal} onBack={() => go("form")} />}

          {screen === "scorecard" && historyWarning && (
            <div
              className="goal-no-print"
              style={{
                marginBottom: 20,
                padding: "12px 16px",
                background: "#FEF6EA",
                border: "1px solid rgba(240,169,59,0.3)",
                borderRadius: 8,
                fontSize: 14,
                color: "#B87613",
              }}
            >
              {historyWarning}
            </div>
          )}

          {screen === "scorecard" && scorecard && (
            <Scorecard
              data={scorecard}
              openSections={openSections}
              onToggleSection={handleToggleSection}
              onOverride={handleOverride}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function NotASalesCall({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div style={{ maxWidth: 560, margin: "48px auto 0" }}>
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E3E8EF",
          borderRadius: 12,
          padding: 36,
          boxShadow: "0 4px 14px rgba(0,23,45,0.08)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#FEF6EA",
            color: "#B87613",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <AlertTriangle size={20} strokeWidth={2} />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F1B2D", margin: "0 0 8px" }}>
          Nothing to score here
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: 15, lineHeight: 1.55, color: "#6A7482" }}>
          {message || "This does not appear to be a sales call. Refusing to score."}
        </p>
        <button
          className="goal-hover-primary"
          onClick={onBack}
          style={{
            padding: "11px 20px",
            background: "#057BE5",
            color: "#FFFFFF",
            border: 0,
            borderRadius: 4,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Try another call
        </button>
      </div>
    </div>
  );
}
