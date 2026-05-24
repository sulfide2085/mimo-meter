"""Mimo meter backend - proxies API calls, serves frontend."""

import os
from datetime import datetime

import requests as http_client
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static")

BASE_URL = "https://platform.xiaomimimo.com"
COOKIE_FILE = os.path.join(os.path.dirname(__file__), "cookie.txt")

_session = None


def _load_cookies():
    cookies = {}
    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            for sep in ["：", ":", "="]:
                if sep in line:
                    key, _, value = line.partition(sep)
                    key = key.strip()
                    value = value.strip().strip('"')
                    if key and value:
                        cookies[key] = value
                    break
    return cookies


def get_session():
    global _session
    if _session is None:
        _session = http_client.Session()
        _session.cookies.update(_load_cookies())
    return _session


def _headers():
    return {
        "accept": "*/*",
        "accept-language": "zh",
        "content-type": "application/json",
        "origin": BASE_URL,
        "referer": f"{BASE_URL}/console/plan-manage",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "x-timezone": "Etc/GMT-8",
    }


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/reload", methods=["POST"])
def api_reload():
    """Reload cookies from cookie.txt without restarting the server."""
    global _session
    _session = None
    return jsonify({"ok": True})


@app.route("/api/detail")
def api_detail():
    s = get_session()
    resp = s.get(f"{BASE_URL}/api/v1/tokenPlan/detail", headers=_headers())
    return jsonify(resp.json())


@app.route("/api/usage")
def api_usage():
    s = get_session()
    resp = s.get(f"{BASE_URL}/api/v1/tokenPlan/usage", headers=_headers())
    return jsonify(resp.json())


@app.route("/api/daily", methods=["POST"])
def api_daily():
    body = request.get_json(silent=True) or {}
    year = body.get("year", datetime.now().year)
    month = body.get("month", datetime.now().month)

    s = get_session()
    ph = s.cookies.get("api-platform_ph", "")
    resp = s.post(
        f"{BASE_URL}/api/v1/usage/token-plan/list",
        headers=_headers(),
        params={"api-platform_ph": ph},
        json={"year": year, "month": month},
    )
    return jsonify(resp.json())


@app.route("/api/all")
def api_all():
    """Return all data in one request for convenience."""
    s = get_session()
    now = datetime.now()

    detail_resp = s.get(f"{BASE_URL}/api/v1/tokenPlan/detail", headers=_headers())
    usage_resp = s.get(f"{BASE_URL}/api/v1/tokenPlan/usage", headers=_headers())

    ph = s.cookies.get("api-platform_ph", "")
    daily_resp = s.post(
        f"{BASE_URL}/api/v1/usage/token-plan/list",
        headers=_headers(),
        params={"api-platform_ph": ph},
        json={"year": now.year, "month": now.month},
    )

    return jsonify({
        "detail": detail_resp.json(),
        "usage": usage_resp.json(),
        "daily": daily_resp.json(),
    })


if __name__ == "__main__":
    if not os.path.exists(COOKIE_FILE):
        print(f"Error: {COOKIE_FILE} not found.")
        print("Create cookie.txt with your Mimo platform cookies.")
        exit(1)
    app.run(host="127.0.0.1", port=5000, debug=True)
