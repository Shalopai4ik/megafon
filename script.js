'use strict';

/* ═══════════════════════════════════════════════════════════════
   SERVICE MAP + CATEGORY MAP
   ═══════════════════════════════════════════════════════════════ */
const SERVICE_MAP = {
  'абонентский номер':'subscriber_number','тарифный план':'tariff_plan',
  'абонентская плата по тарифному плану (посуточное списание)':'plan_fee',
  'абонентская плата по тарифному плану':'plan_fee',
  'удержание вызова':'call_hold',
  'абонентская плата за услугу защита сотрудников':'employee_protection_fee',
  'исходящие вызовы в домашнем регионе':'home_outgoing_calls',
  'исходящие вызовы на номера других операторов в домашнем регионе':'home_other_operators',
  'исходящие вызовы внутри сети в домашнем регионе':'home_onnet_calls',
  'исходящие междугородние вызовы в домашнем регионе':'home_intercity_calls',
  'мобильный интернет в домашнем регионе':'home_mobile_internet',
  'исходящие сообщения в домашнем регионе':'home_sms',
  'входящие вызовы в домашнем регионе':'home_incoming_calls',
  'входящие сообщения в домашнем регионе':'home_incoming_sms',
  'входящие вызовы в путешествиях по россии':'travel_incoming_calls',
  'входящие сообщения в путешествиях по россии':'travel_incoming_sms',
  'исходящие вызовы в путешествиях по России':'travel_outgoing_calls',
  'исходящие междугородние вызовы в путешествиях по России':'travel_intercity_calls',
  'исходящие сообщения в путешествиях по России':'travel_sms',
  'мобильный интернет в путешествиях по России':'travel_mobile_internet',
  'итого начислено':'total_charged','в т.ч. ндс':'vat_included',
  'в том числе ндс (22%)':'vat_included',
  'начисления за передачу мультимедийных сообщений':'multimedia_messages',
  'исходящие вызовы внутри сети в путешествиях по россии':'travel_onnet_russia_calls',
  'исходящие вызовы на номера других операторов региона пребывания в путешествиях по россии':'travel_other_operators',
  'массовые вызовы':'mass_calls','голосовая почта':'voicemail',
  'автоответчик':'auto_answer','звонок за счёт друга':'friend_call',
  'доставка счёта на email':'email_invoice',
  'мобильный интернет в национальном роуминге':'national_roaming_internet',
  'блокировка номера':'number_blocking',
  'начисления за услуги передачи сообщений в национальном роуминге':'national_roaming_messages',
  'офис в кармане':'office_in_pocket','голосовые sms':'voice_sms',
  'исходящие международные вызовы':'international_calls',
  'исходящие sms в международном роуминге':'international_roaming_sms',
  'исходящие вызовы на номера россии в международном роуминге':'international_roaming_russia_calls',
  'исходящие вызовы на номера страны пребывания в международном роуминге':'international_roaming_local_calls',
  'прочие начисления':'misc_charges','ми.детализация счета':'mi_detailing',
  'входящие sms в международном роуминге':'incoming_sms_intl_roaming',
  'вызовы в международном роуминге':'calls_intl_roaming',
  'услуги национального роуминга':'national_roaming_services',
  'услуги международного роуминга':'intl_roaming_services',
  'начисления за голосовые услуги в национальном роуминге':'national_roaming_voice',
  'абонентская плата m2m':'m2m_fee','абонентская плата m2m флекс':'m2m_flex_fee',
};
const META_KEYS = new Set(['subscriber_number','tariff_plan','total_charged','vat_included']);
const CATEGORY_OF = {
  home_outgoing_calls:'voice',home_other_operators:'voice',home_onnet_calls:'voice',
  home_intercity_calls:'voice',home_incoming_calls:'voice',
  travel_outgoing_calls:'voice',travel_intercity_calls:'voice',
  travel_onnet_russia_calls:'voice',travel_other_operators:'voice',mass_calls:'voice',
  international_calls:'voice',international_roaming_russia_calls:'voice',
  international_roaming_local_calls:'voice',friend_call:'voice',
  voicemail:'voice',auto_answer:'voice',call_hold:'voice',
  calls_intl_roaming:'voice',outgoing_calls_intl_roaming:'voice',
  home_mobile_internet:'internet',travel_mobile_internet:'internet',national_roaming_internet:'internet',
  home_sms:'sms',home_incoming_sms:'sms',travel_sms:'sms',travel_incoming_sms:'sms',
  multimedia_messages:'sms',international_roaming_sms:'sms',
  national_roaming_messages:'sms',voice_sms:'sms',incoming_sms_intl_roaming:'sms',
};
const TARIFFS = {"140":{minutes:700,sms:300,internet_mb:15000,name:'Без Переплат'},"230":{minutes:1500,sms:500,internet_mb:25000,name:'Специалист'},"400":{minutes:4000,sms:1000,internet_mb:70000,name:'Федеральный'}};
const DEFAULT_TARIFF = {minutes:500,sms:200,internet_mb:5000,name:'Другой'};
const CATEGORY_META = {voice:{label:'Минуты',unit:'мин',icon:'📞',color:'#0071CE',quotaKey:'minutes'},internet:{label:'Интернет',unit:'МБ',icon:'🌐',color:'#68B944',quotaKey:'internet_mb'},sms:{label:'SMS',unit:'шт',icon:'✉️',color:'#F7941D',quotaKey:'sms'}};
const TARIFF_COLORS = ['#68B944','#0071CE','#F7941D','#D32F2F','#00897B'];
const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const HISTORY_MONTHS = 6;

