'use strict';

/* ── Service mapping: CSV service name → internal key ─────────── */
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
  'виртуальная атс': 'virtual_pbx',
  'видеостриминг': 'video_streaming',
  'замена sim-карты': 'sim_replacement',
  'запрет развлекательного контента': 'ban_content',
  'дополнительный городской номер': 'extra_city_number',
  'дополнительный номер': 'extra_number',
  'mi.': 'mi_service',
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
  "140": { minutes: 700, sms: 300, internet_mb: 15000 },
  "230": { minutes: 1500, sms: 500, internet_mb: 25000 },
  "400": { minutes: 4000, sms: 1000, internet_mb: 70000 }
};

const DEFAULT_TARIFF = { minutes: 500, sms: 200, internet_mb: 5000 };

const CATEGORY_META = {
  voice: { label: 'Минуты', unit: 'мин', icon: '📞', quotaKey: 'minutes' },
  internet: { label: 'Интернет', unit: 'МБ', icon: '🌐', quotaKey: 'internet_mb' },
  sms: { label: 'SMS', unit: 'шт', icon: '✉️', quotaKey: 'sms' },
};

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

  if ($('workersBtn')) {
    $('workersBtn').addEventListener('click', () => $('workersFile').click());
    $('workersFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadWorkers(file);
    });
  }

  if ($('billsBtn')) {
    $('billsBtn').addEventListener('click', () => $('billsFile').click());
    $('billsFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) uploadCSV(file);
    });
  }

  if ($('demoBtn')) {
    $('demoBtn').addEventListener('click', loadDemoData);
  }

  if ($('searchInput')) {
    $('searchInput').addEventListener('input', renderUsers);
  }

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
      if (currentSort === btn.dataset.sort) {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        currentSort = btn.dataset.sort;
        sortDirection = 'desc';
      }
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
        if ($('toggleChartBtn')) $('toggleChartBtn').setAttribute('aria-expanded', String(open));
        if (open) drawBigChart();
      }
    });
  }

  const themeBtn = $('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  }

  window.addEventListener('resize', () => {
    const panel = $('chartPanel');
    if (panel && panel.classList.contains('open')) drawBigChart();
  });
});

/* ── Upload CSV to Python backend ──────────────────────────── */
function uploadCSV(file) {
  showLoading('Отправка файла на сервер…', 10);

  const formData = new FormData();
  formData.append('file', file);

  fetch('/api/upload-csv', {
    method: 'POST',
    body: formData,
  })
    .then((r) => {
      if (!r.ok) return r.json().then((e) => { throw new Error(e.error || 'Ошибка сервера'); });
      return r.json();
    })
    .then((data) => {
      showLoading('Анализ данных…', 60);
      currentFilter = 'all';
      currentSort = 'overpay';
      sortDirection = 'desc';
      processServerData(data);
    })
    .catch((err) => {
      showLoading(`Ошибка: ${err.message}`, 100);
      setTimeout(hideLoading, 3000);
    });
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

      if (key === 'plan_fee') {
        planFee += item.withDiscount;
        continue;
      }
      if (META_KEYS.has(key)) continue;

      items.push({
        key,
        category: CATEGORY_OF[key] || 'other',
        rawVolume: item.rawVolume,
        volume: item.volume,
        unit: item.unit,
        noDiscount: item.noDiscount,
        discount: item.discount,
        withDiscount: item.withDiscount,
        serviceName: item.serviceName,
        allColumns: item.allColumns,
      });
    }

    reportData[number] = {
      items,
      planFee,
      planName: sub.planName || `Тариф ${Math.round(planFee)}₽`,
    };
  }

  buildReportFromData(reportData);
}

function matchServiceKey(serviceName) {
  const lower = serviceName.toLowerCase();
  for (const [pattern, key] of Object.entries(SERVICE_MAP)) {
    if (lower.includes(pattern)) return key;
  }
  return null;
}

