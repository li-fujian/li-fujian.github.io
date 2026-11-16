#!/usr/bin/env python3
"""Rebuild hengrui/data.js and hundsun/data.js from forward-adjusted daily bars.

Price source: Tencent Finance fqkline ``qfq`` (前复权). For these two names the
corporate actions inside the window are cash dividends only, and Tencent's qfq
print equals the unadjusted OHLC minus every later cash dividend, rounded to
the fen. The newest bar is therefore the real traded price.

Volume source: Sina daily kline, in shares. Tencent's volume is in lots (手)
and is rounded, so it is not written into data.js.

The script also reads Yahoo's dividend events and refuses to write if a split
shows up, or if Tencent qfq disagrees with ``raw - later cash dividends``.

A new cash dividend changes every earlier qfq price. Re-run this script after
an ex-date instead of appending a raw bar onto the old series.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

CST = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
SINCE = "2026-05-18"
UA = "Mozilla/5.0 (compatible; study-kline/1.0)"

STOCKS = {
    "hengrui": {
        "name": "恒瑞医药",
        "code": "600276",
        "tencent": "sh600276",
        "yahoo": "600276.SS",
        "global": "HENGRUI_DATA",
        "levels": [
            ("2026-08-20", "high", "放量日高"),
            ("2026-09-11", "low", "半年低"),
        ],
    },
    "hundsun": {
        "name": "恒生电子",
        "code": "600570",
        "tencent": "sh600570",
        "yahoo": "600570.SS",
        "global": "HUNDSUN_DATA",
        "levels": [
            ("2026-11-03", "high", "放量日高"),
            ("2026-10-09", "low", "半年低"),
        ],
    },
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://finance.sina.com.cn/"})
    with urllib.request.urlopen(req, timeout=40) as response:
        return response.read()


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def money_text(value: Decimal) -> str:
    text = f"{value:.2f}"
    if text.endswith("0") and not text.endswith(".0"):
        text = text[:-1]
    return text


def tencent_qfq(symbol: str) -> list[dict]:
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,320,qfq"
    payload = json.loads(fetch(url).decode("utf-8"))
    rows = payload["data"][symbol]["qfqday"]
    parsed = []
    for row in rows:
        # date, open, close, high, low, volume(lots)
        parsed.append({
            "date": row[0],
            "open": money(row[1]),
            "high": money(row[3]),
            "low": money(row[4]),
            "close": money(row[2]),
        })
    return parsed


def sina_raw(symbol: str) -> dict[str, dict]:
    url = (
        "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen=400"
    )
    rows = json.loads(fetch(url).decode("utf-8"))
    out = {}
    for row in rows:
        out[row["day"]] = {
            "open": money(row["open"]),
            "high": money(row["high"]),
            "low": money(row["low"]),
            "close": money(row["close"]),
            "volume": int(row["volume"]),
        }
    return out


def yahoo_events(symbol: str) -> tuple[list[tuple[str, Decimal]], list]:
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{symbol}?range=2y&interval=1d&events=div%7Csplit&includeAdjustedClose=true"
    )
    payload = json.loads(fetch(url).decode("utf-8"))
    result = payload["chart"]["result"][0]
    events = result.get("events") or {}
    dividends = []
    for item in (events.get("dividends") or {}).values():
        day = datetime.fromtimestamp(int(item["date"]), CST).strftime("%Y-%m-%d")
        dividends.append((day, money(item["amount"])))
    dividends.sort()
    splits = list((events.get("splits") or {}).values())
    closes = {}
    quote = result["indicators"]["quote"][0]
    adj = result["indicators"]["adjclose"][0]["adjclose"]
    for index, stamp in enumerate(result["timestamp"]):
        if quote["close"][index] is None or adj[index] is None:
            continue
        day = datetime.fromtimestamp(int(stamp), CST).strftime("%Y-%m-%d")
        closes[day] = (money(quote["close"][index]), Decimal(str(adj[index])))
    return dividends, splits, closes


def shift_for(date: str, dividends: list[tuple[str, Decimal]]) -> Decimal:
    # On the ex-date the print is already the traded (ex) price.
    return sum((amount for ex_date, amount in dividends if ex_date > date), Decimal("0.00"))


def build(stock_id: str) -> tuple[list[dict], list[tuple[str, Decimal]], list[str]]:
    spec = STOCKS[stock_id]
    qfq_rows = [row for row in tencent_qfq(spec["tencent"]) if row["date"] >= SINCE]
    raw_rows = sina_raw(spec["tencent"])
    dividends, splits, yahoo_closes = yahoo_events(spec["yahoo"])
    if splits:
        raise SystemExit(f"{stock_id}: Yahoo reports a split/送转; this cash-dividend qfq path cannot write the file.")
    if not qfq_rows:
        raise SystemExit(f"{stock_id}: Tencent returned no qfq bars on or after {SINCE}.")
    notes = []
    for row in qfq_rows:
        raw = raw_rows.get(row["date"])
        if raw is None:
            raise SystemExit(f"{stock_id}: Sina has no raw bar on {row['date']}.")
        if raw["volume"] <= 0:
            raise SystemExit(f"{stock_id}: Sina volume is empty on {row['date']}.")
        shift = shift_for(row["date"], dividends)
        for field in ("open", "high", "low", "close"):
            expected = money(raw[field] - shift)
            if row[field] != expected:
                raise SystemExit(
                    f"{stock_id}: {row['date']} {field} Tencent qfq {row[field]} "
                    f"!= Sina raw {raw[field]} - later dividends {shift} = {expected}."
                )
        row["volume"] = raw["volume"]
        yahoo = yahoo_closes.get(row["date"])
        if yahoo is not None:
            raw_close, adj_close = yahoo
            if raw_close != raw["close"]:
                raise SystemExit(f"{stock_id}: {row['date']} Yahoo raw close {raw_close} != Sina {raw['close']}.")
            gap = abs(float(row["close"]) - float(adj_close))
            if gap > 0.06:
                raise SystemExit(
                    f"{stock_id}: {row['date']} Tencent qfq close {row['close']} "
                    f"is {gap:.4f} away from Yahoo adjclose {adj_close}."
                )
    last = qfq_rows[-1]
    if shift_for(last["date"], dividends) != 0:
        raise SystemExit(f"{stock_id}: the latest bar is still before a dividend, so it is not the traded price.")
    if last["close"] != raw_rows[last["date"]]["close"]:
        raise SystemExit(f"{stock_id}: latest qfq close does not equal the traded close.")
    dividend_text = "、".join(f"{day} 每股现金红利 {amount:.2f} 元" for day, amount in dividends if day >= SINCE) or "窗口内无现金红利"
    notes.append(dividend_text)
    return qfq_rows, dividends, notes


def render(stock_id: str, rows: list[dict], dividends: list[tuple[str, Decimal]]) -> str:
    spec = STOCKS[stock_id]
    in_window = [(day, amount) for day, amount in dividends if day > SINCE and day <= rows[-1]["date"]]
    dividend_lines = "\n".join(
        f" *   {day} 除息，每股现金红利 {amount:.2f} 元。该日之前的开高低收减去此金额（多笔累加）。"
        for day, amount in in_window
    ) or " *   窗口内没有现金红利。"
    level_lines = []
    by_date = {row["date"]: row for row in rows}
    for date, field, label in spec["levels"]:
        bar = by_date.get(date)
        if bar is None:
            raise SystemExit(f"{stock_id}: KEY_LEVELS date {date} is not in the series.")
        price = bar["high" if field == "high" else "low"]
        level_lines.append(
            f'  {{ price: {money_text(price)}, date: "{date}", label: "{label}" }},'
        )
    body = []
    for row in rows:
        body.append(
            "  ["
            + ", ".join([
                f'"{row["date"]}"',
                money_text(row["open"]),
                money_text(row["high"]),
                money_text(row["low"]),
                money_text(row["close"]),
                str(row["volume"]),
            ])
            + "],"
        )
    return f"""/*
 * ===== 数据更新说明 =====
 * 1. 前复权日K。最新一根的价格就是成交价；除息日之前的开高低收已扣去其后全部现金红利。
 * 2. 平时只改 AS_OF，并在 DATA 末尾追加一行。日期必须晚于上一行。
 *    格式：["日期", 开盘, 最高, 最低, 收盘, 成交量(股)]。成交量单位是股，不是手。
 * 3. 发生新的现金红利后，不要只追加除息日行情。先重新跑
 *    python3 scripts/update_study_klines.py {stock_id}
 *    整段历史会按新的前复权基准重算。没有新红利时，也不要手改已经写入的价格。
 * 4. 阶段高低点由页面自动识别。KEY_LEVELS 是手工关注价位，格式 {{ price, date, label }}，
 *    price 必须是该日最高价或最低价。
 * 来源：腾讯财经 {spec["tencent"]} qfq 日线（差额前复权），成交量为新浪同日成交股数。
 * 抓取窗口自 {SINCE} 起，截至 {rows[-1]["date"]}。
 * 窗口内的现金红利：
{dividend_lines}
 * 对照：同一天的不复权价（新浪 / Yahoo raw OHLC）减去该日之后的每股现金红利，四舍五入到分，
 * 与这里的开高低收一致。Yahoo adjclose 是比例复权，纯现金红利下通常只差几分钱。
 * 详细步骤见同目录 README.md。
 */