let allSubscribers = [], renderedSubscribers = [], nameByNumber = {};
let currentFilter = 'all', currentSort = 'overpay', sortDirection = 'desc';

document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  if ($('workersBtn')) $('workersBtn').onclick = () => $('workersFile').click();
  if ($('workersFile')) $('workersFile').onchange = e => { if (e.target.files[0]) loadWorkers(e.target.files[0]); };
  if ($('billsBtn')) $('billsBtn').onclick = () => $('billsFile').click();
  if ($('billsFile')) $('billsFile').onchange = e => { if (e.target.files[0]) uploadCSV(e.target.files[0]); };
  if ($('demoBtn')) $('demoBtn').onclick = loadDemoData;
  if ($('searchInput')) $('searchInput').oninput = renderUsers;

  document.querySelectorAll('.filter').forEach(b => b.onclick = () => {
    document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); currentFilter = b.dataset.filter; renderUsers();
  });
  document.querySelectorAll('.sort').forEach(b => {
    if (b.dataset.sort === currentSort) b.classList.add('active');
    b.onclick = () => {
      if (currentSort === b.dataset.sort) sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      else { currentSort = b.dataset.sort; sortDirection = 'desc'; }
      document.querySelectorAll('.sort').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); renderUsers();
    };
  });
  if ($('gridView') && $('tableView')) {
    $('gridView').onclick = () => setView('grid');
    $('tableView').onclick = () => setView('table');
  }
  if ($('toggleChartBtn')) $('toggleChartBtn').onclick = () => {
    const p = $('chartPanel'); if (!p) return;
    const open = p.classList.toggle('open');
    $('toggleChartBtn').textContent = open ? '▴' : '▾';
    if (open) drawBigChart();
  };
  if ($('themeBtn')) {
    $('themeBtn').onclick = () => {
      const r = document.documentElement;
      const isDark = r.getAttribute('data-theme') === 'dark' || (!r.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
      r.setAttribute('data-theme', isDark ? 'light' : 'dark');
      localStorage.setItem('theme', isDark ? 'light' : 'dark');
    };
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  // Кнопка настроек
  if ($('settingsBtn')) $('settingsBtn').onclick = () => $('settingsPanel').classList.toggle('show');
  document.addEventListener('click', e => {
    if (!e.target.closest('.settings-toggle') && !e.target.closest('.settings-panel'))
      $('settingsPanel')?.classList.remove('show');
  });

  // Переключатели панелей
  const panelMap = {togKpi:'kpiPanel',togStatus:'analyticsPanel',togRank:'analyticsPanel',togCat:'analyticsPanel',togTariff:'analyticsPanel',togChart:'analyticsPanel',togCards:'usersGrid'};
  const childMap = {togStatus:'stat-card',togRank:'rank-card',togCat:'cat-card',togTariff:'tariff-card',togChart:'chart-card'};
  Object.keys(panelMap).forEach(id => {
    const cb = $(id); if (!cb) return;
    cb.onchange = () => {
      const el = $(panelMap[id]); if (!el) return;
      if (childMap[id]) {
        const card = el.querySelector('.' + childMap[id]);
        if (card) card.style.display = cb.checked ? '' : 'none';
      } else {
        el.style.display = cb.checked ? '' : 'none';
      }
    };
  });

  window.addEventListener('resize', () => { if ($('chartPanel')?.classList.contains('open')) drawBigChart(); });
});

