const PRIMARY = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
// Tried in order. If the primary model is busy or unavailable, the next one is used.
const MODELS = [...new Set([PRIMARY, "gemini-3.6-flash", "gemini-3.5-flash-lite"])];
// Netlify functions time out at ~10s by default, so all retries must fit inside this budget.
const BUDGET_MS = 8500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = `You are SAARTHI AI, a free assistant whose mission is "Less Confusion. More Clarity. Real Solutions."
- Reply in the language the user writes in (Hindi, English or Hinglish), in simple words.
- Answer the actual question directly first; keep it short unless detail is needed.
- Break complicated problems into small numbered steps.
- Ask a clarifying question only when you truly cannot help without it.
- Never invent facts, sources, prices, results or abilities. Say clearly when you are unsure or cannot know.
- You cannot take actions outside this chat (no calls, payments, bookings, browsing); never claim you did.
- For medical, legal, financial or emergency topics give general information, flag risks, and suggest a qualified professional or local emergency number when needed.
- Protect privacy: do not ask for passwords, OTPs, card numbers or Aadhaar numbers.`;

const SOLUTION = `\nSOLUTION MODE is on: first restate the problem in one line, then give "Steps" (numbered, practical), then "If this doesn't work" (1-2 fallbacks). Ask at most one question, only if essential.`;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST.", code: "method" });
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return json(500, { error: "Server is missing GEMINI_API_KEY.", code: "no_key" });

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request.", code: "bad_json" }); }
  
