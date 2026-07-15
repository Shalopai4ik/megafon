'use strict';

/* ═══════════════════════════════════════════════════════════════
   SERVICE MAP — маппинг услуг из CSV → внутренние ключи
   ═══════════════════════════════════════════════════════════════ */
const SERVICE_MAP = {
  'абонентский номер': 'subscriber_number',
  'тарифный план': 'tariff_plan',
  'абонентская плата по тарифному плану (посуточное списание)': 'plan_fee',
  'абонентская плата по тарифному плану': 'plan_fee',
  'удержание вызова': 'call_hold',
  'абонентская плата за услугу защита сотрудников': 'employee_protection_fee',
  'исходящие вызовы в домашнем регионе': 'home_outgoing_calls',
  'исходящие вызовы на номера других операторов в домашнем регионе': 'home_other_operators',
  'исходящие вызовы внутри сети в домашнем регионе': 'home_onnet_calls',
  'исходящие междугородние вызовы в домашнем регионе': 'home_intercity_calls',
  'мобильный интернет в домашнем регионе': 'home_mobile_internet',
  'исходящие сообщения в домашнем регионе': 'home_sms',
  'входящие вызовы в домашнем регионе': 'home_incoming_calls',
  'входящие сообщения в домашнем регионе': 'home_incoming_sms',
  'входящие вызовы в путешествиях по россии': 'travel_incoming_calls',
  'входящие сообщения в путешествиях по россии': 'travel_incoming_sms',
  'исходящие вызовы в путешествиях по России': 'travel_outgoing_calls',
  'исходящие междугородние вызовы в путешествиях по России': 'travel_intercity_calls',
  'исходящие сообщения в путешествиях по России': 'travel_sms',
  'мобильный интернет в путешествиях по России': 'travel_mobile_internet',
  'итого начислено': 'total_charged',
  'в т.ч. ндс': 'vat_included',
  'в том числе ндс (22%)': 'vat_included',
  'начисления за передачу мультимедийных сообщений': 'multimedia_messages',
  'исходящие вызовы внутри сети в путешествиях по россии': 'travel_onnet_russia_calls',
  'исходящие вызовы на номера других операторов региона пребывания в путешествиях по россии': 'travel_other_operators',
  'массовые вызовы': 'mass_calls',
  'голосовая почта': 'voicemail',
  'автоответчик': 'auto_answer',
  'звонок за счёт друга': 'friend_call',
  'доставка счёта на email': 'email_invoice',
  'мобильный интернет в национальном роуминге': 'national_roaming_internet',
  'блокировка номера': 'number_blocking',
  'начисления за услуги передачи сообщений в национальном роуминге': 'national_roaming_messages',
  'офис в кармане': 'office_in_pocket',
  'голосовые sms': 'voice_sms',
  'исходящие международные вызовы': 'international_calls',
  'исходящие sms в международном роуминге': 'international_roaming_sms',
  'исходящие вызовы на номера россии в международном роуминге': 'international_roaming_russia_calls',
  'исходящие вызовы на номера страны пребывания в международном роуминге': 'international_roaming_local_calls',
  'прочие начисления': 'misc_charges',
  'ми.детализация счета': 'mi_detailing',
  'входящие sms в международном роуминге': 'incoming_sms_intl_roaming',
  'вызовы в международном роуминге': 'calls_intl_roaming',
  'исходящие вызовы в международном роуминге': 'outgoing_calls_intl_roaming',
  'услуги национального роуминга': 'national_roaming_services',
  'услуги международного роуминга': 'intl_roaming_services',
  'начисления за голосовые услуги в национальном роуминге': 'national_roaming_voice',
  'абонентская плата m2m': 'm2m_fee',
  'абонентская плата m2m флекс': 'm2m_flex_fee',
};

const META_KEYS = new Set(['subscriber_number', 'tariff_plan', 'total_charged', 'vat_included']);

