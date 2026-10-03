# 美团页面：数据与维护

本页由本仓库维护，停止从 Gitee mtsdt 复制旧分析。页面定位为有日期、有来源的行情与经营观察，不运行交易引擎。

## 日常更新

在仓库根目录执行：

```powershell
python meituan/scripts/update_dashboard.py --check-only
python meituan/scripts/update_dashboard.py
```

GitHub Actions 在周一至周五香港时间 17:37 尝试更新。非交易日核对最近交易日，不补造数据。定时任务依赖仓库 Actions 正常运行；页面使用浏览器时钟独立提示过期，不以生成时间冒充行情日期。

- 腾讯不复权日线、周线；腾讯和新浪收盘快照。交易币种 HKD，成交量为股。
- 验证最近完整交易日、日期覆盖、OHLC、量、昨收、成交额单位、日周聚合，再写入。
- 股价均线与 MACD 均由完整周线计算。最新未收官周仅展示，周线结论使用上一已收官周。
- 日均量对照此前 20 个完整周，按交易日数量处理整日休市；半日市仍计作一个交易日，没有按交易时长归一化。
- 数据提供方不一致或日期不新鲜就报错，保留旧页面数据。对停牌等异常不擅自补K线。
- `data/dashboard.js` 是浏览器唯一数据入口，原子替换；JSON用于检查。校验失败不会发布。多文件落盘遇到I/O错误并不保证整体事务性，需重跑，页面单一JS入口避免混用不同版本字段。
- `trading-calendar.json` 目前仅维护 2026；跨年须按港交所公告添加日历，否则停止更新。不得套用 A 股休市日历。

## 财报

`data/fundamentals.json` 保存公告原始人民币千元值；除以 100000 转为人民币亿元。原件及 SHA256 一并保存，网页来源可打开原公告及本地副本。财报由人工核验，行情任务不自动改写财报；页面明确核验日期，并在超过90天时提示复核。

## 验证

```powershell
python -m unittest discover -s meituan/tests -p "test_*.py"
node --test meituan/tests/page.test.cjs
python meituan/scripts/update_dashboard.py --offline-dir meituan/research/2026-10-03/raw-fixture --now 2026-10-03T01:00:00+08:00 --check-only
```

历史复现时间仅允许 `--check-only`，不能用来发布过期数据。原始返回文件按 UTF-8 存档并记录 SHA256。测试不依赖实时网络。

## 历史与范围

- `research/2026-08-24/`：原页面数据及交易章程，已归档。
- `baseline/`：原始 7 月研究，已加过期提示。
- `research/2026-10-03/audit.md`：本次审查、修正及验证依据。
- `trading/README.md`：旧规则停用说明。没有用新价格虚构模拟成交或净值。
