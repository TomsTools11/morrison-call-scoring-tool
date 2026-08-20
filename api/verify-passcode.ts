import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isValidPasscode } from "../lib/auth.js";
import { rejectWrongMethod } from "../lib/http.js";

/** Gates the UI only. Every other route validates the passcode itself. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectWrongMethod(req, res, "POST")) return;

  const passcode = (req.body as { passcode?: unknown } | undefined)?.passcode;
  if (isValidPasscode(passcode)) {
    res.status(200).json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
}