const CATEGORY_OF = {
  home_outgoing_calls: 'voice', home_other_operators: 'voice', home_onnet_calls: 'voice',
  home_intercity_calls: 'voice', home_incoming_calls: 'voice',
  travel_outgoing_calls: 'voice', travel_intercity_calls: 'voice',
  travel_onnet_russia_calls: 'voice', travel_other_operators: 'voice', mass_calls: 'voice',
  international_calls: 'voice', international_roaming_russia_calls: 'voice',
  international_roaming_local_calls: 'voice', friend_call: 'voice',
  voicemail: 'voice', auto_answer: 'voice', call_hold: 'voice',
  calls_intl_roaming: 'voice', outgoing_calls_intl_roaming: 'voice',
  home_mobile_internet: 'internet', travel_mobile_internet: 'internet',
  national_roaming_internet: 'internet',
  home_sms: 'sms', home_incoming_sms: 'sms',
  travel_sms: 'sms', travel_incoming_sms: 'sms',
  multimedia_messages: 'sms', international_roaming_sms: 'sms',
  national_roaming_messages: 'sms', voice_sms: 'sms',
  incoming_sms_intl_roaming: 'sms',
};

const TARIFFS = {
  "140": { minutes: 700, sms: 300, internet_mb: 15000, name: 'Без Переплат' },
  "230": { minutes: 1500, sms: 500, internet_mb: 25000, name: 'Специалист' },
  "400": { minutes: 4000, sms: 1000, internet_mb: 70000, name: 'Федеральный' },
};

const DEFAULT_TARIFF = { minutes: 500, sms: 200, internet_mb: 5000, name: 'Другой' };

const CATEGORY_META = {
  voice: { label: 'Минуты', unit: 'мин', icon: '📞', color: '#0071CE', quotaKey: 'minutes' },
  internet: { label: 'Интернет', unit: 'МБ', icon: '🌐', color: '#68B944', quotaKey: 'internet_mb' },
  sms: { label: 'SMS', unit: 'шт', icon: '✉️', color: '#F7941D', quotaKey: 'sms' },
};

const TARIFF_COLORS = ['#68B944', '#0071CE', '#F7941D', '#E53935', '#00897B'];
const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const HISTORY_MONTHS = 5;

let allSubscribers = [];
let renderedSubscribers = [];
let nameByNumber = {};
let currentFilter = 'all';
let currentSort = 'overpay';
let sortDirection = 'desc';

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  if ($('workersBtn')) $('workersBtn').addEventListener('click', () => $('workersFile').click());
  if ($('workersFile')) $('workersFile').addEventListener('change', (e) => { if (e.target.files[0]) loadWorkers(e.target.files[0]); });
  if ($('billsBtn')) $('billsBtn').addEventListener('click', () => $('billsFile').click());
  if ($('billsFile')) $('billsFile').addEventListener('change', (e) => { if (e.target.files[0]) uploadCSV(e.target.files[0]); });
  if ($('demoBtn')) $('demoBtn').addEventListener('click', loadDemoData);
  if ($('searchInput')) $('searchInput').addEventListener('input', renderUsers);

  document.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderUsers();
    });
  });

  document.querySelectorAll('.sort').forEach((btn) => {
    if (btn.dataset.sort === currentSort) btn.classList.add('active');
    btn.addEventListener('click', () => {
      if (currentSort === btn.dataset.sort) sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      else { currentSort = btn.dataset.sort; sortDirection = 'desc'; }
      document.querySelectorAll('.sort').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderUsers();
    });
  });

  if ($('gridView') && $('tableView')) {
    $('gridView').addEventListener('click', () => setView('grid'));
    $('tableView').addEventListener('click', () => setView('table'));
  }

  if ($('toggleChartBtn')) {
    $('toggleChartBtn').addEventListener('click', () => {
      const panel = $('chartPanel');
      if (panel) {
        const open = panel.classList.toggle('open');
        $('toggleChartBtn').setAttribute('aria-expanded', String(open));
        $('toggleChartBtn').textContent = open ? '▴' : '▾';
        if (open) drawBigChart();
      }
    });
  }

  if ($('themeBtn')) {
    $('themeBtn').addEventListener('click', toggleTheme);
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  window.addEventListener('resize', () => {
    if ($('chartPanel') && $('chartPanel').classList.contains('open')) drawBigChart();
  });
});

/* ── CSV загрузка ──────────────────────────────────────────── */
function uploadCSV(file) {
  showLoading('Отправка файла на сервер…', 10);
  const fd = new FormData();
  fd.append('file', file);
  fetch('/api/upload-csv', { method: 'POST', body: fd })
    .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error); }))
    .then((data) => {
      showLoading('Анализ данных…', 60);
      currentFilter = 'all'; currentSort = 'overpay'; sortDirection = 'desc';
      processServerData(data);
    })
    .catch((err) => { showLoading(`Ошибка: ${err.message}`, 100); setTimeout(hideLoading, 3000); });
}

