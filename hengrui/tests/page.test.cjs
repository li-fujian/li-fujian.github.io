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
  assert.match(src, /\["2026-05-18", 53\.58, 53\.6, 51\.99, 52\.23, 78660889\]/);
  assert.match(src, /\["2026-05-27", 48\.88, 51\.3, 48\.45, 50\.37, 96115293\]/);
  assert.match(src, /\["2026-11-16", 48\.31, 48\.38, 47\.09, 48\.02, 38339105\]/);
  assert.equal(validate(data), "");
  assert.equal(data.DATA.length, 124);
  assert.equal(data.DATA[0][0], "2026-05-18");
  assert.equal(data.DATA.at(-1)[0], "2026-11-16");
  assert.equal(data.AS_OF, data.DATA.at(-1)[0]);
  assert.deepEqual(row("2026-05-18"), ["2026-05-18", 53.58, 53.6, 51.99, 52.23, 78660889]);
  assert.deepEqual(row("2026-05-18").slice(1, 5), [qfq(53.78, 0.2), qfq(53.8, 0.2), qfq(52.19, 0.2), qfq(52.43, 0.2)]);
  assert.deepEqual(row("2026-05-26").slice(1, 5), [qfq(49.08, 0.2), qfq(50.17, 0.2), qfq(48.8, 0.2), qfq(49.2, 0.2)]);
  assert.deepEqual(row("2026-05-27").slice(1, 5), [48.88, 51.3, 48.45, 50.37]);
  assert.deepEqual(row("2026-11-16"), ["2026-11-16", 48.31, 48.38, 47.09, 48.02, 38339105]);
  assert.equal(row("2026-11-16")[4], 48.02);
  assert.equal(Math.min(...data.DATA.map((item) => item[3])), 41.89);
  assert.equal(Math.max(...data.DATA.map((item) => item[2])), 58);
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
    { price: 51.53, date: "2026-08-20", label: "放量日高" },
    { price: 41.89, date: "2026-09-11", label: "半年低" },
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

test("default grid is 40–60 with one line per yuan, and the fixed band contains the prints", () => {
  assert.equal(FOCUS_MIN, 40);
  assert.equal(FOCUS_MAX, 60);
  assert.equal(GRID_STEP, 1);
  assert.equal(levelText(40), "40");
  assert.equal(isMajorPrice(40), true);
  assert.equal(isMajorPrice(41), false);
  const scene = buildScene(data, DEFAULTS);
  assert.equal(scene.yMin, 40);
  assert.equal(scene.yMax, 60);
  assert.equal(scene.step, 1);
  assert.equal(scene.rowPx, 22);
  assert.equal(scene.ppy, 22);
  assert.equal(scene.levels.length, 21);
  assert.deepEqual(scene.levels.filter((price) => isMajorPrice(price)), [40, 45, 50, 55, 60]);
  assert.equal(fmt(yOf(scene, 60)), String(scene.padTop));
  assert.equal(fmt(yOf(scene, 59)), String(scene.padTop + scene.rowPx));
  assert.equal(fmt(yOf(scene, 40)), String(scene.padTop + scene.plotH));
  assert.equal(scene.plotH, 20 * 22);
  assert.ok(scene.dataMin >= 40 && scene.dataMax <= 60);
  assert.ok(scene.xTicks.some((tick) => tick.month && tick.text === "6月"));
  assert.ok(scene.xTicks.some((tick) => tick.month && tick.text === "11月"));
  const full = buildScene(data, { ...DEFAULTS, fullRange: true });
  assert.equal(full.yMin, 40);
  assert.equal(full.yMax, 60);
  assert.ok(full.yMin <= full.dataMin && full.yMax >= full.dataMax);
});

