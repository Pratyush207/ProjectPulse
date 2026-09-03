import {
  getAgoraPromo,
  setAgoraPromo,
  verifiedEmailFromRequest,
  isAdminEmail,
  AGORA_PROMO_STYLES,
  json,
} from "../lib/helpers.mjs";

const MAX_TITLE = 60;
const MAX_DESC = 220;
const MAX_BTN = 30;
const MAX_HIGHLIGHTS = 140;

function isHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default { fetch: async (req) => {
  if (req.method === "GET") {
    const promo = await getAgoraPromo();
    return json({ promo });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    const { enabled, title, description, buttonText, url, style, highlights } = body;

    const email = await verifiedEmailFromRequest(req);
    if (!email || !isAdminEmail(email)) {
      return json({ error: "Admin access required." }, 403);
    }

    const enabledBool = !!enabled;
    const titleTrimmed = (title || "").trim().slice(0, MAX_TITLE);
    const descTrimmed = (description || "").trim().slice(0, MAX_DESC);
    const btnTrimmed = (buttonText || "").trim().slice(0, MAX_BTN);
    const urlTrimmed = (url || "").trim();
    const styleVal = AGORA_PROMO_STYLES.includes(style) ? style : "gold";
    const highlightsTrimmed = (highlights || "").trim().slice(0, MAX_HIGHLIGHTS);

    if (!titleTrimmed) return json({ error: "Title is required." }, 400);
    if (!descTrimmed) return json({ error: "Description is required." }, 400);
    if (!btnTrimmed) return json({ error: "Button text is required." }, 400);
    if (enabledBool && !isHttpUrl(urlTrimmed)) {
      return json({ error: "A valid http(s) link is required to enable the promo." }, 400);
    }
    if (urlTrimmed && !isHttpUrl(urlTrimmed)) {
      return json({ error: "That link doesn't look valid." }, 400);
    }

    const promo = {
      enabled: enabledBool,
      title: titleTrimmed,
      description: descTrimmed,
      buttonText: btnTrimmed,
      url: urlTrimmed,
      style: styleVal,
      highlights: highlightsTrimmed,
    };
    await setAgoraPromo(promo);
    return json({ ok: true, promo });
  }

  return json({ error: "Method not allowed" }, 405);
} };
