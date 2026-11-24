// functions/api/admin-code.js
// Owner-only API behind admin/codes.html. Mints the unique one-use 100%-off
// Gumroad codes handed to PH buyers after a GCash payment, and removes the
// ones that were never redeemed (72h). No CORS headers: the page is served
// from this same origin and nothing else should be able to call this.
//
// Two secrets on the Pages project:
//   wrangler pages secret put ADMIN_CODES_KEY
//   wrangler pages secret put GUMROAD_ACCESS_TOKEN
// (the token comes from Gumroad -> Settings -> Advanced -> Applications)
//
// Product IDs are read from the same per-template secrets /api/publish and
// /api/verify-license already use, so a code is always minted on the product
// the license check will later validate it against.

import { PRODUCT_ID_ENV_BY_TEMPLATE } from "./_license.js";

const PREFIX = "PH";
const MAX_USES = "1";
const RETENTION_MS = 72 * 60 * 60 * 1000;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function keyMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Codes are stamped with the PH calendar date so "issued today" matches what
// the seller sees on their phone. Cleanup only needs day-level accuracy.
function phStamp(ms) {
  const d = new Date(ms + PH_OFFSET_MS);
  return String(d.getUTCFullYear()).slice(-2)
    + String(d.getUTCMonth() + 1).padStart(2, "0")
    + String(d.getUTCDate()).padStart(2, "0");
}

function stampToMs(stamp) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return 0;
  return Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])) - PH_OFFSET_MS;
}

function buyerTag(name) {
  const tag = String(name == null ? "" : name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return tag || "BUYER";
}

// 32-symbol alphabet avoids look-alikes (I/O/0/1); 256 is a multiple of 32,
// so the modulo adds no bias.
function randomTag(len) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function resolveProduct(env, template) {
  const envVarName = PRODUCT_ID_ENV_BY_TEMPLATE[template];
  if (!envVarName) {
    return { status: 400, error: `Unknown template "${template}".` };
  }
  const productId = env[envVarName];
  if (!productId) {
    return { status: 500, error: `Server is missing ${envVarName}.` };
  }
  return { productId };
}

async function gumroad(method, path, params) {
  const url = new URL(`https://api.gumroad.com/v2${path}`);
  const form = new URLSearchParams(params);
  const init = { method };
  if (method === "GET" || method === "DELETE") {
    form.forEach((value, key) => url.searchParams.set(key, value));
  } else {
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    init.body = form.toString();
  }
  const res = await fetch(url.toString(), init);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return data;
}

async function createCode(token, productId, template, buyer) {
  const name = `${PREFIX}-${phStamp(Date.now())}-${buyerTag(buyer)}-${randomTag(4)}`;
  const data = await gumroad("POST", `/products/${encodeURIComponent(productId)}/offer_codes`, {
    access_token: token,
    name,
    amount_off: "100",
    offer_type: "percent",
    max_purchase_count: MAX_USES,
  });
  if (!data.success) {
    return json(502, { ok: false, error: data.message || "Gumroad rejected the code." });
  }
  return json(200, { ok: true, code: name, template });
}

function isExpired(code, now) {
  if (!code || typeof code.name !== "string") return false;
  const match = /^PH-(\d{6})-/.exec(code.name);
  if (!match) return false;
  const uses = Number(code.times_used);
  if (!Number.isFinite(uses) || uses > 0) return false;
  const issued = stampToMs(match[1]);
  return issued > 0 && now - issued > RETENTION_MS;
}

async function cleanupCodes(token, productId, template) {
  const listed = await gumroad("GET", `/products/${encodeURIComponent(productId)}/offer_codes`, {
    access_token: token,
  });
  if (!listed.success) {
    return json(502, { ok: false, error: listed.message || "Gumroad rejected the listing." });
  }
  const codes = Array.isArray(listed.offer_codes) ? listed.offer_codes : [];
  const now = Date.now();
  const deleted = [];
  for (const code of codes.filter((entry) => isExpired(entry, now))) {
    const data = await gumroad("DELETE", `/products/${encodeURIComponent(productId)}/offer_codes/${encodeURIComponent(code.id)}`, {
      access_token: token,
    });
    if (data.success) deleted.push(code.name);
  }
  return json(200, { ok: true, template, deleted });
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_CODES_KEY) {
    return json(500, { ok: false, error: "Server is missing ADMIN_CODES_KEY." });
  }
  if (!keyMatches(request.headers.get("X-Admin-Key"), env.ADMIN_CODES_KEY)) {
    return json(401, { ok: false, error: "Wrong admin key." });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json(400, { ok: false, error: "Invalid JSON body." });
  }
  body = body && typeof body === "object" ? body : {};

  const action = String(body.action || "create").trim().toLowerCase();
  if (action === "ping") return json(200, { ok: true });

  if (action !== "create" && action !== "cleanup") {
    return json(400, { ok: false, error: `Unknown action "${action}".` });
  }

  const template = String(body.template || "").trim().toLowerCase();
  const resolved = resolveProduct(env, template);
  if (resolved.error) return json(resolved.status, { ok: false, error: resolved.error });

  const token = env.GUMROAD_ACCESS_TOKEN;
  if (!token) {
    return json(500, { ok: false, error: "Server is missing GUMROAD_ACCESS_TOKEN." });
  }

  try {
    return action === "create"
      ? await createCode(token, resolved.productId, template, body.buyer)
      : await cleanupCodes(token, resolved.productId, template);
  } catch (err) {
    return json(502, { ok: false, error: err && err.message ? err.message : "Gumroad request failed." });
  }
}
