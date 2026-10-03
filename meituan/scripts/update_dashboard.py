#!/usr/bin/env python3
"""Fetch, reconcile, and publish an evidence-only Meituan dashboard.

Standard library only. All validation precedes publication. --offline-dir
replays saved raw responses; --now is only permitted for offline verification.
Prices are unadjusted HKD. Tencent HK volume is shares (not mainland lots).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HK = timezone(timedelta(hours=8))
URLS = {
    "tencent_day.json": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hk03690,day,,,640,",
    "tencent_week.json": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hk03690,week,,,800,",
    "tencent_quote.txt": "https://qt.gtimg.cn/q=hk03690",
    "sina_quote.txt": "https://hq.sinajs.cn/list=rt_hk03690",
}
CALENDAR = json.loads((ROOT / "trading-calendar.json").read_text(encoding="utf-8"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def is_session(d, calendar=CALENDAR):
    require(d.year in calendar["years"], f"缺少 {d.year} 年港交所日历，拒绝推断交易日")
    return d.weekday() < 5 and d.isoformat() not in calendar["holidays"]


def close_ready(d, calendar=CALENDAR):
    return time(12, 15) if d.isoformat() in calendar["half_days"] else time(16, 15)


def latest_closed_session(now, calendar=CALENDAR):
    now = now.astimezone(HK)
    d = now.date()
    if is_session(d, calendar) and now.time() >= close_ready(d, calendar):
        return d
    d -= timedelta(days=1)
    while not is_session(d, calendar):
        d -= timedelta(days=1)
    return d


def week_key(d):
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return d - timedelta(days=d.weekday())


def week_end(d):
    monday = week_key(d)
    sessions = [monday + timedelta(days=i) for i in range(5)
                if is_session(monday + timedelta(days=i))]
    require(sessions, "整周无交易日")
    return sessions[-1]


def parse_bars(raw, period):
    doc = json.loads(raw)
    require(doc.get("code") == 0, f"腾讯 {period} 接口失败")
    stock = doc["data"]["hk03690"]
    require(period in stock, "必须使用不复权序列，不自动回退其他复权口径")
    rows = []
    for row in stock[period]:
        d = date.fromisoformat(row[0])
        o, c, h, l, v = map(float, row[1:6])
        require(all(math.isfinite(x) for x in (o, c, h, l, v)), "行情有非有限数")
        require(0 < l <= min(o, c) <= max(o, c) <= h and v > 0, f"OHLC/量异常 {d}")
        require(d.weekday() < 5, f"非工作日行情 {d}")
        if d.year in CALENDAR["years"]:
            require(is_session(d), f"休市日行情 {d}")
        require(not rows or row[0] > rows[-1]["date"], "日期重复或倒序")
        rows.append(dict(date=row[0], open=o, close=c, high=h, low=l, volume=v))
    require(len(rows) >= (300 if period == "day" else 120), "历史样本不足")
    return rows


def parse_quote(raw, provider):
    match = re.search(r'="([^"]+)"', raw)
    require(match is not None, f"{provider} 快照格式异常")
    f = match.group(1).split("~" if provider == "tencent" else ",")
    if provider == "tencent":
        require(f[2] == "03690" and f[75] == "HKD", "腾讯标的/币种异常")
        return dict(timestamp=f[30], open=float(f[5]), close=float(f[3]),
                    high=float(f[33]), low=float(f[34]), volume=float(f[6]),
                    previous_close=float(f[4]), amount=float(f[37]))
    require(f[0] == "MEITUAN-W", "新浪标的异常")
    return dict(timestamp=f[17] + " " + f[18], open=float(f[2]), close=float(f[6]),
                high=float(f[4]), low=float(f[5]), volume=float(f[12]),
                previous_close=float(f[3]), amount=float(f[11]))


def same_prices(a, b, label, volume=True):
    for field in ("open", "close", "high", "low"):
        require(abs(a[field] - b[field]) <= 0.005, f"{label} {field} 不一致：{a[field]} / {b[field]}")
    if volume:
        require(abs(a["volume"] - b["volume"]) <= 1, f"{label} 成交量不一致")


def validate_inputs(raw, now):
    daily = parse_bars(raw["tencent_day.json"], "day")
    weekly = parse_bars(raw["tencent_week.json"], "week")
    expected = latest_closed_session(now).isoformat()
    require(daily[-1]["date"] == expected, f"日线未到最近收盘交易日 {expected}，实际 {daily[-1]['date']}")
    require(weekly[-1]["date"] == expected, "周线最新日期与日线不同")
    require(all(r["date"] <= expected for r in daily + weekly), "发现未来行情")
    # Complete 2026 session coverage: missing trading days must not be silently accepted.
    dates = {r["date"] for r in daily}
    d = max(date.fromisoformat(daily[0]["date"]), date(min(CALENDAR["years"]), 1, 1))
    while d <= date.fromisoformat(expected):
        if is_session(d):
            require(d.isoformat() in dates, f"日线缺少交易日 {d}")
        d += timedelta(days=1)
    quotes = {p: parse_quote(raw[f"{p}_quote.txt"], p) for p in ("tencent", "sina")}
    for provider, quote in quotes.items():
        ts = datetime.strptime(quote["timestamp"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=HK)
        threshold = time(12, 8) if ts.date().isoformat() in CALENDAR["half_days"] else time(16, 8)
        require(ts.date().isoformat() == expected and ts.time() >= threshold and ts <= now,
                f"{provider} 快照不是目标交易日收盘快照")
        same_prices(quote, daily[-1], f"{provider} 快照/日线")
        require(abs(quote["previous_close"] - daily[-2]["close"]) <= .005, "昨收不一致")
        require(math.isfinite(quote["amount"]) and quote["amount"] > 0, "成交额异常")
        require(daily[-1]["low"] <= quote["amount"] / quote["volume"] <= daily[-1]["high"],
                "成交额/成交量不在当日高低区间，可能单位错误")
    groups = defaultdict(list)
    for r in daily:
        groups[week_key(r["date"])].append(r)
    checked = 0
    week_keys = set()
    for row in weekly:
        key = week_key(row["date"])
        require(key not in week_keys, "一周存在多根周K")
        week_keys.add(key)
        if key not in groups or key == week_key(daily[0]["date"]):
            continue  # First daily week may be truncated by API lookback.
        rows = groups[key]
        agg = dict(open=rows[0]["open"], close=rows[-1]["close"],
                   high=max(r["high"] for r in rows), low=min(r["low"] for r in rows),
                   volume=sum(r["volume"] for r in rows))
        require(row["date"] == rows[-1]["date"], "日周最后日期不一致")
        same_prices(row, agg, f"日周聚合 {row['date']}")
        checked += 1
    require(checked == len(groups) - 1, "周线缺少日线覆盖的周")
    return daily, weekly, quotes, checked


def sma(values, period):
    return [None if i + 1 < period else sum(values[i+1-period:i+1]) / period
            for i in range(len(values))]


def ema(values, period):
    result = [values[0]]
    alpha = 2 / (period + 1)
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def indicators(weekly):
    closes = [r["close"] for r in weekly]
    result = {f"ma{p}": sma(closes, p) for p in (5, 10, 20, 30, 60)}
    result["dif"] = [a-b for a, b in zip(ema(closes, 12), ema(closes, 26))]
    result["dea"] = ema(result["dif"], 9)
    result["hist"] = [2*(a-b) for a, b in zip(result["dif"], result["dea"])]
    return result


def validate_financials(f):
    require(f["unit"] == "人民币千元", "财务单位错误")
    s = f["segments"]
    require(s["core_local_revenue"] + s["new_revenue"] == f["quarter"]["revenue"], "分部收入不平")
    require(sum(s[k] for k in ("core_local_operating_profit", "new_operating_profit", "unallocated_operating_profit"))
            == f["quarter"]["operating_profit"], "分部经营利润不平")


def build(raw, now, fundamentals):
    daily, weekly, quotes, checked = validate_inputs(raw, now)
    validate_financials(fundamentals)
    source = ROOT / fundamentals["local_source"]
    require(hashlib.sha256(source.read_bytes()).hexdigest() == fundamentals["source_sha256"], "财报原件哈希不符")
    ind = indicators(weekly)
    latest = daily[-1]
    last_date = date.fromisoformat(latest["date"])
    complete = last_date == week_end(last_date)
    ci = len(weekly) - (1 if complete else 2)
    confirmed = weekly[ci]
    metric = {key: round(value[ci], 6) for key, value in ind.items()}
    above = [str(p) for p in (5, 10, 20, 30, 60) if confirmed["close"] > ind[f"ma{p}"][ci]]
    below = [str(p) for p in (5, 10, 20, 30, 60) if confirmed["close"] < ind[f"ma{p}"][ci]]
    if len(below) == 5:
        trend = "周线偏弱，低于全部观察均线"
    elif len(above) == 5:
        trend = "周线收于全部观察均线上方"
    else:
        trend = "周线均线位置分化"
    macd_relation = "DIF 低于 DEA" if metric["dif"] < metric["dea"] else "DIF 高于 DEA" if metric["dif"] > metric["dea"] else "DIF 等于 DEA"
    hist_prev = ind["hist"][ci-1]
    expansion = "扩大" if abs(metric["hist"]) > abs(hist_prev) else "收缩" if abs(metric["hist"]) < abs(hist_prev) else "持平"
    macd = f"{macd_relation}；{'负柱' if metric['hist'] < 0 else '正柱'}绝对值较上周{expansion}"
    # Preserve the first failure of the archived thesis; recovery cannot erase history.
    failures = [r for r in weekly[:ci+1] if r["date"] > "2026-08-24" and r["close"] < 71.8]
    failure = failures[0] if failures else None
    average_volume = sum(r["volume"] for r in weekly[ci-20:ci]) / 20
    previous_twenty = weekly[ci-20:ci]
    def scheduled_days(row):
        monday = week_key(row["date"])
        return sum(is_session(monday + timedelta(days=i)) for i in range(5))
    # Correct holiday-week volume comparison by actual scheduled session count.
    sessions = scheduled_days(confirmed)
    prior_sessions = sum(scheduled_days(r) for r in previous_twenty)
    volume_ratio = (confirmed["volume"] / sessions) / (sum(r["volume"] for r in previous_twenty) / prior_sessions)
    note = f"以 {confirmed['date']} 已收官周为准。" + ("当周已收官。" if complete else "当周K线尚未收官，仅作图展示，不参与周线判断。")
    return {
        "schema_version": 1,
        "meta": {"symbol": "03690.HK", "name": "美团-W", "currency": "HKD", "adjustment": "none",
                 "price_basis": "不复权", "volume_unit": "股", "generated_at": now.isoformat(),
                 "as_of": latest["date"], "expected_session": latest_closed_session(now).isoformat(),
                 "confirmed_week": confirmed["date"], "latest_week_complete": complete,
                 "weekly_rows": len(weekly), "daily_rows": len(daily), "note": note},
        "quote": {**latest, "previous_close": daily[-2]["close"],
                  "change": round(latest["close"] - daily[-2]["close"], 4),
                  "change_pct": round((latest["close"] / daily[-2]["close"] - 1) * 100, 4),
                  "source_timestamp": quotes["tencent"]["timestamp"]},
        "technical": {"weekly": confirmed, **metric, "above": above, "below": below,
                      "weekly_change_pct": round((confirmed["close"]/weekly[ci-1]["close"]-1)*100, 4),
                      "trend": trend, "macd": macd, "week_sessions": sessions,
                      "volume_vs_prior20": round(confirmed["volume"] / average_volume, 4),
                      "daily_volume_vs_prior20weeks": round(volume_ratio, 4),
                      "prior20_high": max(r["high"] for r in weekly[ci-19:ci+1]),
                      "prior20_low": min(r["low"] for r in weekly[ci-19:ci+1]),
                      "legacy_failure": failure},
        "chart": {"weekly": weekly[-100:], "indicators": {k: [None if v is None else round(v, 6) for v in a[-100:]] for k,a in ind.items()}},
        "fundamentals": fundamentals,
        "calendar": CALENDAR,
        "audit": {"status": "passed", "daily_weekly_matched": checked,
                  "quote_fields_matched": ["日期", "开盘", "收盘", "最高", "最低", "成交量", "昨收"],
                  "sources": [{"name": name, "url": url, "sha256": hashlib.sha256(raw[name].encode('utf-8')).hexdigest()}
                              for name, url in URLS.items()],
                  "limitations": ["腾讯与新浪为两个数据提供方，不保证其上游数据独立。",
                      "本页为行情观察；均线和MACD不能单独证明趋势反转或交易收益。",
                      "财务数据按公告人工核验，行情自动更新不会自动刷新财报。",
                      "旧模拟盘截至2026-08-24无成交，不构成策略有效性证据。"]}
    }


def fetch(name):
    req = urllib.request.Request(URLS[name], headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("gb18030" if name.endswith(".txt") else "utf-8")


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def publish(payload, raw, root=ROOT):
    target = root / "data" / "dashboard.json"
    if target.exists():
        old = json.loads(target.read_text(encoding="utf-8"))
        require(payload["meta"]["as_of"] >= old["meta"]["as_of"], "禁止行情日期回退")
    content = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    for name, text in raw.items():
        atomic_write(root / "data" / "raw" / name, text)
    atomic_write(target, content)
    # Browser consumes exactly one file, replaced only after all checks and JSON serialization pass.
    atomic_write(root / "data" / "dashboard.js", "window.MEITUAN_DASHBOARD = " + content.rstrip() + ";\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline-dir", type=Path)
    parser.add_argument("--now", help="带时区的复现时间，仅离线验证可用")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    require(not args.now or (args.offline_dir and args.check_only), "--now 仅允许离线 --check-only")
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(HK)
    require(now.tzinfo is not None, "时间必须带时区")
    if args.offline_dir:
        raw = {name: (args.offline_dir / name).read_text(encoding="utf-8") for name in URLS}
    else:
        with ThreadPoolExecutor(max_workers=4) as pool:
            raw = dict(zip(URLS, pool.map(fetch, URLS)))
    fundamentals = json.loads((ROOT / "data" / "fundamentals.json").read_text(encoding="utf-8"))
    payload = build(raw, now, fundamentals)
    require(fundamentals["published_at"] <= now.date().isoformat(), "财报发布日期在未来")
    if not args.check_only:
        publish(payload, raw)
    print(json.dumps({"result": "validated" if args.check_only else "published", "as_of": payload["meta"]["as_of"],
                      "close": payload["quote"]["close"], "week": payload["meta"]["confirmed_week"],
                      "matched_weeks": payload["audit"]["daily_weekly_matched"],
                      "technical": payload["technical"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAILED: {exc}; 页面数据未通过本次更新校验。", file=sys.stderr)
        sys.exit(1)
