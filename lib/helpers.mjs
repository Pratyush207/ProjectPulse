import { Redis } from "@upstash/redis";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export const BITS_DOMAIN = "@pilani.bits-pilani.ac.in";

export function isValidBitsEmail(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  // must end with the domain AND have a non-empty local part
  return e.endsWith(BITS_DOMAIN) && e.length > BITS_DOMAIN.length;
}

export function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes((email || "").trim().toLowerCase());
}

// A written note only represents an open "issue" needing follow-up when the
// rating behind it is actually negative — a 4-5 star note is a compliment,
// not a complaint, and shouldn't sit in anyone's "unresolved" queue. 1-3
// stars is treated as a complaint by default.
export function isComplaintRating(stars) {
  return Number(stars) <= 3;
}

/* ---------------- Firebase Auth verification ----------------
 * Every request that needs to know "who is this" now proves it with a
 * Firebase ID token (Authorization: Bearer <token>) instead of a
 * client-supplied email field. The token is verified against Firebase's
 * public keys server-side, so the resulting email can actually be trusted
 * — unlike the old honor-system login.
 */
function ensureFirebaseAdmin() {
  if (getApps().length) return;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

// Returns the verified, lowercased @pilani.bits-pilani.ac.in email for this
// request, or null if there's no valid token / the token's email doesn't
// match the required domain. Never throws.
export async function verifiedEmailFromRequest(req) {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  try {
    ensureFirebaseAdmin();
    const decoded = await getAuth().verifyIdToken(match[1]);
    const email = (decoded.email || "").toLowerCase();
    if (!decoded.email_verified) return null;
    if (!isValidBitsEmail(email)) return null;
    return email;
  } catch {
    return null;
  }
}

// Thin wrapper so every other file in this project can keep calling
// dataStore().get(key, { type: "json" }) / .setJSON(key, value) exactly as
// it did with Netlify Blobs — only this function needed to change when
// moving to Upstash Redis (via the Vercel Marketplace "Upstash for Redis"
// integration, which injects KV_REST_API_URL / KV_REST_API_TOKEN, or plain
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN if you connected Upstash
// directly).
let _redis;
function redisClient() {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

export function dataStore() {
  const redis = redisClient();
  return {
    // @upstash/redis auto-deserializes JSON values it previously auto-serialized,
    // so plain objects/arrays round-trip through get/set without extra encoding.
    async get(key) {
      const val = await redis.get(key);
      return val === null || val === undefined ? null : val;
    },
    async setJSON(key, value) {
      await redis.set(key, value);
    },
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// synthetic base "vote count" per entity so the average doesn't whiplash
// the moment real ratings start coming in
export const SEED_WEIGHT = 22;

export const SEEDS = {
  "mess-ashok-rp": 3.7,
  "mess-bhagirath-vishwakarma": 4.5,
  "mess-ram-budh": 4.2,
  "mess-krishna-gandhi": 4.1,
  "mess-meera": 4.0,
  "mess-shankar-vyas": 3.9,
  "hostel-ashok": 3.3,
  "hostel-bhagirath": 4.2,
  "hostel-budh": 4.1,
  "hostel-gandhi": 3.9,
  "hostel-krishna": 3.7,
  "hostel-meera": 4.0,
  "hostel-rana-pratap": 3.4,
  "hostel-ram": 3.9,
  "hostel-shanker": 3.1,
  "hostel-vishwakarma": 3.5,
  "hostel-vyas": 2.9,
  "gen-admin": 3.7,
  "gen-professors": 3.9,
  "gen-library": 4.2,
  "gen-new-auditorium": 4.7,
  "gen-faculty-1": 4.6,
  "gen-faculty-2": 3.8,
  "gen-faculty-3": 4.9,
  "gen-sports-ground": 3.8,
  "gen-infra": 3.6,
};

export async function getStats() {
  const store = dataStore();
  const raw = await store.get("stats", { type: "json" });
  return raw || {};
}

export async function setStats(stats) {
  const store = dataStore();
  await store.setJSON("stats", stats);
}

export async function getFeedback(id) {
  const store = dataStore();
  const raw = await store.get(`feedback:${id}`, { type: "json" });
  return raw || [];
}

export async function setFeedback(id, list) {
  const store = dataStore();
  await store.setJSON(`feedback:${id}`, list);
}

export const DEFAULT_AGORA_PROMO = {
  enabled: false,
  title: "The Agora",
  description: "Debate an AI, run a live simulation, publish research — five arenas, one score that follows you.",
  buttonText: "Enter The Agora \u2192",
  url: "",
  style: "gold",
  // short chips shown under the description, e.g. "5 arenas, Live scoring, Open beta"
  highlights: "5 arenas, AI-judged, One score that follows you",
};

export const AGORA_PROMO_STYLES = ["gold", "teal"];

export async function getAgoraPromo() {
  const store = dataStore();
  const raw = await store.get("agoraPromo", { type: "json" });
  return { ...DEFAULT_AGORA_PROMO, ...(raw || {}) };
}

export async function setAgoraPromo(promo) {
  const store = dataStore();
  await store.setJSON("agoraPromo", promo);
}

/* ---------------- "Today's food" yes/no mess voting ----------------
 * A separate, lightweight signal from the 1-5 star ratings: once a day,
 * per mess, students answer a plain yes/no on whether that day's food
 * was good. If enough people answer (see getVoteConfig) and more than
 * 60% say no, the mess gets a red flag on the main page for that day.
 */

// "Today" resets at local midnight for campus (Asia/Kolkata), not the
// server's UTC day, so the flag lines up with when students actually eat.
export function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function isMessId(id) {
  return typeof id === "string" && id.startsWith("mess-") && SEEDS.hasOwnProperty(id);
}

export async function getMessVotes(id, date) {
  const store = dataStore();
  const raw = await store.get(`messvote:${id}:${date}`, { type: "json" });
  return raw || { yes: 0, no: 0, voters: {} };
}

export async function setMessVotes(id, date, data) {
  const store = dataStore();
  await store.setJSON(`messvote:${id}:${date}`, data);
}

export const DEFAULT_VOTE_CONFIG = { threshold: 25 };

export async function getVoteConfig() {
  const store = dataStore();
  const raw = await store.get("messVoteConfig", { type: "json" });
  const cfg = { ...DEFAULT_VOTE_CONFIG, ...(raw || {}) };
  if (!Number.isInteger(cfg.threshold) || cfg.threshold < 1) cfg.threshold = DEFAULT_VOTE_CONFIG.threshold;
  return cfg;
}

export async function setVoteConfig(cfg) {
  const store = dataStore();
  await store.setJSON("messVoteConfig", cfg);
}

// Shared shape-builder so mess-vote.mjs and mess-vote-summary.mjs agree on
// exactly how "flagged" is computed.
export function summarizeVotes(data, threshold) {
  const total = data.yes + data.no;
  const badPct = total > 0 ? (data.no / total) * 100 : 0;
  const flagged = total >= threshold && badPct > 60;
  return { yes: data.yes, no: data.no, total, badPct, flagged };
}
