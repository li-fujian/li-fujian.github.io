# 中芯国际 688981 日K

静态页，没有构建步骤。浏览器打开 `index.html`，或访问 https://li-fujian.github.io/smic/

默认纵轴是 90–130 元，每 1 元一条横线。逢 0、逢 5 为实线并标价，其余整数价位是淡虚线。红涨绿跌（收盘不低于开盘为红）。阶段高低点按左右各 N 根 K 线自动识别，N 可在页面上切换为 3、5、8。

## 更新日K

只编辑 `data.js`：

1. 把 `AS_OF` 改成新的截止日期。
2. 在 `DATA` 末尾追加一行，日期必须晚于上一行：`["YYYY-MM-DD", 开盘, 最高, 最低, 收盘, 成交量]`。成交量单位是股，不是手。
3. 不要改写已经写入的历史价格。阶段高低点、均线、成交量会自动重算。
4. 可选：在 `KEY_LEVELS` 里调整手工关注价位，格式 `{ price, date, label }`。

行情是 Yahoo Finance `688981.SS` 未复权日线。

## 检查

```powershell
node --test smic/tests/page.test.cjs
```
