import type { CallFacts, ScorecardResponse } from "../types";

/** Thrown for anything the user should read verbatim. */
export class ApiError extends Error {}

async function readJson(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return res.json();
  }
  if (res.status === 413) throw new ApiError("File too large for the server to accept.");
  if (res.status === 504) throw new ApiError("Request timed out. The AI took too long to respond.");
  throw new ApiError(`Server returned error ${res.status}: ${res.statusText}`);
}

async function postJson(path: string, passcode: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-passcode": passcode },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw new ApiError(data?.error || "An error occurred.");
  return data;
}

/**
 * Resolves false only when the passcode is genuinely wrong. Anything else —
 * a crashed function, a gateway error — throws, so a broken deployment cannot
 * masquerade as a bad passcode.
 */
export async function verifyPasscode(passcode: string): Promise<boolean> {
  const res = await fetch("/api/verify-passcode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  if (res.ok) return true;
  if (res.status === 401) return false;
  throw new ApiError(
    res.status >= 500
      ? `The server could not check the passcode (error ${res.status}). It may be misconfigured.`
      : `Sign-in failed with error ${res.status}.`,
  );
}

/**
 * Returns the call context, or a refusal when the model decides this isn't a
 * sales call at all.
 */
export async function runContextPass(
  transcript: string,
  passcode: string,
): Promise<{ context: CallFacts } | { refusal: string; redFlags: string[] }> {
  const data = await postJson("/api/context", passcode, { transcript });
  if (data.error) {
    return { refusal: data.error as string, redFlags: (data.red_flags as string[]) || [] };
  }
  return { context: data.context as CallFacts };
}

export async function runScoringPass(
  transcript: string,
  context: CallFacts,
  producer: string,
  leadType: string,
  passcode: string,
): Promise<ScorecardResponse> {
  return (await postJson("/api/score", passcode, {
    transcript,
    context,
    producer: producer || undefined,
    lead_type: leadType || undefined,
  })) as ScorecardResponse;
}
