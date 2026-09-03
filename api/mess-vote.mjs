import {
  verifiedEmailFromRequest,
  isMessId,
  todayKey,
  getMessVotes,
  setMessVotes,
  getVoteConfig,
  summarizeVotes,
  SEEDS,
  json,
} from "../lib/helpers.mjs";

// No ?action = the original mess-vote GET/POST (one yes/no answer per
// person per mess per Asia/Kolkata day, on whether today's food was
// good). ?action=summary used to be its own mess-vote-summary.mjs file —
// folded in here so the project stays well under Vercel's per-deployment
// function count on the Hobby plan.

async function defaultAction(req) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!isMessId(id)) return json({ error: "Unknown mess" }, 400);

    const date = todayKey();
    const [data, cfg, email] = await Promise.all([
      getMessVotes(id, date),
      getVoteConfig(),
      verifiedEmailFromRequest(req),
    ]);

    return json({
      date,
      voted: email && data.voters[email] ? data.voters[email] : null,
      threshold: cfg.threshold,
      ...summarizeVotes(data, cfg.threshold),
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    const { id, vote } = body;

    if (!isMessId(id)) return json({ error: "Unknown mess" }, 400);
    if (vote !== "yes" && vote !== "no") {
      return json({ error: "Vote must be 'yes' or 'no'." }, 400);
    }

    const email = await verifiedEmailFromRequest(req);
    if (!email) {
      return json({ error: "Please sign in with your @pilani.bits-pilani.ac.in email." }, 401);
    }

    const date = todayKey();
    const data = await getMessVotes(id, date);

    const prev = data.voters[email];
    if (prev !== vote) {
      if (prev === "yes") data.yes = Math.max(0, data.yes - 1);
      if (prev === "no") data.no = Math.max(0, data.no - 1);
      if (vote === "yes") data.yes += 1;
      else data.no += 1;
      data.voters[email] = vote;
      await setMessVotes(id, date, data);
    }

    const cfg = await getVoteConfig();
    return json({
      date,
      voted: vote,
      threshold: cfg.threshold,
      ...summarizeVotes(data, cfg.threshold),
    });
  }

  return json({ error: "Method not allowed" }, 405);
}

// Today's yes/no tally for every mess in one call, so the main grid can
// show a red flag without opening each mess individually. Read-only, no
// auth needed.
async function summaryAction(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const date = todayKey();
  const cfg = await getVoteConfig();
  const messIds = Object.keys(SEEDS).filter((id) => id.startsWith("mess-"));

  const votes = {};
  await Promise.all(
    messIds.map(async (id) => {
      const data = await getMessVotes(id, date);
      votes[id] = summarizeVotes(data, cfg.threshold);
    })
  );

  return json({ date, threshold: cfg.threshold, votes });
}

export default { fetch: async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (!action) return defaultAction(req);
  if (action === "summary") return summaryAction(req);
  return json({ error: "Unknown mess-vote action" }, 404);
} };