/* ── View toggles ──────────────────────────────────────────── */
function setView(mode) {
  const grid = document.getElementById('usersGrid');
  document.querySelectorAll('.view').forEach((b) => b.classList.remove('active'));
  const btn = document.getElementById(mode === 'table' ? 'tableView' : 'gridView');
  if (btn) btn.classList.add('active');
  if (grid) grid.classList.toggle('table-view', mode === 'table');
  renderUsers();
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark'
    || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const panel = document.getElementById('chartPanel');
  if (panel && panel.classList.contains('open')) drawBigChart();
}

/* ── Workers file ──────────────────────────────────────────── */
function loadWorkers(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    nameByNumber = parseWorkers(e.target.result);
    const n = Object.keys(nameByNumber).length;
    flashHint(n ? `Список сотрудников загружен: ${n}` : 'Файл прочитан, имена не распознаны');
  };
  reader.onerror = () => flashHint('Ошибка чтения файла сотрудников');
  reader.readAsText(file, 'windows-1251');
}

function parseWorkers(text) {
  const map = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const digits = line.match(/\d{10,}/);
    if (!digits) return;
    const number = digits[0].slice(-10);
    const name = line
      .split(/[;,\t]/).map((p) => p.trim())
      .find((p) => p && !/^\+?\d[\d\s()-]{6,}$/.test(p));
    if (name) map[number] = name;
  });
  return map;
}

/* ── Build report ──────────────────────────────────────────── */
function buildReportFromData(reportData) {
  showLoading('Анализ и построение отчёта…', 70);
  allSubscribers = Object.entries(reportData).map(([number, data]) =>
    buildSubscriberRecord(number, data)
  );
  showLoading('Готово', 100);
  updateKpis();
  updateRankList();

  const kpiPanel = document.getElementById('kpiPanel');
  const analyticsPanel = document.getElementById('analyticsPanel');
  const filtersPanel = document.getElementById('filtersPanel');
  const welcomeSection = document.getElementById('welcomeSection');

  if (welcomeSection) welcomeSection.style.display = 'none';
  if (kpiPanel) kpiPanel.style.display = 'grid';
  if (analyticsPanel) analyticsPanel.style.display = 'flex';
  if (filtersPanel) filtersPanel.style.display = 'flex';

  setTimeout(() => {
    hideLoading();
    renderUsers();
  }, 450);
}

function buildSubscriberRecord(number, data) {
  const planFee = data.planFee;
  const planFeeInt = Math.round(planFee);
  const planFeeStr = String(planFeeInt);
  const tariff = TARIFFS[planFeeStr] || DEFAULT_TARIFF;

  let extraCost = 0;
  const cats = {
    voice: { used: 0, cost: 0 },
    internet: { used: 0, cost: 0 },
    sms: { used: 0, cost: 0 },
    other: { used: 0, cost: 0 },
  };

  data.items.forEach((it) => {
    extraCost += it.withDiscount;
    const c = cats[it.category];
    c.cost += it.withDiscount;
    if (it.category === 'voice' && it.unit === 'мин') {
      c.used += it.volume;
    } else if (it.category === 'internet') {
      c.used += it.volume;
    } else if (it.category === 'sms' && it.unit === 'шт') {
      c.used += it.volume;
    }
  });

  const totalCost = planFee + extraCost;
  const overpayment = extraCost;
  const categories = ['voice', 'internet', 'sms'].map((cat) => {
    const meta = CATEGORY_META[cat];
    const limit = tariff[meta.quotaKey] || 0;
    const used = cats[cat].used;
    const ratio = limit > 0 ? used / limit : 0;
    return {
      cat, ...meta, used, limit, cost: cats[cat].cost, ratio,
      advice: categoryAdvice(ratio, cats[cat].cost)
    };
  });

  const overuse = categories.filter((c) => c.ratio > 1).length;
  const overpayRatio = planFee > 0 ? overpayment / planFee : (overpayment > 0 ? 1 : 0);

  let status = 'normal';
  if (overpayment > 50) status = 'danger';
  else if (overpayment > 1) status = 'warning';

  const riskScore = Math.max(0, Math.min(100, Math.round(overpayRatio * 100 + overuse * 15)));

  const rnd = seededRandom(number);
  const monthly = [];
  for (let i = 0; i < HISTORY_MONTHS - 1; i++) {
    monthly.push(totalCost * (0.82 + rnd() * 0.36));
  }
  monthly.push(totalCost);

  const avg = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  const prevVal = monthly[monthly.length - 2];
  const trend = prevVal > 0 ? ((totalCost - prevVal) / prevVal) * 100 : 0;

  return {
    number, name: nameByNumber[number] || '',
    planName: data.planName || `Тариф ${planFeeInt}₽`,
    totalCost, planFee, overpayment, categories, overuse, status, riskScore,
    recommendation: buildRecommendation(status, overpayment, categories),
    monthly, avg, trend, historyIsDemo: true,
  };
}

