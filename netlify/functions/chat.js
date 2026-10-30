const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(500, { error: "Server is missing GEMINI_API_KEY.", code: "no_key" });

  let data;
  try { data = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request.", code: "bad_json" }); }

  const msgs = Array.isArray(data.messages) ? data.messages.slice(-20) : [];
  const contents = msgs
    .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 4000) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user")
    return json(400, { error: "Send a message first.", code: "empty" });

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BASE + (data.solution ? SOLUTION : "") }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = res.status === 429 ? "rate_limit" : "upstream";
      return json(502, { error: res.status === 429 ? "Free limit reached. Try again in a minute." : "AI service error.", code });
    }
    const cand = out.candidates && out.candidates[0];
    const reply = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || "").join("").trim() : "";
    if (!reply) return json(502, { error: "The AI returned no answer. Try rephrasing.", code: "empty_reply" });
    return json(200, { reply });
  } catch {
    return json(502, { error: "Could not reach the AI service.", code: "network" });
  }
};
