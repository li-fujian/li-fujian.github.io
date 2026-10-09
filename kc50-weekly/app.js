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
    const datasets = [backtest.full, backtest.buy_hold];
    datasets.forEach((data, index) => {
      const row = rows[index];
      if (!row || !data) return;
      const values = all(":scope > span", row);
      values[0].textContent = percent(data.cagr_pct);
      values[1].textContent = `-${number(data.max_drawdown_pct)}%`;
      metricClass(values[0], data.cagr_pct);
    });
  }

  function weekMonday(value) {
    const day = new Date(`${value}T00:00:00Z`);
    const weekday = day.getUTCDay();
    day.setUTCDate(day.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
    return day.toISOString().slice(0, 10);
  }

  function withAverages(data, isPartial) {
    if (data.some((week) => Object.hasOwn(week, "ma5"))) return data;
    const usable = isPartial ? data.length - 1 : data.length;
    const mean = (end, window) => {
      if (end >= usable || end < window - 1) return null;
      let sum = 0;
      for (let index = end - window + 1; index <= end; index += 1) sum += data[index].close;
      return sum / window;
    };
    return data.map((week, index) => ({
      ...week,
      ma5: mean(index, 5),
      ma10: mean(index, 10),
      ma20: mean(index, 20),
    }));
  }

  function chartMarkers(data, trades) {
    const markers = [];
    for (const trade of trades) {
      const events = [{ kind: "buy", date: trade.buy_date, price: trade.buy_price }];
      if (trade.status === "closed" && trade.sell_date) {
        events.push({ kind: "sell", date: trade.sell_date, price: trade.sell_price });
      }
      for (const event of events) {
        const index = data.findIndex(
          (week) => weekMonday(week.date) <= event.date && event.date <= week.date,
        );
        if (index >= 0) markers.push({ ...event, index });
      }
    }
    return markers;
  }

  function updateChart(data, trades, isPartial) {
    const svg = one(".line-svg");
    const marks = one(".line-marks");
    if (!svg || !marks || !data.length) return;
    const series = withAverages(data, isPartial);
    const markers = chartMarkers(series, trades);
    const values = [
      ...series.flatMap((week) => [
        week.open, week.high, week.low, week.close, week.ma5, week.ma10, week.ma20,
      ]),
      ...markers.map((marker) => marker.price),
    ].filter((value) => value != null);
    let low = Math.min(...values);
    let high = Math.max(...values);
    // Leaves room for buy badges under the lowest wick and sell badges over the highest.
    const pad = Math.max((high - low) * 0.09, 1);
    low -= pad;
    high += pad;
    const xOf = (index) =>
      series.length === 1 ? 50 : 2 + (index / (series.length - 1)) * 96;
    const yOf = (value) => ((high - value) / (high - low)) * 100;
    const pathOf = (key) => {
      let drawing = "";
      let started = false;
      series.forEach((week, index) => {
        if (week[key] == null) {
          started = false;
          return;
        }
        drawing += `${started ? "L" : "M"}${xOf(index).toFixed(2)},${yOf(week[key]).toFixed(2)}`;
        started = true;
      });
      return drawing;
    };
    const svgNs = "http://www.w3.org/2000/svg";
    const bodyWidth = Math.min(1.35, (96 / series.length) * 0.62);
    svg.replaceChildren();
    for (let step = 0; step <= 4; step += 1) {
      const line = document.createElementNS(svgNs, "line");
      const y = (step / 4) * 100;
      line.setAttribute("x1", "0");
      line.setAttribute("x2", "100");
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", "rgba(20,40,32,0.12)");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(line);
    }
    series.forEach((week, index) => {
      if (week.open == null || week.high == null || week.low == null) return;
      const rising = week.close >= week.open;
      const color = rising ? "#c94337" : "#258367";
      const partial = isPartial && index === series.length - 1;
      const x = xOf(index);
      const group = document.createElementNS(svgNs, "g");
      const title = document.createElementNS(svgNs, "title");
      title.textContent = `${week.date} 开${number(week.open, 2)} 高${number(week.high, 2)} 低${number(week.low, 2)} 收${number(week.close, 2)}${partial ? " · 本周形成中" : ""}`;
      const wick = document.createElementNS(svgNs, "line");
      wick.setAttribute("x1", x.toFixed(2));
      wick.setAttribute("x2", x.toFixed(2));
      wick.setAttribute("y1", yOf(week.high).toFixed(2));
      wick.setAttribute("y2", yOf(week.low).toFixed(2));
      wick.setAttribute("stroke", partial ? "#d6a64f" : color);
      wick.setAttribute("stroke-width", partial ? "1.6" : "1");
      wick.setAttribute("vector-effect", "non-scaling-stroke");
      const body = document.createElementNS(svgNs, "rect");
      const top = Math.min(yOf(week.open), yOf(week.close));
      const height = Math.max(Math.abs(yOf(week.close) - yOf(week.open)), 0.7);
      body.setAttribute("x", (x - bodyWidth / 2).toFixed(2));
      body.setAttribute("y", top.toFixed(2));
      body.setAttribute("width", bodyWidth.toFixed(2));
      body.setAttribute("height", height.toFixed(2));
      body.setAttribute("fill", color);
      body.setAttribute("stroke", partial ? "#d6a64f" : color);
      body.setAttribute("stroke-width", partial ? "1.6" : "0.6");
      body.setAttribute("vector-effect", "non-scaling-stroke");
      group.append(title, wick, body);
      svg.append(group);
    });
    for (const [key, color, width] of [
      ["ma20", "#66746e", "1.4"],
      ["ma10", "#8d5a32", "1.6"],
      ["ma5", "#d6a64f", "1.8"],
    ]) {
      const drawing = pathOf(key);
      if (!drawing) continue;
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", drawing);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(path);
    }

    marks.replaceChildren();
    for (const marker of markers) {
      const buy = marker.kind === "buy";
      const week = series[marker.index];
      const mark = document.createElement("span");
      mark.className = `chart-mark chart-mark-${marker.kind}`;
      mark.style.left = `${xOf(marker.index)}%`;
      mark.style.top = `${yOf(buy ? week.low : week.high)}%`;
      const badge = document.createElement("b");
      badge.textContent = buy ? "B" : "S";
      badge.title = `${buy ? "买入" : "卖出"} ${marker.date} · ${number(marker.price, 2)}`;
      mark.append(badge);
      marks.append(mark);
    }

    const axis = all(".chart-axis > *");
    if (axis.length >= 2) {
      axis[0].textContent = series[0].date;
      axis[axis.length - 1].textContent = series.at(-1).date;
      if (axis.length >= 3) {
        axis[1].textContent = series[Math.floor((series.length - 1) / 2)].date;
      }
    }
    const forming = one(".swatch-now");
    if (forming && forming.parentElement) forming.parentElement.hidden = !isPartial;
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
    setText(".comparison-period", `对比区间 ${backtest.period}`);
    updateChart(recent_weekly, full.trades, meta.current_week_is_partial);
    setText(
      ".rhythm-panel .section-title p",
      meta.current_week_is_partial
        ? "只看节奏，不用盯盘。均线只用完整周收盘，琥珀边是本周形成中的K线。"
        : "只看节奏，不用盯盘。K线与均线都来自已结束的交易周。",
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

  function setupMarkToggle() {
    const toggle = one(".mark-toggle");
    const plot = one(".line-plot");
    if (!toggle || !plot) return;
    toggle.addEventListener("click", () => {
      const hidden = plot.classList.toggle("marks-off");
      toggle.setAttribute("aria-pressed", String(!hidden));
      toggle.textContent = hidden ? "显示买卖点" : "隐藏买卖点";
    });
  }

  setupMarkToggle();
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