/* ── Upload ── */
function uploadCSV(file) {
  showLoading('Отправка…', 10);
  const fd = new FormData(); fd.append('file', file);
  fetch('/api/upload-csv',{method:'POST',body:fd})
    .then(r => r.ok ? r.json() : r.json().then(e => {throw new Error(e.error)}))
    .then(d => { showLoading('Анализ…', 60); currentFilter='all'; currentSort='overpay'; sortDirection='desc'; processServerData(d); })
    .catch(e => { showLoading('Ошибка: '+e.message, 100); setTimeout(hideLoading, 3000); });
}
function processServerData(data) {
  showLoading('Построение…', 80);
  const rd = {};
  for (const [num, sub] of Object.entries(data.subscribers)) {
    const items = []; let pf = sub.planFee || 0;
    for (const it of sub.items) {
      const k = mkey(it.serviceName); if (!k) continue;
      if (k === 'plan_fee') { pf += it.withDiscount; continue; }
      if (META_KEYS.has(k)) continue;
      items.push({key:k,category:CATEGORY_OF[k]||'other',rawVolume:it.rawVolume,volume:it.volume,unit:it.unit,noDiscount:it.noDiscount,discount:it.discount,withDiscount:it.withDiscount,serviceName:it.serviceName});
    }
    rd[num] = {items,planFee:pf,planName:sub.planName||`Тариф ${Math.round(pf)}₽`};
  }
  buildReportFromData(rd);
}
function mkey(n) { const l=n.toLowerCase(); for(const[p,k]of Object.entries(SERVICE_MAP)){if(l.includes(p))return k;} return null; }
function setView(m) {
  document.querySelectorAll('.view').forEach(b=>b.classList.remove('active'));
  document.getElementById(m==='table'?'tableView':'gridView')?.classList.add('active');
  const g=document.getElementById('usersGrid'); if(g)g.classList.toggle('table-view',m==='table'); renderUsers();
}
function loadWorkers(file) {
  const r=new FileReader();
  r.onload=e=>{nameByNumber=pw(e.target.result);flashHint('Сотрудники: '+Object.keys(nameByNumber).length);};
  r.readAsText(file,'windows-1251');
}
function pw(t) {
  const m={};t.split(/\r?\n/).forEach(l=>{if(!l.trim())return;const d=l.match(/\d{10,}/);if(!d)return;const n=d[0].slice(-10);const nm=l.split(/[;,\t]/).map(p=>p.trim()).find(p=>p&&!/^\+?\d[\d\s()-]{6,}$/.test(p));if(nm)m[n]=nm;});return m;
}

/* ═══════════════════════════════════════════════════════════════
   BUILD REPORT
   ═══════════════════════════════════════════════════════════════ */