function categoryAdvice(ratio, cost) {
  if (ratio > 1) return { type: 'raise', text: `Перерасход — начислено ${money(cost)}. Выгоднее увеличить пакет.` };
  if (ratio > 0 && ratio < 0.4) return { type: 'lower', text: 'Пакет почти не используется — можно понизить.' };
  return { type: 'ok', text: 'Потребление в пределах пакета.' };
}

function buildRecommendation(status, overpayment, categories) {
  const raise = categories.filter((c) => c.advice.type === 'raise');
  const lower = categories.filter((c) => c.advice.type === 'lower');
  const parts = [];

  if (raise.length) parts.push(`Повысить лимит: ${raise.map((c) => c.label.toLowerCase()).join(', ')} — уходит в перерасход.`);
  if (lower.length) parts.push(`Понизить лимит: ${lower.map((c) => c.label.toLowerCase()).join(', ')} — пакет недоиспользован.`);

  if (status === 'danger') parts.unshift(`Критично: переплата ${money(overpayment)}. Требуется пересмотр тарифа.`);
  else if (status === 'warning') parts.unshift(`Есть переплата ${money(overpayment)} — стоит оптимизировать.`);

  if (!parts.length) parts.push('Потребление стабильное, тариф подобран корректно.');

  return parts;
}

function seededRandom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── KPIs ──────────────────────────────────────────────────── */
function updateKpis() {
  const totalCost = allSubscribers.reduce((s, x) => s + x.totalCost, 0);
  const totalOverpay = allSubscribers.reduce((s, x) => s + x.overpayment, 0);
  const totalCritical = allSubscribers.filter((x) => x.status === 'danger').length;

  setText('totalCount', allSubscribers.length);
  setText('totalCost', money(totalCost));
  setText('totalOverpay', money(totalOverpay));
  setText('totalEconomy', money(totalOverpay * 0.7));
  setText('criticalCount', totalCritical);

  const riskScore = allSubscribers.length ? Math.round((totalCritical / allSubscribers.length) * 100) : 0;
  const note = riskScore >= 60 ? 'высокий риск' : (riskScore >= 30 ? 'средний риск' : 'низкий риск');
  const cls = riskScore >= 60 ? 'danger' : (riskScore >= 30 ? 'warning' : 'good');

  const riskDonutEl = document.getElementById('riskDonut');
  const riskNoteEl = document.getElementById('riskNote');
  if (riskDonutEl) riskDonutEl.innerHTML = donutSvg(riskScore, cls);
  if (riskNoteEl) riskNoteEl.innerText = note;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}

