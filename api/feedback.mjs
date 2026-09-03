import {
  getFeedback,
  setFeedback,
  getStats,
  setStats,
  verifiedEmailFromRequest,
  isAdminEmail,
  isComplaintRating,
  SEEDS,
  SEED_WEIGHT,
  json,
} from "../lib/helpers.mjs";

// Everything to do with a single entity's written feedback lives behind
// this one function (no ?action = the original feedback GET/POST; other
// actions below used to be their own upvote.mjs / resolve.mjs /
// issue-counts.mjs files) so the project stays well under Vercel's
// per-deployment function count on the Hobby plan.

async function defaultAction(req) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);
    const list = await getFeedback(id);
    // Only reveal which items were posted by admin to admins themselves —
    // everyone else sees admin-authored feedback as indistinguishable from
    // any other post. Similarly, authorEmail never leaves the server — we
    // only tell the client whether *this* signed-in user is allowed to
    // resolve each item (its reporter, or an admin).
    const requesterEmail = await verifiedEmailFromRequest(req);
    const requesterIsAdmin = !!requesterEmail && isAdminEmail(requesterEmail);
    const sanitized = list.map(({ admin, authorEmail, ...rest }) => ({
      ...rest,
      ...(requesterIsAdmin && admin ? { admin } : {}),
      canResolve: requesterIsAdmin || (!!requesterEmail && authorEmail === requesterEmail),
    }));
    return json({ feedback: sanitized });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    const { id, stars, text } = body;

    const email = await verifiedEmailFromRequest(req);
    if (!email) {
      return json({ error: "Please sign in with your @pilani.bits-pilani.ac.in email." }, 401);
    }
    if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);

    const starsNum = Number(stars);
    if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
      return json({ error: "Rating must be a whole number from 1 to 5." }, 400);
    }

    // update running average
    const stats = await getStats();
    if (!stats[id]) stats[id] = { sum: SEEDS[id] * SEED_WEIGHT, count: SEED_WEIGHT };
    stats[id].sum += starsNum;
    stats[id].count += 1;
    await setStats(stats);

    // add written feedback, if any
    const trimmed = (text || "").trim();
    if (trimmed) {
      const list = await getFeedback(id);
      list.unshift({
        id: "f" + Date.now() + Math.random().toString(36).slice(2, 7),
        text: trimmed.slice(0, 800),
        stars: starsNum,
        upvotes: 0,
        upvotedBy: [],
        ts: Date.now(),
        // Only a genuine complaint (3 stars or fewer) starts out
        // "unresolved" — a positive note has nothing to resolve.
        resolved: !isComplaintRating(starsNum),
        resolvedBy: null,
        resolvedAt: null,
        authorEmail: email,
      });
      await setFeedback(id, list);
    }

    return json({ ok: true, stats: stats[id] });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function upvoteAction(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { id, feedbackId } = body;

  const email = await verifiedEmailFromRequest(req);
  if (!email) {
    return json({ error: "Please sign in with your @pilani.bits-pilani.ac.in email." }, 401);
  }
  if (!id || !feedbackId) return json({ error: "Missing id or feedbackId" }, 400);

  const list = await getFeedback(id);
  const item = list.find((f) => f.id === feedbackId);
  if (!item) return json({ error: "Feedback not found" }, 404);

  if (!item.upvotedBy) item.upvotedBy = [];
  if (item.upvotedBy.includes(email)) {
    return json({ ok: true, upvotes: item.upvotes, alreadyVoted: true });
  }
  item.upvotedBy.push(email);
  item.upvotes += 1;
  await setFeedback(id, list);
  return json({ ok: true, upvotes: item.upvotes });
}

// Only the student who reported an issue — or an admin — can resolve or
// reopen it. Every other signed-in student can see the status but not
// change it.
async function resolveAction(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const { id, feedbackId, resolved } = body;

  const email = await verifiedEmailFromRequest(req);
  if (!email) {
    return json({ error: "Please sign in with your @pilani.bits-pilani.ac.in email." }, 401);
  }
  if (!id || !SEEDS.hasOwnProperty(id)) return json({ error: "Unknown entity" }, 400);
  if (!feedbackId) return json({ error: "Missing feedbackId" }, 400);

  const list = await getFeedback(id);
  const item = list.find((f) => f.id === feedbackId);
  if (!item) return json({ error: "Feedback not found" }, 404);

  const requesterIsAdmin = isAdminEmail(email);
  const requesterIsAuthor = !!item.authorEmail && item.authorEmail === email;
  if (!requesterIsAdmin && !requesterIsAuthor) {
    return json({ error: "Only the student who reported this (or an admin) can resolve it." }, 403);
  }

  const resolvedBool = !!resolved;
  item.resolved = resolvedBool;
  item.resolvedBy = resolvedBool ? email : null;
  item.resolvedAt = resolvedBool ? Date.now() : null;

  await setFeedback(id, list);
  return json({ ok: true, resolved: item.resolved, resolvedBy: item.resolvedBy, resolvedAt: item.resolvedAt });
}

// Every feedback item has text (star-only ratings never get stored as a
// feedback item), so every item in a list is an "issue" for this purpose.
// Counts are read-only and don't need auth.
async function countsAction(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const ids = Object.keys(SEEDS);
  const counts = {};
  await Promise.all(
    ids.map(async (id) => {
      const list = await getFeedback(id);
      counts[id] = list.filter((f) => !f.resolved).length;
    })
  );
  return json({ counts });
}

const ACTIONS = {
  upvote: upvoteAction,
  resolve: resolveAction,
  counts: countsAction,
};

export default { fetch: async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const handler = action ? ACTIONS[action] : defaultAction;
  if (!handler) return json({ error: "Unknown feedback action" }, 404);
  return handler(req);
} };