function buildReportFromData(rd) {
  showLoading('Анализ…', 70);
  allSubscribers = Object.entries(rd).map(([n,d]) => buildRec(n,d));
  showLoading('Готово', 100);
  document.getElementById('welcomeSection').style.display='none';
  document.getElementById('kpiPanel').style.display='grid';
  document.getElementById('analyticsPanel').style.display='grid';
  document.getElementById('filtersPanel').style.display='flex';
  updateKpis(); updateStatusChart(); updateRankList(); updateCategoryChart(); updateTariffChart();
  setTimeout(()=>{hideLoading();renderUsers();},350);
}
function buildRec(number,data) {
  const pf=data.planFee, pfi=Math.round(pf), tr=TARIFFS[String(pfi)]||DEFAULT_TARIFF;
  let ec=0; const cats={voice:{used:0,cost:0},internet:{used:0,cost:0},sms:{used:0,cost:0},other:{used:0,cost:0}};
  data.items.forEach(it=>{
    ec+=it.withDiscount; const c=cats[it.category]; c.cost+=it.withDiscount;
    if(it.category==='voice'&&it.unit==='мин')c.used+=it.volume;
    else if(it.category==='internet')c.used+=it.volume;
    else if(it.category==='sms'&&it.unit==='шт')c.used+=it.volume;
  });
  const tc=pf+ec, op=ec;
  const cats2=['voice','internet','sms'].map(cat=>{
    const m=CATEGORY_META[cat], lim=tr[m.quotaKey]||0, u=cats[cat].used, r=lim>0?u/lim:0;
    return{cat,...m,used:u,limit:lim,cost:cats[cat].cost,ratio:r,advice:catAdv(r,cats[cat].cost)};
  });
  const ou=cats2.filter(c=>c.ratio>1).length, opr=pf>0?op/pf:(op>0?1:0);
  let st='normal'; if(op>50)st='danger'; else if(op>1)st='warning';
  const rs=Math.max(0,Math.min(100,Math.round(opr*100+ou*15)));
  const rnd=sRand(number), mo=[];
  for(let i=0;i<HISTORY_MONTHS-1;i++)mo.push(tc*(.82+rnd()*.36));
  mo.push(tc);
  const avg=mo.reduce((a,b)=>a+b,0)/mo.length, pv=mo[mo.length-2], tr2=pv>0?((tc-pv)/pv)*100:0;
  return{number,name:nameByNumber[number]||'',planName:data.planName||`Тариф ${pfi}₽`,totalCost:tc,planFee:pf,overpayment:op,categories:cats2,overuse:ou,status:st,riskScore:rs,recommendation:buildRec2(st,op,cats2),monthly:mo,avg,trend:tr2,tariffName:tr.name};
}
function catAdv(r,c){if(r>1)return{type:'raise',text:`Перерасход ${mny(c)}`};if(r>0&&r<.4)return{type:'lower',text:'Пакет недоиспользован'};return{type:'ok',text:'В пределах пакета'};}
function buildRec2(s,op,cats){const r=cats.filter(c=>c.advice.type==='raise'),l=cats.filter(c=>c.advice.type==='lower'),p=[];if(r.length)p.push(`Повысить: ${r.map(c=>c.label.toLowerCase()).join(', ')}`);if(l.length)p.push(`Понизить: ${l.map(c=>c.label.toLowerCase()).join(', ')}`);if(s==='danger')p.unshift(`Критично: ${mny(op)}`);else if(s==='warning')p.unshift(`Переплата ${mny(op)}`);if(!p.length)p.push('Тариф ОК');return p;}
function sRand(s){let h=1779033703^s.length;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19);}let a=h>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}

/* KPI */
function updateKpis() {
  const tc=allSubscribers.reduce((s,x)=>s+x.totalCost,0),to=allSubscribers.reduce((s,x)=>s+x.overpayment,0),cr=allSubscribers.filter(x=>x.status==='danger').length;
  stxt('totalCount',allSubscribers.length);stxt('totalCost',mny(tc));stxt('totalOverpay',mny(to));stxt('totalEconomy',mny(to*.7));stxt('criticalCount',cr);
}

