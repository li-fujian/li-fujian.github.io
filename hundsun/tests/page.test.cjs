const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const repo = path.join(root, "..");
const data = require("../data.js");
const {
  UP, DOWN, FOCUS_MIN, FOCUS_MAX, GRID_STEP, DEFAULTS,
  findPivots, ma, volText, md, validate, isUpCandle, isMajorPrice, levelText,
  buildScene, mainSvg, axisSvg, quoteModel, pointerToIndex, yOf, fmt, pivotTableRows,
} = require("../app.js");

function row(date) {
  return data.DATA.find((item) => item[0] === date);
}

function qfq(raw, shift) {
  return Math.round((raw - shift) * 100) / 100;
}

test("shipped bars are forward-adjusted and stay easy to extend", () => {
  const src = fs.readFileSync(path.join(root, "data.js"), "utf8");
  assert.match(src, /追加/);
  assert.match(src, /AS_OF/);
  assert.match(src, /成交量\(股\)/);
  assert.match(src, /前复权/);
  assert.match(src, /0\.20/);
  assert.match(src, /0\.05/);
  assert.match(src, /\["2026-05-18", 25\.6, 26\.75, 25\.55, 26\.41, 29182313\]/);
  assert.match(src, /\["2026-06-09", 22\.21, 22\.24, 21\.81, 22\.22, 19704278\]/);
  assert.match(src, /\["2026-10-22", 20\.08, 20\.15, 19\.67, 19\.7, 16887980\]/);
  assert.match(src, /\["2026-11-16", 20\.4, 20\.6, 20\.23, 20\.4, 18248606\]/);
  assert.equal(validate(data), "");
  assert.equal(data.DATA.length, 124);
  assert.equal(data.DATA[0][0], "2026-05-18");
  assert.equal(data.DATA.at(-1)[0], "2026-11-16");
  assert.equal(data.AS_OF, data.DATA.at(-1)[0]);
  assert.deepEqual(row("2026-05-18"), ["2026-05-18", 25.6, 26.75, 25.55, 26.41, 29182313]);
  assert.deepEqual(row("2026-05-18").slice(1, 5), [qfq(25.85, 0.25), qfq(27, 0.25), qfq(25.8, 0.25), qfq(26.66, 0.25)]);
  assert.deepEqual(row("2026-06-08").slice(1, 5), [qfq(22.68, 0.25), qfq(23.15, 0.25), qfq(21.99, 0.25), qfq(22.26, 0.25)]);
  assert.deepEqual(row("2026-06-09").slice(1, 5), [qfq(22.26, 0.05), qfq(22.29, 0.05), qfq(21.86, 0.05), qfq(22.27, 0.05)]);
  assert.deepEqual(row("2026-10-21").slice(1, 5), [qfq(19.96, 0.05), qfq(20.49, 0.05), qfq(19.92, 0.05), qfq(20.13, 0.05)]);
  assert.deepEqual(row("2026-10-22").slice(1, 5), [20.08, 20.15, 19.67, 19.7]);
  assert.deepEqual(row("2026-11-16"), ["2026-11-16", 20.4, 20.6, 20.23, 20.4, 18248606]);
  assert.equal(row("2026-11-16")[4], 20.4);
  assert.equal(Math.min(...data.DATA.map((item) => item[3])), 18.56);
  assert.equal(Math.max(...data.DATA.map((item) => item[2])), 27.24);
  let prev = "";
  for (const item of data.DATA) {
    assert.match(item[0], /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item[0] > prev);
    prev = item[0];
    const [, open, high, low, close, volume] = item;
    assert.ok(low <= Math.min(open, close) && high >= Math.max(open, close));
    assert.equal(Number.isInteger(volume) && volume > 0, true);
  }
  assert.deepEqual(data.KEY_LEVELS, [
    { price: 21.72, date: "2026-11-03", label: "放量日高" },
    { price: 18.56, date: "2026-10-09", label: "半年低" },
  ]);
  const byDate = new Map(data.DATA.map((item) => [item[0], item]));
  for (const level of data.KEY_LEVELS) {
    const bar = byDate.get(level.date);
    assert.ok(bar);
    assert.ok(level.price === bar[2] || level.price === bar[3]);
  }
});