/* ── Rank list ─────────────────────────────────────────────── */
function updateRankList() {
  const rankList = document.getElementById('rankList');
  if (!rankList) return;

  const top = [...allSubscribers].sort((a, b) => b.totalCost - a.totalCost).slice(0, 5);
  if (!top.length) { rankList.innerHTML = '<div class="empty">нет данных</div>'; return; }

  rankList.innerHTML = top.map((sub, i) =>
    `<div class="rank-item" data-goto="${sub.number}"><div class="rank-pos">${i + 1}</div><div class="rank-name">${escapeHtml(sub.name || sub.number)}</div><div class="rank-val">${money(sub.totalCost)}</div></div>`
  ).join('');

  rankList.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      const card = document.querySelector(`.user-card[data-phone="${el.dataset.goto}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1200);
      }
    });
  });
}

/* ── Render users ──────────────────────────────────────────── */
function renderUsers() {
  const usersGrid = document.getElementById('usersGrid');
  const searchTerm = document.getElementById('searchInput') ?
    document.getElementById('searchInput').value.trim().toLowerCase() : '';

  let filtered = allSubscribers.filter((sub) => {
    if (searchTerm && !(sub.number.includes(searchTerm) || sub.name.toLowerCase().includes(searchTerm))) return false;
    if (currentFilter === 'all') return true;
    if (currentFilter === 'overpay') return sub.overpayment > 100;
    if (currentFilter === 'growing') return sub.overpayment > 0;
    return sub.status === currentFilter;
  });

  const dir = sortDirection === 'desc' ? -1 : 1;
  const keys = {
    overpay: (a, b) => a.overpayment - b.overpayment,
    cost: (a, b) => a.totalCost - b.totalCost,
    risk: (a, b) => a.riskScore - b.riskScore,
    number: (a, b) => a.number.localeCompare(b.number),
  };

  filtered.sort((a, b) => dir * (keys[currentSort] || keys.overpay)(a, b));
  renderedSubscribers = filtered;

  if (!filtered.length) {
    usersGrid.innerHTML = '<div class="empty-state">Нет данных для отображения</div>';
    return;
  }

  usersGrid.innerHTML = filtered.map((sub) => renderCard(sub)).join('');

  const resultCount = document.getElementById('resultCount');
  if (resultCount) resultCount.innerText = `${filtered.length} из ${allSubscribers.length}`;
}

function renderCard(sub) {
  const riskText = sub.status === 'danger' ? 'Критично' : (sub.status === 'warning' ? 'Внимание' : 'Норма');
  const trendClass = sub.trend > 0.5 ? 'up' : (sub.trend < -0.5 ? 'down' : 'flat');
  const trendArrow = trendClass === 'up' ? '↗' : (trendClass === 'down' ? '↘' : '→');
  const title = sub.name ? escapeHtml(sub.name) : `Абонент ${sub.number}`;

  return `<div class="user-card" data-phone="${sub.number}">
  <div class="card-header">
    <div>
      <div class="user-name">${title}</div>
      <div class="user-sub">${sub.name ? sub.number + ' · ' : ''}${escapeHtml(sub.planName)}</div>
    </div>
    <span class="badge badge-${sub.status === 'danger' ? 'danger' : sub.status === 'warning' ? 'warning' : 'normal'}">${riskText}</span>
  </div>
  <div class="cost-row">
    <div>
      <div class="cost-main">${money(sub.totalCost)}</div>
      <div class="cost-sub">Абонплата ${money(sub.planFee)} · переплата <strong class="${sub.overpayment > 0 ? 'txt-danger' : 'txt-good'}">${money(sub.overpayment)}</strong></div>
    </div>
    <span class="trend trend-${trendClass}">${trendArrow} ${sub.trend > 0 ? '+' : ''}${sub.trend.toFixed(0)}%</span>
  </div>
  <div class="cat-chips">${sub.categories.map((c) => catChip(c)).join('')}</div>
  <div class="spark-wrap">${sparkline(sub)}</div>
  <div class="card-actions">
    <button class="act" data-act="details">Подробнее ▾</button>
    <button class="act" data-act="limits">Детально по лимитам ▾</button>
  </div>
  <div class="panel panel-details">
    <div class="panel-section">
      <div class="panel-title">Рекомендация</div>
      <ul class="rec-list">${sub.recommendation.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      <div class="econo">Потенциал экономии: <b>${money(sub.overpayment * 0.7)}/мес</b> · прогноз след. месяца ${money(sub.avg * 1.05)}</div>
    </div>
    <div class="panel-section">
      <div class="panel-title">Динамика по месяцам</div>
      <div class="months">${monthsHistory(sub)}</div>
    </div>
  </div>
  <div class="panel panel-limits">
    <div class="panel-section">
      <div class="panel-title">Использование пакетов</div>
      <div class="limits-grid">${sub.categories.map((c) => limitRow(c)).join('')}</div>
      <div class="panel-hint">Пакеты берутся из тарифа «${escapeHtml(sub.planName)}».</div>
    </div>
  </div>
</div>`;
}

function catChip(c) {
  const level = c.ratio > 1 ? 'danger' : (c.ratio >= 0.8 ? 'warning' : 'good');
  const pct = c.limit ? Math.min(100, Math.round(c.ratio * 100)) : 0;
  return `<div class="chip chip-${level}"><span class="chip-ico">${c.icon}</span><span>${c.label}</span><span>${pct}%</span></div>`;
}

function limitRow(c) {
  const level = c.ratio > 1 ? 'danger' : (c.ratio >= 0.8 ? 'warning' : 'good');
  const pct = c.limit ? Math.min(100, c.ratio * 100) : 0;
  const adviceCls = c.advice.type === 'raise' ? 'pill-danger' : (c.advice.type === 'lower' ? 'pill-accent' : 'pill-good');
  const adviceLbl = c.advice.type === 'raise' ? '↑ повысить' : (c.advice.type === 'lower' ? '↓ понизить' : '✓ ок');
  const usedStr = c.cat === 'internet' ? fmtUsed(c) : Math.round(c.used);
  return `<div class="limit-row">
  <div class="limit-head">
    <span>${c.icon}</span>
    <span class="limit-name">${c.label}</span>
    <span class="limit-val">${usedStr} / ${c.limit} ${c.unit}</span>
    <span class="pill ${adviceCls}">${adviceLbl}</span>
  </div>
  <div class="bar bar-lg${pct > 100 ? ' bar-over' : ''}"><div class="bar-fill fill-${level}" style="width:${Math.min(100, pct)}%"></div></div>
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
  const panel = card.querySelector(`.${which}`);
  if (panel) panel.classList.toggle('show', open);
  btn.textContent = btn.textContent.replace(open ? '▾' : '▴', open ? '▴' : '▾');
});

function sparkline(sub) {
  const data = sub.monthly;
  const W = 300, H = 84, padL = 6, padR = 6, padT = 12, padB = 16;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxVal = Math.max(...data, sub.planFee, 1) * 1.18;
  const x = (i) => padL + (i / (data.length - 1)) * chartW;
  const y = (v) => padT + chartH - (v / maxVal) * chartH;
  const labels = getRecentMonthLabels(data.length);
  const linePts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const areaD = `M${x(0).toFixed(1)},${(padT + chartH).toFixed(1)} L${linePts.join(' L')} L${x(data.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} Z`;
  const limitY = y(sub.planFee).toFixed(1);
  const dots = data.map((v, i) => {
    const real = i === data.length - 1;
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${real ? 3 : 2}" class="${real ? 'spark-dot-real' : 'spark-dot'}"/>`;
  }).join('');
  const xlabels = labels.map((l, i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 4}" class="spark-xlabel">${l}</text>`
  ).join('');

  return `<svg width="${W}" height="${H}" class="spark">
  <path d="${areaD}" class="spark-area"/>
  <polyline points="${linePts.join(' ')}" class="spark-line"/>
  ${sub.planFee > 0 ? `<line x1="${padL}" y1="${limitY}" x2="${W - padR}" y2="${limitY}" class="spark-limit"/>` : ''}
  ${dots}${xlabels}
</svg>`;
}

function donutSvg(score, cls) {
  const r = 34, c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return `<svg width="80" height="80" class="donut donut-${cls}">
  <circle cx="40" cy="40" r="${r}" class="donut-track"/>
  <circle cx="40" cy="40" r="${r}" class="donut-val" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
  <text x="40" y="46" text-anchor="middle" class="donut-text">${score}</text>
</svg>`;
}

function drawBigChart() {
  const host = document.getElementById('bigChart');
  if (!host || !renderedSubscribers.length) {
    if (host) host.innerHTML = '<div class="empty">Нет данных</div>';
    return;
  }

  const months = getRecentMonthLabels(HISTORY_MONTHS);
  const totals = new Array(HISTORY_MONTHS).fill(0);
  renderedSubscribers.forEach((s) => s.monthly.forEach((v, i) => { totals[i] += v; }));

  const W = 720, H = 260, padL = 64, padR = 20, padT = 20, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxVal = Math.max(...totals, 1) * 1.12;
  const x = (i) => padL + (i / (totals.length - 1)) * chartW;
  const y = (v) => padT + chartH - (v / maxVal) * chartH;

  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const gy = padT + (i / 4) * chartH;
    const val = maxVal * (1 - i / 4);
    grid.push(`<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" class="grid"/>`);
    grid.push(`<text x="${padL - 8}" y="${gy + 4}" text-anchor="end" class="axis-label">${Math.round(val)}</text>`);
  }
  const linePts = totals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const areaD = `M${x(0).toFixed(1)},${(padT + chartH).toFixed(1)} L${linePts.join(' L')} L${x(totals.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} Z`;
  const dots = totals.map((v, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" class="big-dot"/>`
  ).join('');
  const xlabels = months.map((m, i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis-label">${m}</text>`
  ).join('');
  const valLabels = totals.map((v, i) =>
    `<text x="${x(i).toFixed(1)}" y="${y(v) - 8}" text-anchor="middle" class="big-vlabel">${money(v)}</text>`
  ).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="big-svg">
  ${grid.join('')}
  <path d="${areaD}" class="big-area"/>
  <polyline points="${linePts.join(' ')}" class="big-line"/>
  ${dots}${valLabels}${xlabels}
</svg>`;
}

/* ── Helpers ───────────────────────────────────────────────── */
function money(v) { return (Math.round(v) || 0).toLocaleString('ru-RU') + ' ₽'; }
function fmtUsed(c) {
  if (c.cat === 'internet') return c.used.toFixed(c.used < 10 ? 1 : 0);
  return Math.round(c.used);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function getRecentMonthLabels(count) {
  const now = new Date();
  const labels = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(MONTH_NAMES[d.getMonth()]);
  }
  return labels;
}

function showLoading(text, pct) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'flex';
  const loadingText = document.getElementById('loadingText');
  if (loadingText) loadingText.innerText = text;
  const progressFill = document.getElementById('progressFill');
  if (progressFill) progressFill.style.width = `${pct}%`;
}

function hideLoading() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
}

function flashHint(text) {
  const hint = document.getElementById('hint');
  if (hint) {
    hint.innerText = text;
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 3200);
  }
}

/* ═══════════════════════════════════════════════════════════════
   DEMO DATA
   ═══════════════════════════════════════════════════════════════ */

const DEMO_PLANS = [
  { fee: 140, name: 'Интернет. Без Переплат 04.23', minutes: 700, sms: 300, internet_mb: 15000 },
  { fee: 230, name: 'Управляй! Специалист +', minutes: 1500, sms: 500, internet_mb: 25000 },
  { fee: 400, name: 'Федеральный Специальный B2B', minutes: 4000, sms: 1000, internet_mb: 70000 },
];

function loadDemoData() {
  showLoading('Генерация демо-данных…', 30);
  const reportData = {};

  for (let i = 0; i < 50; i++) {
    const phone = generatePhone();
    const plan = DEMO_PLANS[Math.floor(Math.random() * DEMO_PLANS.length)];
    const data = { items: [], planFee: plan.fee, planName: plan.name };

    const outMin = Math.floor(Math.random() * 500);
    if (outMin > 0) data.items.push({ key: 'home_outgoing_calls', category: 'voice', rawVolume: `${outMin} мин`, volume: outMin, unit: 'мин', withDiscount: 0 });
    const inMin = Math.floor(Math.random() * 600) + 50;
    data.items.push({ key: 'home_incoming_calls', category: 'voice', rawVolume: `${inMin} мин`, volume: inMin, unit: 'мин', withDiscount: 0 });
    const onnetMin = Math.floor(Math.random() * 300);
    if (onnetMin > 0) data.items.push({ key: 'home_onnet_calls', category: 'voice', rawVolume: `${onnetMin} мин`, volume: onnetMin, unit: 'мин', withDiscount: 0 });
    const otherMin = Math.floor(Math.random() * 100);
    const otherCost = +(otherMin * 0.18).toFixed(2);
    if (otherMin > 0) data.items.push({ key: 'home_other_operators', category: 'voice', rawVolume: `${otherMin} мин`, volume: otherMin, unit: 'мин', noDiscount: otherCost, withDiscount: otherCost });
    const intercityMin = Math.floor(Math.random() * 80);
    const intercityCost = +(intercityMin * 0.25).toFixed(2);
    if (intercityMin > 0) data.items.push({ key: 'home_intercity_calls', category: 'voice', rawVolume: `${intercityMin} мин`, volume: intercityMin, unit: 'мин', noDiscount: intercityCost, withDiscount: intercityCost });
    const internetMb = +(Math.random() * 50000).toFixed(2);
    const internetCost = +(Math.max(0, (internetMb - 5000)) * 0.0001).toFixed(2);
    data.items.push({ key: 'home_mobile_internet', category: 'internet', rawVolume: `${internetMb} Мбайт`, volume: internetMb, unit: 'Мбайт', noDiscount: internetCost, withDiscount: internetCost });
    const inSms = Math.floor(Math.random() * 200);
    if (inSms > 0) data.items.push({ key: 'home_incoming_sms', category: 'sms', rawVolume: `${inSms} шт`, volume: inSms, unit: 'шт', withDiscount: 0 });
    const outSms = Math.floor(Math.random() * 60);
    const smsCost = +(outSms * 0.05).toFixed(2);
    if (outSms > 0) data.items.push({ key: 'home_sms', category: 'sms', rawVolume: `${outSms} шт`, volume: outSms, unit: 'шт', noDiscount: smsCost, withDiscount: smsCost });
    if (Math.random() < 0.3) data.items.push({ key: 'employee_protection_fee', category: 'other', rawVolume: '1', volume: 1, unit: '', withDiscount: 90, noDiscount: 90 });
    if (Math.random() < 0.15) {
      const travelMin = Math.floor(Math.random() * 40) + 1;
      const travelCost = +(travelMin * 0.18).toFixed(2);
      data.items.push({ key: 'travel_outgoing_calls', category: 'voice', rawVolume: `${travelMin} мин`, volume: travelMin, unit: 'мин', noDiscount: travelCost, withDiscount: travelCost });
    }
    if (Math.random() < 0.1) {
      const travelSms = Math.floor(Math.random() * 20) + 1;
      const travelSmsCost = +(travelSms * 0.1).toFixed(2);
      data.items.push({ key: 'travel_sms', category: 'sms', rawVolume: `${travelSms} шт`, volume: travelSms, unit: 'шт', noDiscount: travelSmsCost, withDiscount: travelSmsCost });
    }

    reportData[phone] = data;
  }

  currentFilter = 'all';
  currentSort = 'overpay';
  sortDirection = 'desc';
  buildReportFromData(reportData);
}

function generatePhone() {
  const prefixes = [900, 901, 902, 903, 904, 905, 906, 908, 909, 910, 912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 934, 935, 936, 937, 938, 939, 950, 951, 952, 953, 958];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  let rest = '';
  for (let i = 0; i < 7; i++) rest += Math.floor(Math.random() * 10);
  return prefix + rest;
}