function processServerData(data) {
  showLoading('Построение отчёта…', 80);
  const reportData = {};
  for (const [number, sub] of Object.entries(data.subscribers)) {
    const items = [];
    let planFee = sub.planFee || 0;
    for (const item of sub.items) {
      const key = matchServiceKey(item.serviceName);
      if (!key) continue;
      if (key === 'plan_fee') { planFee += item.withDiscount; continue; }
      if (META_KEYS.has(key)) continue;
      items.push({ key, category: CATEGORY_OF[key] || 'other', rawVolume: item.rawVolume, volume: item.volume, unit: item.unit, noDiscount: item.noDiscount, discount: item.discount, withDiscount: item.withDiscount, serviceName: item.serviceName });
    }
    reportData[number] = { items, planFee, planName: sub.planName || `Тариф ${Math.round(planFee)}₽` };
  }
  buildReportFromData(reportData);
}

function matchServiceKey(name) {
  const lower = name.toLowerCase();
  for (const [p, k] of Object.entries(SERVICE_MAP)) { if (lower.includes(p)) return k; }
  return null;
}

function setView(mode) {
  const grid = document.getElementById('usersGrid');
  document.querySelectorAll('.view').forEach((b) => b.classList.remove('active'));
  document.getElementById(mode === 'table' ? 'tableView' : 'gridView')?.classList.add('active');
  if (grid) grid.classList.toggle('table-view', mode === 'table');
  renderUsers();
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

function loadWorkers(file) {
  const reader = new FileReader();
  reader.onload = (e) => { nameByNumber = parseWorkers(e.target.result); flashHint(`Загружено: ${Object.keys(nameByNumber).length} сотрудников`); };
  reader.readAsText(file, 'windows-1251');
}

function parseWorkers(text) {
  const map = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const d = line.match(/\d{10,}/);
    if (!d) return;
    const num = d[0].slice(-10);
    const name = line.split(/[;,\t]/).map((p) => p.trim()).find((p) => p && !/^\+?\d[\d\s()-]{6,}$/.test(p));
    if (name) map[num] = name;
  });
  return map;
}

/* ═══════════════════════════════════════════════════════════════
   ПОСТРОЕНИЕ ОТЧЁТА
   ═══════════════════════════════════════════════════════════════ */
function buildReportFromData(reportData) {
  showLoading('Анализ и построение отчёта…', 70);
  allSubscribers = Object.entries(reportData).map(([num, d]) => buildSubscriberRecord(num, d));
  showLoading('Готово', 100);

  document.getElementById('welcomeSection').style.display = 'none';
  document.getElementById('kpiPanel').style.display = 'grid';
  document.getElementById('analyticsPanel').style.display = 'grid';
  document.getElementById('filtersPanel').style.display = 'flex';

  updateKpis();
  updateStatusChart();
  updateRankList();
  updateCategoryChart();
  updateTariffChart();

  setTimeout(() => { hideLoading(); renderUsers(); }, 400);
}

function buildSubscriberRecord(number, data) {
  const planFee = data.planFee;
  const planFeeInt = Math.round(planFee);
  const tariff = TARIFFS[String(planFeeInt)] || DEFAULT_TARIFF;

  let extraCost = 0;
  const cats = { voice: { used: 0, cost: 0 }, internet: { used: 0, cost: 0 }, sms: { used: 0, cost: 0 }, other: { used: 0, cost: 0 } };

  data.items.forEach((it) => {
    extraCost += it.withDiscount;
    const c = cats[it.category];
    c.cost += it.withDiscount;
    if (it.category === 'voice' && it.unit === 'мин') c.used += it.volume;
    else if (it.category === 'internet') c.used += it.volume;
    else if (it.category === 'sms' && it.unit === 'шт') c.used += it.volume;
  });

  const totalCost = planFee + extraCost;
  const overpayment = extraCost;
  const categories = ['voice', 'internet', 'sms'].map((cat) => {
    const meta = CATEGORY_META[cat];
    const limit = tariff[meta.quotaKey] || 0;
    const used = cats[cat].used;
    const ratio = limit > 0 ? used / limit : 0;
    return { cat, ...meta, used, limit, cost: cats[cat].cost, ratio, advice: categoryAdvice(ratio, cats[cat].cost) };
  });

  const overuse = categories.filter((c) => c.ratio > 1).length;
  const overpayRatio = planFee > 0 ? overpayment / planFee : (overpayment > 0 ? 1 : 0);
  let status = 'normal';
  if (overpayment > 50) status = 'danger';
  else if (overpayment > 1) status = 'warning';
  const riskScore = Math.max(0, Math.min(100, Math.round(overpayRatio * 100 + overuse * 15)));

  const rnd = seededRandom(number);
  const monthly = [];
  for (let i = 0; i < HISTORY_MONTHS - 1; i++) monthly.push(totalCost * (0.82 + rnd() * 0.36));
  monthly.push(totalCost);
  const avg = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  const prevVal = monthly[monthly.length - 2];
  const trend = prevVal > 0 ? ((totalCost - prevVal) / prevVal) * 100 : 0;

  return { number, name: nameByNumber[number] || '', planName: data.planName || `Тариф ${planFeeInt}₽`, totalCost, planFee, overpayment, categories, overuse, status, riskScore, recommendation: buildRecommendation(status, overpayment, categories), monthly, avg, trend, tariffName: tariff.name };
}