var {spec["global"]} = {{
  AS_OF: "{rows[-1]["date"]}",
  DATA: [
{chr(10).join(body)}
  ],
  KEY_LEVELS: [
{chr(10).join(level_lines)}
  ],
}};

if (typeof module !== "undefined" && module.exports) module.exports = {spec["global"]};
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("stock", nargs="*", choices=sorted(STOCKS))
    parser.add_argument("--check", action="store_true", help="verify sources without writing data.js")
    args = parser.parse_args()
    selected = args.stock or list(STOCKS)
    for stock_id in selected:
        rows, dividends, _notes = build(stock_id)
        text = render(stock_id, rows, dividends)
        target = ROOT / stock_id / "data.js"
        low = min(row["low"] for row in rows)
        high = max(row["high"] for row in rows)
        last = rows[-1]
        print(
            f"{stock_id}: {rows[0]['date']}..{last['date']} {len(rows)} bars "
            f"low {low} high {high} last {last['close']} vol {last['volume']}"
        )
        for date in ("2026-05-18", "2026-06-09", "2026-10-22", last["date"]):
            match = next((row for row in rows if row["date"] == date), None)
            if match:
                print(
                    f"  {date} O{match['open']} H{match['high']} L{match['low']} "
                    f"C{match['close']} V{match['volume']}"
                )
        if args.check:
            continue
        target.write_text(text, encoding="utf-8")
        print(f"  wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