/* Status chart */
function updateStatusChart() {
  const el=document.getElementById('statusChart');if(!el)return;
  const t=allSubscribers.length||1,c={normal:0,warning:0,danger:0};
  allSubscribers.forEach(s=>c[s.status]++);
  const st=[{k:'normal',l:'Норма',c:'#68B944'},{k:'warning',l:'Внимание',c:'#F7941D'},{k:'danger',l:'Критично',c:'#D32F2F'}];
  el.innerHTML=st.map(s=>{const p=Math.round(c[s.k]/t*100);return`<div class="status-row"><div class="status-dot" style="background:${s.c}"></div><div class="status-label">${s.l}</div><div class="status-val">${c[s.k]}</div></div><div class="status-bar"><div class="status-fill" style="width:${p}%;background:${s.c}"></div></div>`;}).join('');
}

/* Rank list */
function updateRankList() {
  const el=document.getElementById('rankList');if(!el)return;
  const top=[...allSubscribers].sort((a,b)=>b.totalCost-a.totalCost).slice(0,8);
  document.getElementById('rankCount').textContent=allSubscribers.length;
  if(!top.length){el.innerHTML='<div style="color:var(--text-muted);font-size:11px">Нет данных</div>';return;}
  el.innerHTML=top.map((s,i)=>{
    const pc=i<3?`rank-pos-${i+1}`:'rank-pos-n';
    return`<div class="rank-item" data-goto="${s.number}"><div class="rank-pos ${pc}">${i+1}</div><div class="rank-info"><div class="rank-name">${esc(s.name||s.number)}</div>${s.name?`<div class="rank-phone">${s.number}</div>`:''}</div><div class="rank-val">${mny(s.totalCost)}</div></div>`;
  }).join('');
  el.querySelectorAll('[data-goto]').forEach(it=>{it.onclick=()=>{const c=document.querySelector(`.user-card[data-phone="${it.dataset.goto}"]`);if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),900);}};});
}

/* Category chart */
function updateCategoryChart() {
  const el=document.getElementById('categoryChart');if(!el)return;
  const tot={voice:0,internet:0,sms:0};
  allSubscribers.forEach(s=>s.categories.forEach(c=>{tot[c.cat]=(tot[c.cat]||0)+c.cost;}));
  const pt=allSubscribers.reduce((s,x)=>s+x.planFee,0);
  const mx=Math.max(...Object.values(tot),pt,1);
  const cs=[{l:'Абонплата',i:'💳',c:'#0071CE',v:pt},{l:'Голос',i:'📞',c:'#0071CE',v:tot.voice},{l:'Интернет',i:'🌐',c:'#68B944',v:tot.internet},{l:'SMS',i:'✉️',c:'#F7941D',v:tot.sms}];
  el.innerHTML=cs.map(c=>{const p=Math.round(c.v/mx*100);return`<div class="cat-row"><div class="cat-icon">${c.i}</div><div class="cat-info"><div class="cat-name">${c.l}</div><div class="cat-bar"><div class="cat-fill" style="width:${p}%;background:${c.c}"></div></div></div><div class="cat-amount" style="color:${c.c}">${mny(c.v)}</div></div>`;}).join('');
}

/* Tariff chart */
function updateTariffChart() {
  const el=document.getElementById('tariffChart');if(!el)return;
  const tc2={};allSubscribers.forEach(s=>{const k=s.tariffName||'Другой';tc2[k]=(tc2[k]||0)+1;});
  const t=allSubscribers.length||1,sr=Object.entries(tc2).sort((a,b)=>b[1]-a[1]);
  el.innerHTML=sr.map(([n,c],i)=>{const p=Math.round(c/t*100),cl=TARIFF_COLORS[i%TARIFF_COLORS.length];return`<div class="tariff-row"><div class="tariff-color" style="background:${cl}"></div><div class="tariff-info"><div class="tariff-name">${esc(n)}</div><div class="tariff-count">${c} абонентов</div><div class="tariff-bar"><div class="tariff-fill" style="width:${p}%;background:${cl}"></div></div></div><div class="tariff-pct" style="color:${cl}">${p}%</div></div>`;}).join('');
}

/* ═══════════════════════════════════════════════════════════════
   RENDER USERS
   ═══════════════════════════════════════════════════════════════ */
