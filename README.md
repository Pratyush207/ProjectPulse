# Campus Pulse

Rate and browse feedback on hostels, messes, and general facilities on campus.

## What's in here

- `public/index.html` — the whole front-end (search, browse, rate, upvote, login, admin panel).
- `netlify/functions/` — serverless functions that read/write the shared data and enforce access rules.
- Data is stored in **Netlify Blobs**, so there's no separate database to set up.

## Deploy to Netlify

1. Push this folder to a GitHub repo (or drag-and-drop the folder into Netlify's deploy UI).
2. In Netlify: **Add new site → Import an existing project**, point it at the repo.
   - Build command: (none needed)
   - Publish directory: `public`
   - Netlify will auto-detect `netlify/functions` from `netlify.toml`.
3. Go to **Site configuration → Environment variables** and add:

   | Key | Value |
   |---|---|
   | `ADMIN_EMAILS` | Comma-separated list of admin addresses, e.g. `dean@pilani.bits-pilani.ac.in, sg@pilani.bits-pilani.ac.in` |
   | `FIREBASE_PROJECT_ID` | From your Firebase service account JSON |
   | `FIREBASE_CLIENT_EMAIL` | From your Firebase service account JSON |
   | `FIREBASE_PRIVATE_KEY` | From your Firebase service account JSON (keep the `\n`s — Netlify's env var editor handles this fine as one pasted value) |

4. Deploy. Netlify Blobs works automatically inside Functions — no extra credentials needed.

## How login works (now via Firebase)

Sign-in is real Google sign-in through Firebase Auth, restricted to `@pilani.bits-pilani.ac.in` accounts — no more honor-system typed email.

**One-time setup:**

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (or reuse the one Agora uses — see below).
2. **Authentication → Sign-in method** → enable **Google**.
3. **Authentication → Settings → Authorized domains** → add your Netlify domain (and `localhost` for local dev).
4. **Project settings → General → Your apps** → add a Web app, copy the config object, and paste it into the `firebaseConfig` object near the top of `public/index.html` (it's just placeholders right now — this config is not secret, it's fine in client code).
5. **Project settings → Service accounts** → Generate new private key → download the JSON → copy `project_id`, `client_email`, and `private_key` into the three `FIREBASE_*` env vars above (these ARE secret — never put them in client code).

The client verifies the person's email ends in `@pilani.bits-pilani.ac.in` after Google sign-in and signs them back out if not. Every write endpoint (rating, feedback, upvote, admin actions) independently re-verifies the person's Firebase ID token server-side before trusting who they are — a modified client can no longer claim to be someone else, which closes the gap the old typed-email system had.

**Admin access** still works the same way — `ADMIN_EMAILS` lists which verified addresses get admin powers.

### Single sign-on with The Agora

If Agora's codebase uses the **same Firebase project** (same `firebaseConfig`), someone who signs in on Campus Pulse will already be signed in when they open Agora, and vice versa — Firebase Auth shares session state across different sites on the same project automatically. Just make sure both sites' domains are added under Authorized domains in the one shared Firebase project.

## How ratings work

- Every entity starts with a "seed" average (matching your original screenshot) and a synthetic weight of 22, so early real ratings don't cause wild swings.
- Each student rating adds 1 to the weight and blends into the average.
- Feedback text is optional per rating — students can just star-rate without writing anything.
- Upvotes are capped at one per email per feedback item.

## "Today's food" yes/no vote (messes only)

Below the star rating in a mess's page, students get a simple **Was today's food good? Yes / No** prompt — separate from the 1–5 star rating, resets every day (Asia/Kolkata midnight), one answer per person per mess per day (can be changed by tapping the other option).

- Once at least a minimum number of people answer for that mess that day (default **25**, admin-configurable — see below) **and** more than **60%** said "No", that mess gets a red flag badge on its card on the main page for the rest of the day.
- The flag clears automatically at the next day's reset.
- Backed by `netlify/functions/mess-vote.mjs` (per-mess vote + status) and `netlify/functions/mess-vote-summary.mjs` (today's tally for every mess at once, powering the main-page flags).

## Admin capabilities

Signed-in admins (matching `ADMIN_EMAILS`) see an **Admin controls** panel inside every entity's page:

- **Set rating & weight** — directly overwrites that entity's average and vote count (e.g. rating `4.2`, weight `50`).
- **Add feedback as admin** — posts a feedback entry with any star rating, text, and upvote count you choose, instantly, without affecting the entity's average.

On the homepage itself (not tied to a specific entity), admins also see a **Mess flag threshold** panel to change the minimum number of daily "today's food" responses required before a mess becomes eligible for a red flag — backed by `netlify/functions/admin-mess-threshold.mjs`.

All admin actions are re-checked server-side against `ADMIN_EMAILS` on every request — the admin panel only *appears* client-side, it isn't what grants access.

## Local development

```
npm install
npx netlify dev
```

This runs the functions and Netlify Blobs emulator locally so you can test before deploying.
