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
    if (signal.state === "BUY") {
      return ["下个交易日开盘买入", "买入后立即设置 12% 保护止损。"];
    }
    if (signal.state === "SELL") {
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

  function updateChart(data) {
    const root = one(".bar-chart");
    if (!root || !data.length) return;
    root.replaceChildren(
      ...data.map((week, index) => {
        const bar = document.createElement("div");
        bar.className =
          index === data.length - 1 ? "week-bar week-bar-current" : "week-bar";
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
      sellDate.textContent = trade.sell_date || "持有中";
      sellPrice.textContent = trade.sell_date ? number(trade.sell_price) : "—";
      sell.append(sellDate, sellPrice);

      const days = document.createElement("span");
      days.textContent = `${trade.hold_days} 天`;
      const result = document.createElement("strong");
      result.textContent = percent(trade.return_pct);
      result.className =
        trade.return_pct >= 0 ? "metric-positive" : "metric-negative";
      const reason = document.createElement("span");
      reason.textContent = trade.reason;
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
        signal.state === "BUY"
          ? "买"
          : signal.state === "SELL"
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
    updateChart(recent_weekly);
    updateTrades(full.trades);
    setText("footer strong", strategy.name);
    setText("footer span", strategy.positioning);
    setText(
      "footer p",
      `${meta.disclaimer} 回测区间 ${backtest.period}。行情刷新时间与交易所最终结算可能存在差异，真正操作只以完整周线为准。`,
    );
    document.documentElement.dataset.dataAsOf = meta.data_as_of;
  }

  fetch(`./dashboard.json?v=${Date.now()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`dashboard.json: ${response.status}`);
      return response.json();
    })
    .then(render)
    .catch((error) => {
      console.error("自动行情载入失败，页面继续显示上次发布快照。", error);
    });
})();
