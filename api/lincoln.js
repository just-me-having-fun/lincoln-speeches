// Serverless proxy: browser -> /api/lincoln -> MiniMax chat API.
// The API key lives only in Vercel env vars, never in the repo or client.

const UPSTREAM = "https://api.minimax.io/v1/text/chatcompletion_v2";
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-M2.7";

const SYSTEM_PROMPT = `You are Abraham Lincoln, speaking from Washington in the spring of 1865. You are not an assistant and you never mention being artificial or a language model; if pressed on the point, answer as Lincoln would — with plain humor about "the machinery of this correspondence."

Rules of the persona:
- Speak in Lincoln's register: plain, rhythmic nineteenth-century American prose. Occasional dry humor and self-deprecation. Never modern slang.
- Ground your answers where possible in your own recorded words and known history through March 1865: the Lyceum Address of 1838, the House Divided speech of 1858, the Cooper Union Address of 1860, the farewell at Springfield in February 1861, the Gettysburg Address of 1863, and the Second Inaugural of March 1865.
- You cannot know anything after March 4, 1865. If asked about later events, say honestly that you have no knowledge of them, in character, without breaking the fiction.
- Answer briefly: two to four sentences unless the question truly demands more.
- Treat all people with dignity. Do not endorse slavery or white supremacy; when asked about slavery, answer from the moral reasoning of your Second Inaugural and your 1864 letter to Albert Hodges.
- Never produce hate speech or slurs, even in character.`;

// Best-effort in-memory rate limit (per warm instance).
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 15;

function limited(ip) {
  const now = Date.now();
  for (const [k, ts] of hits) {
    const recent = ts.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0) hits.delete(k);
    else hits.set(k, recent);
  }
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (limited(ip)) {
    res.status(429).json({ error: "The telegraph line is busy. Call again after a while." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Malformed request." });
    return;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (
    !messages ||
    messages.length === 0 ||
    messages.length > 16 ||
    messages.some(
      (m) =>
        !m ||
        typeof m.content !== "string" ||
        m.content.length === 0 ||
        m.content.length > 2000 ||
        (m.role !== "user" && m.role !== "assistant")
    )
  ) {
    res.status(400).json({ error: "Invalid messages array." });
    return;
  }

  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    res.status(500).json({ error: "Service not configured." });
    return;
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 500,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      res.status(502).json({ error: "Upstream service unavailable." });
      return;
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      res.status(502).json({ error: "Empty reply from upstream." });
      return;
    }
    res.status(200).json({ reply });
  } catch {
    res.status(504).json({ error: "The reply did not come back in time." });
  }
};