function categoryAdvice(ratio, cost) {
  if (ratio > 1) return { type: 'raise', text: `Перерасход — ${money(cost)}. Выгоднее увеличить пакет.` };
  if (ratio > 0 && ratio < 0.4) return { type: 'lower', text: 'Пакет недоиспользован — можно понизить.' };
  return { type: 'ok', text: 'В пределах пакета.' };
}

function buildRecommendation(status, overpayment, categories) {
  const raise = categories.filter((c) => c.advice.type === 'raise');
  const lower = categories.filter((c) => c.advice.type === 'lower');
  const parts = [];
  if (raise.length) parts.push(`Повысить: ${raise.map((c) => c.label.toLowerCase()).join(', ')}`);
  if (lower.length) parts.push(`Понизить: ${lower.map((c) => c.label.toLowerCase()).join(', ')}`);
  if (status === 'danger') parts.unshift(`Критично: переплата ${money(overpayment)}`);
  else if (status === 'warning') parts.unshift(`Переплата ${money(overpayment)}`);
  if (!parts.length) parts.push('Тариф подобран корректно.');
  return parts;
}

function seededRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════════════════════════════════════════════
   KPI
   ═══════════════════════════════════════════════════════════════ */
function updateKpis() {
  const totalCost = allSubscribers.reduce((s, x) => s + x.totalCost, 0);
  const totalOverpay = allSubscribers.reduce((s, x) => s + x.overpayment, 0);
  const totalCritical = allSubscribers.filter((x) => x.status === 'danger').length;
  setText('totalCount', allSubscribers.length);
  setText('totalCost', money(totalCost));
  setText('totalOverpay', money(totalOverpay));
  setText('totalEconomy', money(totalOverpay * 0.7));
  setText('criticalCount', totalCritical);
}

/* ═══════════════════════════════════════════════════════════════
   СТАТУС-ЧАРТ (горизонтальные полосы)
   ═══════════════════════════════════════════════════════════════ */
