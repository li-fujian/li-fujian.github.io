const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const calendar = JSON.parse(fs.readFileSync(path.join(root, "trading-calendar.json")));
const dashboard = JSON.parse(fs.readFileSync(path.join(root, "dashboard.json")));

class Element {
  constructor() {
    this.textContent = "";
    this.children = [];
    this.classList = { remove() {}, add() {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  querySelector(selector) { return this.selectors?.get(selector) ?? null; }
  querySelectorAll() { return []; }
}

function page(bootstrap = false, overrides = {}) {
  const selectors = new Map();
  for (const selector of [".data-status", ".signal-stamp", ".hero-copy h1",
    ".hero-summary", ".hero-action strong", ".hero-action small", ".operating-note",
    ".eyebrow span:last-child", ".quote-header span:last-child", ".trade-table"])
    selectors.set(selector, new Element());
  const table = selectors.get(".trade-table");
  table.selectors = new Map([[".trade-head", new Element()]]);
  const document = {
    documentElement: { dataset: {} },
    querySelector: selector => selectors.get(selector) ?? null,
    querySelectorAll: () => [],
    createElement: () => new Element(),
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-10-02T08:00:00Z"])); }
    static now() { return new Date("2026-10-02T08:00:00Z").getTime(); }
  }
  const context = vm.createContext({
    document, Intl, Date: FixedDate, console, AbortSignal,
    setInterval() {}, ...overrides,
  });
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  // Expose the actual implementation before the asynchronous bootstrap starts.
  const startup = '  showUnavailable("正在加载并校验行情；校验通过后显示当前信号。");';
  assert.ok(source.includes(startup));
  vm.runInContext(source.replace(startup, `
    globalThis.api = { currentAction, verifyData, updateTrades, render, showUnavailable };
    ${bootstrap ? "" : "return;"}
${startup}`), context);
  return { api: context.api, selectors, document };
}

test("buy/sell actions and badges agree with the builder states", () => {
  const { api, selectors } = page();
  for (const [state, holding, title, badge] of [
    ["BUY_NEXT_OPEN", false, "下个交易日开盘买入", "买"],
    ["SELL_NEXT_OPEN", true, "下个交易日开盘卖出", "卖"],
    ["HOLD", true, "继续持有", "持"],
    ["WAIT", false, "空仓等待", "等"],
  ]) {
    const data = structuredClone(dashboard);
    Object.assign(data.signal, { state, holding, title });
    api.render(data);
    assert.equal(selectors.get(".hero-copy h1").textContent, title);
    assert.equal(selectors.get(".hero-action strong").textContent,
      state === "WAIT" ? "不买，不猜，等信号" : title);
    assert.equal(selectors.get(".signal-stamp").textContent, `${state} / ${badge}`);
  }
});

test("open trade's mark date is not displayed as a sale", () => {
  const { api, selectors } = page();
  const open = dashboard.backtest.full.trades.find(t => t.status === "open");
  const closed = dashboard.backtest.full.trades.find(t => t.status === "closed");
  api.updateTrades([closed, open]);
  const rows = selectors.get(".trade-table").children;
  assert.equal(rows[1].children[1].children[0].textContent, "持有中");
  assert.equal(rows[1].children[1].children[1].textContent, "未卖出");
  assert.match(rows[1].children[3].textContent, /^浮动 /);
  assert.match(rows[1].children[4].textContent, /期末估值 2026-09-30/);
  assert.equal(rows[2].children[1].children[0].textContent, closed.sell_date);
  assert.match(rows[1].children[2].textContent, /交易日$/);
});

test("national holiday and a weekend retain the last closed session", () => {
  const { api } = page();
  for (const now of ["2026-10-02T08:00:00Z", "2026-10-07T08:00:00Z"])
    assert.equal(api.verifyData(dashboard, calendar, new Date(now)), "2026-09-30");
  const weekend = structuredClone(dashboard);
  weekend.meta.data_as_of = "2026-09-18";
  assert.equal(api.verifyData(weekend, calendar, new Date("2026-09-20T08:00:00Z")), "2026-09-18");
});

test("old, future, malformed, and unsupported-calendar data cannot issue actions", () => {
  const { api } = page();
  const now = new Date("2026-10-02T08:00:00Z");
  for (const date of ["2026-09-24", "2026-10-08"]) {
    const data = structuredClone(dashboard);
    data.meta.data_as_of = date;
    assert.throws(() => api.verifyData(data, calendar, now), /最近收盘交易日/);
  }
  assert.throws(() => api.verifyData(dashboard, calendar,
    new Date("2026-10-08T07:00:00Z")), /2026-10-08/);
  assert.equal(api.verifyData(dashboard, calendar,
    new Date("2026-10-08T06:59:00Z")), "2026-09-30");
  assert.throws(() => api.verifyData(dashboard, calendar,
    new Date("2027-01-04T08:00:00Z")), /日历尚未更新/);
  const unknown = structuredClone(dashboard);
  unknown.signal.state = "BUY";
  assert.throws(() => api.verifyData(unknown, calendar, now), /信号状态无法识别/);
});

test("a next-open instruction expires at its execution-session open", () => {
  const { api } = page();
  for (const state of ["BUY_NEXT_OPEN", "SELL_NEXT_OPEN"]) {
    const data = structuredClone(dashboard);
    Object.assign(data.signal, { state, as_of: "2026-09-30" });
    assert.equal(api.verifyData(data, calendar, new Date("2026-10-08T01:29:00Z")), "2026-09-30");
    assert.throws(() => api.verifyData(data, calendar, new Date("2026-10-08T01:30:00Z")), /执行时点已过/);
  }
});

test("unavailable data replaces instructions and hides the operating note", () => {
  const { api, selectors, document } = page();
  api.render(dashboard);
  api.showUnavailable("数据加载失败");
  assert.equal(document.documentElement.dataset.signalAvailability, "unavailable");
  assert.equal(selectors.get(".hero-action strong").textContent, "暂停显示操作指令");
  assert.equal(selectors.get(".signal-stamp").textContent, "信号暂停");
  assert.equal(selectors.get(".operating-note").hidden, true);
  assert.equal(selectors.get(".data-status").textContent, "数据加载失败");
});

test("without JavaScript the static HTML contains no active signal", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /<h1>当前信号不可用<\/h1>/);
  assert.match(html, /<strong>暂停显示操作指令<\/strong>/);
  assert.match(html, /<section class="operating-note" hidden>/);
  assert.match(html, /<noscript>/);
});

test("bootstrap disables instructions if dashboard or calendar loading fails", async () => {
  for (const failedPath of ["dashboard.json", "trading-calendar.json"]) {
    const { selectors, document } = page(true, {
      console: { error() {} },
      fetch: async url => ({
        ok: !url.includes(failedPath), status: 503,
        json: async () => url.includes("dashboard.json") ? dashboard : calendar,
      }),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.documentElement.dataset.signalAvailability, "unavailable");
    assert.match(selectors.get(".data-status").textContent, /数据加载失败/);
    assert.equal(selectors.get(".hero-action strong").textContent, "暂停显示操作指令");
    assert.equal(selectors.get(".operating-note").hidden, true);
  }
});

test("bootstrap enables only a fresh snapshot and blocks stale fetched data", async () => {
  for (const stale of [false, true]) {
    const data = structuredClone(dashboard);
    if (stale) data.meta.data_as_of = "2026-09-24";
    const { selectors, document } = page(true, {
      fetch: async url => ({ ok: true,
        json: async () => url.includes("dashboard.json") ? data : calendar,
      }),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.documentElement.dataset.signalAvailability,
      stale ? "unavailable" : "available");
    assert.equal(selectors.get(".hero-action strong").textContent,
      stale ? "暂停显示操作指令" : "继续持有");
    assert.equal(selectors.get(".operating-note").hidden, stale);
  }
});
