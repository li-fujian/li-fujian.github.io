(() => {
  "use strict";

  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const number = (value, digits = 1) =>
    Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const percent = (value, digits = 1) =>
    `${Number(value) >= 0 ? "+" : ""}${number(value, digits)}%`;
  const setText = (selector, value) => {
    const node = one(selector);
    if (node) node.textContent = value;
  };
  const metricClass = (node, value, inverse = false) => {
    if (!node) return;
    node.classList.remove("metric-positive", "metric-negative");
    const positive = inverse ? value <= 0 : value >= 0;
    node.classList.add(positive ? "metric-positive" : "metric-negative");
  };

  function currentAction(signal) {
    if (signal.state === "BUY_NEXT_OPEN") {
      return ["下个交易日开盘买入", "买入后立即设置 12% 保护止损。"];
    }
    if (signal.state === "SELL_NEXT_OPEN") {
      return ["下个交易日开盘卖出", "一次退出，不临场改变规则。"];
    }
    if (signal.holding) {
      return ["继续持有", "未触发退出条件，不做多余操作。"];
    }
    return ["不买，不猜，等信号", "只认完整周线。周中价格不触发主观交易。"];
  }

  function updateConditions(signal) {
    const root = one(".conditions");
    if (!root) return;
    root.replaceChildren(
      ...signal.conditions.map((condition) => {
        const row = document.createElement("div");
        row.className = "condition";

        const icon = document.createElement("span");
        icon.className = condition.met ? "condition-on" : "condition-off";
        icon.textContent = condition.met ? "✓" : "—";

        const label = document.createElement("strong");
        label.textContent = condition.label;

        const state = document.createElement("small");
        state.textContent = condition.met ? "已满足" : "未满足";
        row.append(icon, label, state);
        return row;
      }),
    );
  }

  function updateComparison(backtest) {
    const rows = all(".compare-table .compare-row:not(.compare-head)");
    const datasets = [
      backtest.train,
      backtest.validation,
      backtest.buy_hold,
    ];
    datasets.forEach((data, index) => {
      const row = rows[index];
      if (!row || !data) return;
      const values = all(":scope > span", row);
      if (index < 2) {
        values[0].textContent = percent(data.cagr_pct);
        values[1].textContent = `-${number(data.max_drawdown_pct)}%`;
        values[2].textContent = `${number(data.win_rate_pct)}%`;
        values[3].textContent = String(data.trade_count);
      } else {
        values[0].textContent = percent(data.cagr_pct);
        values[1].textContent = `-${number(data.max_drawdown_pct)}%`;
      }
    });
  }

  function updateChart(data, isPartial) {
    const root = one(".bar-chart");
    if (!root || !data.length) return;
    root.replaceChildren(
      ...data.map((week, index) => {
        const bar = document.createElement("div");
        bar.className =
          isPartial && index === data.length - 1
            ? "week-bar week-bar-current"
            : "week-bar";
        bar.title = `${week.date} · ${number(week.close, 2)}`;
        const fill = document.createElement("i");
        fill.style.height = `${week.height_pct}%`;
        bar.append(fill);
        return bar;
      }),
    );
    const axis = all(".chart-axis > *");
    if (axis.length >= 3) {
      axis[0].textContent = data[0].date;
      axis[1].textContent = number(data.at(-1).close);
      axis[2].textContent = data.at(-1).date;
    }
  }

  function updateTrades(trades) {
    const root = one(".trade-table");
    const head = root && one(".trade-head", root);
    if (!root || !head) return;
    root.replaceChildren(head);
    [...trades].reverse().forEach((trade) => {
      const row = document.createElement("div");
      row.className = "trade-row";
      row.setAttribute("role", "row");

      const buy = document.createElement("span");
      const buyDate = document.createElement("strong");
      const buyPrice = document.createElement("small");
      buyDate.textContent = trade.buy_date;
      buyPrice.textContent = number(trade.buy_price);
      buy.append(buyDate, buyPrice);

      const sell = document.createElement("span");
      const sellDate = document.createElement("strong");
      const sellPrice = document.createElement("small");
      const closed = trade.status === "closed";
      sellDate.textContent = closed ? trade.sell_date : "持有中";
      sellPrice.textContent = closed ? number(trade.sell_price) : "未卖出";
      sell.append(sellDate, sellPrice);

      const days = document.createElement("span");
      days.textContent = `${trade.hold_days} 交易日`;
      const result = document.createElement("strong");
      result.textContent = `${closed ? "" : "浮动 "}${percent(trade.return_pct)}`;
      result.className =
        trade.return_pct >= 0 ? "metric-positive" : "metric-negative";
      const reason = document.createElement("span");
      reason.textContent = closed
        ? trade.reason
        : `期末估值 ${trade.sell_date} · ${number(trade.sell_price)}`;
      row.append(buy, sell, days, result, reason);
      root.append(row);
    });
  }

  function render(data) {
    const { meta, instrument, signal, strategy, backtest, recent_weekly } = data;
    const full = backtest.full;
    const action = currentAction(signal);

    setText(".topbar-meta span:first-child", `数据 ${meta.data_as_of}`);
    setText(".topbar-meta span:last-child", `规则 ${strategy.version}`);
    const stamp = one(".signal-stamp");
    if (stamp) {
      stamp.className = `signal-stamp signal-${signal.state}`;
      stamp.textContent = `${signal.state} / ${
        signal.state === "BUY_NEXT_OPEN"
          ? "买"
          : signal.state === "SELL_NEXT_OPEN"
            ? "卖"
            : signal.holding
              ? "持"
              : "等"
      }`;
    }
    setText(".eyebrow span:last-child", `完整周截至 ${meta.last_completed_week}`);
    setText(".hero-copy h1", signal.title);
    setText(".hero-summary", signal.summary);
    setText(".hero-action strong", action[0]);
    setText(".hero-action small", action[1]);

    setText(".quote-header span:first-child", instrument.index_code);
    setText(
      ".quote-header span:last-child",
      meta.current_week_is_partial ? "本周形成中" : "本周已收盘",
    );
    setText(".quote-main > div:first-child small", instrument.index_name);
    setText(
      ".quote-main > div:first-child strong",
      number(instrument.index_latest_close),
    );
    setText(".quote-main > div:first-child span", `截至 ${meta.data_as_of}`);
    setText(
      ".quote-main > div:nth-child(2) strong",
      number(signal.index_close),
    );
    setText(".quote-main > div:nth-child(2) span", meta.last_completed_week);

    updateConditions(signal);
    setText(
      ".indicator-strip strong",
      signal.j_recent.map((value) => number(value)).join(" → "),
    );
    const ruleNodes = all(".rules li p");
    [strategy.entry, strategy.stop, strategy.exit].forEach((rule, index) => {
      if (ruleNodes[index]) ruleNodes[index].textContent = rule;
    });

    const riskMetrics = all(".risk-row .metric");
    if (riskMetrics[1]) {
      setText(
        ".risk-row .metric:nth-child(2) strong",
        `${signal.actions_this_year} / ${strategy.max_annual_actions}`,
      );
      setText(
        ".risk-row .metric:nth-child(2) small",
        `还可用 ${signal.actions_remaining} 次`,
      );
    }
    setText(
      ".risk-row .metric:nth-child(3) strong",
      `${full.max_actions_in_year} 次 / 年`,
    );
    setText(".risk-row .metric:nth-child(4) strong", signal.exit_mode_label);

    setText(".performance-head .section-title p", backtest.method);
    setText(".sample-warning strong", `只有 ${full.trade_count} 笔`);
    const metrics = all(".metric-grid .metric");
    const metricValues = [
      [percent(full.cagr_pct), `累计 ${percent(full.total_return_pct)}`],
      [`${number(full.win_rate_pct)}%`, `完整交易 ${full.trade_count} 笔`],
      [`-${number(full.max_drawdown_pct)}%`, "账户净值口径"],
      [`${number(full.exposure_pct)}%`, "大部分时间可以休息"],
    ];
    metricValues.forEach(([primary, secondary], index) => {
      if (!metrics[index]) return;
      const strong = one("strong", metrics[index]);
      const small = one("small", metrics[index]);
      if (strong) strong.textContent = primary;
      if (small) small.textContent = secondary;
    });
    metricClass(one(".metric-grid .metric:first-child strong"), full.cagr_pct);
    metricClass(one(".metric-grid .metric:nth-child(2) strong"), full.win_rate_pct);
    metricClass(
      one(".metric-grid .metric:nth-child(3) strong"),
      -full.max_drawdown_pct,
    );

    updateComparison(backtest);
    updateChart(recent_weekly, meta.current_week_is_partial);
    setText(
      ".rhythm-panel .section-title p",
      meta.current_week_is_partial
        ? "只看节奏，不用盯盘。最后一根仍是本周形成中的快照。"
        : "只看节奏，不用盯盘。图中均为已结束交易周。",
    );
    updateTrades(full.trades);
    setText("footer strong", strategy.name);
    setText("footer span", strategy.positioning);
    setText(
      "footer p",
      `${meta.disclaimer} 回测区间 ${backtest.period}。行情刷新时间与交易所最终结算可能存在差异，真正操作只以完整周线为准。`,
    );
    document.documentElement.dataset.dataAsOf = meta.data_as_of;
  }

  function shiftDate(value, offset) {
    const day = new Date(`${value}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  }

  function isTradingDay(value, calendar) {
    const closures = calendar.closures[value.slice(0, 4)];
    if (!Array.isArray(closures)) throw new Error("交易日历尚未更新到当前年份");
    const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6 &&
      !closures.some(([start, end]) => start <= value && value <= end);
  }

  function shanghaiClock(now) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(now).map(({ type, value }) => [type, value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
  }

  function expectedSession(calendar, now) {
    const clock = shanghaiClock(now);
    // Require the current year's calendar even during a year-end weekend.
    isTradingDay(clock.date, calendar);
    let candidate = clock.minutes >= 15 * 60 ? clock.date : shiftDate(clock.date, -1);
    for (let i = 0; i < 370; i += 1) {
      if (isTradingDay(candidate, calendar)) return candidate;
      candidate = shiftDate(candidate, -1);
    }
    throw new Error("无法确认最近收盘交易日");
  }

  function verifyData(data, calendar, now = new Date()) {
    const expected = expectedSession(calendar, now);
    const asOf = data.meta.data_as_of;
    if (asOf !== expected) {
      throw new Error(`行情截至 ${asOf}，最近收盘交易日为 ${expected}；等待更新后再查看信号`);
    }
    if (!["BUY_NEXT_OPEN", "SELL_NEXT_OPEN", "HOLD", "WAIT"].includes(data.signal.state)) {
      throw new Error("信号状态无法识别");
    }
    if (["BUY_NEXT_OPEN", "SELL_NEXT_OPEN"].includes(data.signal.state)) {
      let execution = shiftDate(data.signal.as_of, 1);
      while (!isTradingDay(execution, calendar)) execution = shiftDate(execution, 1);
      const clock = shanghaiClock(now);
      if (clock.date > execution ||
          (clock.date === execution && clock.minutes >= 9 * 60 + 30)) {
        throw new Error(`该信号的计划执行日为 ${execution}，开盘执行时点已过；等待更新`);
      }
    }
    return expected;
  }

  function showUnavailable(message) {
    document.documentElement.dataset.signalAvailability = "unavailable";
    const status = one(".data-status");
    if (status) { status.className = "data-status data-status-warning"; status.textContent = message; }
    const stamp = one(".signal-stamp");
    if (stamp) { stamp.className = "signal-stamp signal-UNAVAILABLE"; stamp.textContent = "信号暂停"; }
    setText(".hero-copy h1", "当前信号不可用");
    setText(".hero-summary", "页面中的行情与回测仅供历史参考，请等待数据校验通过。");
    setText(".hero-action strong", "暂停显示操作指令");
    setText(".hero-action small", "加载失败或数据过期时，不依据旧快照操作。");
    setText(".eyebrow span:last-child", "历史快照 · 当前信号未确认");
    setText(".quote-header span:last-child", "历史行情");
    const note = one(".operating-note");
    if (note) note.hidden = true;
  }

  async function loadJson(path) {
    const response = await fetch(`${path}?v=${Date.now()}`, {
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  }

  let loadedData;
  let loadedCalendar;
  function refreshAvailability() {
    try {
      const expected = verifyData(loadedData, loadedCalendar);
      render(loadedData);
      document.documentElement.dataset.signalAvailability = "available";
      const status = one(".data-status");
      if (status) {
        status.className = "data-status";
        status.textContent = `行情已核验至 ${expected} · 持仓为模型推演，请核对实际账户`;
      }
      const note = one(".operating-note");
      if (note) note.hidden = false;
    } catch (error) {
      showUnavailable(error.message);
    }
  }

  showUnavailable("正在加载并校验行情；校验通过后显示当前信号。");
  Promise.all([loadJson("./dashboard.json"), loadJson("./trading-calendar.json")])
    .then(([data, calendar]) => {
      loadedData = data; loadedCalendar = calendar;
      refreshAvailability();
      // An open page must stop showing yesterday's action after today's close.
      setInterval(refreshAvailability, 60000);
    })
    .catch((error) => {
      console.error("行情或交易日历载入失败。", error);
      showUnavailable("数据加载失败；暂停显示当前信号，请刷新页面重试。");
    });
})();
