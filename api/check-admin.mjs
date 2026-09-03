import { verifiedEmailFromRequest, isAdminEmail, json } from "../lib/helpers.mjs";

export default { fetch: async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const email = await verifiedEmailFromRequest(req);
  if (!email) return json({ validDomain: false, isAdmin: false });
  return json({ validDomain: true, isAdmin: isAdminEmail(email) });
} };