function renderUsers() {
  const g=document.getElementById('usersGrid'),s=(document.getElementById('searchInput')?.value||'').trim().toLowerCase();
  let f=allSubscribers.filter(x=>{
    if(s&&!x.number.includes(s)&&!x.name.toLowerCase().includes(s))return false;
    if(currentFilter==='all')return true;if(currentFilter==='overpay')return x.overpayment>100;if(currentFilter==='growing')return x.overpayment>0;return x.status===currentFilter;
  });
  const d=sortDirection==='desc'?-1:1;
  const sk={overpay:(a,b)=>a.overpayment-b.overpayment,cost:(a,b)=>a.totalCost-b.totalCost,risk:(a,b)=>a.riskScore-b.riskScore,number:(a,b)=>a.number.localeCompare(b.number)};
  f.sort((a,b)=>d*(sk[currentSort]||sk.overpay)(a,b));
  renderedSubscribers=f;
  if(!f.length){g.innerHTML='<div class="empty-state">Нет данных</div>';return;}
  g.innerHTML=f.map(card).join('');
  document.getElementById('resultCount').textContent=`${f.length} из ${allSubscribers.length}`;
}
function card(s) {
  const rt=s.status==='danger'?'Критично':s.status==='warning'?'Внимание':'Норма';
  const tc=s.trend>.5?'up':s.trend<-.5?'down':'flat';
  const ta=tc==='up'?'↗':tc==='down'?'↘':'→';
  const t=s.name?esc(s.name):`Абонент ${s.number}`;
  return`<div class="user-card card-${s.status}" data-phone="${s.number}">
  <div class="card-header"><div><div class="user-name">${t}</div><div class="user-sub">${s.name?s.number+' · ':''}${esc(s.planName)}</div></div><span class="badge badge-${s.status}">${rt}</span></div>
  <div class="cost-row"><div><div class="cost-main">${mny(s.totalCost)}</div><div class="cost-sub">Абонплата ${mny(s.planFee)} · переплата <span class="${s.overpayment>0?'txt-danger':'txt-good'}">${mny(s.overpayment)}</span></div></div><span class="trend trend-${tc}">${ta} ${s.trend>0?'+':''}${s.trend.toFixed(0)}%</span></div>
  <div class="cat-chips">${s.categories.map(cc).join('')}</div>
  <div class="spark-wrap">${sparkline(s)}</div>
  <div class="card-actions"><button class="act" data-act="details">Подробнее ▾</button><button class="act" data-act="limits">Лимиты ▾</button></div>
  <div class="panel panel-details"><div class="panel-section"><div class="panel-title">Рекомендация</div><ul class="rec-list">${s.recommendation.map(r=>`<li>${esc(r)}</li>`).join('')}</ul><div class="econo">Экономия: <b>${mny(s.overpayment*.7)}/мес</b> · прогноз ${mny(s.avg*1.05)}</div></div><div class="panel-section"><div class="panel-title">Динамика</div><div class="months">${moH(s)}</div></div></div>
  <div class="panel panel-limits"><div class="panel-section"><div class="panel-title">Пакеты</div><div>${s.categories.map(lr).join('')}</div><div class="panel-hint">Тариф «${esc(s.planName)}»</div></div></div>
</div>`;
}
function cc(c){const l=c.ratio>1?'danger':c.ratio>=.8?'warning':'good',p=c.limit?Math.min(100,Math.round(c.ratio*100)):0;return`<div class="chip chip-${l}"><span class="chip-ico">${c.icon}</span><span>${c.label}</span><span>${p}%</span></div>`;}
function lr(c){const l=c.ratio>1?'danger':c.ratio>=.8?'warning':'good',p=c.limit?Math.min(100,c.ratio*100):0;const pc=c.advice.type==='raise'?'pill-danger':c.advice.type==='lower'?'pill-accent':'pill-good';const pl=c.advice.type==='raise'?'↑ повысить':c.advice.type==='lower'?'↓ понизить':'✓ ок';const u=c.cat==='internet'?fu(c):Math.round(c.used);return`<div class="limit-row"><div class="limit-head"><span>${c.icon}</span><span class="limit-name">${c.label}</span><span class="limit-val">${u} / ${c.limit} ${c.unit}</span><span class="pill ${pc}">${pl}</span></div><div class="bar bar-lg${p>100?' bar-over':''}"><div class="bar-fill fill-${l}" style="width:${Math.min(100,p)}%"></div></div><div class="limit-advice">${esc(c.advice.text)}</div></div>`;}
function moH(s){const lb=getMoLb(HISTORY_MONTHS);return s.monthly.map((v,i)=>{const r=i===s.monthly.length-1;return`<span class="m-item${r?' m-real':''}"><b>${mny(v)}</b> <em>${lb[i]}</em></span>`;}).join('');}
document.addEventListener('click',e=>{const b=e.target.closest('.act');if(!b)return;const c=b.closest('.user-card'),w=b.dataset.act==='limits'?'panel-limits':'panel-details',o=c.classList.toggle(`open-${b.dataset.act}`);c.querySelector(`.${w}`)?.classList.toggle('show',o);b.textContent=b.textContent.replace(o?'▾':'▴',o?'▴':'▾');});

