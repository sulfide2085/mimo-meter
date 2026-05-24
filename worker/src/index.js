/**
 * Mimo Meter - Cloudflare Worker
 * Proxies requests to platform.xiaomimimo.com API
 */

const BASE_URL = "https://platform.xiaomimimo.com";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
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

async function fetchMimo(path, env, options = {}) {
  const cookie = env.MIMO_COOKIES;
  const headers = {
    ...makeHeaders(),
    cookie,
    ...options.headers,
  };

  const resp = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  return resp.json();
}

async function handleDetail(env) {
  return fetchMimo("/api/v1/tokenPlan/detail", env);
}

async function handleUsage(env) {
  return fetchMimo("/api/v1/tokenPlan/usage", env);
}

async function handleDaily(env, body) {
  const { year, month } = body || {};
  const now = new Date();
  const y = year || now.getUTCFullYear();
  const m = month || now.getUTCMonth() + 1;

  // Extract api-platform_ph from cookie string
  const phMatch = env.MIMO_COOKIES.match(/api-platform_ph=([^;]+)/);
  const ph = phMatch ? phMatch[1].replace(/"/g, "") : "";

  return fetchMimo(
    `/api/v1/usage/token-plan/list?api-platform_ph=${encodeURIComponent(ph)}`,
    env,
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

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health check
    if (url.pathname === "/") {
      return new Response(JSON.stringify({ status: "ok", hasCookies: !!env.MIMO_COOKIES }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    if (!env.MIMO_COOKIES) {
      return new Response(JSON.stringify({ error: "MIMO_COOKIES not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    try {
      let data;

      if (url.pathname === "/api/detail") {
        data = await handleDetail(env);
      } else if (url.pathname === "/api/usage") {
        data = await handleUsage(env);
      } else if (url.pathname === "/api/daily") {
        const body = await request.json().catch(() => ({}));
        data = await handleDaily(env, body);
      } else if (url.pathname === "/api/all") {
        const [detail, usage, daily] = await Promise.all([
          handleDetail(env),
          handleUsage(env),
          handleDaily(env, {}),
        ]);
        data = { detail, usage, daily };
      } else {
        return new Response("Not Found", { status: 404, headers: cors });
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }
  },
};
