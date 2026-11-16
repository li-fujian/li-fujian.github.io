(function () {
  "use strict";

  // Candle bodies follow the approved chart: red when close >= open, green otherwise.
  // The quote's 涨跌幅 is a separate comparison against the previous close.
  var UP = "#e5383b";
  var DOWN = "#2b9a48";
  var FOCUS_MIN = 40;
  var FOCUS_MAX = 60;
  var GRID_STEP = 1;
  var SOURCE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600276,day,,,320,qfq";
  var SOURCE_NAME = "腾讯财经（sh600276 日线，前复权）";
  var FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, WenQuanYi Micro Hei, Droid Sans Fallback, sans-serif";
  var PALETTE = {
    up: UP,
    down: DOWN,
    ink: "#242b29",
    secondary: "#3e4a45",
    tertiary: "#8a8478",
    accent: "#3d4f9f",
    gridMajor: "#4a453e",
    gridMinor: "#d5cfc3",
    line: "#d9ddd5",
    paper: "#fffefb",
  };
  var DEFAULTS = { density: 22, spacing: 12, sens: 5, fullRange: false, showMA: false };
  var DENSITIES = [16, 22, 30];
  var SPACINGS = [8, 12, 18];
  var SENS = [3, 5, 8];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmt(n) {
    return String(Math.round(n * 100) / 100);
  }

  function md(d) {
    return Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10));
  }

  function volText(v) {
    return (v / 1e6).toFixed(2) + "万手";
  }

  function isUpCandle(row) {
    return row[4] >= row[1];
  }

  function roundPrice(p) {
    return Math.round(p * 1000) / 1000;
  }

  // Solid rules sit on prices ending in 0 or 5. Half-yuan lines stay dashed.
  function isMajorPrice(p) {
    return Math.round(p * 100) % 500 === 0;
  }

  function levelText(p) {
    var rounded = Math.round(p * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded));
    return rounded.toFixed(2).replace(/0$/, "");
  }

  function priceLevels(yMin, yMax, step) {
    var levels = [];
    var count = Math.round((yMax - yMin) / step);
    for (var i = 0; i <= count; i++) levels.push(roundPrice(yMin + i * step));
    return levels;
  }

  function stepLabel() {
    return GRID_STEP === 1 ? "1" : String(GRID_STEP);
  }


  function optionsFrom(input) {
    var o = input || {};
    return {
      density: DENSITIES.indexOf(Number(o.density)) >= 0 ? Number(o.density) : DEFAULTS.density,
      spacing: SPACINGS.indexOf(Number(o.spacing)) >= 0 ? Number(o.spacing) : DEFAULTS.spacing,
      sens: SENS.indexOf(Number(o.sens)) >= 0 ? Number(o.sens) : DEFAULTS.sens,
      fullRange: Boolean(o.fullRange),
      showMA: Boolean(o.showMA),
    };
  }

  function validate(bundle) {
    var rows = bundle && bundle.DATA;
    if (!Array.isArray(rows) || rows.length < 2) return "DATA 至少需要两根日K。";
    var prev = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!Array.isArray(r) || r.length < 6) return "第 " + (i + 1) + " 行格式应为 [日期, 开, 高, 低, 收, 量]。";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r[0])) return "第 " + (i + 1) + " 行日期无效。";
      if (prev && r[0] <= prev) return "第 " + (i + 1) + " 行日期必须晚于上一行。";
      prev = r[0];
      var o = r[1], h = r[2], l = r[3], c = r[4], v = r[5];
      if (![o, h, l, c, v].every(Number.isFinite)) return "第 " + (i + 1) + " 行价格或成交量不是数字。";
      if (l > h || l > Math.min(o, c) || h < Math.max(o, c)) return "第 " + (i + 1) + " 行高低价与开收不一致。";
      if (v < 0) return "第 " + (i + 1) + " 行成交量无效。";
    }
    return "";
  }

  // Left-side ties lose; right-side ties do not. The newest bar is never itself a pivot.
  function findPivots(rows, n) {
    var out = [];
    var len = rows.length;
    var wing = Number(n);
    for (var i = 0; i < len - 1; i++) {
      var a = Math.max(0, i - wing);
      var b = Math.min(len - 1, i + wing);
      var isHigh = true;
      var isLow = true;
      for (var j = a; j <= b; j++) {
        if (j === i) continue;
        var high = rows[j][2];
        var low = rows[j][3];
        if (j < i ? high >= rows[i][2] : high > rows[i][2]) isHigh = false;
        if (j < i ? low <= rows[i][3] : low < rows[i][3]) isLow = false;
      }
      if (isHigh) out.push({ i: i, kind: "high", price: rows[i][2], date: rows[i][0] });
      if (isLow) out.push({ i: i, kind: "low", price: rows[i][3], date: rows[i][0] });
    }
    return out;
  }

  function ma(rows, k) {
    return rows.map(function (_, i) {
      if (i < k - 1) return null;
      var s = 0;
      for (var j = i - k + 1; j <= i; j++) s += rows[j][4];
      return s / k;
    });
  }

  function xTicks(rows, sp) {
    var ticks = [];
    var lastTick = -99;
    var len = rows.length;
    var gap = Math.max(5, Math.ceil(48 / sp));
    rows.forEach(function (r, i) {
      var month = i > 0 && r[0].slice(5, 7) !== rows[i - 1][0].slice(5, 7);
      if (month) {
        ticks.push({ i: i, text: Number(r[0].slice(5, 7)) + "月", month: true });
        lastTick = i;
      } else if (i - lastTick >= gap && (i % 5 === 0 || i === len - 1)) {
        ticks.push({ i: i, text: md(r[0]), month: false });
        lastTick = i;
      }
    });
    return ticks;
  }

  function yOf(scene, price) {
    return scene.padTop + (scene.yMax - price) * scene.ppy;
  }

  function xOf(scene, i) {
    return scene.leftPad + (i + 0.5) * scene.sp;
  }

  function textWidth(text, size) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += text.charCodeAt(i) > 255 ? size : size * 0.62;
    return w;
  }

  function layoutLabels(items, gap) {
    var sorted = items.slice().sort(function (a, b) { return a.y - b.y; });
    var labs = [];
    for (var i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      var prev = labs[labs.length - 1];
      var ly = prev && item.y - prev.ly < gap ? prev.ly + gap : item.y;
      labs.push({ y: item.y, text: item.text, color: item.color, ly: ly });
    }
    return labs;
  }

  function buildScene(bundle, options) {
    var opt = optionsFrom(options);
    var rows = bundle.DATA;
    var n = rows.length;
    var rowPx = opt.density;
    var ppy = rowPx / GRID_STEP;
    var sp = opt.spacing;
    var dataMin = Math.min.apply(null, rows.map(function (r) { return r[3]; }));
    var dataMax = Math.max.apply(null, rows.map(function (r) { return r[2]; }));
    var yMin = opt.fullRange ? Math.floor(dataMin / 5) * 5 : FOCUS_MIN;
    var yMax = opt.fullRange ? Math.ceil(dataMax / 5) * 5 : FOCUS_MAX;
    if (yMax <= yMin) yMax = yMin + 5;
    var padTop = 14;
    var padBottom = 14;
    var plotH = (yMax - yMin) * ppy;
    var xAxisH = 30;
    var volH = 90;
    var volTop = padTop + plotH + padBottom + xAxisH;
    var leftPad = 6;
    var pivots = findPivots(rows, opt.sens);
    var yPrice = function (price) { return padTop + (yMax - price) * ppy; };
    var shownPivots = pivots.filter(function (p) { return p.price >= yMin && p.price <= yMax; });
    var keyLevels = Array.isArray(bundle.KEY_LEVELS) ? bundle.KEY_LEVELS : [];
    var manual = keyLevels.filter(function (k) {
      return k.price >= yMin && k.price <= yMax && !pivots.some(function (p) {
        return Math.abs(p.price - k.price) < 0.005 && p.date === k.date;
      });
    });
    var stacked = Boolean(options && options.layout === "stack");
    var labelGap = stacked ? 36 : 13;
    var raw = shownPivots.map(function (p) {
      return {
        y: yPrice(p.price),
        text: p.price.toFixed(2) + " " + md(p.date) + (p.kind === "high" ? "高" : "低"),
        color: p.kind === "high" ? UP : DOWN,
      };
    }).concat(manual.map(function (k) {
      return {
        y: yPrice(k.price),
        text: k.price.toFixed(2) + " " + md(k.date) + k.label,
        color: PALETTE.accent,
      };
    }));
    var labs = layoutLabels(raw, labelGap);
    var labelX = 54;
    var axisW = 128;
    labs.forEach(function (lab) {
      var piece = stacked ? lab.text.slice(lab.text.indexOf(" ") + 1) : lab.text;
      var size = stacked ? 10 : 10;
      axisW = Math.max(axisW, labelX + textWidth(piece, size) + 14);
    });
    axisW = Math.ceil(axisW);
    var levels = priceLevels(yMin, yMax, GRID_STEP);
    var last = rows[n - 1];
    var prevClose = n > 1 ? rows[n - 2][4] : last[1];
    return {
      n: n,
      ppy: ppy,
      rowPx: rowPx,
      step: GRID_STEP,
      sp: sp,
      sens: opt.sens,
      fullRange: opt.fullRange,
      showMA: opt.showMA,
      stacked: stacked,
      yMin: yMin,
      yMax: yMax,
      dataMin: dataMin,
      dataMax: dataMax,
      padTop: padTop,
      padBottom: padBottom,
      plotH: plotH,
      xAxisH: xAxisH,
      volH: volH,
      volTop: volTop,
      H: volTop + volH + 8,
      leftPad: leftPad,
      W: n * sp + leftPad * 2 + 4,
      axisW: axisW,
      labelX: labelX,
      levels: levels,
      pivots: pivots,
      shownPivots: shownPivots,
      manual: manual,
      labs: labs,
      ma5: ma(rows, 5),
      ma10: ma(rows, 10),
      ma20: ma(rows, 20),
      xTicks: xTicks(rows, sp),
      vmax: Math.max.apply(null, rows.map(function (r) { return r[5]; })),
      lastClose: last[4],
      lastUp: last[4] >= prevClose,
      bodyW: Math.max(1.5, sp * 0.68),
    };
  }

  function pointerToIndex(scene, px, py) {
    var i = Math.max(0, Math.min(scene.n - 1, Math.floor((px - scene.leftPad) / scene.sp)));
    var inPlot = py >= scene.padTop && py <= scene.padTop + scene.plotH;
    var hoverY = inPlot ? py : null;
    var price = hoverY == null ? null : scene.yMax - (hoverY - scene.padTop) / scene.ppy;
    return { i: i, hoverY: hoverY, price: price };
  }

  function maPath(scene, vals) {
    var d = "";
    var pen = false;
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] == null || !Number.isFinite(vals[i])) {
        pen = false;
        continue;
      }
      d += (pen ? "L" : "M") + fmt(xOf(scene, i)) + "," + fmt(yOf(scene, vals[i]));
      pen = true;
    }
    return d;
  }

  function mainSvg(bundle, scene) {
    var rows = bundle.DATA;
    var parts = [];
    var label = "恒瑞医药600276日K线，" + scene.yMin + "到" + scene.yMax + "元，最新收盘" + scene.lastClose.toFixed(2);
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + scene.W + '" height="' + scene.H + '" viewBox="0 0 ' + scene.W + " " + scene.H + '" role="img" aria-label="' + esc(label) + '" font-family="' + esc(FONT) + '">');
    parts.push("<title>" + esc(label) + "</title>");
    parts.push('<defs><clipPath id="hengrui-plot-clip"><rect x="0" y="' + scene.padTop + '" width="' + scene.W + '" height="' + scene.plotH + '"/></clipPath></defs>');
    scene.levels.forEach(function (p) {
      var y = fmt(yOf(scene, p));
      if (isMajorPrice(p)) {
        parts.push('<line class="grid grid-major" x1="0" x2="' + scene.W + '" y1="' + y + '" y2="' + y + '" stroke="' + PALETTE.gridMajor + '" stroke-width="1" stroke-opacity="0.8"/>');
      } else {
        parts.push('<line class="grid grid-minor" x1="0" x2="' + scene.W + '" y1="' + y + '" y2="' + y + '" stroke="' + PALETTE.gridMinor + '" stroke-width="0.8" stroke-dasharray="2 5"/>');
      }
    });
    scene.xTicks.forEach(function (t) {
      if (!t.month) return;
      var x = fmt(xOf(scene, t.i) - scene.sp / 2);
      parts.push('<line class="month" x1="' + x + '" x2="' + x + '" y1="' + scene.padTop + '" y2="' + (scene.volTop + scene.volH) + '" stroke="' + PALETTE.line + '" stroke-dasharray="1 4"/>');
    });
    scene.shownPivots.forEach(function (p) {
      var y = fmt(yOf(scene, p.price));
      var color = p.kind === "high" ? UP : DOWN;
      parts.push('<line class="pivot-line" data-kind="' + p.kind + '" data-price="' + p.price.toFixed(2) + '" x1="0" x2="' + scene.W + '" y1="' + y + '" y2="' + y + '" stroke="' + color + '" stroke-width="1" stroke-dasharray="6 4" stroke-opacity="0.75"/>');
    });
    scene.manual.forEach(function (k) {
      var y = fmt(yOf(scene, k.price));
      parts.push('<line class="manual-line" data-date="' + esc(k.date) + '" data-price="' + k.price.toFixed(2) + '" x1="0" x2="' + scene.W + '" y1="' + y + '" y2="' + y + '" stroke="' + PALETTE.accent + '" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.8"/>');
    });
    var yClose = fmt(yOf(scene, scene.lastClose));
    parts.push('<line class="last-close" x1="0" x2="' + scene.W + '" y1="' + yClose + '" y2="' + yClose + '" stroke="' + (scene.lastUp ? UP : DOWN) + '" stroke-width="1" stroke-dasharray="1 3" clip-path="url(#hengrui-plot-clip)"/>');
    parts.push('<g clip-path="url(#hengrui-plot-clip)">');
    rows.forEach(function (r, i) {
      var up = isUpCandle(r);
      var color = up ? UP : DOWN;
      var x = xOf(scene, i);
      var top = yOf(scene, Math.max(r[1], r[4]));
      var bot = yOf(scene, Math.min(r[1], r[4]));
      parts.push('<g class="candle" data-date="' + r[0] + '" data-up="' + (up ? "1" : "0") + '">');
      parts.push('<line x1="' + fmt(x) + '" x2="' + fmt(x) + '" y1="' + fmt(yOf(scene, r[2])) + '" y2="' + fmt(yOf(scene, r[3])) + '" stroke="' + color + '" stroke-width="1"/>');
      parts.push('<rect x="' + fmt(x - scene.bodyW / 2) + '" y="' + fmt(top) + '" width="' + fmt(scene.bodyW) + '" height="' + fmt(Math.max(1, bot - top)) + '" fill="' + color + '"/>');
      parts.push("</g>");
    });
    if (scene.showMA) {
      parts.push('<g class="mas" fill="none" stroke-width="1.2">');
      parts.push('<path class="ma ma5" d="' + maPath(scene, scene.ma5) + '" stroke="' + PALETTE.ma5 + '"/>');
      parts.push('<path class="ma ma10" d="' + maPath(scene, scene.ma10) + '" stroke="' + PALETTE.ma10 + '"/>');
      parts.push('<path class="ma ma20" d="' + maPath(scene, scene.ma20) + '" stroke="' + PALETTE.ma20 + '"/>');
      parts.push("</g>");
    }
    parts.push("</g>");
    scene.shownPivots.forEach(function (p) {
      var color = p.kind === "high" ? UP : DOWN;
      var cx = fmt(xOf(scene, p.i));
      var cy = fmt(yOf(scene, p.price));
      parts.push('<circle class="pivot-dot" data-date="' + p.date + '" cx="' + cx + '" cy="' + cy + '" r="3.2" fill="' + PALETTE.paper + '"/>');
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="2.2" fill="' + color + '"/>');
    });
    rows.forEach(function (r, i) {
      var x = xOf(scene, i);
      if (r[2] > scene.yMax) {
        parts.push('<path class="edge edge-up" data-date="' + r[0] + '" d="M' + fmt(x - 3) + "," + (scene.padTop - 2) + " L" + fmt(x + 3) + "," + (scene.padTop - 2) + " L" + fmt(x) + "," + (scene.padTop - 8) + ' Z" fill="' + PALETTE.tertiary + '"/>');
      }
      if (r[3] < scene.yMin) {
        var base = scene.padTop + scene.plotH;
        parts.push('<path class="edge edge-down" data-date="' + r[0] + '" d="M' + fmt(x - 3) + "," + (base + 2) + " L" + fmt(x + 3) + "," + (base + 2) + " L" + fmt(x) + "," + (base + 8) + ' Z" fill="' + PALETTE.tertiary + '"/>');
      }
    });
    scene.xTicks.forEach(function (t) {
      var fill = t.month ? PALETTE.secondary : PALETTE.tertiary;
      parts.push('<text class="xtick" x="' + fmt(xOf(scene, t.i)) + '" y="' + (scene.padTop + scene.plotH + scene.padBottom + 18) + '" text-anchor="middle" font-size="12" font-weight="' + (t.month ? "600" : "400") + '" fill="' + fill + '">' + esc(t.text) + "</text>");
    });
    parts.push('<line x1="0" x2="' + scene.W + '" y1="' + scene.volTop + '" y2="' + scene.volTop + '" stroke="' + PALETTE.line + '"/>');
    var vmax = scene.vmax || 1;
    rows.forEach(function (r, i) {
      var h = (r[5] / vmax) * (scene.volH - 6);
      var x = xOf(scene, i);
      parts.push('<rect class="vol" data-date="' + r[0] + '" x="' + fmt(x - scene.bodyW / 2) + '" y="' + fmt(scene.volTop + scene.volH - h) + '" width="' + fmt(scene.bodyW) + '" height="' + fmt(h) + '" fill="' + (isUpCandle(r) ? UP : DOWN) + '" opacity="0.7"/>');
    });
    parts.push('<g id="crosshair" visibility="hidden" pointer-events="none">');
    parts.push('<line id="cross-v" x1="0" x2="0" y1="' + scene.padTop + '" y2="' + (scene.volTop + scene.volH) + '" stroke="' + PALETTE.secondary + '" stroke-width="0.8" stroke-dasharray="3 3"/>');
    parts.push('<line id="cross-h" visibility="hidden" x1="0" x2="' + scene.W + '" y1="0" y2="0" stroke="' + PALETTE.secondary + '" stroke-width="0.8" stroke-dasharray="3 3"/>');
    parts.push("</g>");
    var anchorY = Math.max(scene.padTop, Math.min(scene.padTop + scene.plotH, yOf(scene, scene.lastClose)));
    parts.push('<rect id="anchor-close" x="' + fmt(xOf(scene, scene.n - 1) - 1) + '" y="' + fmt(anchorY - 1) + '" width="2" height="2" fill="none"/>');
    parts.push("</svg>");
    return parts.join("");
  }

  function axisSvg(scene) {
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + scene.axisW + '" height="' + scene.H + '" viewBox="0 0 ' + scene.axisW + " " + scene.H + '" font-family="' + esc(FONT) + '" aria-hidden="true">');
    var closeY = yOf(scene, scene.lastClose);
    var closeIn = scene.lastClose >= scene.yMin && scene.lastClose <= scene.yMax;
    scene.levels.forEach(function (p) {
      var y = yOf(scene, p);
      if (closeIn && Math.abs(y - closeY) < 12) return;
      if (isMajorPrice(p)) {
        parts.push('<text class="scale scale-major" x="6" y="' + fmt(y + 4) + '" font-size="12" font-weight="600" fill="' + PALETTE.ink + '">' + levelText(p) + "</text>");
      } else if (scene.rowPx >= 22) {
        parts.push('<text class="scale scale-minor" x="6" y="' + fmt(y + 3) + '" font-size="9" fill="' + PALETTE.tertiary + '" opacity="0.75">' + levelText(p) + "</text>");
      }
    });
    scene.labs.forEach(function (lab) {
      parts.push('<line x1="0" x2="46" y1="' + fmt(lab.y) + '" y2="' + fmt(lab.ly) + '" stroke="' + lab.color + '" stroke-width="0.8" opacity="0.6"/>');
      if (scene.stacked) {
        var cut = lab.text.indexOf(" ");
        var price = cut < 0 ? lab.text : lab.text.slice(0, cut);
        var rest = cut < 0 ? "" : lab.text.slice(cut + 1);
        parts.push('<text class="level-label" x="' + scene.labelX + '" y="' + fmt(lab.ly) + '" font-size="11" font-weight="700" fill="' + lab.color + '">' + esc(price) + "</text>");
        if (rest) parts.push('<text class="level-label" x="' + scene.labelX + '" y="' + fmt(lab.ly + 14) + '" font-size="10" fill="' + lab.color + '">' + esc(rest) + "</text>");
      } else {
        parts.push('<text class="level-label" x="' + scene.labelX + '" y="' + fmt(lab.ly + 4) + '" font-size="10" fill="' + lab.color + '">' + esc(lab.text) + "</text>");
      }
    });
    if (closeIn) {
      parts.push('<g class="close-badge"><rect x="2" y="' + fmt(closeY - 8) + '" width="50" height="16" rx="3" fill="' + (scene.lastUp ? UP : DOWN) + '"/><text x="27" y="' + fmt(closeY + 4) + '" text-anchor="middle" font-size="10" fill="#ffffff">' + scene.lastClose.toFixed(2) + "</text></g>");
    }
    parts.push('<g id="hover-tag" visibility="hidden"><rect x="2" y="0" width="50" height="16" rx="3" fill="' + PALETTE.ink + '"/><text x="27" y="4" text-anchor="middle" font-size="10" fill="' + PALETTE.paper + '">0</text></g>');
    parts.push('<text class="vol-max" x="6" y="' + (scene.volTop + 14) + '" font-size="10" fill="' + PALETTE.tertiary + '">量 ' + esc(volText(scene.vmax)) + "</text>");
    parts.push("</svg>");
    return parts.join("");
  }

  function quoteModel(bundle, scene, index) {
    var rows = bundle.DATA;
    var i = index == null ? rows.length - 1 : index;
    var cur = rows[i];
    var prev = i > 0 ? rows[i - 1][4] : null;
    var chg = prev == null ? null : (cur[4] / prev - 1) * 100;
    var color = chg == null ? PALETTE.ink : chg >= 0 ? UP : DOWN;
    return {
      index: i,
      date: cur[0],
      open: cur[1].toFixed(2),
      high: cur[2].toFixed(2),
      low: cur[3].toFixed(2),
      close: cur[4].toFixed(2),
      chg: chg,
      chgText: chg == null ? "—" : (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%",
      color: color,
      volumeText: volText(cur[5]),
      ma: [
        { n: 5, value: scene.ma5[i], color: "#2563eb" },
        { n: 10, value: scene.ma10[i], color: "#d97706" },
        { n: 20, value: scene.ma20[i], color: "#7c3aed" },
      ],
    };
  }

  function quoteHtml(q, showMA) {
    function field(k, v, color) {
      return "<span><em>" + esc(k) + "</em><b" + (color ? ' style="color:' + color + '"' : "") + ">" + esc(v) + "</b></span>";
    }
    var html = [
      field("日期", q.date),
      field("开", q.open),
      field("高", q.high),
      field("低", q.low),
      field("收", q.close, q.color),
      field("涨跌幅", q.chgText, q.color),
      field("成交量", q.volumeText),
    ].join("");
    if (showMA) {
      q.ma.forEach(function (item) {
        if (item.value == null) return;
        html += field("MA" + item.n, item.value.toFixed(2), item.color);
      });
    }
    return html;
  }

  function pivotTableRows(pivots, lastClose) {
    return pivots.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (p) {
      var inFocus = p.price >= FOCUS_MIN && p.price <= FOCUS_MAX;
      return {
        kind: p.kind,
        type: p.kind === "high" ? "阶段高点" : "阶段低点",
        date: p.date,
        price: p.price,
        priceText: p.price.toFixed(2),
        distanceText: ((p.price / lastClose - 1) * 100).toFixed(1) + "%",
        inFocus: inFocus,
        inFocusText: inFocus ? "是" : "否（区间外）",
      };
    });
  }

  function pivotNote(levels) {
    var bits = (levels || []).map(function (k) { return md(k.date) + " " + k.label + " " + Number(k.price).toFixed(2); });
    var extra = bits.length ? "并另外补画手工关注价位：" + bits.join("、") + "。" : "未设置手工关注价位。";
    return "识别规则：某日最高价（或最低价）是前后各 N 个交易日内的最高（或最低），即记为阶段高点（或低点），N 随上方灵敏度切换；最新一根K线不参与判断。图中只画落在当前显示区间内的点，" + extra;
  }

  function sampleText(bundle) {
    var last = bundle.DATA[bundle.DATA.length - 1];
    return 'const AS_OF = "' + bundle.AS_OF + '";\n// ["日期", 开盘, 最高, 最低, 收盘, 成交量(股)]\n["' + last[0] + '", ' + last[1] + ", " + last[2] + ", " + last[3] + ", " + last[4] + ", " + last[5] + "],";
  }

  PALETTE.ma5 = "#2563eb";
  PALETTE.ma10 = "#d97706";
  PALETTE.ma20 = "#7c3aed";

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      UP: UP, DOWN: DOWN, FOCUS_MIN: FOCUS_MIN, FOCUS_MAX: FOCUS_MAX, GRID_STEP: GRID_STEP, DEFAULTS: DEFAULTS, PALETTE: PALETTE, SOURCE_URL: SOURCE_URL,
      isMajorPrice: isMajorPrice, levelText: levelText, priceLevels: priceLevels,
      findPivots: findPivots, ma: ma, volText: volText, md: md, validate: validate, isUpCandle: isUpCandle,
      buildScene: buildScene, mainSvg: mainSvg, axisSvg: axisSvg, quoteModel: quoteModel, quoteHtml: quoteHtml,
      pointerToIndex: pointerToIndex, yOf: yOf, xOf: xOf, fmt: fmt, pivotTableRows: pivotTableRows, pivotNote: pivotNote,
    };
    return;
  }

  function mount() {
    var bundle = window.HENGRUI_DATA;
    var errorEl = document.getElementById("error");
    function fail(message) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = message;
      }
    }
    if (!bundle) {
      fail("没有读到 data.js。");
      return;
    }
    var problem = validate(bundle);
    if (problem) {
      fail(problem);
      return;
    }

    var state = {
      density: DEFAULTS.density,
      spacing: DEFAULTS.spacing,
      sens: DEFAULTS.sens,
      fullRange: DEFAULTS.fullRange,
      showMA: DEFAULTS.showMA,
      layout: window.matchMedia("(max-width: 720px)").matches ? "stack" : "inline",
      hover: null,
      hoverY: null,
    };
    var scene = null;
    var chartScroll = document.getElementById("chart-scroll");
    var chartSvg = document.getElementById("chart-svg");
    var chartAxis = document.getElementById("chart-axis");
    var quoteEl = document.getElementById("quote");
    var narrowMedia = window.matchMedia("(max-width: 720px)");

    function renderCopy() {
      var first = bundle.DATA[0][0];
      var lastDate = bundle.DATA[bundle.DATA.length - 1][0];
      document.getElementById("subtitle").textContent = "日K线 · " + first + " 至 " + lastDate;
      document.getElementById("asof").textContent = "截至 " + bundle.AS_OF + " 收盘";
      document.getElementById("summary").textContent = "数据截至 " + bundle.AS_OF + " 收盘，前复权（最新价即成交价，除息日前的价格已扣去其后现金红利）。默认只看 " + FOCUS_MIN + "–" + FOCUS_MAX + " 元，每 " + stepLabel() + " 元一格：逢 0、5 为实线，其余为淡虚线；红涨绿跌，阶段高低点自动画成虚线方便对齐。";
      document.getElementById("range-label").textContent = scene.fullRange ? "完整区间 " + scene.yMin + "–" + scene.yMax + " 元" : scene.yMin + "–" + scene.yMax + " 元";
      var meta = "共 " + scene.n + " 根日K，" + first + " 至 " + lastDate + "，来源 " + SOURCE_NAME + "。成交量是新浪当日成交股数，页面按 100 股为 1 手换算成万手。";
      if (bundle.AS_OF !== lastDate) meta += " AS_OF（" + bundle.AS_OF + "）与最后一根K线日期不一致，请检查 data.js。";
      document.getElementById("data-meta").textContent = meta;
      document.getElementById("sample").textContent = sampleText(bundle);
      document.getElementById("pivot-note").textContent = pivotNote(bundle.KEY_LEVELS);
      var link = document.getElementById("source-link");
      if (link) link.href = SOURCE_URL;
    }

    function renderTable() {
      var rows = pivotTableRows(scene.pivots, scene.lastClose);
      var body = document.getElementById("pivot-body");
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5">当前灵敏度下没有阶段高低点。</td></tr>';
        return;
      }
      body.innerHTML = rows.map(function (r) {
        var tone = r.kind === "high" ? "up" : "down";
        return "<tr><td class=\"kind " + tone + "\">" + esc(r.type) + "</td><td>" + esc(r.date) + "</td><td>" + esc(r.priceText) + "</td><td>" + esc(r.distanceText) + "</td><td>" + esc(r.inFocusText) + "</td></tr>";
      }).join("");
    }

    function syncControls() {
      document.querySelectorAll("#toolbar button[data-set]").forEach(function (btn) {
        var key = btn.dataset.set;
        var on = key === "fullRange" || key === "showMA" ? state[key] : state[key] === Number(btn.dataset.value);
        btn.setAttribute("aria-pressed", String(Boolean(on)));
      });
      document.querySelectorAll(".ma-key").forEach(function (el) { el.hidden = !state.showMA; });
    }

    function syncScrollHint() {
      chartScroll.classList.toggle("can-left", chartScroll.scrollLeft > 8);
    }

    function paintHover() {
      var q = quoteModel(bundle, scene, state.hover == null ? scene.n - 1 : state.hover);
      quoteEl.innerHTML = quoteHtml(q, state.showMA);
      var cross = document.getElementById("crosshair");
      var crossV = document.getElementById("cross-v");
      var crossH = document.getElementById("cross-h");
      var hoverTag = document.getElementById("hover-tag");
      if (cross && crossV && crossH) {
        if (state.hover == null) {
          cross.setAttribute("visibility", "hidden");
        } else {
          var x = fmt(xOf(scene, state.hover));
          cross.setAttribute("visibility", "visible");
          crossV.setAttribute("x1", x);
          crossV.setAttribute("x2", x);
          if (state.hoverY == null) crossH.setAttribute("visibility", "hidden");
          else {
            var y = fmt(state.hoverY);
            crossH.setAttribute("visibility", "visible");
            crossH.setAttribute("y1", y);
            crossH.setAttribute("y2", y);
          }
        }
      }
      if (!hoverTag) return;
      if (state.hoverY == null) {
        hoverTag.setAttribute("visibility", "hidden");
        return;
      }
      var price = scene.yMax - (state.hoverY - scene.padTop) / scene.ppy;
      hoverTag.setAttribute("visibility", "visible");
      var rect = hoverTag.querySelector("rect");
      var text = hoverTag.querySelector("text");
      rect.setAttribute("y", fmt(state.hoverY - 8));
      text.setAttribute("y", fmt(state.hoverY + 4));
      text.textContent = price.toFixed(2);
    }

    function revealLatest() {
      var pin = function () { chartScroll.scrollLeft = chartScroll.scrollWidth; };
      pin();
      var anchor = document.getElementById("anchor-close");
      if (anchor && anchor.getBoundingClientRect) {
        var rect = anchor.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          anchor.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
          pin();
        }
      }
      syncScrollHint();
    }

    function paintFull(opts) {
      var left = chartScroll.scrollLeft;
      scene = buildScene(bundle, state);
      chartSvg.innerHTML = mainSvg(bundle, scene);
      chartAxis.innerHTML = axisSvg(scene);
      renderCopy();
      renderTable();
      syncControls();
      if (opts.pinX) chartScroll.scrollLeft = chartScroll.scrollWidth;
      else chartScroll.scrollLeft = left;
      paintHover();
      syncScrollHint();
      if (opts.pinY) revealLatest();
    }

    function onPointer(e) {
      var svg = chartSvg.querySelector("svg");
      if (!svg) return;
      var rect = svg.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) return;
      var hit = pointerToIndex(scene, px, py);
      state.hover = hit.i;
      state.hoverY = hit.hoverY;
      paintHover();
      if (e.type === "pointerdown") chartScroll.focus({ preventScroll: true });
    }

    chartScroll.addEventListener("pointermove", onPointer);
    chartScroll.addEventListener("pointerdown", onPointer);
    chartScroll.addEventListener("pointerleave", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      state.hover = null;
      state.hoverY = null;
      paintHover();
    });
    chartScroll.addEventListener("scroll", syncScrollHint, { passive: true });
    chartScroll.addEventListener("keydown", function (e) {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) < 0) return;
      e.preventDefault();
      var i = state.hover == null ? scene.n - 1 : state.hover;
      if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
      else if (e.key === "ArrowRight") i = Math.min(scene.n - 1, i + 1);
      else if (e.key === "Home") i = 0;
      else i = scene.n - 1;
      state.hover = i;
      state.hoverY = null;
      paintHover();
      var x = xOf(scene, i);
      var view = chartScroll.clientWidth;
      if (x < chartScroll.scrollLeft + 24 || x > chartScroll.scrollLeft + view - 24) {
        chartScroll.scrollLeft = Math.max(0, x - view * 0.5);
      }
      syncScrollHint();
    });

    document.getElementById("toolbar").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-set]");
      if (!btn) return;
      var key = btn.dataset.set;
      if (key === "fullRange" || key === "showMA") state[key] = !state[key];
      else state[key] = Number(btn.dataset.value);
      paintFull({
        pinX: key === "density" || key === "spacing" || key === "fullRange",
        pinY: key === "density" || key === "fullRange",
      });
    });
    document.getElementById("jump-latest").addEventListener("click", function () {
      state.hover = null;
      state.hoverY = null;
      paintHover();
      revealLatest();
    });

    function applyLayout() {
      var next = narrowMedia.matches ? "stack" : "inline";
      if (next === state.layout) return;
      var atEnd = chartScroll.scrollWidth - chartScroll.scrollLeft - chartScroll.clientWidth < 24;
      state.layout = next;
      var ratio = chartScroll.scrollWidth ? chartScroll.scrollLeft / chartScroll.scrollWidth : 1;
      paintFull({ pinX: false, pinY: false });
      chartScroll.scrollLeft = atEnd ? chartScroll.scrollWidth : ratio * chartScroll.scrollWidth;
      syncScrollHint();
    }
    if (narrowMedia.addEventListener) narrowMedia.addEventListener("change", applyLayout);
    else if (narrowMedia.addListener) narrowMedia.addListener(applyLayout);

    paintFull({ pinX: true, pinY: true });
  }

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
    else mount();
  } catch (error) {
    var node = document.getElementById("error");
    if (node) {
      node.hidden = false;
      node.textContent = "图表未能绘制：" + error.message;
    }
  }
})();
