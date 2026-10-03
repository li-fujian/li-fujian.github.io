(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formats=new Map();
const fixed=(x,n=2)=>{if(!Number.isFinite(x))return '—';if(!formats.has(n))formats.set(n,new Intl.NumberFormat('en-US',{minimumFractionDigits:n,maximumFractionDigits:n,useGrouping:false}));return formats.get(n).format(x);};
const signed=x=>(x>0?'+':'')+fixed(x);
const tone=x=>x>0?'up':x<0?'down':'';
const billionCny=x=>fixed(x/100000);
function freshness(meta,cal,now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 let ds=`${p.year}-${p.month}-${p.day}`,day=new Date(ds+'T00:00:00Z');
 const supported=d=>cal.years.includes(Number(d.slice(0,4)));
 const session=d=>![0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())&&!cal.holidays.includes(d);
 if(!supported(ds))return{ok:false,label:'交易日历待更新',expected:null};
 const ready=cal.half_days.includes(ds)?735:975;
 if(!session(ds)||Number(p.hour)*60+Number(p.minute)<ready){do{day.setUTCDate(day.getUTCDate()-1);ds=day.toISOString().slice(0,10);if(!supported(ds))return{ok:false,label:'交易日历待更新',expected:null};}while(!session(ds));}
 const ok=meta.as_of===ds;return{ok,expected:ds,label:ok?'已对账 · 最近收盘':'行情待更新'};
}
function financialRows(f){return[['revenue','收入'],['operating_profit','经营利润'],['net_profit','期内利润'],['adjusted_net_profit','经调整净利润（非IFRS）']].map(([key,label])=>{const q=f.quarter[key],p=f.prior_quarter_year[key],h=f.half_year[key];return`<tr><td>${label}</td><td>${billionCny(q)}</td><td>${billionCny(p)}</td><td>${f.reported_yoy_pct[key]===null?'nm（公告）':fixed(f.reported_yoy_pct[key],1)+'%'}</td><td class="${h<0?'down':''}">${billionCny(h)}</td></tr>`;}).join('');}
function chartSVG(data,count,type='price'){
 const rows=data.chart.weekly.slice(-count),n=rows.length,ind=Object.fromEntries(Object.entries(data.chart.indicators).map(([k,v])=>[k,v.slice(-count)]));
 const W=740,H=type==='price'?350:190,L=51,R=16,top=14,bottom=type==='price'?240:151,step=(W-L-R)/n,x=i=>L+step*(i+.5);
 const vals=type==='price'?rows.flatMap((r,i)=>[r.high,r.low,ind.ma20[i],ind.ma30[i],ind.ma60[i]].filter(Number.isFinite)):[0,...ind.hist,...ind.dif,...ind.dea];
 let low=Math.min(...vals),high=Math.max(...vals),pad=(high-low)*.09||1;low-=pad;high+=pad;
 const y=v=>bottom-(v-low)/(high-low)*(bottom-top);
 let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${type==='price'?'不复权周K与成交量':'周线MACD'}，${rows[0].date}至${rows[n-1].date}"><title>${type==='price'?'周线价格与成交量':'MACD动能'}</title>`;
 for(let i=0;i<5;i++){const v=low+(high-low)*i/4,py=y(v);s+=`<path d="M${L},${py}H${W-R}" stroke="#e3e6de"/><text x="${L-7}" y="${py+4}" text-anchor="end">${fixed(v,1)}</text>`;}
 const line=(values,color)=>`<polyline fill="none" stroke="${color}" stroke-width="1.6" points="${values.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:'').join(' ')}"/>`;
 if(type==='price'){
  const vmax=Math.max(...rows.map(r=>r.volume));s+=`<text x="${L}" y="267">成交量 / 百万股（最高 ${fixed(vmax/1e6,1)}）</text>`;
  rows.forEach((r,i)=>{const color=r.close>=r.open?'#b83b35':'#227250',cx=x(i),cw=Math.max(2,step*.57),partial=!data.meta.latest_week_complete&&i===n-1;
   s+=`<g opacity="${partial?.5:1}"><title>${r.date}${partial?'（未收官）':''} 开 ${fixed(r.open)} 高 ${fixed(r.high)} 低 ${fixed(r.low)} 收 ${fixed(r.close)} 量 ${fixed(r.volume/1e6,2)} 百万股</title><path d="M${cx},${y(r.high)}V${y(r.low)}" stroke="${color}"/><rect x="${cx-cw/2}" y="${Math.min(y(r.open),y(r.close))}" width="${cw}" height="${Math.max(1,Math.abs(y(r.close)-y(r.open)))}" fill="${color}"/><rect x="${cx-cw/2}" y="${320-r.volume/vmax*43}" width="${cw}" height="${r.volume/vmax*43}" fill="${color}" opacity=".5"/></g>`;});
  s+=line(ind.ma20,'#ac7719')+line(ind.ma30,'#367b97')+line(ind.ma60,'#756397');
 }else{
  s+=`<path d="M${L},${y(0)}H${W-R}" stroke="#aeb7ab"/>`;
  ind.hist.forEach((v,i)=>{s+=`<rect x="${x(i)-step*.28}" y="${Math.min(y(v),y(0))}" width="${Math.max(2,step*.56)}" height="${Math.max(.5,Math.abs(y(v)-y(0)))}" fill="${v>=0?'#b83b35':'#227250'}"><title>${rows[i].date} 柱 ${fixed(v,3)} DIF ${fixed(ind.dif[i],3)} DEA ${fixed(ind.dea[i],3)}</title></rect>`;});
  s+=line(ind.dif,'#ac7719')+line(ind.dea,'#367b97');s+='<text x="55" y="186">金色 DIF · 蓝色 DEA</text>';
 }
 for(let i=0;i<5;i++){const idx=Math.round((n-1)*i/4);s+=`<text x="${x(idx)}" y="${type==='price'?342:170}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${rows[idx].date.slice(2)}</text>`;}
 return s+'</svg>';
}
if(typeof module!=='undefined'&&module.exports){module.exports={freshness,financialRows,chartSVG,billionCny,fixed};return;}
const $=id=>document.getElementById(id);
function render(){
 const d=window.MEITUAN_DASHBOARD;if(!d||d.schema_version!==1||d.audit.status!=='passed'||!Number.isFinite(d.quote.close))throw new Error('未找到通过校验的数据。请稍后刷新。');
 const m=d.meta,q=d.quote,t=d.technical,f=d.fundamentals,fresh=freshness(m,d.calendar);
 $('freshness').textContent=fresh.label;$('freshness').classList.toggle('warn',!fresh.ok);$('asof').textContent=`行情 ${m.as_of} · 港元 / ${m.price_basis}`;
 $('verdictTitle').textContent=fresh.ok?t.trend:`行情待更新 · 保存状态：${t.trend}`;
 $('verdictBody').textContent=`${m.note} ${t.macd}。${fresh.ok?'':`应有收盘数据：${fresh.expected||'请先补充交易日历'}；下列数值保留原日期。`}`;
 if(t.legacy_failure){$('legacyNotice').hidden=false;$('legacyNotice').textContent=`历史判断已失效：${t.legacy_failure.date} 周收盘 ${fixed(t.legacy_failure.close)}，首次跌破旧框架 71.80 失效线。旧“上升初期”、80–84 买区和分批加仓方案已撤出当前页面；71.80 仅用于历史复盘。`;}
 const metrics=[
 {label:`收盘 / ${m.as_of}`,value:fixed(q.close),sub:`较前一交易日 ${signed(q.change)} / ${signed(q.change_pct)}%`,cls:tone(q.change)},
 {label:`周涨跌 / ${m.confirmed_week}`,value:signed(t.weekly_change_pct)+'%',sub:`周收盘 ${fixed(t.weekly.close)} 港元`,cls:tone(t.weekly_change_pct)},
 {label:'与 60 周均线距离',value:signed((t.weekly.close/t.ma60-1)*100)+'%',sub:`MA60 ${fixed(t.ma60)} · 已收官口径`,cls:tone(t.weekly.close-t.ma60)},
 {label:'本周日均量 / 前20周日均量',value:fixed(t.daily_volume_vs_prior20weeks)+'×',sub:`本周 ${t.week_sessions} 个交易日 · 已剔除整日休市`,cls:''}];
 $('kpis').innerHTML=metrics.map(k=>`<div class="kpi"><div class="label">${esc(k.label)}</div><div class="value ${k.cls}">${esc(k.value)}</div><div class="sub">${esc(k.sub)}</div></div>`).join('');
 $('weekDate').textContent=`截至 ${m.confirmed_week}，周收盘 ${fixed(t.weekly.close)}`;
 $('maRows').innerHTML=[5,10,20,30,60].map(n=>`<tr><td>MA${n}</td><td>${fixed(t['ma'+n])}</td><td>${t.weekly.close>t['ma'+n]?'上方':t.weekly.close<t['ma'+n]?'下方':'持平'}</td></tr>`).join('');
 $('macdState').textContent=`${t.macd}。DIF ${fixed(t.dif,3)} / DEA ${fixed(t.dea,3)} / 柱 ${fixed(t.hist,3)}。`;
 $('volumeState').textContent=`周量 ${fixed(t.weekly.volume/1e8)} 亿股；日均量为此前20个完整周日均量的 ${fixed(t.daily_volume_vs_prior20weeks)} 倍。量能变化不等于资金买入或卖出方向。`;
 $('financialSource').href=f.source_url;
 const days=Math.floor((Date.now()-Date.parse(f.verified_at+'T00:00:00+08:00'))/86400000);
 $('financialDates').textContent=`单位：人民币亿元 · 报告期截至 ${f.period_end} · 公告 ${f.published_at} · 人工核验 ${f.verified_at} · 未经审核${days>90?' · 财报核验已超过90天，需复核后续公告':''}`;
 $('financialRows').innerHTML=financialRows(f);$('financialState').textContent=f.interpretation;
 $('segmentState').textContent=`二季度核心本地商业：收入 ${billionCny(f.segments.core_local_revenue)} 亿元，经营利润 ${billionCny(f.segments.core_local_operating_profit)} 亿元；新业务经营亏损 ${billionCny(-f.segments.new_operating_profit)} 亿元。分部口径来自公告第3页。`;
 $('auditState').textContent=`本次生成 ${m.generated_at.replace('T',' ')}；原始日线 ${m.daily_rows} 根、周线 ${m.weekly_rows} 根；${d.audit.daily_weekly_matched} 个重叠周的OHLC和成交量聚合一致。腾讯与新浪最新快照的${d.audit.quote_fields_matched.join('、')}一致。`;
 $('sourceList').innerHTML=d.audit.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> · <a href="data/raw/${esc(s.name)}">本次原始快照</a></li>`).join('')+`<li><a href="${esc(d.calendar.source)}" target="_blank" rel="noopener noreferrer">港交所2026年交易日历</a></li><li><a href="${esc(f.local_source)}">本地保存的公司二季报原件</a>（第1–3页）</li>`;
 $('methodNote').textContent='价格采用腾讯不复权周线；成交量为股。均线为简单移动平均，MACD从完整历史递推，未收官周只展示。工作日收盘后尝试更新，任何日期、价格或聚合校验失败都保留上一份页面数据；页面另行检查是否过期。';
 $('limitations').innerHTML=d.audit.limitations.map(x=>`<li>${esc(x)}</li>`).join('');
 function charts(count){$('priceChart').innerHTML=chartSVG(d,count);$('macdChart').innerHTML=chartSVG(d,count,'macd');const rows=d.chart.weekly.slice(-count);$('chartScope').textContent=`${rows[0].date} — ${rows.at(-1).date} · ${rows.length} 根周K · 不复权港元 / 成交量为股${m.latest_week_complete?'':' · 末根浅色K线尚未收官'}。鼠标停留K线可查看原值。`;document.querySelectorAll('[data-weeks]').forEach(b=>{const active=Number(b.dataset.weeks)===count;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
 document.querySelectorAll('[data-weeks]').forEach(b=>b.addEventListener('click',()=>charts(Number(b.dataset.weeks))));charts(52);
}
try{render();}catch(error){$('error').hidden=false;$('error').textContent=`数据暂不可用：${error.message}`;$('verdictTitle').textContent='请等待数据核验';$('freshness').textContent='数据未通过页面检查';$('freshness').classList.add('warn');}
})();