function updateStatusChart() {
  const el = document.getElementById('statusChart');
  if (!el) return;
  const total = allSubscribers.length || 1;
  const counts = { normal: 0, warning: 0, danger: 0 };
  allSubscribers.forEach((s) => counts[s.status]++);

  const statuses = [
    { key: 'normal', label: 'Норма', color: '#68B944', bg: '#e8f5e0' },
    { key: 'warning', label: 'Внимание', color: '#F7941D', bg: '#fff3e0' },
    { key: 'danger', label: 'Критично', color: '#E53935', bg: '#fde8e8' },
  ];

  el.innerHTML = statuses.map((st) => {
    const pct = Math.round((counts[st.key] / total) * 100);
    return `<div class="status-row">
      <div class="status-dot" style="background:${st.color}"></div>
      <div class="status-label">${st.label}</div>
      <div class="status-val">${counts[st.key]}</div>
    </div>
    <div class="status-bar"><div class="status-fill" style="width:${pct}%;background:${st.color}"></div></div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   ТОП ПО РАСХОДАМ
   ═══════════════════════════════════════════════════════════════ */
function updateRankList() {
  const el = document.getElementById('rankList');
  if (!el) return;
  const top = [...allSubscribers].sort((a, b) => b.totalCost - a.totalCost).slice(0, 8);
  document.getElementById('rankCount').textContent = allSubscribers.length;
  if (!top.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Нет данных</div>'; return; }

  el.innerHTML = top.map((sub, i) => {
    const posClass = i < 3 ? `rank-pos-${i + 1}` : 'rank-pos-n';
    return `<div class="rank-item" data-goto="${sub.number}">
      <div class="rank-pos ${posClass}">${i + 1}</div>
      <div class="rank-info">
        <div class="rank-name">${escapeHtml(sub.name || sub.number)}</div>
        ${sub.name ? `<div class="rank-phone">${sub.number}</div>` : ''}
      </div>
      <div class="rank-val">${money(sub.totalCost)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-goto]').forEach((item) => {
    item.addEventListener('click', () => {
      const card = document.querySelector(`.user-card[data-phone="${item.dataset.goto}"]`);
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1200); }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   РАСХОДЫ ПО КАТЕГОРИЯМ
   ═══════════════════════════════════════════════════════════════ */
function updateCategoryChart() {
  const el = document.getElementById('categoryChart');
  if (!el) return;
  const totals = { voice: 0, internet: 0, sms: 0, other: 0 };
  allSubscribers.forEach((s) => s.categories.forEach((c) => { totals[c.cat] = (totals[c.cat] || 0) + c.cost; }));
  // Also add "other" cost from planFee
  const planTotal = allSubscribers.reduce((s, x) => s + x.planFee, 0);
  const maxVal = Math.max(...Object.values(totals), planTotal, 1);

  const cats = [
    { key: 'plan', label: 'Абонплата', icon: '💳', color: '#0071CE', value: planTotal },
    { key: 'voice', label: 'Голос', icon: '📞', color: '#0071CE', value: totals.voice },
    { key: 'internet', label: 'Интернет', icon: '🌐', color: '#68B944', value: totals.internet },
    { key: 'sms', label: 'SMS', icon: '✉️', color: '#F7941D', value: totals.sms },
  ];

  el.innerHTML = cats.map((c) => {
    const pct = Math.round((c.value / maxVal) * 100);
    return `<div class="cat-row">
      <div class="cat-icon">${c.icon}</div>
      <div class="cat-info">
        <div class="cat-name">${c.label}</div>
        <div class="cat-bar"><div class="cat-fill" style="width:${pct}%;background:${c.color}"></div></div>
      </div>
      <div class="cat-amount" style="color:${c.color}">${money(c.value)}</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   ТАРИФНЫЕ ПЛАНЫ
   ═══════════════════════════════════════════════════════════════ */
function updateTariffChart() {
  const el = document.getElementById('tariffChart');
  if (!el) return;
  const tariffCounts = {};
  allSubscribers.forEach((s) => {
    const key = s.tariffName || 'Другой';
    tariffCounts[key] = (tariffCounts[key] || 0) + 1;
  });
  const total = allSubscribers.length || 1;
  const sorted = Object.entries(tariffCounts).sort((a, b) => b[1] - a[1]);

  el.innerHTML = sorted.map(([name, count], i) => {
    const pct = Math.round((count / total) * 100);
    const color = TARIFF_COLORS[i % TARIFF_COLORS.length];
    return `<div class="tariff-row">
      <div class="tariff-color" style="background:${color}"></div>
      <div class="tariff-info">
        <div class="tariff-name">${escapeHtml(name)}</div>
        <div class="tariff-count">${count} абонентов</div>
        <div class="tariff-bar"><div class="tariff-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>
      <div class="tariff-pct" style="color:${color}">${pct}%</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   РЕНДЕР АБОНЕНТОВ
   ═══════════════════════════════════════════════════════════════ */
function renderUsers() {
  const grid = document.getElementById('usersGrid');
  const search = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();

  let filtered = allSubscribers.filter((s) => {
    if (search && !s.number.includes(search) && !s.name.toLowerCase().includes(search)) return false;
    if (currentFilter === 'all') return true;
    if (currentFilter === 'overpay') return s.overpayment > 100;
    if (currentFilter === 'growing') return s.overpayment > 0;
    return s.status === currentFilter;
  });

  const dir = sortDirection === 'desc' ? -1 : 1;
  const sorters = {
    overpay: (a, b) => a.overpayment - b.overpayment,
    cost: (a, b) => a.totalCost - b.totalCost,
    risk: (a, b) => a.riskScore - b.riskScore,
    number: (a, b) => a.number.localeCompare(b.number),
  };
  filtered.sort((a, b) => dir * (sorters[currentSort] || sorters.overpay)(a, b));
  renderedSubscribers = filtered;

  if (!filtered.length) { grid.innerHTML = '<div class="empty-state">Нет данных для отображения</div>'; return; }
  grid.innerHTML = filtered.map(renderCard).join('');
  document.getElementById('resultCount').textContent = `${filtered.length} из ${allSubscribers.length}`;
}

function renderCard(sub) {
  const riskText = sub.status === 'danger' ? 'Критично' : sub.status === 'warning' ? 'Внимание' : 'Норма';
  const tc = sub.trend > 0.5 ? 'up' : sub.trend < -0.5 ? 'down' : 'flat';
  const ta = tc === 'up' ? '↗' : tc === 'down' ? '↘' : '→';
  const title = sub.name ? escapeHtml(sub.name) : `Абонент ${sub.number}`;

  return `<div class="user-card card-${sub.status}" data-phone="${sub.number}">
  <div class="card-header">
    <div>
      <div class="user-name">${title}</div>
      <div class="user-sub">${sub.name ? sub.number + ' · ' : ''}${escapeHtml(sub.planName)}</div>
    </div>
    <span class="badge badge-${sub.status}">${riskText}</span>
  </div>
  <div class="cost-row">
    <div>
      <div class="cost-main">${money(sub.totalCost)}</div>
      <div class="cost-sub">Абонплата ${money(sub.planFee)} · переплата <span class="${sub.overpayment > 0 ? 'txt-danger' : 'txt-good'}">${money(sub.overpayment)}</span></div>
    </div>
    <span class="trend trend-${tc}">${ta} ${sub.trend > 0 ? '+' : ''}${sub.trend.toFixed(0)}%</span>
  </div>
  <div class="cat-chips">${sub.categories.map(catChip).join('')}</div>
  <div class="spark-wrap">${sparkline(sub)}</div>
  <div class="card-actions">
    <button class="act" data-act="details">Подробнее ▾</button>
    <button class="act" data-act="limits">Лимиты ▾</button>
  </div>
  <div class="panel panel-details">
    <div class="panel-section">
      <div class="panel-title">Рекомендация</div>
      <ul class="rec-list">${sub.recommendation.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      <div class="econo">Экономия: <b>${money(sub.overpayment * 0.7)}/мес</b> · прогноз ${money(sub.avg * 1.05)}</div>
    </div>
    <div class="panel-section">
      <div class="panel-title">Динамика</div>
      <div class="months">${monthsHistory(sub)}</div>
    </div>
  </div>
  <div class="panel panel-limits">
    <div class="panel-section">
      <div class="panel-title">Пакеты</div>
      <div>${sub.categories.map(limitRow).join('')}</div>
      <div class="panel-hint">Тариф «${escapeHtml(sub.planName)}».</div>
    </div>
  </div>
</div>`;
}

function catChip(c) {
  const lvl = c.ratio > 1 ? 'danger' : c.ratio >= 0.8 ? 'warning' : 'good';
  const pct = c.limit ? Math.min(100, Math.round(c.ratio * 100)) : 0;
  return `<div class="chip chip-${lvl}"><span class="chip-ico">${c.icon}</span><span>${c.label}</span><span>${pct}%</span></div>`;
}

function limitRow(c) {
  const lvl = c.ratio > 1 ? 'danger' : c.ratio >= 0.8 ? 'warning' : 'good';
  const pct = c.limit ? Math.min(100, c.ratio * 100) : 0;
  const pillCls = c.advice.type === 'raise' ? 'pill-danger' : c.advice.type === 'lower' ? 'pill-accent' : 'pill-good';
  const pillLbl = c.advice.type === 'raise' ? '↑ повысить' : c.advice.type === 'lower' ? '↓ понизить' : '✓ ок';
  const used = c.cat === 'internet' ? fmtUsed(c) : Math.round(c.used);
  return `<div class="limit-row">
    <div class="limit-head">
      <span>${c.icon}</span><span class="limit-name">${c.label}</span>
      <span class="limit-val">${used} / ${c.limit} ${c.unit}</span>
      <span class="pill ${pillCls}">${pillLbl}</span>
    </div>
    <div class="bar bar-lg${pct > 100 ? ' bar-over' : ''}"><div class="bar-fill fill-${lvl}" style="width:${Math.min(100, pct)}%"></div></div>
    <div class="limit-advice">${escapeHtml(c.advice.text)}</div>
  </div>`;
}

function monthsHistory(sub) {
  const labels = getRecentMonthLabels(HISTORY_MONTHS);
  return sub.monthly.map((v, i) => {
    const real = i === sub.monthly.length - 1;
    return `<span class="m-item${real ? ' m-real' : ''}"><b>${money(v)}</b> <em>${labels[i]}</em></span>`;
  }).join('');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.act');
  if (!btn) return;
  const card = btn.closest('.user-card');
  const which = btn.dataset.act === 'limits' ? 'panel-limits' : 'panel-details';
  const open = card.classList.toggle(`open-${btn.dataset.act}`);
  card.querySelector(`.${which}`)?.classList.toggle('show', open);
  btn.textContent = btn.textContent.replace(open ? '▾' : '▴', open ? '▴' : '▾');
});

/* ═══════════════════════════════════════════════════════════════
   СПАРКЛАЙН
   ═══════════════════════════════════════════════════════════════ */
function sparkline(sub) {
  const data = sub.monthly;
  const W = 300, H = 80, pL = 6, pR = 6, pT = 10, pB = 16;
  const cW = W - pL - pR, cH = H - pT - pB;
  const mx = Math.max(...data, sub.planFee, 1) * 1.18;
  const x = (i) => pL + (i / (data.length - 1)) * cW;
  const y = (v) => pT + cH - (v / mx) * cH;
  const labels = getRecentMonthLabels(data.length);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${x(0).toFixed(1)},${(pT + cH).toFixed(1)} L${pts.join(' L')} L${x(data.length - 1).toFixed(1)},${(pT + cH).toFixed(1)} Z`;
  const limY = y(sub.planFee).toFixed(1);
  const dots = data.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === data.length - 1 ? 3 : 2}" class="${i === data.length - 1 ? 'spark-dot-real' : 'spark-dot'}"/>`).join('');
  const xlbl = labels.map((l, i) => `<text x="${x(i).toFixed(1)}" y="${H - 4}" class="spark-xlabel">${l}</text>`).join('');

  return `<svg width="${W}" height="${H}" class="spark">
  <path d="${area}" class="spark-area"/>
  <polyline points="${pts.join(' ')}" class="spark-line"/>
  ${sub.planFee > 0 ? `<line x1="${pL}" y1="${limY}" x2="${W - pR}" y2="${limY}" class="spark-limit"/>` : ''}
  ${dots}${xlbl}</svg>`;
}

function drawBigChart() {
  const host = document.getElementById('bigChart');
  if (!host || !renderedSubscribers.length) { if (host) host.innerHTML = '<div style="color:var(--text-muted)">Нет данных</div>'; return; }

  const months = getRecentMonthLabels(HISTORY_MONTHS);
  const totals = new Array(HISTORY_MONTHS).fill(0);
  renderedSubscribers.forEach((s) => s.monthly.forEach((v, i) => { totals[i] += v; }));

  const W = 800, H = 280, pL = 70, pR = 20, pT = 24, pB = 36;
  const cW = W - pL - pR, cH = H - pT - pB;
  const mx = Math.max(...totals, 1) * 1.12;
  const x = (i) => pL + (i / (totals.length - 1)) * cW;
  const y = (v) => pT + cH - (v / mx) * cH;

  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const gy = pT + (i / 4) * cH;
    const val = mx * (1 - i / 4);
    grid.push(`<line x1="${pL}" y1="${gy}" x2="${W - pR}" y2="${gy}" class="grid"/>`);
    grid.push(`<text x="${pL - 10}" y="${gy + 4}" text-anchor="end" class="axis-label">${Math.round(val).toLocaleString('ru-RU')}</text>`);
  }
  const pts = totals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${x(0).toFixed(1)},${(pT + cH).toFixed(1)} L${pts.join(' L')} L${x(totals.length - 1).toFixed(1)},${(pT + cH).toFixed(1)} Z`;
  const dots = totals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5" class="big-dot"/>`).join('');
  const xlbl = months.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="axis-label">${m}</text>`).join('');
  const vlbl = totals.map((v, i) => `<text x="${x(i).toFixed(1)}" y="${y(v) - 10}" text-anchor="middle" class="big-vlabel">${money(v)}</text>`).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="big-svg">
  ${grid.join('')}
  <path d="${area}" class="big-area"/>
  <polyline points="${pts.join(' ')}" class="big-line"/>
  ${dots}${vlbl}${xlbl}</svg>`;
}

/* ═══════════════════════════════════════════════════════════════
   УТИЛИТЫ
   ═══════════════════════════════════════════════════════════════ */
function money(v) { return (Math.round(v) || 0).toLocaleString('ru-RU') + ' ₽'; }
function fmtUsed(c) { return c.cat === 'internet' ? c.used.toFixed(c.used < 10 ? 1 : 0) : Math.round(c.used); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function getRecentMonthLabels(count) {
  const now = new Date();
  const labels = [];
  for (let i = count - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); labels.push(MONTH_NAMES[d.getMonth()]); }
  return labels;
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function showLoading(text, pct) {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('loadingText').textContent = text;
  document.getElementById('progressFill').style.width = `${pct}%`;
}
function hideLoading() { document.getElementById('loading').style.display = 'none'; }
function flashHint(text) {
  const h = document.getElementById('hint');
  h.textContent = text; h.classList.add('show');
  setTimeout(() => h.classList.remove('show'), 3200);
}

/* ═══════════════════════════════════════════════════════════════
   ДЕМО-ДАННЫЕ
   ═══════════════════════════════════════════════════════════════ */
const DEMO_PLANS = [
  { fee: 140, name: 'Интернет. Без Переплат 04.23', minutes: 700, sms: 300, internet_mb: 15000 },
  { fee: 230, name: 'Управляй! Специалист +', minutes: 1500, sms: 500, internet_mb: 25000 },
  { fee: 400, name: 'Федеральный Специальный B2B', minutes: 4000, sms: 1000, internet_mb: 70000 },
];

function loadDemoData() {
  showLoading('Генерация демо-данных…', 30);
  const rd = {};
  for (let i = 0; i < 50; i++) {
    const phone = genPhone();
    const plan = DEMO_PLANS[Math.floor(Math.random() * DEMO_PLANS.length)];
    const d = { items: [], planFee: plan.fee, planName: plan.name };
    const add = (key, cat, vol, unit, cost) => d.items.push({ key, category: cat, rawVolume: `${vol} ${unit}`, volume: vol, unit, withDiscount: cost, noDiscount: cost });

    const outMin = Math.floor(Math.random() * 500);
    if (outMin) add('home_outgoing_calls', 'voice', outMin, 'мин', 0);
    add('home_incoming_calls', 'voice', Math.floor(Math.random() * 600) + 50, 'мин', 0);
    const onnet = Math.floor(Math.random() * 300);
    if (onnet) add('home_onnet_calls', 'voice', onnet, 'мин', 0);
    const otherMin = Math.floor(Math.random() * 100);
    if (otherMin) add('home_other_operators', 'voice', otherMin, 'мин', +(otherMin * 0.18).toFixed(2));
    const icMin = Math.floor(Math.random() * 80);
    if (icMin) add('home_intercity_calls', 'voice', icMin, 'мин', +(icMin * 0.25).toFixed(2));
    const mb = +(Math.random() * 50000).toFixed(2);
    add('home_mobile_internet', 'internet', mb, 'Мбайт', +(Math.max(0, mb - 5000) * 0.0001).toFixed(2));
    const inSms = Math.floor(Math.random() * 200);
    if (inSms) add('home_incoming_sms', 'sms', inSms, 'шт', 0);
    const outSms = Math.floor(Math.random() * 60);
    if (outSms) add('home_sms', 'sms', outSms, 'шт', +(outSms * 0.05).toFixed(2));
    if (Math.random() < 0.3) add('employee_protection_fee', 'other', 1, '', 90);
    if (Math.random() < 0.15) { const t = Math.floor(Math.random() * 40) + 1; add('travel_outgoing_calls', 'voice', t, 'мин', +(t * 0.18).toFixed(2)); }
    if (Math.random() < 0.1) { const t = Math.floor(Math.random() * 20) + 1; add('travel_sms', 'sms', t, 'шт', +(t * 0.1).toFixed(2)); }
    rd[phone] = d;
  }
  currentFilter = 'all'; currentSort = 'overpay'; sortDirection = 'desc';
  buildReportFromData(rd);
}

function genPhone() {
  const p = [900,901,902,903,904,905,906,908,909,910,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927,928,929,930,950,951,952,953];
  const pr = p[Math.floor(Math.random() * p.length)];
  let r = ''; for (let i = 0; i < 7; i++) r += Math.floor(Math.random() * 10);
  return pr + r;
}