test("manual levels inside the window stay unless they sit on a drawn swing", () => {
  for (const sens of [3, 5, 8]) {
    const scene = buildScene(data, { ...DEFAULTS, sens });
    for (const level of data.KEY_LEVELS) {
      const near = scene.pivots.some((item) => Math.abs(item.price - level.price) < scene.pivotGap - 1e-9);
      const shown = scene.manual.some((item) => item.date === level.date && item.price === level.price);
      const inRange = level.price >= scene.yMin && level.price <= scene.yMax;
      assert.equal(shown, inRange && !near);
    }
    assert.ok(scene.shownPivots.every((item) => item.price >= scene.yMin && item.price <= scene.yMax));
  }
});

test("only a few separated swings are drawn, and the wing toggle changes them", () => {
  function signature(sens) {
    return buildScene(data, { ...DEFAULTS, sens }).shownPivots
      .map((item) => item.kind + item.date + item.price)
      .join("|");
  }
  assert.notEqual(signature(3), signature(5));
  assert.notEqual(signature(5), signature(8));
  for (const sens of [3, 5, 8]) {
    const scene = buildScene(data, { ...DEFAULTS, sens });
    const raw = findPivots(data.DATA, sens).filter((item) => item.price >= scene.yMin && item.price <= scene.yMax);
    const cap = sens >= 8 ? 3 : 4;
    for (const kind of ["high", "low"]) {
      const group = scene.shownPivots.filter((item) => item.kind === kind);
      assert.ok(group.length >= 1 && group.length <= cap);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          assert.ok(Math.abs(group[i].price - group[j].price) >= scene.pivotGap - 1e-6);
        }
        assert.ok(raw.some((item) => item.date === group[i].date && item.kind === group[i].kind && item.price === group[i].price));
      }
    }
    const highs = raw.filter((item) => item.kind === "high");
    const lows = raw.filter((item) => item.kind === "low");
    if (highs.length) {
      const top = Math.max(...highs.map((item) => item.price));
      assert.ok(scene.shownPivots.some((item) => item.kind === "high" && item.price === top));
    }
    if (lows.length) {
      const bottom = Math.min(...lows.map((item) => item.price));
      assert.ok(scene.shownPivots.some((item) => item.kind === "low" && item.price === bottom));
    }
  }
  const scene = buildScene(data, DEFAULTS);
  assert.ok(scene.shownPivots.length <= 8);
  const highs = scene.shownPivots.filter((item) => item.kind === "high").length;
  const lows = scene.shownPivots.filter((item) => item.kind === "low").length;
  assert.ok(highs >= 3 && highs <= 4);
  assert.ok(lows >= 3 && lows <= 4);
});

