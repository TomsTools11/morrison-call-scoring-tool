import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * The whole app sits behind one shared agency passcode, sent as an
 * `x-passcode` header (or a `passcode` body field).
 */
export function isValidPasscode(candidate: unknown): boolean {
  const expected = process.env.APP_PASSCODE || "goal123"; // Fallback for dev if not set
  return typeof candidate === "string" && candidate === expected;
}

export function readPasscode(req: VercelRequest): unknown {
  const header = req.headers["x-passcode"];
  if (typeof header === "string") return header;
  if (Array.isArray(header)) return header[0];
  return (req.body as { passcode?: unknown } | undefined)?.passcode;
}

/**
 * Guard an API route. Returns true when the request was rejected, so callers
 * can `if (rejectUnauthorized(req, res)) return;`.
 */
export function rejectUnauthorized(
  req: VercelRequest,
  res: VercelResponse,
): boolean {
  if (isValidPasscode(readPasscode(req))) return false;
  res.status(401).json({ error: "Unauthorized: Invalid passcode" });
  return true;
}
