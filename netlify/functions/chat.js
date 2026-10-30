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

  const msgs = Array.isArray(data.messages) ? data.messages.slice(-20) : [];
  const contents = msgs
    .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 4000) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user")
    return json(400, { error: "Send a message first.", code: "empty" });

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: BASE + (data.solution ? SOLUTION : "") }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
  });

  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);
  let sawBusy = false;
  let sawRateLimit = false;

  outer: for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (left() < 1500) break outer; // not enough time for another try

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), left());
      let res, out;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: payload,
          signal: ctrl.signal,
        });
        out = await res.json().catch(() => ({}));
      } catch {
        console.log("Gemini network/timeout", model);
        break; // try next model
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const cand = out.candidates && out.candidates[0];
        const reply = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || "").join("").trim() : "";
        if (!reply) return json(502, { error: "The AI returned no answer. Try rephrasing.", code: "empty_reply" });
        return json(200, { reply });
      }

      const msg = (out.error && out.error.message) || "";
      console.log("Gemini error", model, res.status, msg.slice(0, 200));

      if (res.status === 429) { sawRateLimit = true; break; }  // quota is per model: try next
      if (res.status === 404) break;                           // model not available: try next
      if (res.status === 500 || res.status === 503 || res.status === 504) {
        sawBusy = true;
        if (attempt === 0 && left() > 2500) { await sleep(600 + Math.random() * 400); continue; } // retry same model once
        break;                                                  // then try next model
      }
      // Bad request, bad key, etc.: retrying will not help.
      return json(502, { error: "AI service error (" + res.status + "). Please try again.", code: "upstream" });
    }
  }

  if (sawBusy) return json(503, { error: "AI is busy right now. Please try again in a few seconds.", code: "busy" });
  if (sawRateLimit) return json(502, { error: "Free limit reached. Try again in a minute.", code: "rate_limit" });
  return json(502, { error: "Could not reach the AI service.", code: "network" });
};