test("the drawing has pinyin grid lines, A-share candles, and volume", () => {
  const scene = buildScene(data, DEFAULTS);
  const svg = mainSvg(data, scene);
  const axis = axisSvg(scene);
  assert.doesNotMatch(svg + axis, /NaN|Infinity|undefined/);
  assert.match(svg, /恒瑞医药600276/);
  assert.equal((svg.match(/class="candle"/g) || []).length, data.DATA.length);
  assert.equal((svg.match(/class="vol"/g) || []).length, data.DATA.length);
  assert.equal((svg.match(/class="grid grid-major"/g) || []).length, 5);
  assert.equal((svg.match(/class="grid grid-minor"/g) || []).length, 16);
  assert.doesNotMatch(svg, /class="grid grid-major"[^>]*stroke-dasharray/);
  assert.match(svg, /class="grid grid-minor"[^>]*stroke-dasharray="2 5"/);
  assert.equal((svg.match(/class="pivot-line"/g) || []).length, scene.shownPivots.length);
  assert.equal((svg.match(/class="manual-line"/g) || []).length, scene.manual.length);
  assert.equal((svg.match(/class="pivot-dot"/g) || []).length, scene.shownPivots.length);
  assert.equal((svg.match(/class="edge /g) || []).length, 0);
  assert.match(svg, /clip-path="url\(#hengrui-plot-clip\)"/);
  assert.match(svg, /data-date="2026-11-16"[^>]*data-up="0"/);
  assert.match(svg, /data-date="2026-11-12"[^>]*data-up="1"/);
  assert.equal(isUpCandle(row("2026-11-16")), false);
  assert.equal(isUpCandle(row("2026-11-12")), true);
  assert.match(svg.slice(svg.indexOf('data-date="2026-11-16"'), svg.indexOf('data-date="2026-11-16"') + 500), new RegExp(DOWN));
  assert.match(svg.slice(svg.indexOf('data-date="2026-11-12"'), svg.indexOf('data-date="2026-11-12"') + 500), new RegExp(UP));
  assert.doesNotMatch(svg, /class="ma /);
  const withMa = mainSvg(data, buildScene(data, { ...DEFAULTS, showMA: true }));
  assert.match(withMa, /class="ma ma5"/);
  assert.match(withMa, /class="ma ma10"/);
  assert.match(withMa, /class="ma ma20"/);
  assert.doesNotMatch(withMa, /NaN|Infinity/);
  assert.match(axis, />40</);
  assert.match(axis, />60</);
  assert.match(axis, />41</);
  assert.match(axis, />48\.02</);
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
  assert.equal(volText(38339105), "38.34万手");
  assert.equal(md("2026-11-16"), "11/16");
  assert.equal(md("2026-05-18"), "5/18");
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
  assert.equal(quote.close, "48.02");
  assert.equal(quote.chgText, (change >= 0 ? "+" : "") + change.toFixed(2) + "%");
  assert.ok(change < 0);
  assert.equal(quote.color, DOWN);
  assert.equal(quote.volumeText, "38.34万手");
  assert.equal(quoteModel(data, scene, 0).chgText, "—");
});

test("the pivot table is newest first and uses the 40–60 window", () => {
  const scene = buildScene(data, DEFAULTS);
  const rows = pivotTableRows(scene.pivots, scene.lastClose);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date);
  for (const item of rows) {
    assert.equal(item.inFocus, item.price >= 40 && item.price <= 60);
    assert.equal(item.distanceText, ((item.price / scene.lastClose - 1) * 100).toFixed(1) + "%");
    assert.equal(item.inFocusText, "是");
  }
});

test("a print outside 40–60 keeps the fixed band and grows only in the full-range view", () => {
  const blown = { AS_OF: data.AS_OF, KEY_LEVELS: data.KEY_LEVELS, DATA: data.DATA.map((item) => item.slice()) };
  blown.DATA[10] = [blown.DATA[10][0], 70, 72.4, 69, 71, 1000];
  const scene = buildScene(blown, DEFAULTS);
  assert.equal(scene.yMin, 40);
  assert.equal(scene.yMax, 60);
  assert.equal((mainSvg(blown, scene).match(/class="edge edge-up"/g) || []).length, 1);
  const full = buildScene(blown, { ...DEFAULTS, fullRange: true });
  assert.equal(full.yMax, 75);
  assert.equal(full.yMin % 5, 0);
  assert.ok(full.yMax >= 72.4);
  assert.doesNotMatch(mainSvg(blown, full), /NaN|Infinity/);
});

test("the page is static, and strategies links it beside the other boards", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const strategies = fs.readFileSync(path.join(repo, "strategies/index.html"), "utf8");
  assert.match(html, /<title>恒瑞医药 600276 日K线<\/title>/);
  assert.match(html, /600276\.SH/);
  assert.match(html, /在40–60内/);
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
  assert.match(app, /HENGRUI_DATA/);
  assert.match(app, /sh600276/);
  assert.match(app, /GRID_STEP = 1/);
  assert.doesNotMatch(app, /688981|SMIC_DATA|未复权/);
  assert.match(readme, /data\.js/);
  assert.match(readme, /node --test/);
  assert.match(readme, /前复权/);
  assert.match(readme, /52\.23/);
  assert.match(readme, /update_study_klines\.py hengrui/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/hengrui\/"/);
  assert.match(strategies, /恒瑞医药 · 日K线/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/smic\/"/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/kc50-weekly\/"/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/meituan\/"/);
  assert.match(strategies, /class="item"/);
});