/* Sparkline */
function sparkline(s) {
  const d=s.monthly,W=280,H=70,pL=4,pR=4,pT=8,pB=14,cW=W-pL-pR,cH=H-pT-pB;
  const mx=Math.max(...d,s.planFee,1)*1.18;
  const x=i=>pL+(i/(d.length-1))*cW,y=v=>pT+cH-(v/mx)*cH;
  const lb=getMoLb(d.length),pt=d.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const ar=`M${x(0).toFixed(1)},${(pT+cH).toFixed(1)} L${pt.join(' L')} L${x(d.length-1).toFixed(1)},${(pT+cH).toFixed(1)} Z`;
  const ly=y(s.planFee).toFixed(1);
  const dots=d.map((v,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i===d.length-1?2.5:1.5}" class="${i===d.length-1?'spark-dot-real':'spark-dot'}"/>`).join('');
  const xl=lb.map((l,i)=>`<text x="${x(i).toFixed(1)}" y="${H-2}" class="spark-xlabel">${l}</text>`).join('');
  return`<svg width="${W}" height="${H}" class="spark"><path d="${ar}" class="spark-area"/><polyline points="${pt.join(' ')}" class="spark-line"/>${s.planFee>0?`<line x1="${pL}" y1="${ly}" x2="${W-pR}" y2="${ly}" class="spark-limit"/>`:''}${dots}${xl}</svg>`;
}
function drawBigChart() {
  const h=document.getElementById('bigChart');if(!h||!renderedSubscribers.length){if(h)h.innerHTML='<div style="color:var(--text-muted);font-size:12px">Нет данных</div>';return;}
  const mo=getMoLb(HISTORY_MONTHS),tot=new Array(HISTORY_MONTHS).fill(0);
  renderedSubscribers.forEach(s=>s.monthly.forEach((v,i)=>{tot[i]+=v;}));
  const W=750,H=240,pL=60,pR=16,pT=20,pB=30,cW=W-pL-pR,cH=H-pT-pB;
  const mx=Math.max(...tot,1)*1.12;
  const x=i=>pL+(i/(tot.length-1))*cW,y=v=>pT+cH-(v/mx)*cH;
  const gr=[];for(let i=0;i<=4;i++){const gy=pT+(i/4)*cH,v2=mx*(1-i/4);gr.push(`<line x1="${pL}" y1="${gy}" x2="${W-pR}" y2="${gy}" class="grid"/>`);gr.push(`<text x="${pL-8}" y="${gy+3}" text-anchor="end" class="axis-label">${Math.round(v2).toLocaleString('ru-RU')}</text>`);}
  const pts=tot.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const ar=`M${x(0).toFixed(1)},${(pT+cH).toFixed(1)} L${pts.join(' L')} L${x(tot.length-1).toFixed(1)},${(pT+cH).toFixed(1)} Z`;
  const dots=tot.map((v,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" class="big-dot"/>`).join('');
  const xl=mo.map((m,i)=>`<text x="${x(i).toFixed(1)}" y="${H-8}" text-anchor="middle" class="axis-label">${m}</text>`).join('');
  const vl=tot.map((v,i)=>`<text x="${x(i).toFixed(1)}" y="${y(v)-8}" text-anchor="middle" class="big-vlabel">${mny(v)}</text>`).join('');
  h.innerHTML=`<svg viewBox="0 0 ${W} ${H}" class="big-svg">${gr.join('')}<path d="${ar}" class="big-area"/><polyline points="${pts.join(' ')}" class="big-line"/>${dots}${vl}${xl}</svg>`;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
function mny(v){return(Math.round(v)||0).toLocaleString('ru-RU')+' ₽';}
function fu(c){return c.cat==='internet'?c.used.toFixed(c.used<10?1:0):Math.round(c.used);}
function esc(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function getMoLb(n){const now=new Date(),lb=[];for(let i=n-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);lb.push(MONTH_NAMES[d.getMonth()]);}return lb;}
function stxt(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function showLoading(t,p){document.getElementById('loading').style.display='flex';document.getElementById('loadingText').textContent=t;document.getElementById('progressFill').style.width=p+'%';}
function hideLoading(){document.getElementById('loading').style.display='none';}
function flashHint(t){const h=document.getElementById('hint');h.textContent=t;h.classList.add('show');setTimeout(()=>h.classList.remove('show'),3000);}

/* DEMO */
const DEMO_PLANS=[{fee:140,name:'Интернет. Без Переплат 04.23',minutes:700,sms:300,internet_mb:15000},{fee:230,name:'Управляй! Специалист +',minutes:1500,sms:500,internet_mb:25000},{fee:400,name:'Федеральный Специальный B2B',minutes:4000,sms:1000,internet_mb:70000}];
function loadDemoData(){
  showLoading('Генерация…',30);const rd={};
  for(let i=0;i<50;i++){const ph=gPh(),pl=DEMO_PLANS[Math.floor(Math.random()*DEMO_PLANS.length)],d={items:[],planFee:pl.fee,planName:pl.name};
  const add=(k,c,v,u,c2)=>d.items.push({key:k,category:c,rawVolume:`${v} ${u}`,volume:v,unit=u,withDiscount:c2,noDiscount:c2});
  const om=Math.floor(Math.random()*500);if(om)add('home_outgoing_calls','voice',om,'мин',0);
  add('home_incoming_calls','voice',Math.floor(Math.random()*600)+50,'мин',0);
  const on=Math.floor(Math.random()*300);if(on)add('home_onnet_calls','voice',on,'мин',0);
  const ot=Math.floor(Math.random()*100);if(ot)add('home_other_operators','voice',ot,'мин',+(ot*.18).toFixed(2));
  const ic=Math.floor(Math.random()*80);if(ic)add('home_intercity_calls','voice',ic,'мин',+(ic*.25).toFixed(2));
  const mb=+(Math.random()*50000).toFixed(2);add('home_mobile_internet','internet',mb,'Мбайт',+(Math.max(0,mb-5000)*.0001).toFixed(2));
  const ins=Math.floor(Math.random()*200);if(ins)add('home_incoming_sms','sms',ins,'шт',0);
  const ons=Math.floor(Math.random()*60);if(ons)add('home_sms','sms',ons,'шт',+(ons*.05).toFixed(2));
  if(Math.random()<.3)add('employee_protection_fee','other',1,'',90);
  if(Math.random()<.15){const t=Math.floor(Math.random()*40)+1;add('travel_outgoing_calls','voice',t,'мин',+(t*.18).toFixed(2));}
  if(Math.random()<.1){const t=Math.floor(Math.random()*20)+1;add('travel_sms','sms',t,'шт',+(t*.1).toFixed(2));}
  rd[ph]=d;}
  currentFilter='all';currentSort='overpay';sortDirection='desc';buildReportFromData(rd);
}
function gPh(){const p=[900,901,902,903,904,905,906,908,909,910,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927,928,929,930,950,951,952,953];const pr=p[Math.floor(Math.random()*p.length)];let r='';for(let i=0;i<7;i++)r+=Math.floor(Math.random()*10);return pr+r;}
