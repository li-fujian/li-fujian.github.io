#!/usr/bin/env python3
"""Align dashboard_config live-price KPIs with rebuilt chart_data.

Keeps the last completed-week thesis, but rewrites 现价 / 反弹 / 距高点 so the
public page never shows a stale spot next to a newer chart.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def r2(x):
    return f"{x:.2f}"


def main():
    chart = json.loads((DATA / "chart_data.json").read_text(encoding="utf-8"))
    cfg = json.loads((DATA / "dashboard_config.json").read_text(encoding="utf-8"))
    meta = chart["meta"]
    quote = meta.get("latest_quote") or {}
    price = float(quote.get("price") or chart["full_close"][-1])
    ts = quote.get("timestamp") or meta.get("daily_snapshot_time") or meta["daily_last_date"]
    last_date = meta["daily_last_date"]
    confirmed_close = float(meta["confirmed_weekly_close"])

    cfg["meta"]["raw_data_asof"] = f"{ts} 腾讯行情快照（收盘后）"

    if cfg.get("kpis"):
        cfg["kpis"][0]["label"] = f"现价（{last_date} 收盘）"
        cfg["kpis"][0]["value"] = r2(price)
        if price < confirmed_close:
            cfg["kpis"][0]["tone"] = "down"
        elif price > confirmed_close:
            cfg["kpis"][0]["tone"] = "up"
        else:
            cfg["kpis"][0]["tone"] = "neutral"

    high = 460.0
    low = 63.65
    for item in cfg.get("kpis", []):
        label = item.get("label") or ""
        if "历史高点" in label:
            item["value"] = f"{(price / high - 1) * 100:.1f}%"
            item["tone"] = "down"
        elif "低点" in label and "反弹" in label:
            item["value"] = f"+{(price / low - 1) * 100:.1f}%"
            item["tone"] = "up"

    (DATA / "dashboard_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"aligned spot price={r2(price)} date={last_date} confirmed_close={confirmed_close}")


if __name__ == "__main__":
    main()
