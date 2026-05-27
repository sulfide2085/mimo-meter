/**
 * Mimo Meter - Cloudflare Worker
 * Proxies requests to platform.xiaomimimo.com API
 * Supports multiple accounts via KV storage
 */

const BASE_URL = "https://platform.xiaomimimo.com";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function makeHeaders() {
  return {
    accept: "*/*",
    "accept-language": "zh",
    "content-type": "application/json",
    origin: BASE_URL,
    referer: `${BASE_URL}/console/plan-manage`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "x-timezone": "Etc/GMT-8",
  };
}

// Verify admin token
function checkAuth(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return true; // No token configured = no auth required
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${token}`;
}

// Load accounts from KV, fallback to env var
async function loadAccounts(env) {
  if (env.ACCOUNTS) {
    const stored = await env.ACCOUNTS.get("accounts");
    if (stored) {
      try { return JSON.parse(stored); } catch {}
    }
  }
  // Fallback to env var (backward compatible)
  const raw = env.MIMO_COOKIES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((a, i) => ({
        name: a.name || `Account ${i + 1}`,
        cookies: a.cookies,
      }));
    }
  } catch {}
  return [{ name: "Default", cookies: raw }];
}

// Save accounts to KV
async function saveAccounts(env, accounts) {
  if (!env.ACCOUNTS) throw new Error("KV not configured");
  await env.ACCOUNTS.put("accounts", JSON.stringify(accounts));
}

function getAccountIndex(url) {
  return parseInt(url.searchParams.get("account") || "0", 10);
}

const REQUIRED_COOKIE_KEYS = ["api-platform_serviceToken", "userId"];

function validateCookies(cookieStr) {
  const keys = cookieStr.split(";").map((p) => p.trim().split("=")[0].trim());
  const missing = REQUIRED_COOKIE_KEYS.filter((k) => !keys.includes(k));
  if (missing.length) {
    return `Missing required cookie fields: ${missing.join(", ")}`;
  }
  return null;
}

async function fetchMimo(path, cookieStr, options = {}) {
  const headers = {
    ...makeHeaders(),
    cookie: cookieStr,
    ...options.headers,
  };
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });
  return resp.json();
}

async function handleDetail(cookieStr) {
  return fetchMimo("/api/v1/tokenPlan/detail", cookieStr);
}

async function handleUsage(cookieStr) {
  return fetchMimo("/api/v1/tokenPlan/usage", cookieStr);
}

async function handleDaily(cookieStr, body) {
  const { year, month } = body || {};
  const now = new Date();
  const y = year || now.getUTCFullYear();
  const m = month || now.getUTCMonth() + 1;
  const phMatch = cookieStr.match(/api-platform_ph=([^;]+)/);
  const ph = phMatch ? phMatch[1].replace(/"/g, "") : "";
  return fetchMimo(
    `/api/v1/usage/token-plan/list?api-platform_ph=${encodeURIComponent(ph)}`,
    cookieStr,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ year: y, month: m }),
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health check
    if (url.pathname === "/") {
      const accounts = await loadAccounts(env);
      return jsonResponse({ status: "ok", accounts: accounts.length }, cors);
    }

    // List accounts (names only)
    if (url.pathname === "/api/accounts" && request.method === "GET") {
      const accounts = await loadAccounts(env);
      return jsonResponse(
        accounts.map((a, i) => ({ index: i, name: a.name })),
        cors
      );
    }

    // Add/Update account
    if (url.pathname === "/api/accounts" && request.method === "POST") {
      if (!checkAuth(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, cors, 401);
      }
      const body = await request.json().catch(() => null);
      if (!body) {
        return jsonResponse({ error: "Missing body" }, cors, 400);
      }
      // Allow rename-only (name + index, no cookies)
      if (!body.cookies && body.index === undefined) {
        return jsonResponse({ error: "Missing cookies" }, cors, 400);
      }
      const cookieErr = body.cookies ? validateCookies(body.cookies) : null;
      if (cookieErr) {
        return jsonResponse({ error: cookieErr }, cors, 400);
      }
      const accounts = await loadAccounts(env);
      const name = body.name || `Account ${accounts.length + 1}`;
      const idx = body.index;

      if (idx !== undefined && idx >= 0 && idx < accounts.length) {
        if (body.cookies) {
          // Update existing (name + cookies)
          accounts[idx] = { name, cookies: body.cookies };
        } else {
          // Rename only
          accounts[idx].name = name;
        }
      } else {
        // Add new
        accounts.push({ name, cookies: body.cookies });
      }

      await saveAccounts(env, accounts);
      return jsonResponse({ ok: true, count: accounts.length }, cors);
    }

    // Delete account
    if (url.pathname === "/api/accounts" && request.method === "DELETE") {
      if (!checkAuth(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, cors, 401);
      }
      const idx = getAccountIndex(url);
      const accounts = await loadAccounts(env);
      if (idx < 0 || idx >= accounts.length) {
        return jsonResponse({ error: "Invalid index" }, cors, 400);
      }
      accounts.splice(idx, 1);
      await saveAccounts(env, accounts);
      return jsonResponse({ ok: true, count: accounts.length }, cors);
    }

    // Data endpoints
    const accounts = await loadAccounts(env);
    if (accounts.length === 0) {
      return jsonResponse({ error: "No accounts configured" }, cors, 400);
    }

    const idx = getAccountIndex(url);
    const account = accounts[idx] || accounts[0];
    const cookieStr = account.cookies;

    try {
      let data;

      if (url.pathname === "/api/detail") {
        data = await handleDetail(cookieStr);
      } else if (url.pathname === "/api/usage") {
        data = await handleUsage(cookieStr);
      } else if (url.pathname === "/api/daily") {
        const body = await request.json().catch(() => ({}));
        data = await handleDaily(cookieStr, body);
      } else if (url.pathname === "/api/all") {
        const [detail, usage, daily] = await Promise.all([
          handleDetail(cookieStr),
          handleUsage(cookieStr),
          handleDaily(cookieStr, {}),
        ]);
        data = { detail, usage, daily };
      } else {
        return new Response("Not Found", { status: 404, headers: cors });
      }

      return jsonResponse(data, cors);
    } catch (err) {
      return jsonResponse({ error: err.message }, cors, 500);
    }
  },
};
