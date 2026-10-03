const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {freshness,financialRows,chartSVG,billionCny,fixed}=require('../assets/app.js');
const d=JSON.parse(fs.readFileSync(path.join(root,'data/dashboard.json'),'utf8'));
const meta={as_of:'2026-10-02'};
test('Hong Kong freshness respects October 2 session and unknown calendar',()=>{
 assert.equal(freshness(meta,d.calendar,new Date('2026-10-03T00:00:00+08:00')).ok,true);
 assert.equal(freshness(meta,d.calendar,new Date('2026-10-05T17:00:00+08:00')).ok,false);
 assert.equal(freshness(meta,d.calendar,new Date('2026-10-01T17:00:00+08:00')).expected,'2026-09-30');
 assert.equal(freshness(meta,d.calendar,new Date('2027-01-04T17:00:00+08:00')).expected,null);
 assert.equal(freshness(meta,d.calendar,new Date('2026-02-16T12:16:00+08:00')).expected,'2026-02-16');
});
test('RMB units and quarterly/half-year signs stay separate',()=>{
 assert.equal(billionCny(104643044),'1046.43');assert.equal(billionCny(-4672036),'-46.72');
 const rows=financialRows(d.fundamentals);assert.match(rows,/21.55/);assert.match(rows,/-46.72/);assert.match(rows,/69.0%/);assert.match(rows,/nm（公告）/);assert.equal(fixed(80.115),'80.12');
});
test('every chart range has finite coordinates and actual dates',()=>{
 for(const n of [26,52,100])for(const type of ['price','macd']){
  const svg=chartSVG(d,n,type);assert.doesNotMatch(svg,/NaN|Infinity|undefined/);assert.match(svg,new RegExp(d.chart.weekly.at(-1).date));
 }
});
test('browser wrapper and JSON are exactly equal',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'data/dashboard.js'),'utf8'),context);
 assert.equal(JSON.stringify(context.window.MEITUAN_DASHBOARD),JSON.stringify(d));
});
test('page IDs match renderer and local resources exist',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),js=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(id),id);
 for(const [,url] of html.matchAll(/(?:src|href)="([^"]+)"/g))if(!/^(https?:|#)/.test(url))assert.ok(fs.existsSync(path.resolve(root,url)),url);
 assert.doesNotMatch(html,/echarts|dashboard_config|trading_data|updates\/2026/);
});
