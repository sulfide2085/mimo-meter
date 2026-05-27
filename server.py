"""Mimo meter backend - proxies API calls, serves frontend."""

import json
import os
from datetime import datetime

import requests as http_client
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder=os.path.dirname(__file__))

BASE_URL = "https://platform.xiaomimimo.com"
COOKIE_FILE = os.path.join(os.path.dirname(__file__), "cookie.txt")

_accounts = None


def _load_accounts_from_file():
    """Load accounts from cookie.txt."""
    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [
                {"name": a.get("name", f"Account {i+1}"), "cookies": a["cookies"]}
                for i, a in enumerate(parsed)
            ]
    except (json.JSONDecodeError, KeyError):
        pass
    return [{"name": "Default", "cookies": raw}]


def _save_accounts_to_file(accounts):
    """Save accounts to cookie.txt."""
    with open(COOKIE_FILE, "w", encoding="utf-8") as f:
        json.dump(accounts, f, ensure_ascii=False, indent=2)


def _build_session(cookie_str):
    s = http_client.Session()
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            key, _, value = part.partition("=")
            s.cookies.set(key.strip(), value.strip().strip('"'))
    return s


REQUIRED_COOKIE_KEYS = {"api-platform_serviceToken", "userId"}


def _validate_cookies(cookie_str):
    keys = {p.strip().split("=", 1)[0].strip() for p in cookie_str.split(";") if "=" in p}
    missing = REQUIRED_COOKIE_KEYS - keys
    if missing:
        return f"Missing required cookie fields: {', '.join(sorted(missing))}"
    return None


def get_accounts():
    global _accounts
    if _accounts is None:
        _accounts = [
            {**a, "session": _build_session(a["cookies"])}
            for a in _load_accounts_from_file()
        ]
    return _accounts


def get_account_session(idx=0):
    accounts = get_accounts()
    if not accounts:
        return None
    idx = max(0, min(idx, len(accounts) - 1))
    return accounts[idx]


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
    return send_from_directory(os.path.dirname(__file__), "index.html")


@app.route("/api/accounts", methods=["GET"])
def api_accounts():
    accounts = get_accounts()
    return jsonify([{"index": i, "name": a["name"]} for i, a in enumerate(accounts)])


@app.route("/api/accounts", methods=["POST"])
def api_accounts_add():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Missing body"}), 400

    # Allow rename-only (name + index, no cookies)
    if "cookies" not in body and "index" not in body:
        return jsonify({"error": "Missing cookies"}), 400

    err = _validate_cookies(body["cookies"]) if "cookies" in body else None
    if err:
        return jsonify({"error": err}), 400

    global _accounts
    accounts = get_accounts()
    name = body.get("name", f"Account {len(accounts) + 1}")
    idx = body.get("index")

    if idx is not None and 0 <= idx < len(accounts):
        accounts[idx]["name"] = name
        if "cookies" in body:
            accounts[idx]["cookies"] = body["cookies"]
            accounts[idx]["session"] = _build_session(body["cookies"])
    else:
        accounts.append({
            "name": name,
            "cookies": body["cookies"],
            "session": _build_session(body["cookies"]),
        })

    # Save to file (without session objects)
    _save_accounts_to_file([
        {"name": a["name"], "cookies": a["cookies"]} for a in accounts
    ])
    return jsonify({"ok": True, "count": len(accounts)})


@app.route("/api/accounts", methods=["DELETE"])
def api_accounts_delete():
    idx = int(request.args.get("account", -1))
    global _accounts
    accounts = get_accounts()
    if idx < 0 or idx >= len(accounts):
        return jsonify({"error": "Invalid index"}), 400

    accounts.pop(idx)
    _save_accounts_to_file([
        {"name": a["name"], "cookies": a["cookies"]} for a in accounts
    ])
    _accounts = accounts  # Update cache
    return jsonify({"ok": True, "count": len(accounts)})


@app.route("/api/reload", methods=["POST"])
def api_reload():
    global _accounts
    _accounts = None
    return jsonify({"ok": True})


@app.route("/api/detail")
def api_detail():
    idx = int(request.args.get("account", 0))
    acct = get_account_session(idx)
    if not acct:
        return jsonify({"error": "No account configured"}), 400
    resp = acct["session"].get(f"{BASE_URL}/api/v1/tokenPlan/detail", headers=_headers())
    return jsonify(resp.json())


@app.route("/api/usage")
def api_usage():
    idx = int(request.args.get("account", 0))
    acct = get_account_session(idx)
    if not acct:
        return jsonify({"error": "No account configured"}), 400
    resp = acct["session"].get(f"{BASE_URL}/api/v1/tokenPlan/usage", headers=_headers())
    return jsonify(resp.json())


@app.route("/api/daily", methods=["POST"])
def api_daily():
    idx = int(request.args.get("account", 0))
    acct = get_account_session(idx)
    if not acct:
        return jsonify({"error": "No account configured"}), 400

    body = request.get_json(silent=True) or {}
    year = body.get("year", datetime.now().year)
    month = body.get("month", datetime.now().month)

    ph = acct["session"].cookies.get("api-platform_ph", "")
    resp = acct["session"].post(
        f"{BASE_URL}/api/v1/usage/token-plan/list",
        headers=_headers(),
        params={"api-platform_ph": ph},
        json={"year": year, "month": month},
    )
    return jsonify(resp.json())


@app.route("/api/all")
def api_all():
    idx = int(request.args.get("account", 0))
    acct = get_account_session(idx)
    if not acct:
        return jsonify({"error": "No account configured"}), 400

    s = acct["session"]
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
