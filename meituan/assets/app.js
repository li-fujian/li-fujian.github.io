(function () {
  const CD = window.MEITUAN_CHART_DATA;
  const CFG = window.MEITUAN_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toneClass = (tone) => (tone === "up" ? "up" : tone === "down" ? "down" : tone === "wait" ? "wait" : "");
  const pill = (tone, text) => `<span class="pill ${esc(tone)}">${esc(text)}</span>`;

  if (!CD || !CFG) {
    document.body.innerHTML = '<div class="wrap"><div class="card"><h3>数据加载失败</h3><p>未找到 window.MEITUAN_CHART_DATA / window.MEITUAN_CONFIG。请先运行 scripts/build_dashboard_data.py 与 scripts/sync_browser_data.py。</p></div></div>';
    return;
  }

  function renderMeta() {
    $("pageTitle").textContent = CFG.meta.title;
    $("subLine").textContent = `叙述口径：${CFG.meta.narrative_asof}｜raw 数据：${CFG.meta.raw_data_asof}｜版本：${CFG.meta.version}｜基线：${CFG.meta.baseline}`;
    $("dataNote").textContent = CFG.meta.data_note;
    $("verdictTag").textContent = CFG.verdict.tag;
    $("verdictTitle").textContent = CFG.verdict.title;
    $("verdictBody").textContent = CFG.verdict.body;

    const weekNote = $("weekStatusNote");
    if (weekNote && CD.meta) {
      const complete = CD.meta.latest_week_complete;
      weekNote.textContent = (complete ? "✓ " : "⚠ ") + (CD.meta.latest_week_note || "");
      weekNote.classList.toggle("warn", complete === false);
    }
  }

  function renderKpis() {
    $("kpis").innerHTML = CFG.kpis.map((k) => `
      <div class="kpi">
        <div class="v ${toneClass(k.tone)}">${esc(k.value)} <span style="font-size:12px">${esc(k.unit || "")}</span></div>
        <div class="l">${esc(k.label)}</div>
      </div>`).join("");
  }

  function renderThisWeek() {
    if (!CFG.thisWeek) return;
    $("weekTitle").textContent = CFG.thisWeek.title;
    $("weekCards").innerHTML = CFG.thisWeek.cards.map((c) => `
      <div class="weekcard">
        <div class="l">${esc(c.label)}</div>
        <div class="v">${esc(c.value)}</div>
        <div class="n">${esc(c.note)}</div>
      </div>`).join("");
  }

  function tableRows(items, cols) {
    return items.map((item) => `<tr>${cols.map((c) => `<td>${c(item)}</td>`).join("")}</tr>`).join("");
  }

  function renderTables() {
    $("stageRows").innerHTML = tableRows(CFG.stages, [
      (x) => `<b>${esc(x.name)}</b>`, (x) => esc(x.range), (x) => esc(x.path), (x) => esc(x.nature), (x) => esc(x.drivers)
    ]);
    $("checklistRows").innerHTML = tableRows(CFG.checklist, [
      (x) => esc(x.item), (x) => pill(x.tone, x.status), (x) => esc(x.evidence)
    ]);
    $("levelRows").innerHTML = tableRows(CFG.levels, [
      (x) => `<b>${esc(x.price)}</b>`, (x) => esc(x.nature), (x) => esc(x.meaning)
    ]);
    $("scenarioRows").innerHTML = tableRows(CFG.scenarios, [
      (x) => `<b>${esc(x.name)}</b>`, (x) => esc(x.probability), (x) => esc(x.path)
    ]);
    $("trendBatchRows").innerHTML = tableRows(CFG.trendPlan.batches, [
      (x) => `<b>${esc(x.batch)}</b>`, (x) => esc(x.trigger), (x) => esc(x.zone), (x) => esc(x.stop), (x) => esc(x.note)
    ]);
    $("trendRuleRows").innerHTML = tableRows(CFG.trendPlan.rules, [
      (x) => esc(x.name), (x) => esc(x.rule)
    ]);
    $("swingPlanRows").innerHTML = tableRows(CFG.swingPlan.plans, [
      (x) => `<b>${esc(x.name)}</b>`, (x) => esc(x.entry), (x) => esc(x.stop), (x) => esc(x.target), (x) => esc(x.rr)
    ]);
    $("swingDisciplineRows").innerHTML = tableRows(CFG.swingPlan.discipline, [
      (x) => esc(x.name), (x) => esc(x.rule)
    ]);
    $("riskList").innerHTML = CFG.risks.map((x) => `<li>${esc(x)}</li>`).join("");
    $("sourceRows").innerHTML = tableRows(CFG.sources, [
      (x) => esc(x.name), (x) => esc(x.type), (x) => esc(x.note)
    ]);
    $("cadenceRows").innerHTML = tableRows(CFG.reviewFramework.cadence, [
      (x) => `<b>${esc(x.frequency)}</b>`, (x) => esc(x.action)
    ]);
    $("updateChecklist").innerHTML = CFG.reviewFramework.updateChecklist.map((x) => `<li>${esc(x)}</li>`).join("");
    $("statusRows").innerHTML = tableRows(CFG.reviewFramework.statusDefinitions, [
      (x) => pill(x.status === "invalidated" ? "ok" : x.status === "weakened" ? "wait" : "no", x.status), (x) => esc(x.meaning)
    ]);
    $("trendPremise").textContent = CFG.trendPlan.premise;
    $("swingPremise").textContent = CFG.swingPlan.premise;
  }

  function makeChart(id, option) {
    const el = $(id);
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(option);
    window.addEventListener("resize", () => chart.resize());
  }

  function renderTrading() {
    const T = window.MEITUAN_TRADING;
    if (!T || !$("tradingKpis")) return;
    const p = T.performance || {};
    const acct = T.account || {};
    const pos = acct.positions || [];
    const shares = pos.reduce((s, x) => s + x.shares, 0);
    const retCls = (p.total_return_pct || 0) >= 0 ? "up" : "down";
    $("tradingKpis").innerHTML = [
      { l: "净值（港元）", v: p.equity != null ? p.equity.toLocaleString() : "-", c: "" },
      { l: "总收益 / 对照买入持有 " + (p.buy_hold_return_pct != null ? p.buy_hold_return_pct + "%" : "-"), v: (p.total_return_pct != null ? p.total_return_pct : "-") + "%", c: retCls },
      { l: "最大回撤", v: (p.max_drawdown_pct != null ? p.max_drawdown_pct : "-") + "%", c: "down" },
      { l: "持仓 " + shares + " 股 / 现金 " + (acct.cash != null ? acct.cash.toLocaleString() : "-"), v: (p.exposure_days_pct != null ? p.exposure_days_pct : 0) + "%", c: "" }
    ].map((k) => `<div class="kpi"><div class="v ${k.c}">${esc(k.v)}</div><div class="l">${esc(k.l)}</div></div>`).join("");

    $("positionRows").innerHTML = pos.length
      ? pos.map((x) => `<tr><td>${esc(x.engine)}</td><td>${esc(x.shares)}</td><td>${esc(x.avg_cost)}</td><td>${esc(x.stop == null ? "-" : x.stop)}</td><td>${esc((x.targets || []).join(" / ") || "-")}</td></tr>`).join("")
      : '<tr><td colspan="5">空仓</td></tr>';

    const notes = [];
    notes.push(`成绩截至 ${p.asof || "-"}；已平仓 ${p.closed_trades || 0} 笔，胜率 ${p.win_rate_pct != null ? p.win_rate_pct + "%" : "-"}。`);
    if (!pos.length && !(T.orders || []).length) notes.push("自 2026-07-27 空仓起跑：价格处于无操作区，未产生订单——「不追高」就是当前决策。等 80-84 回踩企稳或 96-100 站稳确认。");
    if ((p.open_orders || []).length) notes.push("挂单待成交：" + p.open_orders.join("、") + "（次一交易日开盘价结算）");
    if (p.week_confirmed === false) notes.push("⚠ " + (p.week_note || "本周尚未收官，周线触发条件（96-100/80/71.8/63.65等）本周内暂不生效。"));
    if ((p.alerts || []).length) notes.push("🚨 " + p.alerts.join("；"));
    $("tradingNote").textContent = notes.join(" ");

    const sideCell = (s) => s === "buy" ? '<span class="up">买入</span>' : '<span class="down">卖出</span>';
    $("orderRows").innerHTML = (T.orders || []).slice().reverse().map((o) => `<tr><td>${esc(o.signal_date)}</td><td>${sideCell(o.side)}</td><td>${esc(o.engine)}</td><td>${esc(o.shares)}</td><td>${esc(o.rule)}</td><td>${esc(o.reason)}</td><td>${esc(o.status)}${o.fill_price ? " @" + esc(o.fill_price) : ""}</td></tr>`).join("") || '<tr><td colspan="7">暂无订单</td></tr>';
    $("fillRows").innerHTML = (T.fills || []).slice().reverse().map((f) => `<tr><td>${esc(f.fill_date)}</td><td>${sideCell(f.side)}</td><td>${esc(f.engine)}</td><td>${esc(f.shares)}</td><td>${esc(f.price)}</td><td>${esc(f.fee)}</td><td>${esc(f.rule)}</td></tr>`).join("") || '<tr><td colspan="7">暂无成交</td></tr>';

    if (window.echarts && (T.equity || []).length) {
      const eq = T.equity;
      const baseEq = eq[0].equity || 1;
      const baseClose = eq[0].close || 1;
      makeChart("chartEquity", {
        tooltip: { trigger: "axis" },
        legend: { data: ["模拟盘净值", "买入持有"] },
        grid: { left: 60, right: 24, top: 30, bottom: 40 },
        xAxis: { type: "category", data: eq.map((r) => r.date) },
        yAxis: { type: "value", scale: true, name: "港元" },
        series: [
          { name: "模拟盘净值", type: "line", data: eq.map((r) => r.equity), showSymbol: false, lineStyle: { width: 1.8, color: "#c0392b" } },
          { name: "买入持有", type: "line", data: eq.map((r) => Math.round((r.close / baseClose) * baseEq * 100) / 100), showSymbol: false, lineStyle: { width: 1.4, color: "#8a919e", type: "dashed" } }
        ]
      });
    }
  }

  function renderCharts() {
    if (!window.echarts) {
      ["chartFull", "chartK", "chartMACD"].forEach((id) => { if ($(id)) $(id).innerHTML = '<div class="note">ECharts CDN 未加载，图表暂不可见；表格与复盘框架仍可查看。</div>'; });
      return;
    }
    const upC = "#c0392b", downC = "#1e8449";
    const stageAreas = [
      ["① 上市寻底", "2018-09-21", "2019-01-04", "#f9e2e0"],
      ["② 首轮主升", "2019-01-04", "2020-02-21", "#eafaf1"],
      ["③ 超级泡沫", "2020-02-21", "2021-02-19", "#fdebd0"],
      ["④ 三年大熊", "2021-02-19", "2024-02-09", "#f9e2e0"],
      ["⑤ 政策脉冲", "2024-02-09", "2024-10-10", "#eafaf1"],
      ["⑥ 二次探底", "2024-10-10", "2026-06-26", "#f9e2e0"],
      ["⑦ 拐点反转", "2026-06-26", CD.full_dates[CD.full_dates.length - 1], "#fef9e7"]
    ];
    makeChart("chartFull", {
      tooltip: { trigger: "axis" },
      grid: { left: 60, right: 24, top: 30, bottom: 40 },
      xAxis: { type: "category", data: CD.full_dates },
      yAxis: { type: "value", scale: true, name: "港元" },
      dataZoom: [{ type: "inside" }],
      series: [{
        name: "周收盘", type: "line", data: CD.full_close, showSymbol: false,
        lineStyle: { width: 1.6, color: "#2c3e50" }, itemStyle: { color: "#2c3e50" },
        markArea: { silent: true, label: { fontSize: 11, color: "#555", position: "insideTop" }, data: stageAreas.map((s) => [{ name: s[0], xAxis: s[1], itemStyle: { color: s[3] } }, { xAxis: s[2] }]) },
        markPoint: { data: [
          { coord: ["2021-02-19", 460], value: "460 历史顶", label: { fontSize: 11 } },
          { coord: ["2024-02-09", 61.1], value: "61.1", label: { fontSize: 11 } },
          { coord: ["2026-06-26", 63.65], value: "63.65 双底", label: { fontSize: 11 } }
        ] }
      }]
    });
    makeChart("chartK", {
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      legend: { data: ["周K", "MA20", "MA30", "MA60", "成交量"] },
      grid: [{ left: 60, right: 24, top: 36, height: "56%" }, { left: 60, right: 24, top: "74%", height: "16%" }],
      xAxis: [{ type: "category", data: CD.k_dates, gridIndex: 0 }, { type: "category", data: CD.k_dates, gridIndex: 1, axisLabel: { show: false } }],
      yAxis: [{ scale: true, gridIndex: 0, name: "港元" }, { scale: true, gridIndex: 1, name: "亿股" }],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }],
      series: [
        { name: "周K", type: "candlestick", data: CD.k_ohlc, itemStyle: { color: upC, color0: downC, borderColor: upC, borderColor0: downC } },
        { name: "MA20", type: "line", data: CD.k_ma20, showSymbol: false, lineStyle: { width: 1.4, color: "#e67e22" } },
        { name: "MA30", type: "line", data: CD.k_ma30, showSymbol: false, lineStyle: { width: 1.4, color: "#2c6fbb" } },
        { name: "MA60", type: "line", data: CD.k_ma60, showSymbol: false, lineStyle: { width: 1.6, color: "#7d3c98" } },
        { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: CD.k_vol, itemStyle: { color: "#b0b7bf" } }
      ]
    });
    makeChart("chartMACD", {
      tooltip: { trigger: "axis" },
      legend: { data: ["DIF", "DEA", "MACD柱"] },
      grid: { left: 60, right: 24, top: 36, bottom: 40 },
      xAxis: { type: "category", data: CD.m_dates },
      yAxis: { type: "value", scale: true },
      dataZoom: [{ type: "inside" }],
      series: [
        { name: "MACD柱", type: "bar", data: CD.m_hist.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? upC : downC } })) },
        { name: "DIF", type: "line", data: CD.m_dif, showSymbol: false, lineStyle: { width: 1.5, color: "#e67e22" } },
        { name: "DEA", type: "line", data: CD.m_dea, showSymbol: false, lineStyle: { width: 1.5, color: "#2c6fbb" } }
      ]
    });
  }

  renderMeta();
  renderThisWeek();
  renderKpis();
  renderTables();
  renderTrading();
  renderCharts();
})();
