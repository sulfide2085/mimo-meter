"""Test script for Mimo platform API endpoints."""

import json
import requests
from datetime import datetime

BASE_URL = "https://platform.xiaomimimo.com"

# Load cookies from cookie.txt
# Format: one cookie per line, key ："value" or key ：value
def load_cookies():
    cookies = {}
    with open("cookie.txt", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # Support full-width ：, ASCII :, and =
            for sep in ["：", ":", "="]:
                if sep in line:
                    key, _, value = line.partition(sep)
                    key = key.strip()
                    value = value.strip().strip('"')
                    if key and value:
                        cookies[key] = value
                    break
    return cookies


def get_headers():
    return {
        "accept": "*/*",
        "accept-language": "zh",
        "content-type": "application/json",
        "origin": BASE_URL,
        "referer": f"{BASE_URL}/console/plan-manage",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "x-timezone": "Etc/GMT-8",
    }


def test_detail(session):
    """GET /api/v1/tokenPlan/detail - plan info"""
    print("=" * 60)
    print("[1] tokenPlan/detail")
    print("=" * 60)
    resp = session.get(f"{BASE_URL}/api/v1/tokenPlan/detail", headers=get_headers())
    data = resp.json()
    print(f"Status: {resp.status_code}")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return data


def test_usage(session):
    """GET /api/v1/tokenPlan/usage - quota usage"""
    print("\n" + "=" * 60)
    print("[2] tokenPlan/usage")
    print("=" * 60)
    resp = session.get(f"{BASE_URL}/api/v1/tokenPlan/usage", headers=get_headers())
    data = resp.json()
    print(f"Status: {resp.status_code}")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return data


def test_daily_usage(session, year=None, month=None):
    """POST /api/v1/usage/token-plan/list - daily usage by model"""
    if year is None:
        year = datetime.now().year
    if month is None:
        month = datetime.now().month

    print("\n" + "=" * 60)
    print(f"[3] usage/token-plan/list ({year}-{month:02d})")
    print("=" * 60)
    payload = {"year": year, "month": month}
    # This endpoint requires api-platform_ph as query param
    ph = session.cookies.get("api-platform_ph", "")
    resp = session.post(
        f"{BASE_URL}/api/v1/usage/token-plan/list",
        headers=get_headers(),
        params={"api-platform_ph": ph},
        json=payload,
    )
    data = resp.json()
    print(f"Status: {resp.status_code}")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return data


def format_token_count(count):
    """Format token count to human readable."""
    if count >= 1_000_000:
        return f"{count / 1_000_000:.2f}M"
    elif count >= 1_000:
        return f"{count / 1_000:.2f}K"
    return str(count)


def print_summary(detail, usage, daily):
    """Print a human-friendly summary."""
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    if detail and detail.get("code") == 0:
        d = detail["data"]
        print(f"Plan:        {d['planName']} ({d['planCode']})")
        print(f"Expires:     {d['currentPeriodEnd']}")
        print(f"Expired:     {'Yes' if d['expired'] else 'No'}")
        print(f"Auto-renew:  {'Yes' if d['hasAutoRenewSubscribed'] else 'No'}")

    if usage and usage.get("code") == 0:
        u = usage["data"]
        mu = u["monthUsage"]
        pu = u["usage"]
        for item in mu["items"]:
            print(f"\nMonthly:     {format_token_count(item['used'])} / {format_token_count(item['limit'])} ({item['percent']:.2%})")
        for item in pu["items"]:
            if item["limit"] > 0:
                print(f"Plan total:  {format_token_count(item['used'])} / {format_token_count(item['limit'])} ({item['percent']:.2%})")

    if daily and daily.get("code") == 0:
        records = daily["data"]
        if records:
            print(f"\nDaily breakdown ({records[0]['date']}):")
            for r in records:
                print(f"  {r['model']:20s}  requests={r['requestCount']:4d}  total={format_token_count(r['totalToken']):>10s}  input_hit={format_token_count(r['inputHitToken']):>10s}  input_miss={format_token_count(r['inputMissToken']):>8s}  output={format_token_count(r['outputToken']):>8s}")


def main():
    cookies = load_cookies()
    print(f"Loaded {len(cookies)} cookies")

    session = requests.Session()
    session.cookies.update(cookies)

    detail = test_detail(session)
    usage = test_usage(session)
    daily = test_daily_usage(session)

    print_summary(detail, usage, daily)


if __name__ == "__main__":
    main()
