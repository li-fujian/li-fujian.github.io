#!/usr/bin/env python3
"""Build the STAR 50 weekly dashboard data and run a conservative backtest.

Signal and backtest instrument:
  SSE STAR 50 Index (000688)

Execution contract:
  - Only completed weekly bars may generate discretionary signals.
  - A Friday-close signal is filled at the next trading day's open.
  - Entry and discretionary exit are all-in/all-out.
  - Each buy or sell is one action; no more than six actions per calendar year.
  - A 12% protective stop is assumed to be placed immediately after entry.
  - Backtests include 10 bps friction on each side and adverse opening gaps.

The strategy intentionally stays small: one oscillator, one protective stop,
and a two-stage profit-taking rule that lets exceptional trends run.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
PUBLIC_DATA_DIR = ROOT / "public" / "data"

INDEX_SYMBOL = "sh000688"
INDEX_URL = (
    "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
    "?param=sh000688,day,,,2000,qfq"
)

# Frozen v1.2 parameters. Change only with a new version and a fresh audit.
ENTRY_J = 5.0
ENTRY_WEEKS = 3
EXIT_J = 90.0
RUNNER_ACTIVATION = 0.30
RUNNER_TRAIL = 0.15
PROTECTIVE_STOP = 0.12
FRICTION = 0.001
MAX_ANNUAL_ACTIONS = 6


@dataclass(frozen=True)
class DailyBar:
    date: str
    open: float
    close: float
    high: float
    low: float
    volume: float


@dataclass(frozen=True)
class WeeklyBar:
    date: str
    open: float
    close: float
    high: float
    low: float
    volume: float
    daily_start: int
    daily_end: int


@dataclass
class Trade:
    buy_date: str
    buy_price: float
    sell_date: str = ""
    sell_price: float = 0.0
    return_pct: float = 0.0
    hold_days: int = 0
    reason: str = ""
    status: str = "open"


@dataclass
class Metrics:
    total_return_pct: float
    cagr_pct: float
    max_drawdown_pct: float
    win_rate_pct: float
    trade_count: int
    avg_trade_pct: float
    profit_factor: float | None
    exposure_pct: float
    max_actions_in_year: int
    annual_actions: dict[str, int]
    trades: list[Trade]
    equity_curve: list[tuple[str, float]]


def round2(value: float) -> float:
    return round(value + 1e-10, 2)


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 Chrome/126 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def load_or_refresh(symbol: str, url: str, refresh: bool) -> tuple[dict, bool]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"{symbol}.json"
    if refresh:
        try:
            payload = fetch_json(url)
            path.write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            return payload, True
        except Exception as exc:
            if not path.exists():
                raise RuntimeError(f"行情刷新失败且无本地缓存：{symbol}: {exc}") from exc
            print(f"WARN: {symbol} 刷新失败，使用缓存：{exc}")
    if not path.exists():
        raise RuntimeError(f"缺少行情缓存：{path}；请去掉 --no-refresh 重试")
    return json.loads(path.read_text(encoding="utf-8")), False


def parse_daily(payload: dict, symbol: str) -> list[DailyBar]:
    node = payload.get("data", {}).get(symbol, {})
    rows = node.get("day") or node.get("qfqday") or []
    if not rows:
        raise ValueError(f"{symbol} 行情为空")
    bars = [
        DailyBar(
            date=row[0],
            open=float(row[1]),
            close=float(row[2]),
            high=float(row[3]),
            low=float(row[4]),
            volume=float(row[5]),
        )
        for row in rows
        if len(row) >= 6
    ]
    return sorted(bars, key=lambda bar: bar.date)


def aggregate_weekly(daily: list[DailyBar]) -> list[WeeklyBar]:
    groups: list[list[tuple[int, DailyBar]]] = []
    current_key: tuple[int, int] | None = None
    for idx, bar in enumerate(daily):
        parsed = datetime.strptime(bar.date, "%Y-%m-%d").date()
        iso = parsed.isocalendar()
        key = (iso.year, iso.week)
        if key != current_key:
            groups.append([])
            current_key = key
        groups[-1].append((idx, bar))

    weekly: list[WeeklyBar] = []
    for group in groups:
        first_idx, first = group[0]
        last_idx, last = group[-1]
        weekly.append(
            WeeklyBar(
                date=last.date,
                open=first.open,
                close=last.close,
                high=max(item.high for _, item in group),
                low=min(item.low for _, item in group),
                volume=sum(item.volume for _, item in group),
                daily_start=first_idx,
                daily_end=last_idx,
            )
        )
    return weekly


def completed_week_count(
    daily: list[DailyBar],
    weekly: list[WeeklyBar],
    *,
    as_of: date | None = None,
) -> int:
    """Return the count of weeks safe to use for signals.

    Any week before the latest data week is complete. The latest week is accepted
    only when its last bar is Friday or later; a Friday holiday can delay the
    signal to the next data update, never move it earlier.
    """
    if not weekly:
        return 0
    latest = datetime.strptime(daily[-1].date, "%Y-%m-%d").date()
    reference = as_of or date.today()
    latest_iso = latest.isocalendar()
    reference_iso = reference.isocalendar()
    if (latest_iso.year, latest_iso.week) < (reference_iso.year, reference_iso.week):
        return len(weekly)
    if latest.weekday() >= 4:
        return len(weekly)
    return max(0, len(weekly) - 1)


def compute_kdj(weekly: list[WeeklyBar]) -> list[tuple[float, float, float]]:
    k = d = 50.0
    result: list[tuple[float, float, float]] = []
    for idx, bar in enumerate(weekly):
        start = max(0, idx - 8)
        high = max(item.high for item in weekly[start : idx + 1])
        low = min(item.low for item in weekly[start : idx + 1])
        rsv = (bar.close - low) / (high - low) * 100.0 if high != low else 50.0
        k = rsv / 3.0 + k * 2.0 / 3.0
        d = k / 3.0 + d * 2.0 / 3.0
        result.append((k, d, 3.0 * k - 2.0 * d))
    return result


def drawdown_from_52w_high(weekly: list[WeeklyBar], idx: int) -> float:
    start = max(0, idx - 51)
    rolling_high = max(bar.high for bar in weekly[start : idx + 1])
    return 1.0 - weekly[idx].close / rolling_high if rolling_high else 0.0


def entry_signal(
    weekly: list[WeeklyBar],
    j_values: list[float],
    idx: int,
    *,
    entry_j: float = ENTRY_J,
    entry_weeks: int = ENTRY_WEEKS,
) -> bool:
    if idx < max(entry_weeks, 8):
        return False
    prior = j_values[idx - entry_weeks : idx]
    oversold = len(prior) == entry_weeks and all(value < entry_j for value in prior)
    turning_up = j_values[idx] > j_values[idx - 1]
    return oversold and turning_up


def exit_signal(j_values: list[float], idx: int, *, exit_j: float = EXIT_J) -> bool:
    return idx >= 1 and j_values[idx] > exit_j and j_values[idx] < j_values[idx - 1]


def runner_mode_active(
    entry_raw_fill: float,
    peak_weekly_close: float,
    *,
    activation: float = RUNNER_ACTIVATION,
) -> bool:
    return (
        entry_raw_fill > 0.0
        and peak_weekly_close >= entry_raw_fill * (1.0 + activation)
    )


def discretionary_exit_reason(
    weekly: list[WeeklyBar],
    j_values: list[float],
    idx: int,
    *,
    entry_raw_fill: float,
    peak_weekly_close: float,
    exit_j: float = EXIT_J,
    runner_activation: float = RUNNER_ACTIVATION,
    runner_trail: float = RUNNER_TRAIL,
) -> str | None:
    if runner_mode_active(
        entry_raw_fill,
        peak_weekly_close,
        activation=runner_activation,
    ):
        if weekly[idx].close <= peak_weekly_close * (1.0 - runner_trail):
            return f"大行情模式：周收盘从峰值回撤{runner_trail * 100:g}%"
        return None
    if exit_signal(j_values, idx, exit_j=exit_j):
        return "标准模式：周线J高位回落"
    return None


def _week_end_map(weekly: list[WeeklyBar], completed_count: int) -> dict[int, int]:
    return {
        weekly[idx].daily_end: idx
        for idx in range(min(completed_count, len(weekly)))
    }


def run_backtest(
    daily_all: list[DailyBar],
    *,
    start_date: str,
    end_date: str,
    entry_j: float = ENTRY_J,
    entry_weeks: int = ENTRY_WEEKS,
    exit_j: float = EXIT_J,
    protective_stop: float = PROTECTIVE_STOP,
) -> Metrics:
    history = [bar for bar in daily_all if bar.date <= end_date]
    active_indices = [
        idx
        for idx, bar in enumerate(history)
        if start_date <= bar.date <= end_date
    ]
    if len(active_indices) < 80:
        raise ValueError(f"回测区间数据不足：{start_date} ~ {end_date}")
    daily = [history[idx] for idx in active_indices]
    first_day_idx = active_indices[0]
    last_day_idx = active_indices[-1]

    # Indicators keep their pre-window history. Only orders and equity are
    # reset at start_date, avoiding KDJ/52-week cold starts in validation.
    weekly = aggregate_weekly(history)
    completed_count = completed_week_count(history, weekly)
    kdj = compute_kdj(weekly)
    j_values = [item[2] for item in kdj]
    week_end = _week_end_map(weekly, completed_count)

    cash = 1.0
    units = 0.0
    entry_fill = 0.0
    entry_raw_fill = 0.0
    stop_price = 0.0
    entry_day_idx = -1
    peak_weekly_close = 0.0
    pending: str | None = None
    pending_reason = ""
    trades: list[Trade] = []
    active_trade: Trade | None = None
    annual_actions: defaultdict[str, int] = defaultdict(int)
    equity_curve: list[tuple[str, float]] = []
    exposed_days = 0

    def close_position(bar: DailyBar, fill: float, reason: str, day_idx: int) -> None:
        nonlocal cash, units, active_trade, entry_fill, entry_raw_fill
        nonlocal stop_price, entry_day_idx, peak_weekly_close
        net_fill = fill * (1.0 - FRICTION)
        cash = units * net_fill
        if active_trade is None:
            raise AssertionError("active_trade missing")
        active_trade.sell_date = bar.date
        active_trade.sell_price = round(fill, 3)
        active_trade.return_pct = round((net_fill / entry_fill - 1.0) * 100.0, 2)
        active_trade.hold_days = day_idx - entry_day_idx + 1
        active_trade.reason = reason
        active_trade.status = "closed"
        trades.append(active_trade)
        annual_actions[bar.date[:4]] += 1
        units = 0.0
        active_trade = None
        entry_fill = 0.0
        entry_raw_fill = 0.0
        stop_price = 0.0
        entry_day_idx = -1
        peak_weekly_close = 0.0

    for day_idx in range(first_day_idx, last_day_idx + 1):
        bar = history[day_idx]
        if pending == "buy":
            year = bar.date[:4]
            # Keep one action slot available for a same-year protective exit.
            if annual_actions[year] <= MAX_ANNUAL_ACTIONS - 2:
                raw_fill = bar.open
                entry_raw_fill = raw_fill
                entry_fill = raw_fill * (1.0 + FRICTION)
                units = cash / entry_fill
                stop_price = raw_fill * (1.0 - protective_stop)
                entry_day_idx = day_idx
                peak_weekly_close = raw_fill
                active_trade = Trade(
                    buy_date=bar.date,
                    buy_price=round(raw_fill, 3),
                )
                annual_actions[year] += 1
            pending = None
        elif pending == "sell" and units:
            close_position(bar, bar.open, pending_reason, day_idx)
            pending = None
            pending_reason = ""

        if units:
            exposed_days += 1
            if bar.open <= stop_price:
                close_position(bar, bar.open, "12%保护止损（开盘跳空）", day_idx)
            elif bar.low <= stop_price:
                close_position(bar, stop_price, "12%保护止损", day_idx)

        equity = units * bar.close if units else cash
        equity_curve.append((bar.date, equity))

        weekly_idx = week_end.get(day_idx)
        if weekly_idx is None or pending is not None:
            continue
        if units:
            peak_weekly_close = max(
                peak_weekly_close,
                weekly[weekly_idx].close,
            )
            reason = discretionary_exit_reason(
                weekly,
                j_values,
                weekly_idx,
                entry_raw_fill=entry_raw_fill,
                peak_weekly_close=peak_weekly_close,
                exit_j=exit_j,
            )
            if reason:
                pending = "sell"
                pending_reason = reason
        elif not units and entry_signal(
            weekly,
            j_values,
            weekly_idx,
            entry_j=entry_j,
            entry_weeks=entry_weeks,
        ):
            pending = "buy"

    if units and active_trade is not None:
        last = history[last_day_idx]
        mark_fill = last.close * (1.0 - FRICTION)
        active_trade.sell_date = last.date
        active_trade.sell_price = round(last.close, 3)
        active_trade.return_pct = round((mark_fill / entry_fill - 1.0) * 100.0, 2)
        active_trade.hold_days = last_day_idx - entry_day_idx + 1
        active_trade.reason = "期末估值（未触发卖出）"
        active_trade.status = "open"
        trades.append(active_trade)
        final_equity = units * mark_fill
    else:
        final_equity = cash

    peak = 1.0
    max_drawdown = 0.0
    for _, equity in equity_curve:
        peak = max(peak, equity)
        if peak:
            max_drawdown = max(max_drawdown, 1.0 - equity / peak)

    start = datetime.strptime(history[first_day_idx].date, "%Y-%m-%d")
    end = datetime.strptime(history[last_day_idx].date, "%Y-%m-%d")
    years = max((end - start).days / 365.25, 1 / 252)
    closed = [trade for trade in trades if trade.status == "closed"]
    wins = [trade.return_pct for trade in closed if trade.return_pct > 0]
    losses = [trade.return_pct for trade in closed if trade.return_pct <= 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss else None
    return Metrics(
        total_return_pct=round((final_equity - 1.0) * 100.0, 2),
        cagr_pct=round((final_equity ** (1.0 / years) - 1.0) * 100.0, 2),
        max_drawdown_pct=round(max_drawdown * 100.0, 2),
        win_rate_pct=round(len(wins) / len(closed) * 100.0, 1) if closed else 0.0,
        trade_count=len(closed),
        avg_trade_pct=round(statistics.mean([trade.return_pct for trade in closed]), 2)
        if closed
        else 0.0,
        profit_factor=round(profit_factor, 2) if profit_factor is not None else None,
        exposure_pct=round(exposed_days / len(active_indices) * 100.0, 1),
        max_actions_in_year=max(annual_actions.values(), default=0),
        annual_actions=dict(sorted(annual_actions.items())),
        trades=trades,
        equity_curve=equity_curve,
    )


def buy_and_hold_metrics(
    daily: list[DailyBar], start_date: str, end_date: str
) -> dict[str, float]:
    period = [bar for bar in daily if start_date <= bar.date <= end_date]
    first = period[0].open * (1.0 + FRICTION)
    final = period[-1].close * (1.0 - FRICTION)
    equity = final / first
    peak = first
    max_drawdown = 0.0
    for bar in period:
        peak = max(peak, bar.close)
        max_drawdown = max(max_drawdown, 1.0 - bar.close / peak)
    start = datetime.strptime(period[0].date, "%Y-%m-%d")
    end = datetime.strptime(period[-1].date, "%Y-%m-%d")
    years = max((end - start).days / 365.25, 1 / 252)
    return {
        "total_return_pct": round((equity - 1.0) * 100.0, 2),
        "cagr_pct": round((equity ** (1.0 / years) - 1.0) * 100.0, 2),
        "max_drawdown_pct": round(max_drawdown * 100.0, 2),
    }


def metrics_payload(metrics: Metrics, include_curve: bool = False) -> dict:
    payload = {
        key: value
        for key, value in asdict(metrics).items()
        if key not in {"equity_curve", "trades"}
    }
    payload["trades"] = [asdict(trade) for trade in metrics.trades]
    if include_curve:
        # Monthly tail is enough for a compact dashboard comparison.
        sampled: list[dict[str, float | str]] = []
        last_month = ""
        for date_str, equity in metrics.equity_curve:
            month = date_str[:7]
            if month != last_month:
                sampled.append({"date": date_str, "equity": round(equity, 4)})
                last_month = month
            else:
                sampled[-1] = {"date": date_str, "equity": round(equity, 4)}
        payload["equity_curve"] = sampled
    return payload


def current_signal_payload(
    daily: list[DailyBar],
    weekly: list[WeeklyBar],
    completed_count: int,
    j_values: list[float],
    full_metrics: Metrics,
) -> dict:
    latest_idx = completed_count - 1
    latest = weekly[latest_idx]
    open_trade = next(
        (trade for trade in reversed(full_metrics.trades) if trade.status == "open"),
        None,
    )
    is_holding = open_trade is not None
    buy = entry_signal(weekly, j_values, latest_idx)
    position_weekly_closes = (
        [
            bar.close
            for bar in weekly[:completed_count]
            if bar.date >= open_trade.buy_date
        ]
        if open_trade
        else []
    )
    peak_weekly_close = (
        max([open_trade.buy_price, *position_weekly_closes])
        if open_trade
        else latest.close
    )
    runner_mode = bool(
        open_trade
        and runner_mode_active(open_trade.buy_price, peak_weekly_close)
    )
    exit_reason = (
        discretionary_exit_reason(
            weekly,
            j_values,
            latest_idx,
            entry_raw_fill=open_trade.buy_price,
            peak_weekly_close=peak_weekly_close,
        )
        if open_trade
        else None
    )
    sell = exit_reason is not None
    current_year_actions = full_metrics.annual_actions.get(str(date.today().year), 0)

    if sell:
        state = "SELL_NEXT_OPEN"
        title = "下个交易日开盘卖出"
        summary = f"已持仓，{exit_reason}；按规则清仓，不猜顶部。"
    elif is_holding:
        state = "HOLD"
        title = "继续持有"
        summary = (
            "浮盈已达到30%，大行情模式生效；只有完整周收盘从峰值回撤15%才退出。"
            if runner_mode
            else "尚未进入大行情模式，也未触发J高位回落；继续按周持有。"
        )
    elif buy and current_year_actions <= MAX_ANNUAL_ACTIONS - 2:
        state = "BUY_NEXT_OPEN"
        title = "下个交易日开盘买入"
        summary = "周线深度超卖持续三周后拐头；按冻结规则执行，不额外猜底。"
    else:
        state = "WAIT"
        title = "空仓等待"
        summary = "买点条件未全部满足；没有信号就不操作。"

    recent_j = [round(value, 1) for value in j_values[max(0, latest_idx - 3) : latest_idx + 1]]
    return {
        "state": state,
        "title": title,
        "summary": summary,
        "as_of": latest.date,
        "index_close": round2(latest.close),
        "j_recent": recent_j,
        "conditions": [
            {
                "label": f"前 {ENTRY_WEEKS} 周 J 均低于 {ENTRY_J:g}",
                "met": all(
                    value < ENTRY_J
                    for value in j_values[latest_idx - ENTRY_WEEKS : latest_idx]
                ),
            },
            {
                "label": "本周 J 向上拐头",
                "met": j_values[latest_idx] > j_values[latest_idx - 1],
            },
        ],
        "holding": is_holding,
        "exit_mode": "RUNNER" if runner_mode else "STANDARD",
        "exit_mode_label": "大行情模式" if runner_mode else "标准模式",
        "runner_activation_pct": round2(RUNNER_ACTIVATION * 100.0),
        "runner_trail_pct": round2(RUNNER_TRAIL * 100.0),
        "peak_weekly_close": round2(peak_weekly_close) if open_trade else None,
        "runner_exit_level": (
            round2(peak_weekly_close * (1.0 - RUNNER_TRAIL))
            if runner_mode
            else None
        ),
        "model_position": asdict(open_trade) if open_trade else None,
        "planned_stop_index": round2(
            (open_trade.buy_price if open_trade else latest.close)
            * (1.0 - PROTECTIVE_STOP)
        ),
        "actions_this_year": current_year_actions,
        "actions_remaining": max(0, MAX_ANNUAL_ACTIONS - current_year_actions),
    }


def run_research(daily: list[DailyBar]) -> None:
    candidates: list[tuple[float, int, float, float]] = []
    end_date = daily[-1].date
    for entry_j in (0.0, 5.0, 10.0):
        for entry_weeks in (2, 3, 4):
            for exit_j in (80.0, 90.0, 100.0):
                for stop in (0.10, 0.12):
                    candidates.append((entry_j, entry_weeks, exit_j, stop))

    rows = []
    for params in candidates:
        kwargs = {
            "entry_j": params[0],
            "entry_weeks": params[1],
            "exit_j": params[2],
            "protective_stop": params[3],
        }
        train = run_backtest(
            daily,
            start_date="2020-01-01",
            end_date="2023-12-31",
            **kwargs,
        )
        valid = run_backtest(
            daily,
            start_date="2024-01-01",
            end_date=end_date,
            **kwargs,
        )
        full = run_backtest(
            daily,
            start_date="2020-01-01",
            end_date=end_date,
            **kwargs,
        )
        if (
            train.trade_count >= 4
            and valid.trade_count >= 2
            and full.max_actions_in_year <= MAX_ANNUAL_ACTIONS
        ):
            robustness = min(train.win_rate_pct, valid.win_rate_pct)
            score = (
                robustness * 2
                + min(train.cagr_pct, valid.cagr_pct)
                - full.max_drawdown_pct
                + math.log1p(full.trade_count) * 4
            )
            rows.append((score, params, train, valid, full))

    rows.sort(key=lambda item: item[0], reverse=True)
    print("score | params(entryJ,weeks,exitJ,stop) | train | valid | full")
    for score, params, train, valid, full in rows[:20]:
        print(
            f"{score:6.1f} | {params} | "
            f"T cagr={train.cagr_pct:+.1f} dd={train.max_drawdown_pct:.1f} "
            f"win={train.win_rate_pct:.0f}% n={train.trade_count} | "
            f"V cagr={valid.cagr_pct:+.1f} dd={valid.max_drawdown_pct:.1f} "
            f"win={valid.win_rate_pct:.0f}% n={valid.trade_count} | "
            f"F cagr={full.cagr_pct:+.1f} dd={full.max_drawdown_pct:.1f} "
            f"win={full.win_rate_pct:.0f}% n={full.trade_count} "
            f"maxActions={full.max_actions_in_year}"
        )


def build_dashboard(refresh: bool) -> dict:
    index_raw, index_refreshed = load_or_refresh(INDEX_SYMBOL, INDEX_URL, refresh)
    index_daily = parse_daily(index_raw, INDEX_SYMBOL)

    end_date = index_daily[-1].date
    full = run_backtest(
        index_daily, start_date="2020-01-01", end_date=end_date
    )
    train = run_backtest(
        index_daily, start_date="2020-01-01", end_date="2023-12-31"
    )
    validation = run_backtest(
        index_daily, start_date="2024-01-01", end_date=end_date
    )
    weekly = aggregate_weekly(index_daily)
    complete_count = completed_week_count(index_daily, weekly)
    kdj = compute_kdj(weekly)
    j_values = [item[2] for item in kdj]
    signal = current_signal_payload(
        index_daily, weekly, complete_count, j_values, full
    )

    latest_weekly = weekly[-26:]
    close_values = [bar.close for bar in latest_weekly]
    low_close = min(close_values)
    high_close = max(close_values)
    spread = max(high_close - low_close, 1.0)
    spark = [
        {
            "date": bar.date,
            "close": round2(bar.close),
            "height_pct": round(18 + (bar.close - low_close) / spread * 82, 1),
        }
        for bar in latest_weekly
    ]

    payload = {
        "meta": {
            "version": "kc50-weekly-v1.2",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "data_as_of": index_daily[-1].date,
            "last_completed_week": weekly[complete_count - 1].date,
            "current_week_is_partial": complete_count < len(weekly),
            "index_refreshed": index_refreshed,
            "source": "腾讯行情接口（前复权日线）；规则与回测脚本可本地复算",
            "disclaimer": "历史回测不代表未来收益；极端跳空可能使实际亏损超过保护线。",
        },
        "instrument": {
            "index_name": "上证科创板50成份指数",
            "index_code": "000688",
            "index_latest_close": round2(index_daily[-1].close),
        },
        "signal": signal,
        "strategy": {
            "name": "三周深潜 · 大行情模式",
            "version": "v1.2",
            "entry": (
                "前3个完整周的 KDJ J 均 < 5，本周 J 向上拐头；"
                "下个交易日开盘买入。"
            ),
            "exit": (
                "浮盈未达到30%时，周线J > 90后向下拐头即卖出；"
                "一旦最高完整周收盘达到买入价上方30%，切换为大行情模式，"
                "仅在完整周收盘较持仓后最高周收盘回撤15%时卖出。"
            ),
            "stop": "成交后立即设置成本价下方12%的保护止损；不因“底部”取消止损。",
            "frequency": "每周五收盘后看一次；买、卖各算1次，任一自然年最多6次。",
            "positioning": "单标的、单仓位、一次买完、一次卖完；不加仓、不做T、不预测消息。",
            "friction_bps_each_side": int(FRICTION * 10000),
            "max_annual_actions": MAX_ANNUAL_ACTIONS,
        },
        "backtest": {
            "period": f"2020-01-01 ~ {end_date}",
            "method": (
                "完整周收盘产生信号、下一交易日开盘成交；双边各计10bp摩擦；"
                "12%保护止损按日内触价或开盘跳空成交；浮盈达到30%后改用"
                "15%周线收盘移动止盈。"
            ),
            "full": metrics_payload(full, include_curve=True),
            "train": metrics_payload(train),
            "validation": metrics_payload(validation),
            "buy_hold": buy_and_hold_metrics(
                index_daily, start_date="2020-01-01", end_date=end_date
            ),
        },
        "recent_weekly": spark,
        "sources": [
            {
                "label": "上交所：科创50指数编制方案",
                "url": (
                    "https://www.sse.com.cn/market/sseindex/diclosure/c/"
                    "10077925/files/69a9c8291f1d4bf4adad92318053104d.pdf"
                ),
            },
        ],
    }
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    output = PUBLIC_DATA_DIR / "dashboard.json"
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"wrote {output} data={payload['meta']['data_as_of']} "
        f"signal={signal['state']} trades={full.trade_count}"
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--no-refresh",
        action="store_true",
        help="只用 data/raw 缓存，不访问行情接口",
    )
    parser.add_argument(
        "--research",
        action="store_true",
        help="运行小范围稳健性网格，不改冻结参数",
    )
    args = parser.parse_args()
    payload = build_dashboard(refresh=not args.no_refresh)
    if args.research:
        index_raw = json.loads(
            (RAW_DIR / f"{INDEX_SYMBOL}.json").read_text(encoding="utf-8")
        )
        run_research(parse_daily(index_raw, INDEX_SYMBOL))
    full = payload["backtest"]["full"]
    print(
        f"full: CAGR={full['cagr_pct']:+.2f}% "
        f"maxDD={full['max_drawdown_pct']:.2f}% "
        f"win={full['win_rate_pct']:.1f}% "
        f"maxActions={full['max_actions_in_year']}"
    )


if __name__ == "__main__":
    main()