test("bad rows are rejected before they can draw", () => {
  assert.match(validate({ DATA: [["2026-01-02", 1, 1, 1, 1, 1], ["2026-01-01", 1, 1, 1, 1, 1]] }), /日期/);
  assert.match(validate({ DATA: [["2026-01-01", 5, 4, 1, 3, 10], ["2026-01-02", 1, 2, 0.5, 1.5, 10]] }), /高低/);
});

test("pivots use the approved wing and tie-break, and skip the newest bar", () => {
  const tied = [
    ["2026-01-01", 1, 5, 1, 1, 1],
    ["2026-01-02", 1, 5, 1, 1, 1],
    ["2026-01-03", 1, 4, 1, 1, 1],
    ["2026-01-04", 1, 4, 1, 1, 1],
  ];
  assert.deepEqual(findPivots(tied, 1).filter((item) => item.kind === "high").map((item) => item.i), [0]);
  const pivots = findPivots(data.DATA, 5);
  assert.ok(pivots.length > 0);
  assert.ok(pivots.every((item) => item.i < data.DATA.length - 1));
  for (const item of pivots) {
    assert.equal(item.date, data.DATA[item.i][0]);
    assert.equal(item.price, data.DATA[item.i][item.kind === "high" ? 2 : 3]);
    const a = Math.max(0, item.i - 5);
    const b = Math.min(data.DATA.length - 1, item.i + 5);
    for (let j = a; j <= b; j++) {
      if (j === item.i) continue;
      if (item.kind === "high") {
        const high = data.DATA[j][2];
        if (j < item.i) assert.ok(high < item.price);
        else assert.ok(high <= item.price);
      } else {
        const low = data.DATA[j][3];
        if (j < item.i) assert.ok(low > item.price);
        else assert.ok(low >= item.price);
      }
    }
  }
});

test("default grid is 15–30 with a line every 0.5 yuan, and the fixed band contains the prints", () => {
  assert.equal(FOCUS_MIN, 15);
  assert.equal(FOCUS_MAX, 30);
  assert.equal(GRID_STEP, 0.5);
  assert.equal(levelText(20), "20");
  assert.equal(levelText(20.5), "20.5");
  assert.equal(isMajorPrice(15), true);
  assert.equal(isMajorPrice(20), true);
  assert.equal(isMajorPrice(20.5), false);
  assert.equal(isMajorPrice(21), false);
  const scene = buildScene(data, DEFAULTS);
  assert.equal(scene.yMin, 15);
  assert.equal(scene.yMax, 30);
  assert.equal(scene.step, 0.5);
  assert.equal(scene.rowPx, 22);
  assert.equal(scene.ppy, 44);
  assert.equal(scene.levels.length, 31);
  assert.deepEqual(scene.levels.filter((price) => isMajorPrice(price)), [15, 20, 25, 30]);
  assert.equal(fmt(yOf(scene, 30)), String(scene.padTop));
  assert.equal(fmt(yOf(scene, 29.5)), String(scene.padTop + scene.rowPx));
  assert.equal(fmt(yOf(scene, 15)), String(scene.padTop + scene.plotH));
  assert.equal(scene.plotH, 30 * 22);
  assert.ok(scene.dataMin >= 15 && scene.dataMax <= 30);
  assert.ok(scene.xTicks.some((tick) => tick.month && tick.text === "6月"));
  assert.ok(scene.xTicks.some((tick) => tick.month && tick.text === "11月"));
  const full = buildScene(data, { ...DEFAULTS, fullRange: true });
  assert.equal(full.yMin, 15);
  assert.equal(full.yMax, 30);
  assert.ok(full.yMin <= full.dataMin && full.yMax >= full.dataMax);
});

test("manual levels inside the window stay unless they duplicate a pivot", () => {
  for (const sens of [3, 5, 8]) {
    const scene = buildScene(data, { ...DEFAULTS, sens });
    for (const level of data.KEY_LEVELS) {
      const duplicate = scene.pivots.some((item) => item.date === level.date && Math.abs(item.price - level.price) < 0.005);
      const shown = scene.manual.some((item) => item.date === level.date && item.price === level.price);
      const inRange = level.price >= scene.yMin && level.price <= scene.yMax;
      assert.equal(shown, inRange && !duplicate);
    }
    assert.ok(scene.shownPivots.every((item) => item.price >= scene.yMin && item.price <= scene.yMax));
  }
  const scene = buildScene(data, DEFAULTS);
  assert.ok(scene.manual.some((item) => item.date === "2026-11-03" && item.price === 21.72));
});

