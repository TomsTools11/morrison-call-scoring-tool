import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Reject anything that is not the expected verb. Returns true when handled. */
export function rejectWrongMethod(
  req: VercelRequest,
  res: VercelResponse,
  method: "GET" | "POST",
): boolean {
  if (req.method === method) return false;
  res.setHeader("Allow", method);
  res.status(405).json({ error: `Method ${req.method} not allowed` });
  return true;
}

/** Read a required env var, or fail the request with a clear message. */
export function requireEnv(
  name: string,
  res: VercelResponse,
): string | undefined {
  const value = process.env[name];
  if (!value) {
    res.status(500).json({ error: `${name} is not configured on the server` });
    return undefined;
  }
  return value;
}

export function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
