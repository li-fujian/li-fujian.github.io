const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const repo = path.join(root, "..");
const data = require("../data.js");
const {
  UP, DOWN, FOCUS_MIN, FOCUS_MAX, DEFAULTS,
  findPivots, ma, volText, md, validate, isUpCandle,
  buildScene, mainSvg, axisSvg, quoteModel, pointerToIndex, yOf, fmt, pivotTableRows,
} = require("../app.js");

function row(date) {
  return data.DATA.find((item) => item[0] === date);
}

test("shipped bars keep the approved series and stay easy to extend", () => {
  const src = fs.readFileSync(path.join(root, "data.js"), "utf8");
  assert.match(src, /追加/);
  assert.match(src, /AS_OF/);
  assert.match(src, /成交量\(股\)/);
  assert.match(src, /\["2026-05-18", 117\.4, 120\.34, 115\.6, 117\.62, 74896919\]/);
  assert.match(src, /\["2026-07-10", 173\.0, 176\.34, 162\.58, 163\.02, 112708895\]/);
  assert.match(src, /\["2026-10-23", 99\.46, 104\.28, 94\.8, 104\.1, 52490626\]/);
  assert.match(src, /\["2026-11-04", 102\.0, 111\.82, 101\.24, 111\.3, 58021471\]/);
  assert.match(src, /\["2026-11-16", 107\.0, 109\.1, 104\.83, 106\.44, 39334084\]/);
  assert.equal(validate(data), "");
  assert.ok(data.DATA.length >= 124);
  assert.equal(data.DATA[0][0], "2026-05-18");
  assert.ok(data.DATA.at(-1)[0] >= "2026-11-16");
  assert.equal(data.AS_OF, data.DATA.at(-1)[0]);
  assert.deepEqual(row("2026-05-18"), ["2026-05-18", 117.4, 120.34, 115.6, 117.62, 74896919]);
  assert.deepEqual(row("2026-11-16"), ["2026-11-16", 107, 109.1, 104.83, 106.44, 39334084]);
  let prev = "";
  for (const item of data.DATA) {
    assert.match(item[0], /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item[0] > prev);
    prev = item[0];
    const [, open, high, low, close, volume] = item;
    assert.ok(low <= Math.min(open, close) && high >= Math.max(open, close));
    assert.equal(Number.isInteger(volume) && volume > 0, true);
  }
  const byDate = new Map(data.DATA.map((item) => [item[0], item]));
  assert.deepEqual(data.KEY_LEVELS, [
    { price: 96.36, date: "2026-10-30", label: "二次探底" },
    { price: 111.82, date: "2026-11-04", label: "放量突破日高" },
  ]);
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

test("default grid is 90–130 with one line per yuan, and full range covers the prints", () => {
  const scene = buildScene(data, DEFAULTS);
  assert.equal(scene.yMin, FOCUS_MIN);
  assert.equal(scene.yMax, FOCUS_MAX);
  assert.equal(scene.levels.length, 41);
  assert.deepEqual(scene.levels.filter((price) => price % 5 === 0), [90, 95, 100, 105, 110, 115, 120, 125, 130]);
  assert.equal(fmt(yOf(scene, 130)), String(scene.padTop));
  assert.equal(fmt(yOf(scene, 90)), String(scene.padTop + scene.plotH));
  assert.ok(scene.xTicks.some((tick) => tick.month && tick.text === "6月"));
  assert.ok(scene.xTicks.some((tick) => tick.month && tick.text === "11月"));
  const full = buildScene(data, { ...DEFAULTS, fullRange: true });
  assert.equal(full.yMin % 5, 0);
  assert.equal(full.yMax % 5, 0);
  assert.ok(full.yMin <= full.dataMin && full.yMax >= full.dataMax);
  assert.equal(full.yMin, 90);
  assert.equal(full.yMax, 180);
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
});

test("the drawing has pinyin grid lines, A-share candles, clipped markers, and volume", () => {
  const scene = buildScene(data, DEFAULTS);
  const svg = mainSvg(data, scene);
  const axis = axisSvg(scene);
  assert.doesNotMatch(svg + axis, /NaN|Infinity|undefined/);
  assert.equal((svg.match(/class="candle"/g) || []).length, data.DATA.length);
  assert.equal((svg.match(/class="vol"/g) || []).length, data.DATA.length);
  assert.equal((svg.match(/class="grid grid-major"/g) || []).length, 9);
  assert.equal((svg.match(/class="grid grid-minor"/g) || []).length, 32);
  assert.doesNotMatch(svg, /class="grid grid-major"[^>]*stroke-dasharray/);
  assert.match(svg, /class="grid grid-minor"[^>]*stroke-dasharray="2 5"/);
  assert.equal((svg.match(/class="pivot-line"/g) || []).length, scene.shownPivots.length);
  assert.equal((svg.match(/class="manual-line"/g) || []).length, scene.manual.length);
  assert.equal((svg.match(/class="pivot-dot"/g) || []).length, scene.shownPivots.length);
  const above = data.DATA.filter((item) => item[2] > 130).length;
  const below = data.DATA.filter((item) => item[3] < 90).length;
  assert.ok(above > 0);
  assert.equal(below, 0);
  assert.equal((svg.match(/class="edge edge-up"/g) || []).length, above);
  assert.equal((svg.match(/class="edge edge-down"/g) || []).length, 0);
  assert.equal((mainSvg(data, buildScene(data, { ...DEFAULTS, fullRange: true })).match(/class="edge /g) || []).length, 0);
  assert.match(svg, /clip-path="url\(#smic-plot-clip\)"/);
  assert.match(svg, /data-date="2026-11-16"[^>]*data-up="0"/);
  assert.match(svg, /data-date="2026-11-12"[^>]*data-up="1"/);
  assert.equal(isUpCandle(row("2026-11-16")), false);
  assert.equal(isUpCandle(row("2026-11-12")), true);
  const downCandle = svg.slice(svg.indexOf('data-date="2026-11-16"'), svg.indexOf('data-date="2026-11-16"') + 500);
  assert.match(downCandle, new RegExp(DOWN));
  assert.match(svg.slice(svg.indexOf('data-date="2026-11-12"'), svg.indexOf('data-date="2026-11-12"') + 500), new RegExp(UP));
  assert.doesNotMatch(svg, /class="ma /);
  const withMa = mainSvg(data, buildScene(data, { ...DEFAULTS, showMA: true }));
  assert.match(withMa, /class="ma ma5"/);
  assert.match(withMa, /class="ma ma10"/);
  assert.match(withMa, /class="ma ma20"/);
  assert.doesNotMatch(withMa, /NaN|Infinity/);
  assert.match(axis, />90</);
  assert.match(axis, />130</);
  assert.match(axis, />91</);
  assert.match(axis, />106\.44</);
  assert.equal((axisSvg(buildScene(data, { ...DEFAULTS, density: 16 })).match(/class="scale scale-minor"/g) || []).length, 0);
  for (const level of scene.manual) assert.ok(axis.includes(`${level.price.toFixed(2)} ${md(level.date)}${level.label}`));
  for (const pivot of scene.shownPivots) {
    assert.ok(axis.includes(`${pivot.price.toFixed(2)} ${md(pivot.date)}${pivot.kind === "high" ? "高" : "低"}`));
  }
  const pivot = scene.shownPivots[0];
  const y = fmt(yOf(scene, pivot.price));
  assert.match(svg, new RegExp(`class="pivot-line" data-kind="${pivot.kind}" data-price="${pivot.price.toFixed(2)}" x1="0" x2="${scene.W}" y1="${y}" y2="${y}"`));
});

test("moving averages, volume text, and the crosshair price follow the bar under the pointer", () => {
  const values = ma(data.DATA, 5);
  assert.equal(values[3], null);
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += data.DATA[i][4];
  assert.equal(values[4], sum / 5);
  assert.equal(volText(39334084), "39.33万手");
  assert.equal(md("2026-11-04"), "11/4");
  assert.equal(md("2026-05-18"), "5/18");
  const scene = buildScene(data, DEFAULTS);
  const hit = pointerToIndex(scene, scene.leftPad + scene.sp * 2 + 1, scene.padTop + scene.ppy);
  assert.equal(hit.i, 2);
  assert.equal(hit.hoverY, scene.padTop + scene.ppy);
  assert.ok(Math.abs(hit.price - (scene.yMax - 1)) < 1e-9);
  const above = pointerToIndex(scene, 0, scene.padTop - 1);
  assert.equal(above.i, 0);
  assert.equal(above.hoverY, null);
  const last = pointerToIndex(scene, scene.W + 20, scene.padTop + 4);
  assert.equal(last.i, scene.n - 1);
  const quote = quoteModel(data, scene, data.DATA.length - 1);
  const prev = data.DATA.at(-2)[4];
  const close = data.DATA.at(-1)[4];
  const change = (close / prev - 1) * 100;
  assert.equal(quote.date, "2026-11-16");
  assert.equal(quote.chgText, (change >= 0 ? "+" : "") + change.toFixed(2) + "%");
  assert.equal(quote.color, change >= 0 ? UP : DOWN);
  assert.equal(quote.volumeText, "39.33万手");
  assert.equal(quoteModel(data, scene, 0).chgText, "—");
});

test("the pivot table is newest first and flags prices outside 90–130", () => {
  const scene = buildScene(data, DEFAULTS);
  const rows = pivotTableRows(scene.pivots, scene.lastClose);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].date >= rows[i].date);
  assert.ok(rows.some((item) => item.price > 130 && item.inFocusText === "否（区间外）"));
  assert.ok(rows.some((item) => item.inFocus && item.inFocusText === "是"));
  for (const item of rows) {
    assert.equal(item.distanceText, ((item.price / scene.lastClose - 1) * 100).toFixed(1) + "%");
    assert.equal(item.inFocus, item.price >= 90 && item.price <= 130);
  }
});

test("the page is static, and strategies links it beside the other boards", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const strategies = fs.readFileSync(path.join(repo, "strategies/index.html"), "utf8");
  assert.match(html, /<title>中芯国际 688981 日K线<\/title>/);
  assert.match(html, /data-set="density"[^>]*data-value="22"[^>]*aria-pressed="true"/);
  assert.match(html, /data-set="spacing"[^>]*data-value="12"[^>]*aria-pressed="true"/);
  assert.match(html, /data-set="sens"[^>]*data-value="5"[^>]*aria-pressed="true"/);
  assert.match(html, /data-value="16"/);
  assert.match(html, /data-value="30"/);
  assert.match(html, /data-value="8"/);
  assert.match(html, /data-value="18"/);
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
    if (!/^(https?:|#|\.\.)/.test(url)) assert.ok(fs.existsSync(path.resolve(root, url.split("?")[0])), url);
  }
  assert.match(readme, /data\.js/);
  assert.match(readme, /node --test/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/smic\/"/);
  assert.match(strategies, /中芯国际 · 日K线/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/kc50-weekly\/"/);
  assert.match(strategies, /href="https:\/\/li-fujian\.github\.io\/meituan\/"/);
  assert.match(strategies, /class="item"/);
});
