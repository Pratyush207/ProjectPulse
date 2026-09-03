import {
  getStats,
  setStats,
  getFeedback,
  setFeedback,
  getVoteConfig,
  setVoteConfig,
  verifiedEmailFromRequest,
  isAdminEmail,
  isComplaintRating,
  SEEDS,
  json,
} from "../lib/helpers.mjs";

// All admin-only actions live behind one function (?action=...) so the
// project stays well under Vercel's per-deployment function count on the
// Hobby plan. Each action below is the untouched logic that used to live
// in its own admin-*.mjs file.

async function resetAction(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { id, rating, weight } = body;

  const email = await verifiedEmailFromRequest(req);
  if (!email || !isAdminEmail(email)) {
    return json({ error: "Admin access required." }, 403);
  }
  if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);

  const r = Number(rating);
  const w = Number(weight);
  if (!(r >= 1 && r <= 5)) return json({ error: "Rating must be between 1 and 5." }, 400);
  if (!(w >= 1) || !Number.isFinite(w)) return json({ error: "Weight must be a positive number." }, 400);

  const stats = await getStats();
  stats[id] = { sum: r * w, count: w };
  await setStats(stats);
  return json({ ok: true, stats: stats[id] });
}

async function feedbackAction(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { id, text, stars, upvotes } = body;

  const email = await verifiedEmailFromRequest(req);
  if (!email || !isAdminEmail(email)) {
    return json({ error: "Admin access required." }, 403);
  }
  if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);

  const starsNum = Number(stars);
  const upvotesNum = Number(upvotes);
  if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
    return json({ error: "Rating must be a whole number from 1 to 5." }, 400);
  }
  if (!Number.isInteger(upvotesNum) || upvotesNum < 0) {
    return json({ error: "Upvotes must be a non-negative whole number." }, 400);
  }
  const trimmed = (text || "").trim();
  if (!trimmed) return json({ error: "Feedback text is required." }, 400);

  const list = await getFeedback(id);
  list.unshift({
    id: "f" + Date.now() + Math.random().toString(36).slice(2, 7),
    text: trimmed.slice(0, 800),
    stars: starsNum,
    upvotes: upvotesNum,
    upvotedBy: [],
    ts: Date.now(),
    admin: true,
    resolved: !isComplaintRating(starsNum),
    resolvedBy: null,
    resolvedAt: null,
    authorEmail: email,
  });
  await setFeedback(id, list);
  return json({ ok: true });
}

async function deleteFeedbackAction(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { id, feedbackId } = body;

  const email = await verifiedEmailFromRequest(req);
  if (!email || !isAdminEmail(email)) {
    return json({ error: "Admin access required." }, 403);
  }
  if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);
  if (!feedbackId) return json({ error: "Missing feedbackId" }, 400);

  const list = await getFeedback(id);
  const next = list.filter((f) => f.id !== feedbackId);
  if (next.length === list.length) return json({ error: "Feedback not found" }, 404);

  await setFeedback(id, next);
  return json({ ok: true });
}

async function voteAction(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { id, feedbackId, delta } = body;

  const email = await verifiedEmailFromRequest(req);
  if (!email || !isAdminEmail(email)) {
    return json({ error: "Admin access required." }, 403);
  }
  if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);
  if (!feedbackId) return json({ error: "Missing feedbackId" }, 400);

  const deltaNum = Number(delta);
  if (!Number.isInteger(deltaNum) || deltaNum === 0) {
    return json({ error: "delta must be a non-zero whole number." }, 400);
  }

  const list = await getFeedback(id);
  const item = list.find((f) => f.id === feedbackId);
  if (!item) return json({ error: "Feedback not found" }, 404);

  item.upvotes = Math.max(0, (item.upvotes || 0) + deltaNum);
  await setFeedback(id, list);
  return json({ ok: true, upvotes: item.upvotes });
}

async function messThresholdAction(req) {
  if (req.method === "GET") {
    const cfg = await getVoteConfig();
    return json({ threshold: cfg.threshold });
  }

  if (req.method === "POST") {
    const email = await verifiedEmailFromRequest(req);
    if (!email || !isAdminEmail(email)) {
      return json({ error: "Admin access required." }, 403);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }

    const n = Number(body.threshold);
    if (!Number.isInteger(n) || n < 1) {
      return json({ error: "Threshold must be a positive whole number." }, 400);
    }

    await setVoteConfig({ threshold: n });
    return json({ ok: true, threshold: n });
  }

  return json({ error: "Method not allowed" }, 405);
}

const ACTIONS = {
  reset: resetAction,
  feedback: feedbackAction,
  "delete-feedback": deleteFeedbackAction,
  vote: voteAction,
  "mess-threshold": messThresholdAction,
};

export default { fetch: async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const handler = ACTIONS[action];
  if (!handler) return json({ error: "Unknown admin action" }, 404);
  return handler(req);
} };
