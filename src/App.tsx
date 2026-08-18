import { useState } from "react";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, XCircle, MinusCircle, Printer, Download } from "lucide-react";
import { ScorecardResponse } from "./types";
import { format } from "date-fns";

export default function App() {
  const [passcode, setPasscode] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState("");

  const [inputType, setInputType] = useState<"audio" | "transcript">("audio");
  const [file, setFile] = useState<File | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [producer, setProducer] = useState("");
  const [leadType, setLeadType] = useState("");
  const [isScoring, setIsScoring] = useState(false);
  const [scorecard, setScorecard] = useState<ScorecardResponse | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/verify-passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setError("");
      } else {
        setError("Invalid passcode.");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    }
  };

  const handleScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputType === "audio" && !file) {
      setError("Please select an audio file.");
      return;
    }
    if (inputType === "transcript" && !transcriptText.trim()) {
      setError("Please paste a transcript.");
      return;
    }

    setIsScoring(true);
    setError("");

    const formData = new FormData();
    formData.append("passcode", passcode);
    if (producer) formData.append("producer", producer);
    if (leadType) formData.append("lead_type", leadType);

    if (inputType === "audio" && file) {
      formData.append("file", file);
    } else {
      formData.append("transcript", transcriptText);
    }

    try {
      const res = await fetch("/api/score", {
        method: "POST",
        body: formData,
      });
      
      let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (res.status === 413) throw new Error("File too large. Maximum size is ~10MB.");
        if (res.status === 504) throw new Error("Request timed out. The AI took too long to respond.");
        throw new Error(`Server returned error ${res.status}: ${res.statusText}`);
      }

      if (res.ok) {
        if (data.error) {
          setError(data.error);
        } else {
          setScorecard(data);
        }
      } else {
        setError(data.error || "An error occurred during scoring.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to score the call. Please try again.");
    } finally {
      setIsScoring(false);
    }
  };

  const handleDownloadJson = () => {
    if (!scorecard) return;
    const blob = new Blob([JSON.stringify(scorecard, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scorecard-${scorecard.meta.producer}-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080808] p-4 text-[#E0E0E0]">
        <form onSubmit={handleLogin} className="w-full max-w-sm bg-[#0C0C0C] p-8 rounded-sm border border-white/10 shadow-lg">
          <h1 className="text-3xl font-serif italic text-white mb-2 tracking-tight">Sign In</h1>
          <p className="text-white/50 mb-6 text-[10px] uppercase tracking-widest">Enter the passcode to access the tool.</p>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-sm focus:outline-none focus:border-[#C5A059] focus:ring-1 focus:ring-[#C5A059] mb-4 text-white placeholder-white/30"
            placeholder="Passcode"
            required
          />
          {error && <p className="text-red-400 text-xs uppercase tracking-widest mb-4">{error}</p>}
          <button
            type="submit"
            className="w-full bg-[#C5A059] text-black py-3 rounded-sm hover:bg-[#D4B478] transition-colors font-bold uppercase tracking-widest text-[10px]"
          >
            Access Tool
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-[#E0E0E0] font-sans selection:bg-[#C5A059] selection:text-black">
      <header className="bg-[#0C0C0C] border-b border-white/10 sticky top-0 z-10 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-serif italic text-2xl tracking-tighter text-[#C5A059]">M</span>
            <div className="h-6 w-[1px] bg-white/20 mx-2"></div>
            <h1 className="text-xs uppercase tracking-[0.2em] font-semibold text-white/70">Morrison Call Scoring</h1>
          </div>
          {scorecard && (
            <div className="flex items-center gap-4">
              <button onClick={() => window.print()} className="p-2 text-white/50 hover:text-white transition-colors" title="Print to PDF">
                <Printer className="w-5 h-5" />
              </button>
              <button onClick={handleDownloadJson} className="p-2 text-white/50 hover:text-white transition-colors" title="Download JSON">
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setScorecard(null)}
                className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-sm transition-colors"
              >
                New Scorecard
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!scorecard ? (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white/[0.02] p-6 sm:p-8 rounded-lg shadow-sm border border-white/5">
              <h2 className="text-3xl font-serif italic text-white mb-6 tracking-tight">Score a New Call</h2>
              <form onSubmit={handleScore} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">Producer (Optional)</label>
                    <input
                      type="text"
                      value={producer}
                      onChange={(e) => setProducer(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-sm focus:outline-none focus:border-[#C5A059] text-white placeholder-white/20 text-sm"
                      placeholder="e.g. Alvaro"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">Lead Type (Optional)</label>
                    <select
                      value={leadType}
                      onChange={(e) => setLeadType(e.target.value)}
                      className="w-full px-4 py-3 bg-[#0C0C0C] border border-white/10 rounded-sm focus:outline-none focus:border-[#C5A059] text-white text-sm"
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

                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">Input Source</label>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setInputType("audio")}
                      className={`flex-1 py-3 border rounded-sm flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                        inputType === "audio" ? "border-[#C5A059] bg-[#C5A059]/10 text-[#C5A059]" : "border-white/10 text-white/50 hover:border-white/20 hover:bg-white/5"
                      }`}
                    >
                      <UploadCloud className="w-4 h-4" /> Audio File
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputType("transcript")}
                      className={`flex-1 py-3 border rounded-sm flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                        inputType === "transcript" ? "border-[#C5A059] bg-[#C5A059]/10 text-[#C5A059]" : "border-white/10 text-white/50 hover:border-white/20 hover:bg-white/5"
                      }`}
                    >
                      <FileText className="w-4 h-4" /> Transcript Paste
                    </button>
                  </div>
                </div>

                {inputType === "audio" ? (
                  <div>
                    <label className="block w-full border border-dashed border-white/20 rounded-sm p-8 text-center cursor-pointer hover:border-white/40 hover:bg-white/5 transition-colors">
                      <input
                        type="file"
                        accept="audio/*,video/mp4"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                      <UploadCloud className="w-8 h-8 text-white/30 mx-auto mb-3" />
                      <div className="text-white font-medium text-sm">{file ? file.name : "Click to upload audio"}</div>
                      <div className="text-white/40 text-[10px] uppercase tracking-widest mt-2">MP3, M4A, WAV, MP4 (Up to 90 min)</div>
                    </label>
                  </div>
                ) : (
                  <div>
                    <textarea
                      value={transcriptText}
                      onChange={(e) => setTranscriptText(e.target.value)}
                      className="w-full h-48 px-4 py-3 bg-white/5 border border-white/10 rounded-sm focus:outline-none focus:border-[#C5A059] resize-none font-mono text-sm text-white placeholder-white/20"
                      placeholder="Paste call transcript here..."
                    />
                  </div>
                )}

                {error && <div className="p-4 bg-red-500/10 text-red-400 rounded-sm text-[10px] uppercase tracking-widest border border-red-500/20 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0"/> <p>{error}</p></div>}

                <button
                  type="submit"
                  disabled={isScoring}
                  className="w-full bg-[#C5A059] text-black py-4 rounded-sm hover:bg-[#D4B478] transition-colors font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {isScoring ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      Analyzing Call...
                    </>
                  ) : (
                    "Generate Scorecard"
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <ScorecardView data={scorecard} />
        )}
      </main>
    </div>
  );
}

function ScorecardView({ data }: { data: ScorecardResponse }) {
  const getBandColor = (band: string) => {
    switch (band) {
      case "On System": return "bg-green-500/10 text-green-400 border-green-500/20";
      case "Solid": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "Needs Work": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default: return "bg-red-500/10 text-red-400 border-red-500/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "met": return <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30"><div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div></div>;
      case "partial": return <div className="w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30"><div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div></div>;
      case "missed": return <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30"><div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div></div>;
      case "na": return <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest px-1">N/A</span>;
      default: return null;
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 print:space-y-6">
      {data.red_flags && data.red_flags.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex gap-3">
          <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
          <div>
            <h3 className="font-bold text-red-400 text-sm mb-1 uppercase tracking-wide">Red Flags Detected</h3>
            <ul className="text-sm text-red-400/80 list-disc list-inside">
              {data.red_flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white/[0.02] p-6 sm:p-8 rounded-lg border border-white/5 flex flex-col sm:flex-row sm:items-start justify-between gap-6 print:border-white/10">
        <div>
          <h2 className="text-4xl font-serif italic text-white tracking-tight">{data.meta.producer}</h2>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] uppercase tracking-widest text-white/40">
            <span>{format(new Date(data.meta.date), "MMM d, yyyy • h:mm a")}</span>
            <span className="w-1 h-1 bg-white/20 rounded-full" />
            <span className="capitalize">{data.meta.call_type}</span>
            <span className="w-1 h-1 bg-white/20 rounded-full" />
            <span className="capitalize text-[#C5A059] font-bold">{data.meta.outcome.replace(/_/g, " ")}</span>
          </div>
        </div>
        <div className="flex flex-col sm:items-end text-left sm:text-right">
          <div className="flex items-baseline gap-1">
            <span className="text-5xl font-serif italic text-white">{Math.round(data.overallScore)}</span>
            <span className="text-xl text-[#C5A059]">/100</span>
          </div>
          <div className={`mt-3 px-3 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold border inline-flex items-center ${getBandColor(data.gradeBand)}`}>
            {data.gradeBand}
          </div>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Duration", value: data.metrics.duration },
          { label: "Producer Talk Share", value: data.metrics.talkShare },
          { label: "Pace", value: data.metrics.pace },
        ].map((m, i) => (
          <div key={i} className="bg-white/[0.02] p-6 rounded-lg border border-white/5">
            <div className="text-[10px] font-bold text-[#C5A059] uppercase tracking-widest mb-2">{m.label}</div>
            <div className="text-2xl font-serif italic text-white">{m.value || "—"}</div>
          </div>
        ))}
      </div>

      {/* Coaching Summary */}
      <div className="bg-[#0A0A0A] border border-white/10 rounded-lg p-6 sm:p-8">
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#C5A059] font-bold mb-8">
          Coaching Summary
        </h3>
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-6 border-b border-white/10 pb-4">Done Well</h4>
            <ul className="space-y-4">
              {data.strengths.map((str, i) => (
                <li key={i} className="flex gap-4 text-sm bg-white/5 border border-white/5 p-4 rounded-sm">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] flex-shrink-0"></div>
                  <span className="text-white/80 leading-relaxed font-serif italic">{str}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-6 border-b border-white/10 pb-4">Top 3 Priorities</h4>
            <div className="space-y-6">
              {data.priorities.map((p, i) => (
                <div key={i} className="group">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[#C5A059] uppercase tracking-wide">Priority {i + 1}</span>
                    {p.timestamp && <span className="text-[10px] font-mono text-white/30 pt-1">{p.timestamp}</span>}
                  </div>
                  <p className="text-sm text-white/80 leading-relaxed mb-4">{p.whatHappened}</p>
                  <div className="bg-[#C5A059]/10 p-4 rounded-sm border-l-2 border-[#C5A059]">
                    <div className="text-[10px] font-mono text-[#C5A059] uppercase tracking-widest mb-2">Run This Script Line Next Time</div>
                    <p className="text-sm text-white italic font-serif">"{p.scriptLine}"</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Full Rubric */}
      <div className="bg-[#0A0A0A] rounded-lg border border-white/10 overflow-hidden">
        <div className="px-8 py-6 border-b border-white/10 bg-white/5">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#C5A059] font-bold">Scorecard Detail</h3>
        </div>
        <div className="divide-y divide-white/5">
          {data.sections.map((section, idx) => (
            <div key={idx} className="p-8">
              <div className="flex items-end justify-between mb-6 pb-2 border-b border-white/5">
                <h4 className="font-serif italic text-2xl text-white tracking-tight">{section.name}</h4>
                {section.maxScore > 0 ? (
                  <span className="text-xs font-serif italic text-[#C5A059]">
                    {section.score} / {section.maxScore}
                  </span>
                ) : (
                  <span className="text-xs font-serif italic text-white/40">
                    —
                  </span>
                )}
              </div>
              <div className="space-y-6">
                {section.criteria.map((c, i) => (
                  <div key={i} className="flex gap-4 group">
                    <div className="pt-0.5">{getStatusIcon(c.status)}</div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <span className={`font-bold text-xs uppercase tracking-wide ${c.status === "na" ? "text-white/30" : "text-white/80"}`}>{c.name}</span>
                        {c.timestamp && <span className="text-[10px] font-mono text-white/30 shrink-0">{c.timestamp}</span>}
                      </div>
                      {c.status !== "na" && (
                        <div className="mt-3 space-y-3">
                          {c.evidence && (
                            <div className="text-sm text-white/70 bg-white/5 border-l border-[#C5A059]/50 p-4 rounded-sm font-serif italic leading-relaxed">
                              "{c.evidence}"
                            </div>
                          )}
                          {c.note && <div className="text-[10px] uppercase tracking-widest text-white/40">{c.note}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="text-center text-[10px] uppercase tracking-widest text-white/30 py-8">
        Prepared by your GOAL account team.
      </div>
    </div>
  );
}