test("the drawing has pinyin grid lines, A-share candles, and volume", () => {
  const scene = buildScene(data, DEFAULTS);
  const svg = mainSvg(data, scene);
  const axis = axisSvg(scene);
  assert.doesNotMatch(svg + axis, /NaN|Infinity|undefined/);
  assert.match(svg, /恒生电子600570/);
  assert.equal((svg.match(/class="candle"/g) || []).length, data.DATA.length);
  assert.equal((svg.match(/class="vol"/g) || []).length, data.DATA.length);
  assert.equal((svg.match(/class="grid grid-major"/g) || []).length, 4);
  assert.equal((svg.match(/class="grid grid-minor"/g) || []).length, 27);
  assert.doesNotMatch(svg, /class="grid grid-major"[^>]*stroke-dasharray/);
  assert.match(svg, /class="grid grid-minor"[^>]*stroke-dasharray="2 5"/);
  assert.equal((svg.match(/class="pivot-line"/g) || []).length, scene.shownPivots.length);
  assert.equal((svg.match(/class="manual-line"/g) || []).length, scene.manual.length);
  assert.equal((svg.match(/class="pivot-dot"/g) || []).length, scene.shownPivots.length);
  assert.equal((svg.match(/class="edge /g) || []).length, 0);
  assert.match(svg, /clip-path="url\(#hundsun-plot-clip\)"/);
  assert.match(svg, /data-date="2026-11-16"[^>]*data-up="1"/);
  assert.match(svg, /data-date="2026-11-12"[^>]*data-up="0"/);
  assert.equal(isUpCandle(row("2026-11-16")), true);
  assert.equal(isUpCandle(row("2026-11-12")), false);
  assert.match(svg.slice(svg.indexOf('data-date="2026-11-16"'), svg.indexOf('data-date="2026-11-16"') + 500), new RegExp(UP));
  assert.match(svg.slice(svg.indexOf('data-date="2026-11-12"'), svg.indexOf('data-date="2026-11-12"') + 500), new RegExp(DOWN));
  assert.doesNotMatch(svg, /class="ma /);
  const withMa = mainSvg(data, buildScene(data, { ...DEFAULTS, showMA: true }));
  assert.match(withMa, /class="ma ma5"/);
  assert.match(withMa, /class="ma ma10"/);
  assert.match(withMa, /class="ma ma20"/);
  assert.doesNotMatch(withMa, /NaN|Infinity/);
  assert.match(axis, />15</);
  assert.match(axis, />30</);
  assert.match(axis, />18\.5</);
  assert.match(axis, />20\.40</);
  assert.equal((axisSvg(buildScene(data, { ...DEFAULTS, density: 16 })).match(/class="scale scale-minor"/g) || []).length, 0);
  for (const level of scene.manual) assert.ok(axis.includes(`${level.price.toFixed(2)} ${md(level.date)}${level.label}`));
  for (const pivot of scene.shownPivots) {
    assert.ok(axis.includes(`${pivot.price.toFixed(2)} ${md(pivot.date)}${pivot.kind === "high" ? "高" : "低"}`));
  }
});

test("moving averages, volume text, and the crosshair price follow the bar under the pointer", () => {
  const values = ma(data.DATA, 5);
  assert.equal(values[3], null);
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += data.DATA[i][4];
  assert.equal(values[4], sum / 5);
  assert.equal(volText(18248606), "18.25万手");
  assert.equal(md("2026-11-16"), "11/16");
  const scene = buildScene(data, DEFAULTS);
  const hit = pointerToIndex(scene, scene.leftPad + scene.sp * 2 + 1, scene.padTop + scene.ppy);
  assert.equal(hit.i, 2);
  assert.equal(hit.hoverY, scene.padTop + scene.ppy);
  assert.ok(Math.abs(hit.price - (scene.yMax - 1)) < 1e-9);
  const quote = quoteModel(data, scene, data.DATA.length - 1);
  const prev = data.DATA.at(-2)[4];
  const close = data.DATA.at(-1)[4];
  const change = (close / prev - 1) * 100;
  assert.equal(quote.date, "2026-11-16");
  assert.equal(quote.close, "20.40");
  assert.equal(quote.chgText, (change >= 0 ? "+" : "") + change.toFixed(2) + "%");
  assert.ok(change < 0);
  assert.equal(quote.color, DOWN);
  assert.equal(isUpCandle(row("2026-11-16")), true);
  assert.equal(quote.volumeText, "18.25万手");
  assert.equal(quoteModel(data, scene, 0).chgText, "—");
});

test("the pivot table is newest first and uses the 15–30 window", () => {
  const scene = buildScene(data, DEFAULTS);
  const rows = pivotTableRows(scene.pivots, scene.lastClose);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date);
  for (const item of rows) {
    assert.equal(item.inFocus, item.price >= 15 && item.price <= 30);
    assert.equal(item.distanceText, ((item.price / scene.lastClose - 1) * 100).toFixed(1) + "%");
    assert.equal(item.inFocusText, "是");
  }
});

test("a print outside 15–30 keeps the fixed band and grows only in the full-range view", () => {
  const blown = { AS_OF: data.AS_OF, KEY_LEVELS: data.KEY_LEVELS, DATA: data.DATA.map((item) => item.slice()) };
  blown.DATA[4] = [blown.DATA[4][0], 12, 12.4, 11.2, 11.8, 1000];
  const scene = buildScene(blown, DEFAULTS);
  assert.equal(scene.yMin, 15);
  assert.equal(scene.yMax, 30);
  assert.equal((mainSvg(blown, scene).match(/class="edge edge-down"/g) || []).length, 1);
  const full = buildScene(blown, { ...DEFAULTS, fullRange: true });
  assert.equal(full.yMin, 10);
  assert.equal(full.yMax % 5, 0);
  assert.ok(full.yMin <= 11.2);
  assert.doesNotMatch(mainSvg(blown, full), /NaN|Infinity/);
});

test("the page is static, and strategies links it beside the other boards", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const strategies = fs.readFileSync(path.join(repo, "strategies/index.html"), "utf8");
  assert.match(html, /<title>恒生电子 600570 日K线<\/title>/);
  assert.match(html, /600570\.SH/);
  assert.match(html, /在15–30内/);
  assert.match(html, /每 0\.5 元一格/);
  assert.match(html, /前复权/);
  assert.match(html, /data-set="density"[^>]*data-value="22"[^>]*aria-pressed="true"/);
  assert.match(html, /data-set="spacing"[^>]*data-value="12"[^>]*aria-pressed="true"/);
  assert.match(html, /data-set="sens"[^>]*data-value="5"[^>]*aria-pressed="true"/);
  assert.match(html, /短线\(3日\)/);
  assert.match(html, /波段\(8日\)/);
  assert.match(html, /显示完整价格区间/);
  assert.match(html, /均线 MA5\/10\/20/);
  assert.match(html, /id="chart-scroll"/);
  assert.match(html, /id="pivot-body"/);
  const dataAt = html.indexOf('src="data.js"');
  const appAt = html.indexOf('src="app.js"');
  assert.ok(dataAt > 0 && appAt > dataAt);
  assert.doesNotMatch(html, /grok\/canvas|react|echarts/);
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^(https?:|#|\.\.|data:)/.test(url)) assert.ok(fs.existsSync(path.resolve(root, url.split("?")[0])), url);
  }
  assert.match(app, /HUNDSUN_DATA/);
  assert.match(app, /sh600570/);
  assert.match(app, /GRID_STEP = 0\.5/);
  assert.doesNotMatch(app, /688981|SMIC_DATA|未复权/);
  assert.match(readme, /data\.js/);
  assert.match(readme, /node --test/);
  assert.match(readme, /前复权/);
  assert.match(readme, /26\.41/);
  assert.match(readme, /update_study_klines\.py hundsun/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/hundsun\/"/);
  assert.match(strategies, /恒生电子 · 日K线/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/smic\/"/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/kc50-weekly\/"/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/meituan\/"/);
  assert.match(strategies, /class="item"/);
});
