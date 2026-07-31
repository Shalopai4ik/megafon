'use strict';

/* =============================================================================
 * Фронтенд «Анализ тарифных планов».
 * =============================================================================
 *
 * Вся прикладная арифметика — разбор счёта, потребление по категориям,
 * подбор тарифа, статусы и рекомендации — живёт на сервере (domain.py).
 * Здесь только загрузка файлов, состояние интерфейса и отрисовка.
 *
 * Так сделано осознанно: когда часть расчётов дублировалась в JS, цифры в
 * карточке расходились с отчётом. Теперь источник правды один.
 * ========================================================================== */

const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
// Тот же месяц в именительном падеже. Нужен для оборота «за ИЮНЬ 2026»:
// с родительным получалось «за июня 2026».
const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const ACTION_META = {
  raise: { label: 'Повысить тариф', cls: 'danger', icon: '↑' },
  lower: { label: 'Понизить тариф', cls: 'accent', icon: '↓' },
  switch: { label: 'Подобрать тариф', cls: 'accent', icon: '⇄' },
  keep: { label: 'Тариф оптимален', cls: 'good', icon: '✓' },
};

const STATUS_META = {
  danger: { label: 'Критично', cls: 'danger' },
  warning: { label: 'Внимание', cls: 'warning' },
  normal: { label: 'Норма', cls: 'normal' },
};

const VERDICT_CLS = {
  over: 'danger', extra: 'warning', under: 'accent', ok: 'good', payg: 'muted',
};

const CAT_META = {
  voice: { label: 'Минуты', icon: '', unit: 'мин', usageKey: 'voice_min', costKey: 'voice_cost' },
  internet: { label: 'Интернет', icon: '', unit: 'ГБ', usageKey: 'internet_mb', costKey: 'internet_cost' },
  sms: { label: 'SMS', icon: '', unit: 'шт', usageKey: 'sms_cnt', costKey: 'sms_cost' },
};

/**
 * Бейдж «номером не пользуются». Уровень считает сервер (domain.usage_level),
 * здесь только подпись.
 *
 * Отдельная от статуса метка нужна потому, что молчащий номер по деньгам
 * обычно «Норма»: лимит не превышен, перерасхода нет — и на карточке не было
 * ни следа того, что связи не было вообще. А это как раз самый очевидный
 * повод отключить SIM.
 */
const USAGE_BADGE = {
  none: '<span class="badge badge-idle" title="За месяц ни исходящих минут,'
    + ' ни интернета, ни SMS">не используется</span>',
  idle: '<span class="badge badge-idle" title="За месяц только служебный'
    + ' трафик: единицы минут и мегабайт">почти не используется</span>',
};

const VERDICT_COLS = [
  { type: 'over', label: 'Перерасход', cls: 'danger' },
  { type: 'extra', label: 'Вне пакета', cls: 'warning' },
  { type: 'ok', label: 'Норма', cls: 'good' },
  { type: 'under', label: 'Недоиспользование', cls: 'accent' },
  { type: 'payg', label: 'По факту', cls: 'muted' },
];

/* ── Состояние ───────────────────────────────────────────────────────────── */
const state = {
  month: '', months: [], subscribers: [], filtered: [],
  summary: null, tariffStats: [], tariffs: [], statuses: [],
  trend: [], invoice: {},
  // НОВОЕ: разделение оплаты и справочники правил.
  paymentSummary: null, chipColors: [], chipMarks: [], trips: [],
  filter: 'all', sort: 'waste', sortDir: 'desc', view: 'grid', search: '',
  hasRoster: false,
  openPanels: {},   // number -> 'details' | 'limits' — какие панели раскрыты
  hiddenWidgets: new Set(),   // id блоков, выключенных в настройках
};

/* ─────────────────────────────────────────────────────────────────────────
 * Реестр блоков отчёта.
 *
 * Отчёт намеренно показывает всё, что можно посчитать по загруженному счёту,
 * — а лишнее выключается здесь же, в «Настройки → Виджеты». Хранится не
 * список включённых, а список ВЫКЛЮЧЕННЫХ: тогда блок, добавленный в
 * следующей версии, появится у всех, а не останется невидимым из-за старой
 * записи в localStorage.
 *
 * `container` — секция-обёртка. Она прячется сама, когда выключены все её
 * блоки, иначе на странице оставалась бы пустая рамка.
 * ────────────────────────────────────────────────────────────────────────── */
const WIDGET_GROUPS = [
  {
    title: 'Показатели сверху', container: 'kpiPanel',
    items: [
      { id: 'kpiCountCard', label: 'Абонентов', note: 'сколько номеров в периоде' },
      { id: 'kpiCostCard', label: 'Начислено за период', note: 'сумма счёта и средний чек' },
      { id: 'kpiCompanyCard', label: 'Платит компания', note: 'абонплата и опции по правилам' },
      { id: 'kpiEmployeeCard', label: 'Платит сотрудник', note: 'перерасход и роуминг' },
      { id: 'kpiWasteCard', label: 'Платим впустую', note: 'оплаченный, но не выбранный пакет' },
      { id: 'kpiEconomyCard', label: 'Потенциал экономии', note: 'если сменить тарифы' },
      { id: 'kpiYearCard', label: 'Экономия за год', note: 'тот же эффект × 12 месяцев' },
      { id: 'kpiOverpayCard', label: 'Перерасход лимита', note: 'нужны лимиты из списка абонентов' },
      { id: 'kpiCriticalCard', label: 'Требуют внимания', note: 'номера в статусе «критично»' },
      { id: 'kpiRoamingCard', label: 'Роуминг за период', note: 'связь вне домашнего региона' },
      { id: 'kpiIdleCard', label: 'Неиспользуемые SIM', note: 'номера без потребления' },
    ],
  },
  {
    title: 'Аналитика', container: 'analyticsPanel',
    items: [
      { id: 'riskBlock', label: 'Индекс риска', note: 'доля критичных номеров' },
      { id: 'rankBlock', label: 'Наибольшая экономия', note: 'топ-6 по выгоде от смены тарифа' },
      { id: 'actionsBlock', label: 'Что делать с тарифами', note: 'повысить / понизить / оставить' },
      { id: 'usageBlock', label: 'Потребление по компании', note: 'минуты, интернет, SMS' },
      { id: 'chartBlock', label: 'Динамика расходов по месяцам', note: 'нужны счета за 2+ месяца' },
    ],
  },
  {
    title: 'Расширенная аналитика', container: 'extraPanel',
    items: [
      { id: 'exTrips', label: 'Командировки', note: 'таблица загруженных командировок' },
      { id: 'exOversized', label: 'Слишком большой пакет', note: 'за кого платим впустую — главный список' },
      { id: 'exPayers', label: 'Кто за что платит', note: 'разделение «мы / сотрудник» по корзинам' },
      { id: 'exStructure', label: 'Структура расходов компании', note: 'из чего сложился весь счёт' },
      { id: 'exDistribution', label: 'Распределение расходов', note: 'гистограмма, медиана и 90-й перцентиль' },
      { id: 'exPareto', label: 'ABC-анализ расходов', note: 'кто делает 80% счёта' },
      { id: 'exTopCost', label: 'Топ-10 по расходам', note: 'самые дорогие номера' },
      { id: 'exIdle', label: 'Неиспользуемые номера', note: 'кандидаты на отключение' },
      { id: 'exLimits', label: 'Освоение лимитов', note: 'нужны лимиты из списка абонентов' },
      { id: 'exRoaming', label: 'Роуминг и командировки', note: 'роуминг без отметки о командировке' },
      { id: 'exAnomalies', label: 'Аномалии месяца', note: 'резкий рост и падение расхода' },
      { id: 'exPositions', label: 'Расходы по должностям', note: 'нужен список абонентов' },
      { id: 'exHeat', label: 'Категории × вердикт', note: 'где именно не сходятся пакеты' },
      { id: 'exMatrix', label: 'Матрица «расход × риск»', note: 'каждый номер точкой' },
    ],
  },
  {
    title: 'Списки и фильтры', container: null,
    items: [
      { id: 'tariffCompareSection', label: 'Тарифы в счёте', note: 'кто на чём сидит и что это стоит' },
      { id: 'filtersPanel', label: 'Фильтры и сортировка', note: 'панель над списком абонентов' },
    ],
  },
];

/** Минимальный набор — то, что остаётся при нажатии «Только основное». */
const WIDGET_ESSENTIALS = new Set([
  'kpiCountCard', 'kpiCostCard', 'kpiEconomyCard', 'kpiCriticalCard',
  'riskBlock', 'rankBlock', 'actionsBlock', 'filtersPanel',
]);

const WIDGET_STORAGE_KEY = 'hiddenWidgets';

function allWidgets() {
  return WIDGET_GROUPS.flatMap((g) => g.items);
}

function loadWidgetPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDGET_STORAGE_KEY) || '[]');
    state.hiddenWidgets = new Set(Array.isArray(raw) ? raw : []);
  } catch (_) {
    state.hiddenWidgets = new Set();
  }
}

function saveWidgetPrefs() {
  try {
    localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify([...state.hiddenWidgets]));
  } catch (_) {
    /* приватный режим — настройки просто не переживут перезагрузку */
  }
}

function widgetOn(id) {
  return !state.hiddenWidgets.has(id);
}

/** Показывает ровно те блоки, которые включены, — и только когда есть данные. */
function applyWidgetVisibility() {
  const hasData = state.subscribers.length > 0;
  WIDGET_GROUPS.forEach((group) => {
    let shown = 0;
    group.items.forEach((w) => {
      const el = document.querySelector(`[data-widget="${w.id}"]`);
      if (!el) return;
      const visible = hasData && widgetOn(w.id);
      el.hidden = !visible;
      if (visible) shown += 1;
    });
    if (group.container) toggle(group.container, hasData && shown > 0);
  });
}

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ── Инициализация ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  loadWidgetPrefs();

  bindUpload('billsBtn', 'billsFile', (file) => uploadFile(file, 'bill'));
  bindUpload('rosterBtn', 'rosterFile', (file) => uploadFile(file, 'roster'));
  bindUpload('tripsBtn', 'tripsFile', (file) => uploadFile(file, 'trips'));
  on('welcomeBillBtn', 'click', () => $('billsFile').click());
  on('welcomeRosterBtn', 'click', () => $('rosterFile').click());
  on('welcomeTripsBtn', 'click', () => $('tripsFile').click());
  on('downloadBtn', 'click', downloadReport);
  on('themeBtn', 'click', toggleTheme);
  on('statsBtn', 'click', openStats);
  on('settingsBtn', 'click', openSettings);
  on('monthSelect', 'change', (e) => loadMonth(e.target.value));
  bindMainMenu();

  on('searchInput', 'input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderUsers(true);
  }, 180));

  bindFilters();

  $$('.sort').forEach((btn) => btn.addEventListener('click', () => {
    if (state.sort === btn.dataset.sort) {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sort = btn.dataset.sort;
      state.sortDir = 'desc';
    }
    $$('.sort').forEach((b) => { b.classList.remove('active'); b.removeAttribute('data-dir'); });
    btn.classList.add('active');
    btn.dataset.dir = state.sortDir;
    renderUsers(true);
  }));

  on('gridView', 'click', () => setView('grid'));
  on('tableView', 'click', () => setView('table'));

  on('tariffCompareBtn', 'click', () => {
    const body = $('tariffCompareBody');
    const btn = $('tariffCompareBtn');
    const open = body.classList.toggle('show');
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('.collapsible-arrow').classList.toggle('open', open);
  });

  // Блоки категорий живут и в карточках, и в модалке, и перерисовываются —
  // поэтому обработчик делегированный, а не навешивается на каждый блок.
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.limit-toggle');
    if (toggle) toggleCategoryChart(toggle);
  });

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) {
      const what = closer.dataset.close;
      if (what === 'settings') closeOverlay('settingsPanel');
      else if (what === 'stats') closeOverlay('statsModal');
      else closeOverlay('subModal');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ['subModal', 'settingsPanel', 'statsModal'].forEach(closeOverlay);
  });

  // Оба графика строят viewBox по фактической ширине блока, поэтому
  // при изменении размера окна их надо пересчитать.
  window.addEventListener('resize', debounce(() => {
    if (!state.subscribers.length) return;
    drawTrendChart();
    renderExMatrix();
  }, 200));

  bootstrap();
});

function on(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

function bindFilters() {
  $$('.filter').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      $$('.filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderUsers(true);
    });
  });
}

function bindUpload(buttonId, inputId, handler) {
  const btn = $(buttonId);
  const input = $(inputId);
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handler(file);
    e.target.value = '';   // чтобы повторный выбор того же файла сработал
  });
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/* ── Обмен с сервером ────────────────────────────────────────────────────── */
async function bootstrap() {
  try {
    const data = await getJSON('/api/subscribers');
    if (data && data.subscribers && data.subscribers.length) applyView(data);
  } catch (_) {
    /* сервер пуст или недоступен — остаётся экран приветствия */
  }
}

async function getJSON(url) {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  let data = null;
  try { data = await resp.json(); } catch (_) { /* тело не JSON */ }
  if (!resp.ok) throw new Error((data && data.error) || `Ошибка сервера (${resp.status})`);
  return data;
}

/**
 * Дописать к адресу выбранный период.
 *
 * ЗАЧЕМ. Правка настройки пересчитывает отчёт на сервере, и он возвращает его
 * целиком. Без периода сервер собирал отчёт за ПОСЛЕДНИЙ загруженный месяц —
 * и любое сохранение перекидывало экран с выбранного периода на него.
 */
function withMonth(url) {
  if (!state.month) return url;
  return url + (url.includes('?') ? '&' : '?') + `month=${encodeURIComponent(state.month)}`;
}

async function postJSON(url, payload) {
  const resp = await fetch(withMonth(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  let data = null;
  try { data = await resp.json(); } catch (_) { /* тело не JSON */ }
  if (!resp.ok) throw new Error((data && data.error) || `Ошибка сервера (${resp.status})`);
  return data;
}

// Куда отправлять файл и что писать в индикаторе — по типу загрузки.
const UPLOAD_KINDS = {
  bill: { url: '/api/upload-csv', loading: 'Разбор счёта…' },
  roster: { url: '/api/upload-roster', loading: 'Разбор списка абонентов…' },
  trips: { url: '/api/upload-trips', loading: 'Разбор списка командировок…' },
};

async function uploadFile(file, kind) {
  const isBill = kind === 'bill';
  const meta = UPLOAD_KINDS[kind] || UPLOAD_KINDS.bill;
  showLoading(meta.loading, 25);

  const form = new FormData();
  form.append('file', file);

  try {
    // Счёт сам приносит свой период — его и покажем. Список абонентов и
    // командировки period не меняют, поэтому отчёт пересобираем на том,
    // который открыт сейчас.
    const resp = await fetch(isBill ? meta.url : withMonth(meta.url), {
      method: 'POST', body: form,
    });
    let data = null;
    try { data = await resp.json(); } catch (_) { /* тело не JSON */ }
    if (!resp.ok) throw new Error((data && data.error) || `Ошибка сервера (${resp.status})`);

    showLoading('Построение отчёта…', 75);
    if (isBill) {
      state.filter = 'all'; state.sort = 'waste'; state.sortDir = 'desc';
      state.openPanels = {};
      resetFilterButtons();
      resetCardBatch();
    } else if (kind === 'roster') {
      state.hasRoster = true;
    }

    if (data.view) applyView(data.view);
    hideLoading();
    flashHint(uploadSummary(data, kind, file.name));
  } catch (err) {
    hideLoading();
    flashHint(`Не удалось обработать «${file.name}»: ${err.message}`, 'error', 7000);
  }
}

function uploadSummary(data, kind, fileName) {
  // Из книги Excel мы берём ОДИН лист (сотрудники — второй, командировки —
  // четвёртый, см. server.XLSX_SHEET). Какой именно взяли — говорим вслух:
  // если листы в книге переставили, это видно сразу, а не по пропавшим
  // строкам. Для CSV поле пустое и приписки нет.
  const sheet = data.sheet ? ` Взят ${data.sheet}.` : '';
  return uploadSummaryText(data, kind, fileName) + sheet;
}

function uploadSummaryText(data, kind, fileName) {
  if (kind === 'bill') {
    const s = data.stats || {};
    return `Счёт «${fileName}» загружен: ${data.saved} абонентов, `
      + `${s.rows || 0} строк начислений, период ${formatMonth(data.month)}.`;
  }
  if (kind === 'trips') {
    const s = data.stats || {};
    return `Командировки «${fileName}»: ${data.saved} `
      + `${plural(data.saved, 'запись', 'записи', 'записей')}`
      + (s.approved ? `, утверждено ${s.approved}` : '')
      + (s.skipped ? `, пропущено строк без номера — ${s.skipped}` : '')
      // Строка с номером, но без периода — не командировка, а чаще всего
      // строка из списка сотрудников. Молчать об этом нельзя: человек
      // должен понять, почему записей меньше, чем строк в файле.
      + (s.no_dates ? `, без периода командировки — ${s.no_dates} (не сохранены)` : '')
      + '.';
  }
  const parts = [`Список «${fileName}»: ${data.applied} записей`];
  if (data.with_limit) parts.push(`лимитов ${data.with_limit}`);
  if (data.with_history) parts.push(`история по ${(data.months || []).length} мес.`);
  return parts.join(', ') + '.';
}

async function loadMonth(month) {
  if (!month || month === state.month) return;
  showLoading('Загрузка периода…', 50);
  // Другой период — другой список, показываем его с начала.
  resetCardBatch();
  try {
    applyView(await getJSON(`/api/subscribers?month=${encodeURIComponent(month)}`));
    hideLoading();
  } catch (err) {
    hideLoading();
    flashHint(`Не удалось загрузить период: ${err.message}`, 'error');
  }
}

async function refreshView() {
  if (!state.month) return;
  try {
    applyView(await getJSON(`/api/subscribers?month=${encodeURIComponent(state.month)}`));
  } catch (err) {
    flashHint(`Не удалось обновить отчёт: ${err.message}`, 'error');
  }
}

function resetFilterButtons() {
  $$('.filter').forEach((b) => b.classList.toggle('active', b.dataset.filter === state.filter));
  $$('.sort').forEach((b) => {
    b.classList.toggle('active', b.dataset.sort === state.sort);
    if (b.dataset.sort === state.sort) b.dataset.dir = state.sortDir;
    else b.removeAttribute('data-dir');
  });
}

/* ── Применение представления ─────────────────────────────────────────────
 *
 * ПОЧЕМУ ЗДЕСЬ ДВА ЭТАПА, А НЕ ОДИН.
 *
 * Любая правка настройки возвращает с сервера ПЕРЕСЧИТАННЫЙ ОТЧЁТ ЦЕЛИКОМ —
 * иначе суммы на экране разъедутся с правилами. Но перерисовать по этому
 * поводу главный экран значит собрать заново сотню карточек (полмегабайта
 * разметки), четыре графика и все сводки. А главный экран в этот момент
 * закрыт панелью настроек, и человек его не видит.
 *
 * Именно на этом всё и подвисало: щёлкнул галку «в командировке» — и жди,
 * пока браузер перестроит то, чего на экране нет.
 *
 * Поэтому: данные кладём всегда, тяжёлую отрисовку — только когда главный
 * экран виден. Пока открыты настройки, ставим отметку mainStale и наверстаем
 * всё разом при закрытии.
 * ───────────────────────────────────────────────────────────────────────── */

let mainStale = false;

function settingsOpen() {
  const panel = $('settingsPanel');
  return !!panel && !panel.hidden;
}

function applyView(data) {
  applyViewData(data);
  if (settingsOpen()) { mainStale = true; return; }
  renderMain();
}

/** Догнать главный экран, если пока он был закрыт, данные успели смениться. */
function refreshMainIfStale() {
  if (!mainStale) return;
  mainStale = false;
  renderMain();
}

function applyViewData(data) {
  state.month = data.month || '';
  state.months = data.months || [];
  state.subscribers = data.subscribers || [];
  state.summary = data.summary || null;
  state.tariffStats = data.tariff_stats || [];
  state.tariffs = data.tariffs || state.tariffs;
  state.statuses = data.statuses || state.statuses;
  state.trend = data.trend || [];
  state.invoice = data.invoice || {};
  state.paymentSummary = data.payment_summary || null;
  state.chipColors = data.chip_colors || state.chipColors;
  state.chipMarks = data.chip_marks || state.chipMarks;
  state.trips = data.trips || state.trips;
  state.hasRoster = state.hasRoster || state.subscribers.some((s) => s.limit_set || s.username);
}

/** Вся отрисовка главного экрана. Дорого: сотня карточек и четыре графика. */
function renderMain() {
  const hasData = state.subscribers.length > 0;
  toggle('welcomeSection', !hasData);
  applyWidgetVisibility();
  ['downloadBtn', 'statsBtn'].forEach((id) => { const el = $(id); if (el) el.hidden = !hasData; });
  const picker = $('monthPickerWrap');
  if (picker) picker.hidden = state.months.length < 2;

  renderMonthSelect();
  renderStatusFilters();
  if (!hasData) { $('usersGrid').innerHTML = ''; return; }

  renderKpis();
  renderRiskDonut();
  renderRankList();
  renderActionsChart();
  renderUsageTotals();
  drawTrendChart();
  renderExtras();
  renderTariffCompare();
  renderUsers();
}

function toggle(id, visible) {
  const el = $(id);
  if (el) el.hidden = !visible;
}

function renderMonthSelect() {
  const sel = $('monthSelect');
  if (!sel) return;
  sel.innerHTML = state.months
    .map((m) => `<option value="${esc(m.month)}"${m.month === state.month ? ' selected' : ''}>`
      + `${esc(formatMonth(m.month))} — ${m.report_count} шт.</option>`)
    .join('');
}

/** Пользовательские статусы становятся фильтрами — так их видно в общем списке. */
function renderStatusFilters() {
  const group = $('filtersGroup');
  if (!group) return;
  $$('.filter[data-status]', group).forEach((b) => b.remove());
  const used = new Set(state.subscribers.map((s) => s.user_status).filter(Boolean));
  state.statuses.filter((st) => st.id !== 'normal' && used.has(st.id)).forEach((st) => {
    const btn = document.createElement('button');
    btn.className = 'filter filter-status';
    btn.dataset.filter = `status:${st.id}`;
    btn.dataset.status = st.id;
    btn.innerHTML = `<span class="dot" style="background:${esc(st.color)}"></span>${esc(st.label)}`;
    group.appendChild(btn);
  });
  bindFilters();
}

/* ── KPI и аналитика ─────────────────────────────────────────────────────── */
function renderKpis() {
  const s = state.summary;
  if (!s) return;

  setText('kpiCount', s.subscribers);
  const trips = state.subscribers.filter((x) => x.on_trip).length;
  setText('kpiCountSub', (state.month ? formatMonth(state.month) : '')
    + (trips ? ` · ${trips} в командировке` : ''));

  setText('kpiCost', money(s.total_cost));
  setText('kpiCostSub', `в среднем ${money(s.avg_cost)} на номер`);

  setText('kpiEconomy', money(s.economy_potential));
  const changing = (s.by_action.raise || 0) + (s.by_action.lower || 0) + (s.by_action.switch || 0);
  setText('kpiEconomySub', changing
    ? `сменить тариф: ${changing} ${plural(changing, 'номер', 'номера', 'номеров')}`
    : 'тарифы подобраны верно');

  setText('kpiOverpay', money(s.total_overpay));
  const chronic = state.subscribers.filter((x) => x.chronic).length;
  setText('kpiOverpaySub', !state.hasRoster ? 'лимиты не загружены'
    : (s.total_overpay > 0 ? `${chronic} превышают стабильно` : 'все в пределах лимитов'));

  setText('kpiCritical', s.critical);
  setText('kpiCriticalSub', `${s.overuse} с перерасходом пакета`);

  // ── Разделение оплаты «мы / сотрудник» ──────────────────────────────
  const ps = state.paymentSummary;
  if (ps) {
    setText('kpiCompany', money(ps.company_pays));
    setText('kpiCompanySub', `${pct(ps.company_share, 1)} счёта`
      + (ps.excluded_count ? ` · ${ps.excluded_count} исключено` : ''));

    setText('kpiEmployee', money(ps.employee_pays));
    setText('kpiEmployeeSub', 'перерасход и роуминг');

    setText('kpiWaste', money(ps.waste_money));
    setText('kpiWasteSub', ps.waste_money > 0
      ? `${money(ps.waste_money * 12)} в год · пакеты не выбираются`
      : 'пакеты подобраны точно');
  }

  setText('kpiYear', money(s.economy_potential * 12));
  setText('kpiYearSub', s.economy_potential > 0
    ? `при сохранении текущего потребления`
    : 'менять нечего');

  const roamers = state.subscribers.filter((x) => x.roaming_cost > 0);
  const roamingSum = roamers.reduce((acc, x) => acc + x.roaming_cost, 0);
  setText('kpiRoaming', money(roamingSum));
  setText('kpiRoamingSub', roamers.length
    ? `${roamers.length} ${plural(roamers.length, 'номер', 'номера', 'номеров')} вне домашнего региона`
    : 'роуминга в счёте нет');

  const idle = idleSubscribers();
  const idleSum = idle.reduce((acc, x) => acc + x.total, 0);
  setText('kpiIdle', idle.length);
  setText('kpiIdleSub', idle.length
    ? `${money(idleSum)}/мес за номера без потребления`
    : 'все номера используются');
}

/**
 * Номера, за которые платят, но которыми не пользуются.
 *
 * Порог считает сервер (domain.usage_level): несколько минут или пара
 * мегабайт набегают от служебных сообщений оператора и сами по себе не
 * означают, что SIM живая. Здесь порогов больше нет намеренно — пока они
 * были продублированы в браузере, «не используется» на карточке и в виджете
 * рисковали разойтись между собой.
 */
function idleSubscribers() {
  return state.subscribers.filter((s) => s.usage_level === 'none' || s.usage_level === 'idle');
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function renderRiskDonut() {
  const s = state.summary;
  const score = s ? s.risk_index : 0;
  const cls = score >= 60 ? 'danger' : score >= 30 ? 'warning' : 'good';
  const note = score >= 60 ? 'высокий риск' : score >= 30 ? 'средний риск' : 'низкий риск';
  const el = $('riskDonut');
  if (el) el.innerHTML = donutSvg(score, cls);
  const noteEl = $('riskNote');
  if (noteEl) { noteEl.textContent = note; noteEl.className = `risk-note txt-${cls}`; }

  const br = $('riskBreak');
  if (br && s) {
    br.innerHTML = [
      ['danger', 'Критично', s.critical],
      ['warning', 'Внимание', s.warning],
      ['good', 'Норма', s.subscribers - s.critical - s.warning],
    ].map(([cl, label, n]) => `<div class="risk-break-row">
      <span class="dot dot-${cl}"></span><span>${label}</span><b>${n}</b></div>`).join('');
  }
}

function donutSvg(score, cls) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `<svg viewBox="0 0 80 80" class="donut donut-${cls}" role="img" aria-label="Индекс риска ${score}">
    <circle cx="40" cy="40" r="${r}" class="donut-track"/>
    <circle cx="40" cy="40" r="${r}" class="donut-val"
            stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
            transform="rotate(-90 40 40)"/>
    <text x="40" y="46" text-anchor="middle" class="donut-text">${score}</text>
  </svg>`;
}

function renderRankList() {
  const el = $('rankList');
  if (!el) return;
  const top = [...state.subscribers].filter((s) => s.saving > 0)
    .sort((a, b) => b.saving - a.saving).slice(0, 6);

  if (!top.length) {
    el.innerHTML = '<div class="empty">Тарифы подобраны верно — менять нечего.</div>';
    return;
  }

  el.innerHTML = top.map((s, i) => `
    <button class="rank-item" data-goto="${esc(s.number)}">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${esc(s.username || formatPhone(s.number))}</span>
      <span class="rank-val">−${money(s.saving)}</span>
    </button>`).join('');

  bindGoto(el);
}

function renderActionsChart() {
  const el = $('actionsChart');
  if (!el || !state.summary) return;
  const total = state.summary.subscribers || 1;
  const rows = ['raise', 'lower', 'switch', 'keep']
    .map((key) => ({ key, count: state.summary.by_action[key] || 0 }))
    .filter((r) => r.count > 0);

  el.innerHTML = rows.map((r) => {
    const meta = ACTION_META[r.key];
    const pct = (r.count / total) * 100;
    return `<button class="action-row" data-filter-action="${r.key}" title="Показать эти номера">
      <span class="action-label"><b class="pill pill-${meta.cls}">${meta.icon}</b>${meta.label}</span>
      <span class="action-bar"><span class="action-fill fill-${meta.cls}" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="action-count">${r.count}</span>
    </button>`;
  }).join('');

  $$('[data-filter-action]', el).forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.filterAction;
      const target = action === 'keep' ? 'all' : (action === 'switch' ? 'lower' : action);
      const filterBtn = document.querySelector(`.filter[data-filter="${target}"]`);
      if (filterBtn) filterBtn.click();
      $('filtersPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/** Суммарное потребление компании — сколько минут, ГБ и SMS и во что обошлось. */
function renderUsageTotals() {
  const el = $('usageTotals');
  if (!el) return;
  const acc = { voice: { used: 0, cost: 0, over: 0 }, internet: { used: 0, cost: 0, over: 0 }, sms: { used: 0, cost: 0, over: 0 } };
  state.subscribers.forEach((s) => s.categories.forEach((c) => {
    const a = acc[c.key];
    if (!a) return;
    a.used += c.used;
    a.cost += c.cost;
    if (c.verdict.type === 'over') a.over += 1;
  }));

  el.innerHTML = Object.entries(acc).map(([key, a]) => {
    const meta = CAT_META[key];
    const usedText = key === 'internet' ? fmtGb(a.used) : `${Math.round(a.used).toLocaleString('ru-RU')} ${meta.unit}`;
    return `<div class="usage-row">
      <span class="usage-ico">${meta.icon}</span>
      <span class="usage-label">${meta.label}</span>
      <span class="usage-used">${usedText}</span>
      <span class="usage-cost">${money(a.cost)}</span>
      <span class="usage-over ${a.over ? 'txt-danger' : 'txt-muted'}">${a.over ? `${a.over} с перерасходом` : 'в пакетах'}</span>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * РАСШИРЕННАЯ АНАЛИТИКА
 *
 * Все блоки ниже считаются из `state.subscribers` — того же массива, что
 * рисует карточки. Сервер для них ничего дополнительно не отдаёт, поэтому
 * цифры здесь и в карточке абонента гарантированно совпадают.
 *
 * Блок, которому не хватает данных (нет лимитов, нет второго месяца, нет
 * списка сотрудников), не исчезает молча, а объясняет, что нужно загрузить,
 * — иначе пустое место читается как поломка.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Блоки расширенной аналитики: id блока → чем рисуется.
 *
 * Таблица нужна, чтобы НЕ РИСОВАТЬ ВЫКЛЮЧЕННОЕ. Каждый блок проходит по всему
 * парку номеров и собирает свою разметку; при отключённом блоке эта работа
 * уходила в никуда — элемент всё равно скрыт через applyWidgetVisibility.
 * На сотне номеров разница незаметна, на двух тысячах это четырнадцать
 * лишних проходов и сотни килобайт разметки в скрытых блоках.
 */
const EXTRA_WIDGETS = [
  ['exTrips', renderExTrips],
  ['exOversized', renderExOversized],
  ['exPayers', renderExPayers],
  ['exStructure', renderExStructure],
  ['exDistribution', renderExDistribution],
  ['exPareto', renderExPareto],
  ['exTopCost', renderExTopCost],
  ['exIdle', renderExIdle],
  ['exLimits', renderExLimits],
  ['exRoaming', renderExRoaming],
  ['exAnomalies', renderExAnomalies],
  ['exPositions', renderExPositions],
  ['exHeat', renderExHeat],
  ['exMatrix', renderExMatrix],
];

function renderExtras() {
  EXTRA_WIDGETS.forEach(([id, draw]) => {
    if (widgetOn(id)) draw();
  });
}

/* ── Примитивы ───────────────────────────────────────────────────────────── */

/** Строка «подпись — полоса — значение». С `number` становится кнопкой к карточке. */
function exRow({ name, sub, pct, value, cls, number, title }) {
  const tag = number ? 'button' : 'div';
  const attrs = number ? ` type="button" data-goto="${esc(number)}"` : '';
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<${tag} class="ex-row"${attrs}${title ? ` title="${esc(title)}"` : ''}>
    <span class="ex-row-name">${esc(name)}${sub ? ` <small>${esc(sub)}</small>` : ''}</span>
    <span class="ex-row-track"><span class="ex-row-fill${cls ? ` fill-${cls}` : ''}"
      style="width:${width.toFixed(1)}%"></span></span>
    <span class="ex-row-val">${value}</span>
  </${tag}>`;
}

/** Ряд чисел под заголовком блока. */
function exStats(items) {
  return `<div class="ex-stats">${items.map(([label, value]) =>
    `<span class="ex-stat"><span class="ex-stat-label" title="${esc(label)}">${esc(label)}</span>
      <span class="ex-stat-value">${value}</span></span>`).join('')}</div>`;
}

function exEmpty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

/** Открытие карточки абонента по клику на строке рейтинга. */
function bindGoto(root) {
  $$('[data-goto]', root).forEach((btn) => {
    btn.addEventListener('click', () => openModal(btn.dataset.goto));
  });
}

function share(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Процент с русской запятой — как и остальные числа в отчёте. */
function pct(value, digits = 0) {
  return `${(Number(value) || 0).toFixed(digits).replace('.', ',')}%`;
}

/** Значение перцентиля по возрастающе отсортированному массиву. */
function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Ширина шага шкалы, округлённая до «человеческого» числа (100, 250, 500…). */
function niceStep(span, buckets) {
  const raw = (span || 1) / Math.max(1, buckets);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) || mag * 10;
}

function catCost(s, key) {
  const c = (s.categories || []).find((x) => x.key === key);
  return c ? c.cost : 0;
}

/* ── Таблица командировок ────────────────────────────────────────────────
   Загруженные командировки видно прямо на главной, без похода в настройки.
   Сюда же выводится, попадает ли период в расчётный месяц счёта — именно
   от этого зависит, кто платит за роуминг. */
function renderExTrips() {
  const el = $('exTrips');
  if (!el) return;

  // Командировки приходят вместе с абонентами: в записи номера лежит поле
  // trip, если период пересекается с месяцем счёта.
  const inMonth = new Map();
  state.subscribers.forEach((s) => { if (s.trip) inMonth.set(s.number, s); });

  if (!state.trips || !state.trips.length) {
    el.innerHTML = exEmpty('Командировки не загружены. Кнопка «Командировки» в шапке — '
      + 'выгрузка с колонками «Абонентский номер», «ФИО», период, «Страна», «Утверждено».');
    return;
  }

  const rows = [...state.trips].sort((a, b) =>
    String(b.date_start || '').localeCompare(String(a.date_start || '')));
  const approved = rows.filter((t) => t.approved).length;
  const active = rows.filter((t) => inMonth.has(t.number)).length;

  el.innerHTML = exStats([
    ['Всего', String(rows.length)],
    ['Утверждено', String(approved)],
    [`Попадают в ${monthNom(state.month)}`, String(active)],
  ])
    + `<div class="trip-table">
      <div class="trip-row trip-row-head">
        <span>Номер</span><span>ФИО</span><span>Период</span><span>Страна</span>
        <span>Заказ</span><span>№ СЗ</span><span>Утв.</span><span>В месяце счёта</span>
      </div>
      <!-- Строки — в отдельном окне с прокруткой на пять командировок.
           Шапка остаётся снаружи, иначе она уезжает вверх при первом же
           движении колеса (высоту окна считает .trip-scroll). -->
      <div class="trip-scroll">
      ${rows.map((t) => {
        const sub = inMonth.get(t.number);
        return `<div class="trip-row${t.approved ? '' : ' is-unapproved'}">
          ${sub ? `<button class="trip-link" type="button" data-goto="${esc(t.number)}"
                     >${esc(formatPhone(t.number))}</button>`
                : `<span>${esc(formatPhone(t.number))}</span>`}
          <span title="${esc(t.username || '')}">${esc(t.username || '—')}</span>
          <span class="trip-period">${esc(t.date_start || '—')} — ${esc(t.date_end || '—')}</span>
          <span>${esc(t.country || '—')}</span>
          <span>${esc(t.order_no || '—')}</span>
          <span title="${esc(t.memo_no || '')}">${esc(t.memo_no || '—')}</span>
          <span class="${t.approved ? 'txt-good' : 'txt-warning'}">${t.approved ? 'да' : 'нет'}</span>
          <span>${sub ? 'да · роуминг ' + money(sub.roaming_cost || 0) : 'нет'}</span>
        </div>`;
      }).join('')}
      </div>
    </div>
    <div class="panel-hint">Командировка, пересекающаяся с расчётным месяцем счёта,
      переводит роуминг номера на компанию — он перестаёт считаться перерасходом
      сотрудника. Номера, попавшие в текущий период, кликабельны.
      ${rows.length > 5 ? `Видно пять из ${rows.length} — список прокручивается.` : ''}</div>`;
  bindGoto(el);
}

/* ── Слишком большой пакет: за что мы платим впустую ─────────────────────
   Главный ответ на вопрос «кто пользуется слишком большим пакетом».
   Сортировка по индексу невыгодности: вверху те, за кого мы платим много,
   а пакет стоит нетронутым. */
function renderExOversized() {
  const el = $('exOversized');
  if (!el) return;

  const rows = state.subscribers
    .filter((s) => s.waste && s.waste.waste_money > 0 && !(s.payment || {}).excluded)
    .sort((a, b) => b.waste.waste_money - a.waste.waste_money)
    .slice(0, 10);

  if (!rows.length) {
    el.innerHTML = exEmpty('Все оплаченные пакеты используются — переплаты за объём нет.');
    return;
  }

  const ps = state.paymentSummary || {};
  const max = rows[0].waste.waste_money || 1;

  el.innerHTML = exStats([
    ['Впустую в месяц', money(ps.waste_money || 0)],
    ['Впустую за год', money((ps.waste_money || 0) * 12)],
    ['Номеров', String(state.subscribers.filter(
      (s) => s.waste && s.waste.waste_money > 0).length)],
  ])
    + `<div class="ex-list">${rows.map((s) => exRow({
      name: s.username || formatPhone(s.number),
      sub: `${s.plan_name || 'тариф не определён'} · пакет выбран на ${pct(s.waste.package_use * 100)}`,
      pct: share(s.waste.waste_money, max),
      value: money(s.waste.waste_money),
      cls: s.waste.index >= 60 ? 'danger' : s.waste.index >= 30 ? 'warning' : 'accent',
      number: s.number,
      title: `Индекс невыгодности ${s.waste.index} из 100. `
        + `Компания платит ${money(s.payment.company_pays)}.`,
    })).join('')}</div>
    <div class="panel-hint">Считаем так: берём ту часть абонплаты, которую платит
      компания, и умножаем на неиспользованную долю пакета. Плюс четверть
      неосвоенного рублёвого лимита — это не убыток, а замороженный резерв.</div>`;
  bindGoto(el);
}

/* ── Кто за что платит ───────────────────────────────────────────────────── */
function renderExPayers() {
  const el = $('exPayers');
  if (!el) return;
  const ps = state.paymentSummary;
  if (!ps) { el.innerHTML = exEmpty('Нет данных.'); return; }

  const total = ps.company_pays + ps.employee_pays;
  if (total <= 0) { el.innerHTML = exEmpty('В счёте нет начислений.'); return; }

  const BUCKETS = [
    ['tariff', 'Абонентская плата', 'seg-fee'],
    ['options', 'Опции и сервисы', 'seg-net'],
    // Не «Перерасход пакета»: в корзине и он, и связь, которую пакет не
    // покрывает вовсе (межгород, международка). См. includes.INCLUDES.
    ['overage', 'Связь сверх пакета', 'seg-min'],
    ['roaming', 'Роуминг', 'seg-sms'],
  ];
  const byBucket = ps.company_by_bucket || {};
  const maxBucket = Math.max(...BUCKETS.map(([k]) => byBucket[k] || 0), 1);

  el.innerHTML = `
    <div class="ex-stack">
      <span class="ex-stack-seg seg-fee" style="width:${share(ps.company_pays, total).toFixed(2)}%"
        title="Компания: ${money(ps.company_pays)}"></span>
      <span class="ex-stack-seg seg-min" style="width:${share(ps.employee_pays, total).toFixed(2)}%"
        title="Сотрудник: ${money(ps.employee_pays)}"></span>
    </div>
    <div class="ex-stack-legend">
      <span class="ex-legend-item"><i class="seg-fee"></i><span>Платит компания</span>
        <b>${money(ps.company_pays)}</b><em>${pct(ps.company_share, 1)}</em></span>
      <span class="ex-legend-item"><i class="seg-min"></i><span>Платит сотрудник</span>
        <b>${money(ps.employee_pays)}</b><em>${pct(100 - ps.company_share, 1)}</em></span>
    </div>
    <div class="ex-subtitle">На что уходят деньги компании</div>
    <div class="ex-list">${BUCKETS.map(([key, label]) => exRow({
      name: label,
      pct: share(byBucket[key] || 0, maxBucket),
      value: money(byBucket[key] || 0),
      cls: key === 'overage' || key === 'roaming' ? 'danger' : '',
    })).join('')}</div>
    <div class="panel-hint">Перерасход и роуминг в строке компании означают, что
      сработало правило: цвет номера, пометка или командировка. По умолчанию их
      платит сотрудник.${ps.excluded_count
        ? ` Исключено из подсчёта номеров: ${ps.excluded_count}.` : ''}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ПАНЕЛЬ НАСТРОЙКИ ЧИПСА
 *
 * Открывается кнопкой «Настройка» прямо в карточке номера, чтобы не искать
 * каждого абонента в «Настройки → Абоненты».
 *
 * Что можно задать и как это влияет на деньги:
 *   Цвет      — это ПРАВИЛО. Покрасили в «Безлимит» — номер выпал из сводок.
 *   Пометки   — точечные правила поверх цвета, их можно навесить несколько.
 *   Плательщик— ручное указание по каждой корзине, сильнее цвета и пометок.
 *   Заметка   — свободный текст, на расчёт не влияет, ищется поиском.
 *   Лимит     — месячный потолок расхода в рублях.
 *
 * Всё сохраняется сразу в базу и переживает перезапуск.
 * ═════════════════════════════════════════════════════════════════════════ */

const PAYER_OPTIONS = [
  ['auto', 'по правилу'],
  ['company', 'компания'],
  ['employee', 'сотрудник'],
];

const PAYER_BUCKETS = [
  ['payer_tariff', 'Абонплата'],
  ['payer_options', 'Опции'],
  ['payer_overage', 'Сверх пакета'],
  ['payer_roaming', 'Роуминг'],
];

function cardChipPanel(s) {
  const chip = s.chip || {};
  const pay = s.payment || {};
  const marks = chip.marks || [];
  const colorCode = chip.color_code || 'normal';

  // ОДИН СПИСОК ПРАВИЛ.
  // Цвета и пометки — по сути одно и то же: набор эффектов, который вешают
  // на номер. Держать их двумя списками значило заставлять человека помнить,
  // в каком из двух рядов искать нужное. Теперь ряд один.
  //
  // Разница осталась только в поведении при нажатии, и она естественная:
  //   цвет  — заменяет предыдущий цвет (карточка красится в один тон);
  //   пометка — просто включается и выключается.
  // Объяснять это словами не нужно: нажал — увидел.
  const allRules = [
    ...(state.chipColors || []).map((r) => ({ ...r, kind: 'color' })),
    ...(state.chipMarks || []).map((r) => ({ ...r, kind: 'mark' })),
  ];
  const ruleButtons = allRules.map((r) => {
    const on = r.kind === 'color' ? r.code === colorCode : marks.includes(r.code);
    return `<button type="button" class="chip-rule${on ? ' is-on' : ''}"
      data-rule="${esc(r.code)}" data-kind="${r.kind}"
      style="--swatch:${esc(r.hex || '#8a9a94')}"
      aria-pressed="${on ? 'true' : 'false'}"
      title="${esc(r.description || r.label)}">
      <span class="chip-rule-dot"></span>
      <span class="chip-rule-label">${esc(r.label)}</span>
    </button>`;
  }).join('');

  const payerRows = PAYER_BUCKETS.map(([field, label]) => {
    const value = chip[field] || 'auto';
    const bucket = (pay.buckets || []).find((b) => `payer_${b.key}` === field) || {};
    return `<label class="chip-payer">
      <span class="chip-payer-label">${label}</span>
      <select class="chip-payer-select" data-field="${field}">
        ${PAYER_OPTIONS.map(([v, t]) =>
          `<option value="${v}"${v === value ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <span class="chip-payer-now">${bucket.amount !== undefined
        ? `${money(bucket.amount)} → ${payerText(bucket.payer)}` : '—'}</span>
      <span class="chip-payer-why">${esc(bucket.reason || '')}</span>
    </label>`;
  }).join('');

  const trip = s.trip;

  return `<div class="chip-setup" data-number="${esc(s.number)}">
    <!-- ПРАВИЛА НОМЕРА — один список, без деления на цвета и пометки. -->
    <div class="chip-setup-row">
      <div class="chip-setup-title">Нажмите правило, чтобы включить</div>
      <div class="chip-rules">${ruleButtons
        || '<span class="txt-muted">Правил нет</span>'}</div>
    </div>

    <!-- КТО ПЛАТИТ — свёрнуто по умолчанию.
         Это ручное переопределение поверх правил, нужно оно редко, а места
         занимало больше всего: четыре выпадающих списка сразу под правилами.
         Сложили в раскрывающийся блок — на экране осталась одна строка
         вместо четырёх, а кому надо, тот развернёт. -->
    <details class="chip-advanced">
      <summary>Переопределить вручную, кто платит</summary>
      <div class="chip-payers">${payerRows}</div>
    </details>

    <div class="chip-setup-row chip-setup-grid">
      <label class="chip-field">
        <span class="chip-setup-title">Лимит, ₽/мес</span>
        <input type="number" class="chip-limit" min="0" step="10"
               value="${s.limit_set ? s.limit : ''}" placeholder="не задан">
      </label>
      <label class="chip-field chip-field-wide">
        <span class="chip-setup-title">Заметка</span>
        <input type="text" class="chip-note" maxlength="300"
               value="${esc(chip.note || '')}" placeholder="например: модем на складе, не трогать">
      </label>
    </div>

    ${trip ? `<div class="chip-trip">Командировка: ${esc(trip.country || 'без страны')},
      ${esc(trip.date_start || '')} — ${esc(trip.date_end || '')}
      ${trip.approved ? '· утверждена' : '· НЕ утверждена'}
      ${trip.order_no ? `· заказ ${esc(trip.order_no)}` : ''}</div>` : ''}

    <div class="chip-setup-foot">
      <span class="chip-status" aria-live="polite"></span>
      <span class="panel-hint">Настройки хранятся в базе и не зависят от месяца:
        загрузите новый счёт — они останутся.</span>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ГЛАВНОЕ МЕНЮ
 *
 * Все действия шапки собраны под одну кнопку. Поведение сделано максимально
 * предсказуемым, потому что работать с этим будет человек, который редко
 * пользуется компьютером:
 *   — меню закрывается само после выбора пункта;
 *   — закрывается по клику мимо и по Esc;
 *   — ничего не открывается при простом наведении мыши, только по нажатию.
 * ═════════════════════════════════════════════════════════════════════════ */
function bindMainMenu() {
  const btn = $('menuBtn');
  const drop = $('mainMenu');
  if (!btn || !drop) return;

  const setOpen = (open) => {
    drop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-open', open);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(drop.hidden);
  });

  // Выбрали пункт — меню уходит. Само действие выполнит обработчик кнопки,
  // навешанный отдельно (см. init): здесь мы только закрываем список.
  drop.addEventListener('click', (e) => {
    if (e.target.closest('.menu-item')) setOpen(false);
  });

  document.addEventListener('click', (e) => {
    if (!drop.hidden && !e.target.closest('.menu-wrap')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drop.hidden) { setOpen(false); btn.focus(); }
  });
}

function payerText(payer) {
  return { company: 'компания', employee: 'сотрудник', mixed: 'поровну' }[payer] || 'по умолчанию';
}

/** Навесить обработчики на панель настройки чипса. */
function bindChipPanel(panel) {
  const root = panel.querySelector('.chip-setup');
  if (!root) return;
  const number = root.dataset.number;
  const statusEl = root.querySelector('.chip-status');

  const flash = (text, bad = false) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `chip-status${bad ? ' is-error' : ' is-ok'}`;
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'chip-status'; }, 2200);
  };

  const save = async (payload) => {
    try {
      const data = await postJSON(`/api/chips/${encodeURIComponent(number)}`, payload);
      flash('Сохранено');
      // Отчёт пересобирается на сервере: правило могло изменить суммы.
      if (data.view) {
        state.openPanels[number] = 'chip';
        applyView(data.view);
      }
    } catch (err) {
      flash(err.message, true);
    }
  };

  // Один обработчик на весь список правил. Что делать — решает вид правила:
  //   цвет   — заменяет прежний цвет; повторное нажатие снимает его ('normal');
  //   пометка — просто включается и выключается.
  $$('.chip-rule', root).forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = btn.classList.contains('is-on');

    if (btn.dataset.kind === 'color') {
      // Гасим остальные цвета сразу, не дожидаясь ответа сервера — иначе
      // кнопка «залипает» на время запроса и человек жмёт второй раз.
      $$('.chip-rule[data-kind="color"]', root).forEach((b) => {
        b.classList.remove('is-on');
        b.setAttribute('aria-pressed', 'false');
      });
      if (!on) { btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true'); }
      save({ color_code: on ? 'normal' : btn.dataset.rule });
      return;
    }

    btn.classList.toggle('is-on');
    btn.setAttribute('aria-pressed', on ? 'false' : 'true');
    save({ marks: $$('.chip-rule[data-kind="mark"].is-on', root).map((b) => b.dataset.rule) });
  }));

  $$('.chip-payer-select', root).forEach((sel) => sel.addEventListener('change', (e) => {
    e.stopPropagation();
    save({ [sel.dataset.field]: sel.value });
  }));

  const note = root.querySelector('.chip-note');
  if (note) {
    note.addEventListener('click', (e) => e.stopPropagation());
    note.addEventListener('change', () => save({ note: note.value }));
  }

  // Лимит живёт в карточке абонента (users_numbers), а не в настройках чипса,
  // поэтому уходит своим эндпоинтом.
  const limit = root.querySelector('.chip-limit');
  if (limit) {
    limit.addEventListener('click', (e) => e.stopPropagation());
    limit.addEventListener('change', async () => {
      try {
        const data = await postJSON(`/api/users/${encodeURIComponent(number)}`,
          { limit: limit.value === '' ? 0 : Number(limit.value) });
        flash('Лимит сохранён');
        if (data.view) { state.openPanels[number] = 'chip'; applyView(data.view); }
      } catch (err) { flash(err.message, true); }
    });
  }
}

/* ── Структура расходов компании ─────────────────────────────────────────── */
function renderExStructure() {
  const el = $('exStructure');
  if (!el) return;
  const subs = state.subscribers;
  const total = subs.reduce((a, s) => a + s.total, 0);
  if (total <= 0) { el.innerHTML = exEmpty('В счёте нет начислений.'); return; }

  const fee = subs.reduce((a, s) => a + s.plan_fee, 0);
  const voice = subs.reduce((a, s) => a + catCost(s, 'voice'), 0);
  const net = subs.reduce((a, s) => a + catCost(s, 'internet'), 0);
  const sms = subs.reduce((a, s) => a + catCost(s, 'sms'), 0);
  // Остаток — опции и услуги, не попавшие ни в одну категорию. Считаем его
  // вычитанием, чтобы сумма сегментов всегда сходилась с итогом счёта.
  const other = Math.max(0, total - fee - voice - net - sms);
  const roaming = subs.reduce((a, s) => a + (s.roaming_cost || 0), 0);

  const segs = [
    ['Абонентская плата', fee, 'seg-fee'],
    ['Минуты сверх пакета', voice, 'seg-min'],
    ['Интернет сверх пакета', net, 'seg-net'],
    ['SMS сверх пакета', sms, 'seg-sms'],
    ['Опции и прочие услуги', other, 'seg-other'],
  ].filter(([, v]) => v > 0);

  el.innerHTML = `
    <div class="ex-stack">${segs.map(([label, v, cls]) =>
      `<span class="ex-stack-seg ${cls}" style="width:${share(v, total).toFixed(2)}%"
        title="${esc(label)}: ${money(v)}"></span>`).join('')}</div>
    <div class="ex-stack-legend">${segs.map(([label, v, cls]) =>
      `<span class="ex-legend-item"><i class="${cls}"></i><span>${esc(label)}</span>
        <b>${money(v)}</b><em>${pct(share(v, total))}</em></span>`).join('')}</div>
    <div class="panel-hint">Итого по счёту ${money(total)}.${roaming > 0
      ? ` В том числе роуминг и связь вне домашнего региона — ${money(roaming)}
         (${pct(share(roaming, total), 1)} счёта); эта сумма уже входит в сегменты выше.` : ''}</div>`;
}

/* ── Распределение расходов по номерам ───────────────────────────────────── */
function renderExDistribution() {
  const el = $('exDistribution');
  if (!el) return;
  const values = state.subscribers.map((s) => s.total).sort((a, b) => a - b);
  if (!values.length) { el.innerHTML = exEmpty('Нет данных.'); return; }

  const max = values[values.length - 1];
  const p90 = percentile(values, 0.9);
  const median = percentile(values, 0.5);
  const avg = values.reduce((a, v) => a + v, 0) / values.length;

  const BUCKETS = 6;
  const step = niceStep(max, BUCKETS);
  const counts = new Array(BUCKETS).fill(0);
  values.forEach((v) => {
    // Всё, что выше шкалы, попадает в последнюю корзину — она открытая.
    counts[Math.min(BUCKETS - 1, Math.floor(v / step))] += 1;
  });
  const peak = Math.max(...counts, 1);

  el.innerHTML = exStats([
    ['Медиана', money(median)],
    ['Среднее', money(avg)],
    ['90-й перцентиль', money(p90)],
    ['Максимум', money(max)],
  ])
    + `<div class="ex-hist">${counts.map((n, i) => `
      <div class="ex-hist-col" title="${compact(i * step)}–${i === BUCKETS - 1 ? '∞' : compact((i + 1) * step)} ₽: ${n} ${plural(n, 'номер', 'номера', 'номеров')}">
        <span class="ex-hist-num">${n || ''}</span>
        <span class="ex-hist-bar${n ? '' : ' is-empty'}" style="height:${(n / peak) * 100}%"></span>
      </div>`).join('')}</div>
    <div class="ex-hist-axis">${counts.map((_, i) =>
      `<span>${i === BUCKETS - 1 ? `${compact(i * step)}+` : compact(i * step)}</span>`).join('')}</div>
    <div class="panel-hint">Шаг корзины — ${compact(step)} ₽. Половина номеров укладывается
      в ${money(median)}, но верхние 10% начинаются от ${money(p90)}.</div>`;
}

/* ── ABC-анализ ──────────────────────────────────────────────────────────── */
function renderExPareto() {
  const el = $('exPareto');
  if (!el) return;
  const sorted = [...state.subscribers].sort((a, b) => b.total - a.total);
  const total = sorted.reduce((a, s) => a + s.total, 0);
  if (total <= 0) { el.innerHTML = exEmpty('В счёте нет начислений.'); return; }

  // A — номера, которые дают первые 80% расходов, B — следующие 15%, C — остальные.
  const groups = { A: [], B: [], C: [] };
  let cum = 0;
  sorted.forEach((s) => {
    const before = cum / total;
    cum += s.total;
    if (before < 0.8) groups.A.push(s);
    else if (before < 0.95) groups.B.push(s);
    else groups.C.push(s);
  });

  const meta = {
    A: ['Ключевые расходы', 'первые 80% счёта'],
    B: ['Средние расходы', 'следующие 15%'],
    C: ['Хвост', 'последние 5%'],
  };

  const topFifth = Math.max(1, Math.round(sorted.length * 0.2));
  const topFifthSum = sorted.slice(0, topFifth).reduce((a, s) => a + s.total, 0);

  el.innerHTML = `<div class="ex-abc">${Object.entries(groups).map(([key, list]) => {
    const sum = list.reduce((a, s) => a + s.total, 0);
    return `<div class="ex-abc-row abc-${key.toLowerCase()}">
      <span class="ex-abc-key">${key}</span>
      <span class="ex-abc-text">
        <b>${meta[key][0]} — ${list.length} ${plural(list.length, 'номер', 'номера', 'номеров')}</b>
        <span>${pct(share(list.length, sorted.length))} абонентов ·
          ${pct(share(sum, total))} расходов · ${meta[key][1]}</span>
      </span>
      <span class="ex-abc-sum">${money(sum)}</span>
    </div>`;
  }).join('')}</div>
  <div class="panel-hint">Верхние 20% номеров (${topFifth} ${plural(topFifth, 'штука', 'штуки', 'штук')})
    дают ${pct(share(topFifthSum, total))} счёта. Разбор группы A окупается быстрее всего.</div>`;
}

/* ── Топ-10 по расходам ──────────────────────────────────────────────────── */
function renderExTopCost() {
  const el = $('exTopCost');
  if (!el) return;
  const sorted = [...state.subscribers].sort((a, b) => b.total - a.total).slice(0, 10);
  if (!sorted.length) { el.innerHTML = exEmpty('Нет данных.'); return; }

  const total = state.subscribers.reduce((a, s) => a + s.total, 0);
  const max = sorted[0].total || 1;

  el.innerHTML = `<div class="ex-list">${sorted.map((s) => exRow({
    name: s.username || formatPhone(s.number),
    sub: pct(share(s.total, total), 1),
    pct: share(s.total, max),
    value: money(s.total),
    cls: s.status === 'danger' ? 'danger' : s.status === 'warning' ? 'warning' : '',
    number: s.number,
    title: `${s.plan_name || 'тариф не определён'} · нажмите, чтобы открыть карточку`,
  })).join('')}</div>
  <div class="panel-hint">В сумме — ${money(sorted.reduce((a, s) => a + s.total, 0))},
    это ${pct(share(sorted.reduce((a, s) => a + s.total, 0), total))} счёта.</div>`;
  bindGoto(el);
}

/* ── Неиспользуемые номера ───────────────────────────────────────────────── */
function renderExIdle() {
  const el = $('exIdle');
  if (!el) return;
  const idle = idleSubscribers().sort((a, b) => b.total - a.total);

  if (!idle.length) {
    el.innerHTML = exEmpty('Все номера в счёте что-то потребляют — отключать нечего.');
    return;
  }

  const sum = idle.reduce((a, s) => a + s.total, 0);
  const max = idle[0].total || 1;

  el.innerHTML = exStats([
    ['Номеров', String(idle.length)],
    ['В месяц', money(sum)],
    ['В год', money(sum * 12)],
  ])
    + `<div class="ex-list">${idle.slice(0, 8).map((s) => exRow({
      name: s.username || formatPhone(s.number),
      sub: s.plan_name || '',
      pct: share(s.total, max),
      value: money(s.total),
      cls: 'accent',
      number: s.number,
      title: 'Нет исходящих минут, интернета и SMS за период',
    })).join('')}</div>
    ${idle.length > 8 ? `<div class="panel-hint">Показаны 8 самых дорогих из ${idle.length}.</div>` : ''}
    <div class="panel-hint">Ни исходящих минут, ни интернета, ни SMS за ${esc(monthNom(state.month))}.
      Прежде чем отключать, проверьте — это может быть модем, шлагбаум или сигнализация.</div>`;
  bindGoto(el);
}

/* ── Освоение лимитов ────────────────────────────────────────────────────── */
function renderExLimits() {
  const el = $('exLimits');
  if (!el) return;
  const withLimit = state.subscribers.filter((s) => s.limit_set && s.limit > 0);

  if (!withLimit.length) {
    el.innerHTML = exEmpty('Лимиты не заданы. Загрузите список абонентов с колонкой «Лимит» '
      + 'или проставьте лимиты вручную в настройках.');
    return;
  }

  const limitSum = withLimit.reduce((a, s) => a + s.limit, 0);
  const spent = withLimit.reduce((a, s) => a + s.total, 0);

  const bands = [
    { label: 'до 50% лимита', cls: 'accent', test: (r) => r < 0.5 },
    { label: '50–80%', cls: 'good', test: (r) => r >= 0.5 && r < 0.8 },
    { label: '80–100%', cls: 'warning', test: (r) => r >= 0.8 && r <= 1 },
    { label: 'свыше лимита', cls: 'danger', test: (r) => r > 1 },
  ];
  const rows = bands.map((b) => ({
    ...b, count: withLimit.filter((s) => b.test(s.total / s.limit)).length,
  }));

  el.innerHTML = exStats([
    ['Сумма лимитов', money(limitSum)],
    ['Начислено', money(spent)],
    ['Освоено', pct(share(spent, limitSum))],
  ])
    + `<div class="ex-list">${rows.map((r) => exRow({
      name: r.label,
      pct: share(r.count, withLimit.length),
      value: String(r.count),
      cls: r.cls,
    })).join('')}</div>
    <div class="panel-hint">Лимиты заданы у ${withLimit.length} из ${state.subscribers.length}
      ${plural(state.subscribers.length, 'номера', 'номеров', 'номеров')}.
      Группа «до 50%» — это лимиты, выданные с запасом: их можно снизить, не мешая работе.</div>`;
}

/* ── Роуминг и командировки ──────────────────────────────────────────────── */
function renderExRoaming() {
  const el = $('exRoaming');
  if (!el) return;
  const roamers = state.subscribers.filter((s) => s.roaming_cost > 0)
    .sort((a, b) => b.roaming_cost - a.roaming_cost);

  if (!roamers.length) {
    el.innerHTML = exEmpty('Роуминга и связи вне домашнего региона в счёте нет.');
    return;
  }

  const sum = roamers.reduce((a, s) => a + s.roaming_cost, 0);
  // Роуминг без отметки о командировке — либо забыли отметить, либо расход
  // личный. И то и другое стоит проверить, поэтому выносим отдельным числом.
  const unmarked = roamers.filter((s) => !s.on_trip);
  const max = roamers[0].roaming_cost || 1;

  el.innerHTML = exStats([
    ['Роуминг всего', money(sum)],
    ['Номеров', String(roamers.length)],
    ['Без отметки', String(unmarked.length)],
  ])
    + `<div class="ex-list">${roamers.slice(0, 8).map((s) => exRow({
      name: `${s.on_trip ? '· ' : ''}${s.username || formatPhone(s.number)}`,
      sub: s.on_trip ? 'в командировке' : 'без отметки',
      pct: share(s.roaming_cost, max),
      value: money(s.roaming_cost),
      cls: s.on_trip ? 'accent' : 'danger',
      number: s.number,
    })).join('')}</div>
    ${roamers.length > 8 ? `<div class="panel-hint">Показаны 8 из ${roamers.length}.</div>` : ''}
    ${unmarked.length ? `<div class="panel-hint warn">${unmarked.length}
      ${plural(unmarked.length, 'номер потратил', 'номера потратили', 'номеров потратили')}
      ${money(unmarked.reduce((a, s) => a + s.roaming_cost, 0))} в роуминге без отметки о командировке.
      Отметьте командировку в настройках — тогда перерасход не будет считаться нарушением.</div>` : ''}`;
  bindGoto(el);
}

/* ── Аномалии месяца ─────────────────────────────────────────────────────── */
function renderExAnomalies() {
  const el = $('exAnomalies');
  if (!el) return;

  const changes = state.subscribers.map((s) => {
    const hist = s.history || [];
    const i = hist.findIndex((h) => h.month === s.month);
    const prev = i > 0 ? hist[i - 1].total : null;
    if (prev === null || prev <= 0) return null;
    const delta = s.total - prev;
    return { s, prev, delta, pct: (delta / prev) * 100 };
  }).filter(Boolean);

  if (!changes.length) {
    el.innerHTML = exEmpty('Не с чем сравнивать: нужен счёт минимум за два месяца '
      + 'или список абонентов с помесячными расходами.');
    return;
  }

  // Порог двойной: и процент, и рубли. Рост со 20 ₽ до 60 ₽ — это +200%,
  // но разбираться там не с чем.
  const flagged = changes.filter((c) => Math.abs(c.pct) >= 25 && Math.abs(c.delta) >= 50)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  if (!flagged.length) {
    el.innerHTML = exEmpty(`Резких изменений нет: все номера в пределах ±25% к предыдущему месяцу.`);
    return;
  }

  const grew = flagged.filter((c) => c.delta > 0);
  const fell = flagged.filter((c) => c.delta < 0);
  const max = Math.abs(flagged[0].delta) || 1;

  el.innerHTML = exStats([
    ['Выросли', String(grew.length)],
    ['Снизились', String(fell.length)],
    ['Прирост', money(grew.reduce((a, c) => a + c.delta, 0))],
  ])
    + `<div class="ex-list">${flagged.slice(0, 8).map((c) => exRow({
      name: `${c.delta > 0 ? '↗' : '↘'} ${c.s.username || formatPhone(c.s.number)}`,
      sub: `${money(c.prev)} → ${money(c.s.total)}`,
      pct: share(Math.abs(c.delta), max),
      value: `${c.delta > 0 ? '+' : '−'}${money(Math.abs(c.delta))}`,
      cls: c.delta > 0 ? 'danger' : 'good',
      number: c.s.number,
      title: `${c.pct > 0 ? '+' : ''}${Math.round(c.pct)}% к предыдущему месяцу`,
    })).join('')}</div>
    ${flagged.length > 8 ? `<div class="panel-hint">Показаны 8 самых крупных из ${flagged.length}.</div>` : ''}
    <div class="panel-hint">Порог — изменение больше 25% и больше 50 ₽ к предыдущему месяцу.</div>`;
  bindGoto(el);
}

/* ── Расходы по должностям ───────────────────────────────────────────────── */
function renderExPositions() {
  const el = $('exPositions');
  if (!el) return;

  const byPos = new Map();
  state.subscribers.forEach((s) => {
    const key = (s.position || '').trim();
    if (!key) return;
    const row = byPos.get(key) || { name: key, count: 0, total: 0, saving: 0 };
    row.count += 1;
    row.total += s.total;
    row.saving += s.saving;
    byPos.set(key, row);
  });

  if (!byPos.size) {
    el.innerHTML = exEmpty('Должности не заполнены. Загрузите список абонентов — '
      + 'должность берётся из колонки «Должность».');
    return;
  }

  const rows = [...byPos.values()].sort((a, b) => b.total - a.total);
  const max = rows[0].total || 1;
  const total = rows.reduce((a, r) => a + r.total, 0);

  el.innerHTML = `<div class="ex-list">${rows.slice(0, 12).map((r) => exRow({
    name: r.name,
    sub: `${r.count} ${plural(r.count, 'номер', 'номера', 'номеров')} · в среднем ${money(r.total / r.count)}`,
    pct: share(r.total, max),
    value: money(r.total),
    cls: r.saving > 0 ? 'accent' : '',
    title: r.saving > 0 ? `Потенциал экономии по группе — ${money(r.saving)}/мес` : '',
  })).join('')}</div>
  <div class="panel-hint">${rows.length > 12 ? `Показаны 12 должностей из ${rows.length}. ` : ''}Всего
    по должностям ${money(total)}. Цветом выделены группы, где есть что сэкономить.</div>`;
}

/* ── Тепловая карта «категория × вердикт» ────────────────────────────────── */
function renderExHeat() {
  const el = $('exHeat');
  if (!el) return;

  const keys = Object.keys(CAT_META);
  const counts = {};
  keys.forEach((k) => { counts[k] = {}; });
  state.subscribers.forEach((s) => (s.categories || []).forEach((c) => {
    if (!counts[c.key]) return;
    const t = c.verdict.type;
    counts[c.key][t] = (counts[c.key][t] || 0) + 1;
  }));

  const peak = Math.max(1, ...keys.flatMap((k) => Object.values(counts[k])));

  el.innerHTML = `<table class="ex-heat">
    <thead><tr><th class="ex-heat-corner"></th>
      ${VERDICT_COLS.map((v) => `<th>${esc(v.label)}</th>`).join('')}</tr></thead>
    <tbody>${keys.map((k) => `<tr>
      <td class="ex-heat-name">${CAT_META[k].icon} ${esc(CAT_META[k].label)}</td>
      ${VERDICT_COLS.map((v) => {
        const n = counts[k][v.type] || 0;
        // Насыщенность фона — доля от самой заполненной клетки: так видно,
        // где скопление, без отдельной легенды.
        const weight = n ? Math.round(15 + 60 * (n / peak)) : 0;
        const tone = v.cls === 'muted' ? 'text-muted' : v.cls;
        const bg = n ? `background:color-mix(in srgb, var(--${tone}) ${weight}%, var(--surface));` : '';
        return `<td class="ex-heat-cell${n ? ' has-value' : ''}" style="${bg}"
          title="${esc(CAT_META[k].label)} · ${esc(v.label)}: ${n}">${n || '·'}</td>`;
      }).join('')}
    </tr>`).join('')}</tbody>
  </table>
  <div class="panel-hint">Сколько номеров попало в каждый вердикт по каждой категории.
    «Перерасход» — пакета не хватило, «Недоиспользование» — пакет избыточен,
    «Вне пакета» — начисления за услуги, которые пакет не покрывает.</div>`;
}

/* ── Матрица «расход × риск» ─────────────────────────────────────────────── */
function renderExMatrix() {
  const host = $('exMatrix');
  if (!host) return;
  const subs = state.subscribers;
  if (!subs.length) { host.innerHTML = exEmpty('Нет данных.'); return; }

  // padT с запасом: наверху шкалы сидят самые рискованные номера, и при
  // маленьком отступе их точки наезжали на подписи осей.
  const W = Math.max(420, Math.round(host.clientWidth || 900));
  const H = 252, padL = 52, padR = 16, padT = 28, padB = 32;
  const cw = W - padL - padR;
  const ch = H - padT - padB;

  const maxCost = Math.max(...subs.map((s) => s.total), 1);
  const x = (v) => padL + (v / maxCost) * cw;
  const y = (v) => padT + ch - (Math.max(0, Math.min(100, v)) / 100) * ch;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gy = padT + (i / 4) * ch;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="grid"/>`
      + `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="axis-label">`
      + `${100 - i * 25}</text>`;
  }

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f, i, arr) =>
    `<text x="${x(maxCost * f).toFixed(1)}" y="${H - 10}"
      text-anchor="${i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}"
      class="axis-label">${compact(maxCost * f)}</text>`).join('');

  // Дорогие и рискованные — правый верхний угол; рисуем их последними,
  // чтобы они оказались поверх плотного облака дешёвых номеров.
  const dots = [...subs].sort((a, b) => (a.total + a.risk * 10) - (b.total + b.risk * 10))
    .map((s) => `<circle class="ex-dot ex-dot-${s.status}" data-goto="${esc(s.number)}"
      cx="${x(s.total).toFixed(1)}" cy="${y(s.risk).toFixed(1)}" r="4.5">
      <title>${esc(s.username || formatPhone(s.number))} — ${money(s.total)}, риск ${s.risk}
${esc(s.plan_name || 'тариф не определён')}</title></circle>`).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ex-scatter" preserveAspectRatio="xMidYMid meet">
    ${grid}${xTicks}${dots}
    <text x="${padL - 8}" y="12" text-anchor="end" class="axis-label">риск</text>
    <text x="${W - padR}" y="12" text-anchor="end" class="axis-label">начислено, ₽</text>
  </svg>
  <div class="ex-scatter-note">Каждая точка — номер: по горизонтали начислено за месяц,
    по вертикали индекс риска. Правый верхний угол — дорого и проблемно, туда и смотреть в первую очередь.
    Нажмите на точку, чтобы открыть карточку.</div>`;
  bindGoto(host);
}

/* ── График динамики ─────────────────────────────────────────────────────── */
function drawTrendChart() {
  const host = $('bigChart');
  if (!host) return;
  const data = state.trend || [];

  if (data.length < 2) {
    // ПУСТОЕ СОСТОЯНИЕ.
    // Раньше здесь висела строка текста внутри карточки во всю ширину — дыра
    // на пол-экрана посреди отчёта. Теперь блок схлопывается в узкую полосу и
    // сразу говорит, что сделать, чтобы график появился.
    host.closest('.chart-block')?.classList.add('is-empty');
    host.innerHTML = `<div class="empty-inline">
      <span class="empty-inline-mark">◐</span>
      <span>График появится, когда будет счёт минимум за два месяца.
        <b>Загрузите ещё один счёт</b> — или список абонентов с помесячными расходами.</span>
    </div>`;
    return;
  }
  // Данные появились — снимаем схлопнутое состояние.
  host.closest('.chart-block')?.classList.remove('is-empty');

  // viewBox подгоняется под фактическую ширину блока, а высота фиксирована.
  // Так график занимает ровно 200 px по вертикали и подписи не масштабируются:
  // при фиксированном узком viewBox высота тянулась за шириной и график
  // разрастался на пол-экрана. По resize график перерисовывается (см. init).
  const W = Math.max(360, Math.round(host.clientWidth || 720));
  const H = 176, padL = 58, padR = 16, padT = 16, padB = 28;
  const cw = W - padL - padR, ch = H - padT - padB;
  const values = data.map((d) => d.total);
  const max = Math.max(...values, 1) * 1.15;
  const x = (i) => padL + (data.length === 1 ? cw / 2 : (i / (data.length - 1)) * cw);
  const y = (v) => padT + ch - (v / max) * ch;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gy = padT + (i / 4) * ch;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="grid"/>`
      + `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="axis-label">`
      + `${compact(max * (1 - i / 4))}</text>`;
  }

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${x(0).toFixed(1)},${(padT + ch).toFixed(1)} L${pts.join(' L')} `
    + `L${x(values.length - 1).toFixed(1)},${(padT + ch).toFixed(1)} Z`;
  const dots = values.map((v, i) => {
    const fromBill = data[i].source !== 'roster';
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${fromBill ? 4.5 : 3.5}"`
      + ` class="${fromBill ? 'big-dot' : 'big-dot big-dot-roster'}">`
      + `<title>${esc(formatMonth(data[i].month))}: ${money(v)} · ${data[i].subscribers} абонентов`
      + ` · ${fromBill ? 'из счёта' : 'из списка абонентов'}</title></circle>`;
  }).join('');
  // Крайние подписи прижимаются к своей стороне: по центру они наезжали на
  // подписи оси слева и обрезались краем svg справа.
  const anchor = (i) => (i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle');
  const labels = data.map((d, i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor(i)}" class="axis-label">`
    + `${esc(shortMonth(d.month))}</text>`).join('');
  const valueLabels = values.map((v, i) =>
    `<text x="${x(i).toFixed(1)}" y="${(y(v) - 10).toFixed(1)}" text-anchor="${anchor(i)}" class="big-vlabel">`
    + `${compact(v)}</text>`).join('');

  const mixed = data.some((d) => d.source === 'roster') && data.some((d) => d.source !== 'roster');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="big-svg" preserveAspectRatio="xMidYMid meet">
    ${grid}<path d="${area}" class="big-area"/>
    <polyline points="${pts.join(' ')}" class="big-line"/>
    ${dots}${valueLabels}${labels}
  </svg>`
    + (mixed ? '<div class="chart-legend"><span class="legend-dot legend-bill"></span>из счёта'
      + '<span class="legend-dot legend-roster"></span>из списка абонентов</div>' : '');
}

/** Универсальный линейный график для карточки абонента. */
function lineChart(points, opts) {
  const o = Object.assign({ W: 300, H: 120, limit: 0, fmt: (v) => compact(v), unit: '' }, opts || {});
  if (!points.length) return '<div class="empty">Нет данных</div>';
  const padL = 44, padR = 10, padT = 14, padB = 22;
  const cw = o.W - padL - padR, ch = o.H - padT - padB;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, o.limit, 1) * 1.18;
  const x = (i) => padL + (points.length === 1 ? cw / 2 : (i / (points.length - 1)) * cw);
  const y = (v) => padT + ch - (v / max) * ch;

  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const gy = padT + (i / 2) * ch;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${o.W - padR}" y2="${gy.toFixed(1)}" class="grid"/>`
      + `<text x="${padL - 6}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="axis-label sm">`
      + `${esc(o.fmt(max * (1 - i / 2)))}</text>`;
  }
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${x(0).toFixed(1)},${(padT + ch).toFixed(1)} L${pts.join(' L')} `
    + `L${x(values.length - 1).toFixed(1)},${(padT + ch).toFixed(1)} Z`;
  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${p.current ? 4 : 2.8}"
      class="${p.current ? 'spark-dot-real' : 'spark-dot'}">
      <title>${esc(formatMonth(p.month))}: ${esc(o.fmt(p.value))}${o.unit ? ' ' + o.unit : ''}</title></circle>`).join('');
  // На узком графике «фев 26 мар 26 …» слипается в сплошную строку, поэтому
  // год оставляем только у первой точки, дальше — один месяц.
  const labels = points.map((p, i) => {
    const full = shortMonth(p.month);
    const tick = points.length > 4 && i > 0 ? full.split(' ')[0] : full;
    return `<text x="${x(i).toFixed(1)}" y="${o.H - 5}"
      text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}"
      class="axis-label sm">${esc(tick)}</text>`;
  }).join('');
  const limitLine = o.limit > 0
    ? `<line x1="${padL}" y1="${y(o.limit).toFixed(1)}" x2="${o.W - padR}" y2="${y(o.limit).toFixed(1)}"
        class="spark-limit"><title>Пакет: ${esc(o.fmt(o.limit))}</title></line>` : '';

  return `<svg viewBox="0 0 ${o.W} ${o.H}" class="mini-chart" preserveAspectRatio="xMidYMid meet">
    ${grid}<path d="${area}" class="spark-area"/>
    <polyline points="${pts.join(' ')}" class="spark-line"/>
    ${limitLine}${dots}${labels}
  </svg>`;
}

/**
 * График потребления одной категории — минуты, интернет или SMS — за
 * последние месяцы. Точки берутся из `category_history`: это разбивка из
 * счетов, поэтому месяцев столько, за сколько счета загружены.
 * Пунктир — объём пакета по текущему тарифу: сразу видно, где абонент из
 * пакета вылезает.
 */
function categoryChart(s, key, opts) {
  const o = Object.assign({ months: 6, W: 300, H: 118 }, opts || {});
  const meta = CAT_META[key];
  if (!meta) return '';

  const hist = (s.category_history || []).slice(-o.months);
  if (hist.length < 2) {
    return `<div class="empty">${hist.length
      ? 'Счёт загружен только за один месяц — для графика нужно минимум два.'
      : 'Помесячной разбивки по категориям нет.'} Загрузите счета за предыдущие месяцы.</div>`;
  }

  const cat = s.categories.find((c) => c.key === key) || {};
  const isNet = key === 'internet';
  const points = hist.map((m) => ({
    month: m.month,
    value: isNet ? (m[meta.usageKey] || 0) / 1024 : (m[meta.usageKey] || 0),
    current: m.month === s.month,
  }));
  const quota = isNet ? (cat.quota || 0) / 1024 : (cat.quota || 0);
  const fmt = isNet ? (v) => `${v.toFixed(v < 10 ? 1 : 0)}` : (v) => `${Math.round(v)}`;

  return `${lineChart(points, { W: o.W, H: o.H, limit: quota, fmt, unit: meta.unit })}
    <div class="cat-chart-foot">${meta.label}, ${meta.unit} —
      ${hist.length} ${plural(hist.length, 'месяц', 'месяца', 'месяцев')} по данным счетов${quota > 0
        ? `. Пунктиром — пакет ${esc(cat.quota_text || '')}` : ''}.</div>`;
}

/* ── Сравнение тарифов по компании ───────────────────────────────────────── */
function renderTariffCompare() {
  const el = $('tariffCompareContent');
  const hint = $('tariffCompareHint');
  if (!el) return;

  if (!state.tariffStats.length) {
    el.innerHTML = '<div class="empty">Нет данных о тарифах.</div>';
    if (hint) hint.textContent = '';
    return;
  }
  if (hint) {
    hint.textContent = `${state.tariffStats.length} `
      + plural(state.tariffStats.length, 'тариф', 'тарифа', 'тарифов');
  }

  const maxCost = Math.max(...state.tariffStats.map((t) => t.total_cost), 1);
  el.innerHTML = state.tariffStats.map((t) => {
    const share = (t.total_cost / maxCost) * 100;
    const savePct = t.total_cost > 0 ? (t.saving / t.total_cost) * 100 : 0;
    return `<div class="tariff-card">
      <div class="tariff-card-head">
        <div>
          <div class="tariff-card-name">${esc(t.name)}</div>
          <div class="tariff-card-fee">${money(t.fee)}<span>/мес абонплата</span></div>
        </div>
        <div class="tariff-card-count"><b>${t.count}</b><span>${plural(t.count, 'номер', 'номера', 'номеров')}</span></div>
      </div>
      <div class="tariff-bar" title="Доля в общих расходах">
        <span class="tariff-bar-fill" style="width:${share.toFixed(1)}%"></span>
        ${savePct > 0 ? `<span class="tariff-bar-save" style="width:${Math.min(savePct, 100).toFixed(1)}%"></span>` : ''}
      </div>
      <div class="tariff-card-row"><span>Начислено всего</span><b>${money(t.total_cost)}</b></div>
      <div class="tariff-card-row"><span>В среднем на номер</span><b>${money(t.avg_cost)}</b></div>
      <div class="tariff-card-row"><span>Перерасход пакета</span>
        <b class="${t.overuse ? 'txt-danger' : 'txt-good'}">${t.overuse}</b></div>
      <div class="tariff-card-row"><span>Пакет избыточен</span>
        <b class="${t.underuse ? 'txt-accent' : 'txt-good'}">${t.underuse}</b></div>
      <div class="tariff-card-row tariff-card-total"><span>Можно сэкономить</span>
        <b class="${t.saving > 0 ? 'txt-good' : 'txt-muted'}">${t.saving > 0 ? money(t.saving) : '—'}</b></div>
    </div>`;
  }).join('');
}

/* ── Карточки абонентов ──────────────────────────────────────────────────── */
/**
 * `fresh` — список начинается заново, с первой порции (поиск, фильтр,
 * сортировка). Без него перерисовка сохраняет прежний размер списка,
 * см. drawCardBatch.
 */
function renderUsers(fresh = false) {
  const grid = $('usersGrid');
  if (!grid) return;

  const term = state.search;
  let list = state.subscribers.filter((s) => {
    if (term) {
      // ПОИСК ПОНИМАЕТ ОБА ВИДА НОМЕРА.
      // На экране номер оформленный: +7 (996) 305-40-30. Человек так его и
      // наберёт — со скобками, пробелами или как получится. В базе же лежат
      // голые десять цифр. Поэтому: если в запросе есть цифры, сравниваем
      // ТОЛЬКО цифры, выкинув из обеих сторон всё лишнее. Запрос из одних
      // букв (ФИО, должность, тариф) идёт обычным путём.
      const digits = term.replace(/\D/g, '');
      // Человек часто копирует номер целиком, вместе с «+7» или «8». В базе
      // код страны не хранится, поэтому пробуем оба варианта: как набрали и
      // без ведущей семёрки/восьмёрки.
      const variants = digits ? [digits, digits.replace(/^[78]/, '')] : [];
      const hay = `${s.number} ${s.username} ${s.position} ${s.plan_name}`.toLowerCase();
      // Совпало хотя бы одним способом — годится. Дальше номер всё равно
      // проходит остальные фильтры, поэтому выходим только при промахе.
      const hit = hay.includes(term)
        || variants.some((v) => v.length > 0 && String(s.number).includes(v));
      if (!hit) return false;
    }
    if (state.filter.startsWith('status:')) return s.user_status === state.filter.slice(7);
    // Фильтр по цвету-правилу: color:unlimited и т.п.
    if (state.filter.startsWith('color:')) {
      return ((s.chip || {}).color_code || 'normal') === state.filter.slice(6);
    }
    const pay = s.payment || {};
    const waste = s.waste || {};
    switch (state.filter) {
      case 'all': return true;
      case 'raise': return s.recommendation.action === 'raise';
      case 'lower': return s.recommendation.action === 'lower' || s.recommendation.action === 'switch';
      case 'over': return s.overuse > 0;
      // Пакет избыточен: платим за объём, которым не пользуются.
      case 'oversized': return (waste.waste_money || 0) > 0 && (waste.package_use || 0) < 0.5;
      case 'overlimit': return s.limit_set && s.overpayment > 0;
      case 'trip': return s.on_trip;
      case 'roaming': return (s.roaming_cost || 0) > 0;
      case 'paid-by-us': return (pay.company_pays || 0) >= (pay.employee_pays || 0);
      case 'paid-by-user': return (pay.employee_pays || 0) > (pay.company_pays || 0);
      case 'excluded': return !!pay.excluded;
      case 'noted': return !!((s.chip || {}).note || '').trim();
      default: return true;
    }
  });

  const dir = state.sortDir === 'desc' ? -1 : 1;
  const cmp = {
    // Основная сортировка отчёта: кто невыгоднее всего.
    waste: (a, b) => ((a.waste || {}).index || 0) - ((b.waste || {}).index || 0),
    idle: (a, b) => ((a.waste || {}).waste_money || 0) - ((b.waste || {}).waste_money || 0),
    company: (a, b) => ((a.payment || {}).company_pays || 0) - ((b.payment || {}).company_pays || 0),
    saving: (a, b) => a.saving - b.saving,
    cost: (a, b) => a.total - b.total,
    overpay: (a, b) => a.overpayment - b.overpayment,
    risk: (a, b) => a.risk - b.risk,
    number: (a, b) => a.number.localeCompare(b.number),
  };
  list = list.sort((a, b) => dir * (cmp[state.sort] || cmp.waste)(a, b));
  state.filtered = list;

  setText('resultCount', `${list.length} из ${state.subscribers.length}`);

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">По выбранному фильтру абонентов нет.</div>';
    grid.dataset.drawn = '0';
    return;
  }

  drawCardBatch(grid, true, fresh);
  bindCardActions(grid);
}

/* ── Карточки рисуются порциями ───────────────────────────────────────────────
 *
 * ПОЧЕМУ. Одна карточка — это 3,5 КБ разметки. Сто карточек ещё терпимо, а на
 * реальном счёте их без малого две тысячи: семь мегабайт HTML в одном
 * присваивании innerHTML. Браузер на это время замирает целиком — и именно
 * так выглядела «загрузка отчёта».
 *
 * Рисуем первую порцию, а дальше догружаем по мере прокрутки: в конце списка
 * стоит маячок, и когда он попадает в видимую область, добавляется следующая
 * порция. Пользователь всё равно не может смотреть на две тысячи карточек
 * сразу, а прокрутка догоняет его быстрее, чем он успевает доскроллить.
 *
 * Порции добавляются через insertAdjacentHTML, а не переприсваиванием
 * innerHTML: переприсваивание уничтожило бы уже нарисованные карточки вместе
 * с раскрытыми в них панелями.
 * ─────────────────────────────────────────────────────────────────────────── */
const CARD_BATCH = 24;

/**
 * Нарисовать очередную порцию списка. Общий механизм: им живут и карточки
 * абонентов, и список номеров в настройках.
 *
 * `host.dataset.drawn` хранит, сколько уже нарисовано, — состояние держится на
 * самом элементе, поэтому две разные порционные раскладки на экране друг другу
 * не мешают.
 */
function batchList(host, items, renderItem, opts = {}) {
  const { batch = CARD_BATCH, more = null, after = null,
          reset = false, keepDrawn = false } = opts;
  // Сколько рисуем в ЭТОТ заход. Обычно порцию, но при перерисовке того же
  // списка — столько же, сколько было нарисовано до неё (см. keepDrawn).
  let size = batch;
  if (reset) {
    // ПЕРЕРИСОВКА НЕ ДОЛЖНА СХЛОПЫВАТЬ СПИСОК.
    // Человек доскроллил до трёхсотой карточки и поправил там чипс —
    // сохранение пересобирает отчёт на сервере и перерисовывает весь список.
    // Без этого на экране оставались бы первые 24 карточки: и его карточка,
    // и раскрытая в ней панель, и место в прокрутке — всё пропадало.
    if (keepDrawn) size = Math.max(batch, Number(host.dataset.drawn || 0));
    host.innerHTML = '';
    host.dataset.drawn = '0';
  }
  const drawn = Number(host.dataset.drawn || 0);
  const slice = items.slice(drawn, drawn + size);
  if (!slice.length) return;

  const old = host.querySelector('.cards-sentinel');
  if (old) old.remove();
  // insertAdjacentHTML, а не переприсваивание innerHTML: переприсваивание
  // уничтожило бы уже нарисованное вместе с раскрытыми панелями и введённым
  // в поля текстом.
  host.insertAdjacentHTML('beforeend', slice.map(renderItem).join(''));
  host.dataset.drawn = String(drawn + slice.length);
  if (after) after(slice, host);

  const left = items.length - (drawn + slice.length);
  if (left <= 0) return;
  host.insertAdjacentHTML('beforeend',
    `<div class="cards-sentinel">${more ? more(left) : `Ещё ${left}…`}</div>`);
  observeSentinel(host, () => batchList(host, items, renderItem, { ...opts, reset: false }));
}

/**
 * Маячок конца списка: пока он в зоне видимости, дорисовывается следующая
 * порция. IntersectionObserver вместо обработчика прокрутки — он не будит нас
 * на каждый пиксель и сам разбирается, в какой прокручиваемой области лежит
 * список (список абонентов в настройках прокручивается внутри модалки).
 */
const LIST_OBSERVERS = new WeakMap();

function observeSentinel(host, onHit) {
  const sentinel = host.querySelector('.cards-sentinel');
  if (!sentinel || typeof IntersectionObserver !== 'function') return;
  const old = LIST_OBSERVERS.get(host);
  if (old) old.disconnect();
  const obs = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) onHit();
  }, { rootMargin: '600px 0px' });
  LIST_OBSERVERS.set(host, obs);
  obs.observe(sentinel);
}

/**
 * `fresh` — начать список заново, с первой порции. Так ведут себя поиск,
 * фильтр и сортировка: там на экране заведомо другой список и человек ждёт
 * его начала. Обычная же перерисовка (пересчёт отчёта после сохранения)
 * восстанавливает список в прежнем размере.
 */
/**
 * Забыть, сколько карточек было нарисовано. Нужно там, где на экран приезжает
 * ДРУГОЙ список — новый счёт или другой период: восстанавливать прежний размер
 * там незачем, а прежняя прокрутка всё равно ни на что не указывает.
 */
function resetCardBatch() {
  const grid = $('usersGrid');
  if (grid) grid.dataset.drawn = '0';
}

function drawCardBatch(grid, reset = false, fresh = false) {
  batchList(grid, state.filtered, renderCard, {
    reset,
    keepDrawn: !fresh,
    after: (slice) => restoreOpenPanels(grid, slice),
    more: (left) => `Ещё ${left} ${plural(left, 'номер', 'номера', 'номеров')} —`
      + ' дорисуются при прокрутке',
  });
}

function bindCardActions(root) {
  // ОДИН обработчик на весь список вместо четырёх на каждую карточку.
  // Кнопок «Подробнее» / «Детально по тарифам» / «⚙» на две тысячи карточек
  // получалось шесть тысяч подписок, и все они создавались заново после
  // каждой правки фильтра. Событие всплывает до контейнера — там и разбираем.
  if (root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.act');
    const card = e.target.closest('.user-card');
    if (!card) return;

    if (btn) {
      e.stopPropagation();
      return toggleCardPanel(card, btn);
    }
    // Клик по самой карточке открывает модалку, но не по раскрытой панели:
    // внутри панели есть свои кнопки и поля.
    if (e.target.closest('.panel')) return;
    openModal(card.dataset.number);
  });
}

/** Раскрыть / свернуть панель карточки. Одновременно открыта одна. */
function toggleCardPanel(card, btn) {
  const number = card.dataset.number;
  const which = btn.dataset.act;
  const panel = card.querySelector(`.panel-${which}`);
  if (!panel) return;
  const open = !panel.classList.contains('show');

  $$('.panel', card).forEach((p) => p.classList.remove('show'));
  $$('.act', card).forEach((b) => b.classList.remove('open'));

  if (!open) {
    delete state.openPanels[number];
    return;
  }
  const sub = state.subscribers.find((x) => x.number === number);
  panel.innerHTML = panelHtml(which, sub);
  if (which === 'chip') bindChipPanel(panel);
  panel.classList.add('show');
  btn.classList.add('open');
  state.openPanels[number] = which;
}

/**
 * Вернуть на место панели, раскрытые до перерисовки.
 *
 * Идём по ТОЛЬКО ЧТО НАРИСОВАННОЙ порции, а не по всем открытым панелям:
 * карточка из следующей порции ещё не существует, и искать её в разметке
 * бессмысленно. Панель раскроется, когда до неё дойдёт своя порция.
 */
function restoreOpenPanels(root, slice) {
  slice.forEach((sub) => {
    const which = state.openPanels[sub.number];
    if (!which) return;
    const card = root.querySelector(`.user-card[data-number="${CSS.escape(sub.number)}"]`);
    if (!card) return;
    const panel = card.querySelector(`.panel-${which}`);
    const btn = card.querySelector(`.act[data-act="${which}"]`);
    if (!panel || !btn) return;
    panel.innerHTML = panelHtml(which, sub);
    if (which === 'chip') bindChipPanel(panel);
    panel.classList.add('show');
    btn.classList.add('open');
  });
}

/** Содержимое раскрывающейся панели карточки по её типу. */
function panelHtml(which, sub) {
  if (which === 'details') return cardDetailsPanel(sub);
  if (which === 'chip') return cardChipPanel(sub);
  return cardTariffPanel(sub);
}

function renderCard(s) {
  const status = STATUS_META[s.status] || STATUS_META.normal;
  const action = ACTION_META[s.recommendation.action] || ACTION_META.keep;
  const userStatus = state.statuses.find((x) => x.id === s.user_status);
  // Нет ФИО — заголовком становится сам номер, и он тоже должен быть
  // оформленным. Раньше здесь стояло «Абонент 9921876423» сырыми цифрами.
  const title = s.username || formatPhone(s.number);
  const subtitle = [s.username ? formatPhone(s.number) : '', s.position].filter(Boolean).join(' · ');

  const trendCls = s.trend > 1 ? 'up' : s.trend < -1 ? 'down' : 'flat';
  const trendArrow = trendCls === 'up' ? '↗' : trendCls === 'down' ? '↘' : '→';

  const limitPct = s.limit_set && s.limit > 0 ? Math.min(100, (s.total / s.limit) * 100) : 0;

  // Цвет чипса — это действующее правило, поэтому он виден прямо на карточке
  // полосой слева, а не только внутри панели настройки.
  const pay = s.payment || {};
  const chipColor = pay.color && pay.color.code !== 'normal' ? pay.color : null;
  const waste = s.waste || {};

  return `<article class="user-card card-${s.status}${chipColor ? ' has-chip-color' : ''}"
    data-number="${esc(s.number)}"${chipColor ? ` style="--chip:${esc(chipColor.hex)}"` : ''}>
    <header class="card-header">
      <div class="card-ident">
        <div class="user-name">
          ${userStatus && userStatus.id !== 'normal'
            ? `<span class="status-dot" style="background:${esc(userStatus.color)}" title="${esc(userStatus.label)}"></span>` : ''}
          <!-- Текст в span, иначе многоточие при обрезке не работает:
               голый текстовый узел нельзя ограничить text-overflow. -->
          <span class="user-name-text">${esc(title)}</span>
          <!-- Настройка номера — СПРАВА ОТ НОМЕРА, в той же строке.
               Крошечная и без фона: в списке из сотни карточек она не
               должна лезть в глаза. -->
          <button class="chip-gear act" data-act="chip" type="button"
                  title="Настройка номера: цвет-правило, пометки, кто платит"
                  aria-label="Настройка номера">⚙</button>
        </div>
        <div class="user-sub">${esc(subtitle)}</div>
      </div>
      <div class="card-badges">
        <span class="badge badge-${status.cls}">${status.label}</span>
        ${USAGE_BADGE[s.usage_level] || ''}
        ${s.on_trip ? '<span class="badge badge-trip" title="В командировке">командировка</span>' : ''}
        ${chipColor ? `<span class="badge badge-chip" style="--chip:${esc(chipColor.hex)}"
          title="${esc(chipColor.label)} — правило применено">${esc(chipColor.label)}</span>` : ''}
        ${pay.excluded ? '<span class="badge badge-muted" title="Не участвует в сводках">исключён</span>' : ''}
      </div>
    </header>

    ${waste.index > 0 ? `
      <div class="waste-line" title="Индекс невыгодности ${waste.index} из 100. Считается по всему парку номеров.">
        <span class="waste-label">Платим впустую</span>
        <span class="waste-track"><span class="waste-fill fill-${
          waste.index >= 60 ? 'danger' : waste.index >= 30 ? 'warning' : 'accent'
        }" style="width:${waste.index}%"></span></span>
        <span class="waste-value">${money(waste.waste_money)}</span>
      </div>` : ''}

    <div class="card-plan">
      <span class="plan-chip" title="Тариф по счёту">${esc(s.plan_name || 'тариф не определён')}</span>
      ${s.plan_fee > 0 ? `<span class="plan-fee">${money(s.plan_fee)}/мес</span>` : '<span class="plan-fee">без абонплаты</span>'}
      <!-- Каталожный тариф рядом с тем, что написано в счёте. Оператор
           подписывает план одинаково на всю компанию, а пакеты минут и
           гигабайт есть только у каталожной записи — и раньше карточка
           показывала одно имя, а рекомендация под ней другое. -->
      ${catalogTariffNote(s)}
    </div>

    <div class="cost-row">
      <div>
        <div class="cost-main">${money(s.total)}</div>
        <div class="cost-sub">услуги ${money(s.total - s.plan_fee)}${s.addons_cost > 0 ? ` · опции ${money(s.addons_cost)}` : ''}</div>
      </div>
      ${s.history && s.history.length > 1
        ? `<span class="trend trend-${trendCls}" title="К предыдущему месяцу">${trendArrow} ${s.trend > 0 ? '+' : ''}${Math.round(s.trend)}%</span>` : ''}
    </div>

    ${s.limit_set ? `
      <div class="limit-line">
        <span>Лимит ${money(s.limit)}</span>
        <span class="${s.overpayment > 0 ? 'txt-danger' : 'txt-good'}">
          ${s.overpayment > 0 ? `превышен на ${money(s.overpayment)}` : 'в пределах'}</span>
        ${s.chronic ? '<span class="pill pill-danger" title="Средний расход тоже выше лимита">стабильно</span>' : ''}
      </div>
      <div class="bar${s.overpayment > 0 ? ' bar-over' : ''}">
        <div class="bar-fill fill-${s.status}" style="width:${limitPct.toFixed(1)}%"></div>
      </div>`
    : '<div class="limit-line"><span class="txt-muted">Лимит не задан</span></div>'}

    <div class="cat-chips">${s.categories.map(catChip).join('')}</div>

    <div class="rec-strip rec-${action.cls}">
      <span class="rec-badge">${action.icon} ${action.label}</span>
      ${s.saving > 0 ? `<span class="rec-saving">−${money(s.saving)}/мес</span>` : ''}
    </div>

    <div class="card-actions">
      <button class="act" data-act="details">Подробнее<span class="chev">▾</span></button>
      <button class="act act-limits" data-act="tariff">Детально по тарифам<span class="chev">▾</span></button>
    </div>
    <div class="panel panel-details"></div>
    <div class="panel panel-tariff"></div>
    <div class="panel panel-chip"></div>
  </article>`;
}

/**
 * Подпись «а по каталогу это другой тариф».
 *
 * Показывается только когда имена действительно разошлись: в счёте оператор
 * пишет «Федеральный Специальный B2B» на всю компанию, а по абонплате это
 * «Пакет 400 + Интернет 100». Сравнение тарифов и все пакеты берутся из
 * каталожной записи, поэтому её название и попадает в рекомендацию — без этой
 * подписи карточка и текст под ней выглядели как про разные номера.
 *
 * matched_by приходит из domain.match_tariff и говорит, насколько уверенно
 * тариф опознан: 'fee' — сумма совпала копейка в копейку, 'nearest' — просто
 * ближайший по цене, то есть догадка. Догадку так и подписываем.
 */
const MATCH_NOTE = {
  fee: 'опознан по абонплате',
  'fee+name': 'опознан по абонплате и названию',
  'fee~': 'опознан по близкой абонплате',
  name: 'опознан по названию, абонплата в счёте другая',
  nearest: 'точного совпадения нет, взят ближайший по цене',
};

function catalogTariffNote(s) {
  const catalog = (s.tariff || {}).name || '';
  if (!catalog) return '';
  const norm = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const a = norm(s.plan_name);
  const b = norm(catalog);
  if (!a || a === b || a.includes(b) || b.includes(a)) return '';
  const note = MATCH_NOTE[s.tariff_matched_by] || 'опознан по абонплате';
  return `<span class="plan-catalog" title="Пакеты и сравнение тарифов считаются
    по этой записи каталога — ${esc(note)}">по каталогу: ${esc(catalog)}</span>`;
}

function catChip(c) {
  const cls = VERDICT_CLS[c.verdict.type] || 'good';
  const pct = c.quota > 0 ? Math.min(100, (c.used / c.quota) * 100) : 0;
  return `<div class="chip chip-${cls}" title="${esc(c.verdict.text)}">
    <span class="chip-top"><span class="chip-used">${esc(c.used_text)}</span></span>
    ${c.quota > 0 ? `<span class="chip-bar"><span class="chip-bar-fill fill-${cls}" style="width:${pct.toFixed(0)}%"></span></span>` : ''}
    <span class="chip-cost">${c.cost > 0 ? money(c.cost) : 'в пакете'}</span>
  </div>`;
}

/* ── Разбор счёта: за что именно платим ──────────────────────────────────────
 *
 * Живёт ТОЛЬКО в подробной карточке абонента (модалке): на главной такой
 * разбор занимал полстраницы в каждой карточке, а карточек там весь парк.
 *
 * Складывается из абонплаты, категорий и опций. Раньше здесь была ещё строка
 * «прочее», которая считалась вычитанием на клиенте и молча впитывала всё,
 * что не разложилось. Теперь состав приходит с сервера (addons, other_cost),
 * а строка по категории показывает и объём, и сколько из этих денег ушло
 * СВЕРХ пакета.
 * ─────────────────────────────────────────────────────────────────────────── */
function billBreakdown(s, opts = {}) {
  const pay = s.payment || {};
  const rows = [];

  if (s.plan_fee > 0) {
    // Неполный месяц: плата списана посуточно. Без этой подписи непонятно,
    // почему тариф за 400 ₽ стоит в счёте 200 ₽.
    const note = s.partial_month
      ? `за ${s.plan_days} дн., в пересчёте на месяц ${money(s.plan_fee_monthly)}`
      : (s.tariff || {}).name || '';
    rows.push({ label: 'Абонентская плата', note, cost: s.plan_fee });
  }

  s.categories.forEach((c) => {
    const over = Math.max(0, (c.used || 0) - (c.quota || 0));
    const note = [
      c.quota > 0 ? `${c.used_text} из ${c.quota_text}` : c.used_text,
      c.cost > 0 && over > 0 && c.quota > 0
        ? `сверх пакета ${fmtCatAmount(c.key, over)}` : '',
      c.cost <= 0 ? 'покрыто пакетом' : '',
    ].filter(Boolean).join(' · ');
    rows.push({ label: c.label, note, cost: c.cost, cls: c.cost > 0 ? 'danger' : 'good' });
  });

  // Роуминг деньгами уже сидит внутри категорий, поэтому он не строка, а
  // сноска: отдельной строкой он удваивал бы итог.
  (s.addons || []).forEach((a) => {
    rows.push({ label: a.service, note: 'опция, от тарифа не зависит', cost: a.cost });
  });
  if (s.other_cost > 0.5) {
    rows.push({ label: 'Прочие начисления', note: 'разовые услуги, детализация, доставка счёта',
      cost: s.other_cost });
  }

  const sum = rows.reduce((acc, r) => acc + r.cost, 0);

  return `<div class="bill-flow">
    ${rows.map((r) => `<div class="bill-row">
      <span class="bill-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bill-note">${esc(r.note || '')}</span>
      <span class="bill-track"><span class="bill-fill fill-${r.cls || 'accent'}"
        style="width:${(s.total > 0 ? Math.min(100, (r.cost / s.total) * 100) : 0).toFixed(1)}%"></span></span>
      <span class="bill-cost${r.cost > 0 ? '' : ' txt-muted'}">${money(r.cost)}</span>
    </div>`).join('')}
    <div class="bill-row bill-total">
      <span class="bill-label">Итого за ${esc(monthNom(s.month))}</span>
      <span class="bill-note">${esc([
        (s.roaming_cost || 0) > 0 ? `в том числе роуминг ${money(s.roaming_cost)}` : '',
        pay.company_pays !== undefined
          ? `платит компания ${money(pay.company_pays)} · сотрудник ${money(pay.employee_pays)}` : '',
      ].filter(Boolean).join(' · '))}</span>
      <span class="bill-track"></span>
      <span class="bill-cost">${money(s.total)}</span>
    </div>
    ${Math.abs(s.total - sum) > 1 ? `<div class="panel-hint warn">Сумма показанных строк
      ${money(sum)} расходится с «Итого начислено» из счёта на
      ${money(Math.abs(s.total - sum))} — на экране сумма из счёта.</div>` : ''}
    ${opts.hint === false ? '' : `<div class="panel-hint">Полоса — доля строки в счёте номера.
      «Покрыто пакетом» значит, что объём израсходован, но денег за него не списано.</div>`}
  </div>`;
}

/**
 * Кто за что платит — по корзинам, только чтение.
 *
 * Настройка плательщика живёт в панели «⚙» карточки, а здесь ответ на другой
 * вопрос: почему счёт разделился именно так. Причина (`reason`) приходит с
 * сервера — «правило по услуге», «командировка (Китай)», «по умолчанию».
 */
function payerBreakdown(s) {
  const buckets = ((s.payment || {}).buckets || []).filter((b) => b.amount > 0);
  if (!buckets.length) return '';
  return `<div class="payer-split">
    <div class="panel-title">Кто платит</div>
    ${buckets.map((b) => `<div class="payer-split-row">
      <span class="payer-split-label">${esc(b.label)}</span>
      <span class="payer-split-amount">${money(b.amount)}</span>
      <span class="pill pill-${b.payer === 'company' ? 'good'
        : b.payer === 'employee' ? 'danger' : 'accent'}">${payerText(b.payer)}</span>
      <span class="payer-split-why">${esc(b.reason || '')}</span>
    </div>`).join('')}
  </div>`;
}

/** Объём в единицах категории: минуты, ГБ/МБ, штуки. Как на сервере. */
function fmtCatAmount(key, value) {
  if (key === 'internet') return value >= 1024 ? fmtGb(value) : `${Math.round(value)} МБ`;
  if (key === 'voice') return `${Math.round(value)} мин`;
  return `${Math.round(value)} шт`;
}

/* ── Панель «Подробнее» внутри карточки ────────────────────────────────────
   РЕКОМЕНДАЦИЯ ЗДЕСЬ — ОДНОЙ СТРОКОЙ, ТОЙ ЧТО ПРО ТАРИФ.
   Полный вывод (перерасход по категориям, роуминг, неиспользованные пакеты)
   занимает пять-шесть абзацев, а на главной таких карточек весь парк — панель
   превращалась в стену текста. Первая строка отвечает на главный вопрос
   «менять тариф или нет», остальное ждёт в подробной карточке: клик по
   карточке открывает модалку, и там те же lines выводятся целиком
   (см. openModal → sm-rec-lines). */
function cardDetailsPanel(s) {
  const rec = s.recommendation;
  const top = (s.services || []).filter((x) => x.cost > 0).slice(0, 6);
  const hist = (s.history || []).slice(-6);

  return `<div class="panel-grid">
    <div class="panel-section">
      <div class="panel-title">Рекомендация</div>
      <div class="rec-one">${esc(rec.lines[0] || '')}</div>
      ${rec.lines.length > 1
        ? '<div class="panel-hint">Разбор целиком — в подробной карточке: '
          + 'нажмите на карточку.</div>'
        : ''}
    </div>

    <!-- «За что платим» ЗДЕСЬ БОЛЬШЕ НЕТ.
         Разбор счёта по строкам — это полстраницы разметки на карточку, а на
         главной таких карточек весь парк. Место ему в подробной карточке
         абонента: там он идёт под заголовком «Из чего сложился счёт» вместе
         с раскладкой «Кто платит» (см. openModal → billBreakdown). -->

    <div class="panel-section">
      <div class="panel-title">Потребление за ${esc(monthNom(s.month))}</div>
      <div class="limits-list">${s.categories.map((c) => limitRow(s, c)).join('')}</div>
    </div>

    <div class="panel-section">
      <div class="panel-title">Крупнейшие начисления</div>
      ${top.length ? `<div class="svc-list">${top.map((it) => `
        <div class="svc-row">
          <span class="svc-name" title="${esc(it.service)}">${esc(it.service)}</span>
          <span class="svc-vol">${esc(it.raw_volume || '—')}</span>
          <span class="svc-cost txt-danger">${money(it.cost)}</span>
        </div>`).join('')}</div>`
      : '<div class="empty">Платных начислений нет — всё в пакете.</div>'}
    </div>

    ${hist.length > 1 ? `<div class="panel-section">
      <div class="panel-title">Динамика расходов</div>
      ${lineChart(hist.map((h) => ({ month: h.month, value: h.total, current: h.month === s.month })),
        { W: 320, H: 120, limit: s.limit_set ? s.limit : 0, fmt: (v) => compact(v) })}
      ${s.limit_set ? '<div class="panel-hint">Пунктиром — месячный лимит расхода.</div>' : ''}
    </div>` : ''}
  </div>`;
}

/* ── Панель «Детально по тарифам» внутри карточки ──────────────────────────
   Только подбор тарифа. Разбор потребления по минутам / интернету / SMS живёт
   в панели «Подробнее» — раньше он дублировался в обеих панелях. */
function cardTariffPanel(s) {
  const rec = s.recommendation;
  return `<div class="panel-grid">
    <div class="panel-section panel-wide">
      ${tariffPicker(s, rec.alternatives || [], rec)}
    </div>
  </div>`;
}

/**
 * Подбор тарифа по фактическому потреблению.
 *
 * Сверху — итог одной строкой: сколько месяц стоит сейчас, какой тариф
 * дешевле и сколько это даёт в месяц. Ниже варианты, отсортированные от
 * самого дешёвого: длина полосы — стоимость месяца, сегменты внутри —
 * из чего она складывается (абонплата + перерасход по минутам / SMS /
 * интернету). Видно и «что дешевле», и «почему дорого».
 *
 * Раскладка строки строго вертикальная (заголовок → полоса → подпись): сетка
 * из колонок с минимальными ширинами не сжималась и вылезала за границы
 * узкой карточки абонента.
 */
/**
 * Название и подпись тарифа по его id.
 *
 * В оценках вариантов (recommendation.alternatives) названий больше нет: они
 * одни и те же у всех номеров, и на две тысячи абонентов это были лишние
 * сотни килобайт в каждом обновлении отчёта (см. server.slim_for_list).
 * Каталог приходит с отчётом отдельным полем — оттуда и берём.
 */
function tariffOf(id) {
  return (state.tariffs || []).find((t) => t.id === id) || {};
}

function tariffPicker(s, alts, rec) {
  const title = '<div class="tp-title">Подбор тарифа по фактическому потреблению</div>';
  if (!alts.length) return `${title}<div class="empty">Каталог тарифов пуст.</div>`;

  const max = Math.max(...alts.map((a) => a.total), s.tariff_cost, 1);
  const segs = [
    ['fee', 'абонплата', 'seg-fee'],
    ['cost_min', 'минуты сверх пакета', 'seg-min'],
    ['cost_sms', 'SMS сверх пакета', 'seg-sms'],
    ['cost_mb', 'интернет сверх пакета', 'seg-net'],
  ];

  const best = rec.best ? alts.find((a) => a.tariff_id === rec.best.tariff_id) : null;
  const saving = best ? s.tariff_cost - best.total : 0;

  const row = ({ cls, rank, name, tags, bars, sum, note, diff }) => `
    <div class="cmp-row${cls}">
      <div class="cmp-head">
        ${rank ? `<span class="cmp-rank">${rank}</span>` : ''}
        <span class="cmp-name" title="${esc(name)}">${esc(name)}</span>
        ${tags ? `<span class="cmp-tags">${tags}</span>` : ''}
        <span class="cmp-sum">${sum}</span>
      </div>
      <div class="cmp-track">${bars}</div>
      <div class="cmp-foot">
        <span class="cmp-note">${esc(note)}</span>
        ${diff}
      </div>
    </div>`;

  // Дешёвые сверху: первый же вариант в списке — и есть ответ на вопрос.
  const rows = alts.slice().sort((a, b) => a.total - b.total).map((a, i) => {
    const isCurrent = s.tariff && a.tariff_id === s.tariff.id;
    const isBest = rec.best && a.tariff_id === rec.best.tariff_id;
    const delta = a.total - s.tariff_cost;
    const bars = segs.map(([key, label, segCls]) => {
      const val = a[key] || 0;
      if (val <= 0) return '';
      return `<span class="cmp-seg ${segCls}" style="width:${((val / max) * 100).toFixed(2)}%"
        title="${label}: ${money(val)}"></span>`;
    }).join('');

    return row({
      cls: `${isBest ? ' cmp-best' : ''}${isCurrent ? ' cmp-current' : ''}`,
      rank: i + 1,
      name: tariffOf(a.tariff_id).name || 'тариф без названия',
      tags: `${isCurrent ? '<span class="pill pill-muted">текущий</span>' : ''}`
        + `${isBest && !isCurrent ? '<span class="pill pill-good">выгоднее</span>' : ''}`,
      bars,
      sum: money(a.total),
      note: tariffOf(a.tariff_id).note || '',
      diff: !isCurrent && Math.abs(delta) >= 1
        ? `<span class="cmp-diff ${delta < 0 ? 'txt-good' : 'txt-danger'}">`
          + `${delta < 0 ? '−' : '+'}${money(Math.abs(delta))}</span>`
        : '<span class="cmp-diff txt-muted">—</span>',
    });
  }).join('');

  return `${title}
  <div class="tp-summary">
    <div class="tp-cell">
      <span class="tp-cell-label">Сейчас в счёте</span>
      <span class="tp-cell-value">${money(s.tariff_cost)}</span>
      <span class="tp-cell-note">${esc(s.plan_name || 'тариф не определён')}</span>
    </div>
    <div class="tp-arrow" aria-hidden="true">→</div>
    <div class="tp-cell">
      <span class="tp-cell-label">Дешевле всего</span>
      <span class="tp-cell-value">${best ? money(best.total) : '—'}</span>
      <span class="tp-cell-note">${esc(best ? (tariffOf(best.tariff_id).name || '') : 'вариантов нет')}</span>
    </div>
    <div class="tp-cell tp-cell-${saving > 0 ? 'good' : 'muted'}">
      <span class="tp-cell-label">${saving > 0 ? 'Экономия' : 'Разница'}</span>
      <span class="tp-cell-value">${saving > 0 ? `−${money(saving)}` : money(0)}</span>
      <span class="tp-cell-note">${saving > 0 ? 'в месяц' : 'текущий тариф оптимален'}</span>
    </div>
  </div>

  <div class="cmp-list">
    ${row({
      cls: ' cmp-actual',
      rank: '',
      name: 'Фактически в счёте',
      tags: '',
      bars: `<span class="cmp-seg seg-actual" style="width:${((s.tariff_cost / max) * 100).toFixed(2)}%"></span>`,
      sum: money(s.tariff_cost),
      note: 'тарифная часть за месяц',
      diff: '<span class="cmp-diff txt-muted">база</span>',
    })}
    ${rows}
  </div>
  <div class="cmp-legend">
    <span><i class="seg-fee"></i>абонплата</span>
    <span><i class="seg-min"></i>минуты сверх пакета</span>
    <span><i class="seg-sms"></i>SMS сверх пакета</span>
    <span><i class="seg-net"></i>интернет сверх пакета</span>
  </div>
  <div class="panel-hint">Расчёт по фактическому потреблению за ${esc(monthNom(s.month))}.
    Опции, не зависящие от тарифа, в сравнение не входят.</div>`;
}

/**
 * Блок одной категории — минуты, интернет или SMS.
 *
 * Шапка кликабельна целиком: показывает, сколько пакета израсходовано
 * (полоса + процент), а по треугольнику справа снизу разворачивается график
 * потребления за последние месяцы. График рисуется лениво, при первом
 * раскрытии, — иначе на 50 карточках сразу считалось бы 150 SVG.
 */
function limitRow(s, c) {
  const cls = VERDICT_CLS[c.verdict.type] || 'good';

  // База для полосы. Обычно это пакет тарифа в минутах / ГБ / штуках.
  // На тарифе без пакетов сравнивать не с чем — там ориентир один: рублёвый
  // лимит абонента из списка сотрудников. Тогда и полоса, и процент считаются
  // в деньгах: начислено по категории против месячного лимита.
  const byMoney = c.quota <= 0 && s.limit_set && s.limit > 0;
  const used = byMoney ? c.cost : c.used;
  const base = byMoney ? s.limit : c.quota;
  const usedText = byMoney ? money(c.cost) : c.used_text;
  const baseText = byMoney ? money(s.limit) : c.quota_text;

  const ratio = base > 0 ? (used / base) * 100 : 0;
  const over = base > 0 && used > base;
  const pct = Math.min(100, ratio);
  const barCls = byMoney ? (over ? 'danger' : 'good') : cls;
  const label = byMoney && over ? 'перерасход' : c.verdict.label;

  return `<div class="limit-row" data-cat="${esc(c.key)}" data-number="${esc(s.number)}">
    <button class="limit-toggle" type="button" aria-expanded="false"
      title="График потребления за последние месяцы">
      <span class="limit-head">
        <span>${c.icon}</span>
        <span class="limit-name">${c.label}</span>
        <span class="limit-val">${esc(usedText)} из ${esc(baseText)}</span>
        <span class="pill pill-${byMoney ? (over ? 'danger' : 'good') : cls}">${esc(label)}</span>
      </span>
      <span class="limit-bar-row">
        <span class="bar bar-lg${over ? ' bar-over' : ''}">
          <span class="bar-fill fill-${barCls}" style="width:${pct.toFixed(1)}%"></span>
        </span>
        <span class="limit-pct">${base > 0 ? `${Math.round(ratio)}%` : '—'}</span>
        <span class="limit-chev" aria-hidden="true">▼</span>
      </span>
    </button>
    <div class="limit-advice">
      ${byMoney
        ? `Тариф без пакета — считаем от месячного лимита ${money(s.limit)}:
           по категории начислено ${money(c.cost)} (${Math.round(ratio)}% лимита).
           Потрачено ${esc(c.used_text)}.`
        : `${esc(c.verdict.text)}${c.cost > 0 ? ` Начислено ${money(c.cost)}.` : ''}`}
    </div>
    <div class="limit-chart"></div>
  </div>`;
}

/** Разворачивает / сворачивает график внутри блока категории. */
function toggleCategoryChart(btn) {
  const row = btn.closest('.limit-row');
  const host = row.querySelector('.limit-chart');
  const open = !row.classList.contains('open');

  if (open && !host.dataset.ready) {
    const s = state.subscribers.find((x) => x.number === row.dataset.number);
    host.innerHTML = s ? categoryChart(s, row.dataset.cat) : '';
    host.dataset.ready = '1';
  }
  row.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
}

/* ── Модалка абонента ────────────────────────────────────────────────────── */
function openModal(number) {
  const s = state.subscribers.find((x) => x.number === number);
  if (!s) return;

  const action = ACTION_META[s.recommendation.action] || ACTION_META.keep;
  const status = STATUS_META[s.status] || STATUS_META.normal;
  const userStatus = state.statuses.find((x) => x.id === s.user_status);
  const rec = s.recommendation;

  let h = `<header class="sm-header">
    <div>
      <div class="sm-name">
        ${userStatus && userStatus.id !== 'normal'
          ? `<span class="status-dot" style="background:${esc(userStatus.color)}"></span>` : ''}
        ${esc(s.username || formatPhone(s.number))}
      </div>
      <div class="sm-sub">${esc([formatPhone(s.number), s.position,
        s.personnel_no && `таб. ${s.personnel_no}`].filter(Boolean).join(' · '))}</div>
      <div class="sm-sub">Тариф по счёту: <b>${esc(s.plan_name || 'не определён')}</b>
        ${s.plan_fee > 0 ? ` · абонплата ${money(s.plan_fee)}` : ' · без абонплаты'}</div>
      ${s.on_trip ? `<div class="sm-sub txt-accent">В командировке${s.trip_start_date
        ? ` c ${esc(s.trip_start_date)}${s.trip_end_date ? ` по ${esc(s.trip_end_date)}` : ''}` : ''}</div>` : ''}
    </div>
    <div class="sm-head-right">
      <div class="sm-cost-big">${money(s.total)}</div>
      <div class="sm-cost-sub">${esc(formatMonth(s.month))}</div>
      <span class="badge badge-${status.cls}">${status.label}</span>
    </div>
  </header>`;

  h += `<section class="sm-rec-block rec-${action.cls}">
    <div class="sm-rec-head">
      <span class="rec-badge">${action.icon} ${action.label}</span>
      ${rec.saving > 0 ? `<span class="rec-saving-big">${money(rec.saving)}/мес</span>` : ''}
    </div>
    <ul class="sm-rec-lines">${rec.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
  </section>`;

  if (s.limit_set) {
    const pct = Math.min(100, (s.total / s.limit) * 100);
    h += `<section class="sm-section"><div class="sm-title">Лимит расхода</div>
      <div class="limit-row">
        <div class="limit-head">
          <span></span><span class="limit-name">Месячный лимит</span>
          <span class="limit-val">${money(s.total)} из ${money(s.limit)}</span>
          <span class="pill pill-${s.overpayment > 0 ? 'danger' : 'good'}">
            ${s.overpayment > 0 ? `+${money(s.overpayment)}` : 'в пределах'}</span>
        </div>
        <div class="bar bar-lg${s.overpayment > 0 ? ' bar-over' : ''}">
          <div class="bar-fill fill-${s.status}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="limit-advice">
          ${s.overpayment > 0
            ? `Расход за ${esc(monthNom(s.month))} превысил лимит на ${money(s.overpayment)}.`
            : `Расход за ${esc(monthNom(s.month))} укладывается в лимит.`}
          ${s.avg_total ? ` Средний расход по истории — ${money(s.avg_total)}.` : ''}
          ${s.chronic ? ' Превышение систематическое, а не разовое.' : ''}
        </div>
      </div></section>`;
  }

  // Каждый блок раскрывается по треугольнику — внутри график за 6 месяцев.
  h += '<section class="sm-section"><div class="sm-title">Потребление и пакеты</div>'
    + `<div class="limits-grid">${s.categories.map((c) => limitRow(s, c)).join('')}</div>`
    + '<div class="panel-hint">Нажмите на блок, чтобы раскрыть график потребления по месяцам.</div>'
    + '</section>';

  h += `<section class="sm-section">
    ${tariffPicker(s, rec.alternatives || [], rec)}</section>`;

  // Тот же разбор, что и в карточке (billBreakdown): состав счёта считается
  // в одном месте, иначе карточка и модалка начинают показывать разные суммы.
  h += `<section class="sm-section"><div class="sm-title">Из чего сложился счёт</div>
    ${billBreakdown(s)}
    ${payerBreakdown(s)}
  </section>`;

  if (s.history && s.history.length > 1) {
    h += `<section class="sm-section"><div class="sm-title">Динамика расходов</div>
      ${lineChart(s.history.map((x) => ({ month: x.month, value: x.total, current: x.month === s.month })),
        { W: 640, H: 170, limit: s.limit_set ? s.limit : 0, fmt: (v) => compact(v) })}
      <div class="months">${s.history.map((x) => `
        <span class="m-item${x.month === s.month ? ' m-real' : ''}">
          <b>${money(x.total)}</b> <em>${esc(shortMonth(x.month))}</em></span>`).join('')}</div>
    </section>`;
  }

  // ВСЕ НАЧИСЛЕНИЯ — ДОГРУЖАЮТСЯ.
  // В списочном отчёте у каждого номера лежат только крупнейшие строки (см.
  // server.slim_for_list): полный список нужен ровно здесь, а на весь парк это
  // лишние сотни килобайт в каждом обновлении отчёта. Показываем то, что есть,
  // и дополняем, когда придёт ответ.
  h += `<section class="sm-section" id="smServices">
    ${servicesHtml(s.services, s.services_count || s.services.length,
      (s.services_count || 0) > s.services.length)}</section>`;

  $('subModalContent').innerHTML = h;
  $('subModal').hidden = false;

  if ((s.services_count || 0) > s.services.length) loadAllServices(s);
}

/** Список начислений. `partial` — показаны не все, остальные ещё едут. */
function servicesHtml(services, total, partial) {
  return `<div class="sm-title">Все начисления (${total})</div>
    <div class="sm-services">${services.map((it) => `
      <div class="sm-svc">
        <span class="sm-svc-name" title="${esc(it.service)}">${esc(it.service)}</span>
        <span class="sm-svc-vol">${esc(it.raw_volume || '—')}</span>
        <span class="sm-svc-amt${it.cost > 0 ? ' txt-danger' : ''}">${money(it.cost)}</span>
      </div>`).join('')}</div>
    ${partial ? '<div class="panel-hint">Показаны крупнейшие, остальные загружаются…</div>' : ''}`;
}

async function loadAllServices(s) {
  const host = $('smServices');
  if (!host) return;
  try {
    const full = await getJSON(`/api/subscriber/${encodeURIComponent(s.number)}`
      + `?month=${encodeURIComponent(s.month)}`);
    const services = full.services || [];
    if (!services.length) return;
    // Модалку могли за это время открыть на ДРУГОМ номере. Тогда на странице
    // лежит уже новый #smServices, а наш host — оторванный от документа кусок
    // прошлой модалки, и дописывать в него нечего. Сравниваем сами элементы:
    // проверки «такой id существует» тут мало — id-то одинаковый.
    if (host !== document.getElementById('smServices')) return;
    // Кладём в state, чтобы повторное открытие обошлось без запроса.
    s.services = services;
    s.services_count = services.length;
    host.innerHTML = servicesHtml(services, services.length, false);
  } catch (_) {
    const hint = host.querySelector('.panel-hint');
    if (hint) hint.textContent = 'Остальные начисления загрузить не удалось.';
  }
}

function closeOverlay(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  el.hidden = true;
  // Пока настройки были открыты, отрисовку главного экрана мы откладывали
  // (см. applyView). Теперь он на виду — наверстаем разом.
  if (id === 'settingsPanel') refreshMainIfStale();
}

/* ── Общая статистика по счёту ───────────────────────────────────────────── */
async function openStats() {
  const el = $('statsContent');
  $('statsModal').hidden = false;
  el.innerHTML = '<div class="empty">Загрузка…</div>';
  try {
    // Период передаём явно: окно показывает тот счёт, который выбран в шапке.
    // Без него сервер всегда отдавал последний загруженный месяц, и после
    // переключения периода тут оставались чужие реквизиты.
    const url = state.month
      ? `/api/invoice?month=${encodeURIComponent(state.month)}` : '/api/invoice';
    const data = await getJSON(url);
    el.innerHTML = statsHtml(data.invoice || {}, data.storage || {});
  } catch (err) {
    el.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(err.message)}</div>`;
  }
}

function statsHtml(inv, storage) {
  const a = inv.amounts || {};
  const sum = state.summary || {};
  const has = (v) => v !== undefined && v !== null && v !== '' && v !== '-';

  // Блок «ключ — значение». Пустые поля не показываем: в разных выгрузках
  // счёта набор реквизитов отличается, и пустые строки только шумят.
  const block = (title, rows) => {
    const filled = rows.filter(([, v]) => has(v));
    if (!filled.length) return '';
    return `<section class="stats-block">
      <div class="stats-block-title">${title}</div>
      <div class="stats-grid">${filled.map(([k, v]) =>
        `<span class="stats-key">${esc(k)}</span><span class="stats-val">${esc(String(v))}</span>`).join('')}</div>
    </section>`;
  };
  const rub = (v) => (has(v) ? money(v) : '');

  let h = `<header class="stats-header">
    <div class="stats-header-main">
      <div class="stats-name">Полный отчёт по счёту${inv.invoice_number ? ` № ${esc(inv.invoice_number)}` : ''}</div>
      <div class="stats-sub">${esc([inv.subscriber_name, inv.invoice_date && `от ${inv.invoice_date}`,
        inv.period || (state.month ? formatMonth(state.month) : '')].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="stats-header-right">
      <div class="stats-header-value">${money(a.total_charged ?? a.charged ?? sum.total_cost ?? 0)}</div>
      <div class="stats-sub">начислено за период</div>
    </div>
  </header>`;

  // Ключевые суммы плиткой. Порядок — как в сводной части счёта оператора.
  const tiles = [
    ['Баланс на начало', a.balance_start, (a.balance_start || 0) < 0 ? 'danger' : 'good'],
    ['Начислено', a.charged ?? a.total_charged, 'primary'],
    ['Оплачено', a.paid, 'good'],
    ['Баланс на конец', a.balance_end, (a.balance_end || 0) < 0 ? 'danger' : 'good'],
    ['К оплате за период', a.due_period, 'accent'],
    ['К оплате на конец', a.due_total, 'accent'],
    ['в т.ч. НДС', a.vat_total, 'muted'],
    ['Не оплачено ранее', a.unpaid_previous, 'danger'],
  ].filter(([, v]) => has(v));

  if (tiles.length) {
    h += `<div class="stats-tiles">${tiles.map(([label, v, cls]) =>
      `<div class="stats-tile stats-tile-${cls}">
        <div class="stats-tile-label">${esc(label)}</div>
        <div class="stats-tile-value">${money(v)}</div>
      </div>`).join('')}</div>`;
  }

  // Реквизиты в несколько колонок — так весь «паспорт» счёта виден без прокрутки.
  h += '<div class="stats-blocks">';

  h += block('Счёт', [
    ['Счёт №', inv.invoice_number], ['Дата счёта', inv.invoice_date],
    ['Расчётный период', inv.period],
    ['Начало периода', inv.period_start], ['Конец периода', inv.period_end],
    ['Месяц', inv.month ? formatMonth(inv.month) : ''],
    ['Счета-фактуры', inv.factura],
    ['Лицевой счёт', inv.account_number], ['Договор', inv.contract],
    ['Форма оплаты', inv.payment_form],
    ['Дней на оплату', a.days_to_pay], ['Руководитель', inv.director],
  ]);

  h += block('Стороны', [
    ['Оператор', inv.operator_name], ['Абонент', inv.subscriber_name],
    ['Получатель', inv.recipient], ['ИНН / КПП', inv.inn_kpp],
  ]);

  h += block('Банковские реквизиты', [
    ['Банк получателя', inv.bank], ['Р/с', inv.rs], ['к/с', inv.ks], ['БИК', inv.bik],
  ]);

  h += block('Обороты за период', [
    ['Баланс на начало', rub(a.balance_start)],
    ['Сумма начислений', rub(a.charged)],
    ['Сумма платежей', rub(a.paid)],
    ['Баланс на конец', rub(a.balance_end)],
  ]);

  h += block('Начислено', [
    ['Итого начислено', rub(a.total_charged)],
    ['По услугам, облагаемым НДС', rub(a.total_vatable)],
    ['в том числе НДС', rub(a.vat_total)],
  ]);

  h += block('К оплате', [
    ['За период (без пени)', rub(a.due_period)],
    ['На конец периода (с пени)', rub(a.due_total)],
    ['Не оплачено ранее', rub(a.unpaid_previous)],
    ['Дней на оплату', a.days_to_pay],
  ]);

  h += block('Пени', [
    ['На начало периода', rub(a.penalty_start)],
    ['Начислено', rub(a.penalty_accrued)],
    ['На конец периода', rub(a.penalty_end)],
  ]);

  h += block('Свод по абонентам', [
    ['Абонентов в периоде', sum.subscribers],
    ['Начислено по абонентам', rub(sum.total_cost)],
    ['В среднем на номер', rub(sum.avg_cost)],
    ['Потенциал экономии', rub(sum.economy_potential)],
    ['Перерасход лимита', rub(sum.total_overpay)],
    ['Индекс риска', has(sum.risk_index) ? `${sum.risk_index}` : ''],
    ['Критично / внимание', has(sum.critical) ? `${sum.critical} / ${sum.warning}` : ''],
    ['С перерасходом пакета', sum.overuse],
    ['С недоиспользованием', sum.underuse],
  ]);

  const act = sum.by_action || {};
  h += block('Рекомендации по тарифам', [
    ['Повысить тариф', act.raise], ['Понизить тариф', act.lower],
    ['Подобрать тариф', act.switch], ['Тариф оптимален', act.keep],
  ]);

  h += block('Что загружено в систему', [
    ['Абонентов', storage.users_numbers], ['Счетов', storage.reports_2],
    ['Строк начислений', storage.parameter_values_2], ['Периодов', storage.months],
    ['Строк из списка', storage.roster_rows],
    ['Справочник услуг', storage.parameters],
    ['Услуг не распознано', storage.unmatched_services],
  ]);

  h += '</div>';

  const services = inv.services || [];
  if (services.length) {
    const max = Math.max(...services.map((x) => x.amount), 1);
    const total = services.reduce((acc, x) => acc + x.amount, 0);
    const discount = services.reduce((acc, x) => acc + (x.discount || 0), 0);
    h += `<section class="stats-block stats-block-wide">
      <div class="stats-block-title">Начислено по услугам (${services.length})
        ${inv.services_derived ? '<span class="stats-block-note">свод посчитан по строкам абонентов</span>' : ''}</div>
      <div class="stats-services">${services.map((x) => `
        <div class="stats-svc">
          <span class="stats-svc-name" title="${esc(x.name)}">${esc(x.name)}</span>
          <span class="stats-svc-vol">${esc(x.volume || '')}</span>
          <span class="stats-svc-bar"><span style="width:${((x.amount / max) * 100).toFixed(1)}%"></span></span>
          <span class="stats-svc-amt">${money(x.amount)}</span>
        </div>`).join('')}</div>
      <div class="stats-svc stats-svc-total">
        <span class="stats-svc-name"><b>Итого по услугам</b></span>
        <span class="stats-svc-vol">${discount > 0 ? `скидка ${money(discount)}` : ''}</span>
        <span class="stats-svc-bar"></span>
        <span class="stats-svc-amt"><b>${money(total)}</b></span>
      </div>
    </section>`;
  }

  return h;
}

/* ── Настройки ───────────────────────────────────────────────────────────── */
let settingsTab = 'subscribers';
let settingsSearch = '';

function openSettings() {
  const panel = $('settingsPanel');
  if (!panel) return;
  panel.hidden = false;
  renderSettings();
  $$('.settings-tab').forEach((tab) => {
    tab.onclick = () => {
      $$('.settings-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      settingsTab = tab.dataset.tab;
      renderSettings();
    };
  });
}

// Какая вкладка настроек чем рисуется. Таблица вместо цепочки if —
// добавить вкладку теперь значит дописать одну строку.
const SETTINGS_TABS = {
  subscribers: renderSubscriberSettings,
  // Одна вкладка вместо бывших «Цвета-правила» и «Пометки» — внутри две группы.
  chiprules: renderChipRuleSettings,
  rules: renderRuleSettings,
  trips: renderTripSettings,
  statuses: renderStatusSettings,
  tariffs: renderTariffSettings,
  roaming: renderRoamingSettings,
  widgets: renderWidgetSettings,
};

function renderSettings() {
  const el = $('settingsContent');
  if (!el) return;
  (SETTINGS_TABS[settingsTab] || renderWidgetSettings)(el);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * РЕДАКТОРЫ ПРАВИЛ РАСПРЕДЕЛЕНИЯ ОПЛАТЫ
 *
 * Всё, что влияет на деньги, правится здесь, без правки кода — это условие
 * работы в закрытом контуре. Любое сохранение пересчитывает отчёт на сервере
 * и сразу возвращает новые суммы.
 * ═════════════════════════════════════════════════════════════════════════ */

// Селектор плательщика для формы. 'auto' — не переопределять.
function payerSelect(name, value) {
  return `<select data-f="${name}">${PAYER_OPTIONS.map(([v, t]) =>
    `<option value="${v}"${v === (value || 'auto') ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
}

/** Общий обработчик сохранения справочника: шлём на сервер, применяем отчёт. */
async function saveDictionary(url, payload, onDone) {
  try {
    const data = await postJSON(url, payload);
    if (data.colors) state.chipColors = data.colors;
    if (data.marks) state.chipMarks = data.marks;
    if (data.view) applyView(data.view);
    if (onDone) onDone(data);
    renderSettings();
    flashHint('Сохранено, отчёт пересчитан.');
  } catch (err) {
    flashHint(err.message, 'error');
  }
}

/* ── Правила чипсов: цвета и пометки в одном месте ───────────────────────────
 *
 * БЫЛО две вкладки-близнеца с одинаковыми таблицами. Разница между ними ровно
 * одна: цвет у номера ОДИН и красит карточку, пометок можно навесить сколько
 * угодно. Всё остальное — те же поля, те же эффекты на деньги.
 *
 * СТАЛО одна вкладка с двумя группами. В базе они тоже уже одна таблица
 * chip_rules с полем kind ('color' | 'mark'), так что интерфейс наконец
 * повторяет то, как данные лежат на самом деле.
 *
 * Сохранение по-прежнему идёт на /api/chip-colors и /api/chip-marks — эти
 * ручки пишут в chip_rules, менять их не понадобилось.
 * ────────────────────────────────────────────────────────────────────────── */

// Всё, что отличает цвет от пометки — собрано в одном месте, чтобы обе группы
// рисовались одним кодом и не разъезжались при правках.
const CHIP_RULE_KINDS = [
  {
    kind: 'color', list: () => state.chipColors,
    title: 'Цвета', api: '/api/chip-colors',
    hint: 'У номера действует один. Красит карточку на главной.',
    addLabel: '+ Цвет', addName: 'Новый цвет', badge: 'базовый',
    confirm: 'Удалить цвет? Номера с ним станут обычными.',
    // Сколько номеров носит этот цвет.
    count: (counts, s) => { const c = (s.chip || {}).color_code || 'normal';
      counts[c] = (counts[c] || 0) + 1; },
  },
  {
    kind: 'mark', list: () => state.chipMarks,
    title: 'Пометки', api: '/api/chip-marks',
    hint: 'Навешиваются поверх цвета, их может быть несколько. Приоритет ниже цвета.',
    addLabel: '+ Пометка', addName: 'Новая пометка', badge: 'базовая',
    confirm: 'Удалить пометку? Она снимется со всех номеров.',
    count: (counts, s) => ((s.chip || {}).marks || [])
      .forEach((m) => { counts[m] = (counts[m] || 0) + 1; }),
  },
];

function renderChipRuleSettings(el) {
  el.innerHTML = `
    <div class="settings-note">Правило — это набор эффектов: кто платит за
      абонплату, опции, перерасход и роуминг, убирать ли номер из сводок и
      считать ли его пакет безлимитным. Навесили правило на номер — эффекты
      применились, отчёт пересчитался сразу.</div>
    <div id="chipRuleGroups"></div>`;

  const draw = () => {
    // Считаем, сколько номеров носит каждое правило — админу важно видеть,
    // что он правит: мёртвую строку или правило на половину парка.
    const counts = {};
    CHIP_RULE_KINDS.forEach((k) => state.subscribers.forEach((s) => k.count(counts, s)));

    $('chipRuleGroups').innerHTML = CHIP_RULE_KINDS.map((k) => `
      <section class="rule-group" data-kind="${k.kind}">
        <div class="rule-group-head">
          <h4>${k.title} <span class="rule-group-n">${k.list().length}</span></h4>
          <span class="rule-group-hint">${k.hint}</span>
          <button class="btn btn-soft btn-sm" data-add="${k.kind}">${k.addLabel}</button>
        </div>
        <div class="rule-table">
          <div class="rule-head">
            <span>Цвет</span><span>Название</span><span>Абонплата</span><span>Опции</span>
            <span>Перерасход</span><span>Роуминг</span><span>Искл.</span><span>Безлим.</span>
            <span>Номеров</span><span></span>
          </div>
          ${k.list().map((r) => `
            <div class="rule-row" data-code="${esc(r.code)}" data-kind="${k.kind}">
              <input type="color" data-f="hex" value="${esc(r.hex || '#6b7a74')}">
              <input type="text" data-f="label" value="${esc(r.label)}" maxlength="40">
              ${payerSelect('payer_tariff', r.payer_tariff)}
              ${payerSelect('payer_options', r.payer_options)}
              ${payerSelect('payer_overage', r.payer_overage)}
              ${payerSelect('payer_roaming', r.payer_roaming)}
              <input type="checkbox" data-f="is_excluded"${r.is_excluded ? ' checked' : ''}
                     title="Убрать номера с этим правилом из всех сводок">
              <input type="checkbox" data-f="is_unlimited"${r.is_unlimited ? ' checked' : ''}
                     title="Пакет безлимитный — перерасхода по нему не бывает">
              <span class="rule-count${counts[r.code] ? '' : ' is-zero'}">${counts[r.code] || 0}</span>
              ${r.builtin ? `<span class="pill pill-muted">${k.badge}</span>`
                : `<button class="rule-del" data-del="${esc(r.code)}" title="Удалить">✕</button>`}
            </div>`).join('')}
        </div>
      </section>`).join('');

    // Правка любого поля строки сразу летит на сервер: отдельной кнопки
    // «сохранить» нет намеренно — она только плодит несохранённые состояния.
    $$('.rule-row', el).forEach((row) => {
      const k = CHIP_RULE_KINDS.find((x) => x.kind === row.dataset.kind);
      $$('input, select', row).forEach((input) => input.addEventListener('change', () => {
        const source = k.list().find((x) => x.code === row.dataset.code) || {};
        const payload = { ...source, code: row.dataset.code };
        $$('input, select', row).forEach((f) => {
          payload[f.dataset.f] = f.type === 'checkbox' ? f.checked : f.value;
        });
        saveDictionary(k.api, payload);
      }));
    });

    $$('[data-del]', el).forEach((btn) => btn.addEventListener('click', () => {
      const k = CHIP_RULE_KINDS.find((x) => x.kind === btn.closest('.rule-row').dataset.kind);
      if (!confirm(k.confirm)) return;
      saveDictionary(`${k.api}/delete`, { code: btn.dataset.del });
    }));

    $$('[data-add]', el).forEach((btn) => btn.addEventListener('click', () => {
      const k = CHIP_RULE_KINDS.find((x) => x.kind === btn.dataset.add);
      saveDictionary(k.api, { label: k.addName, hex: '#6b7a74', sort_order: 900 });
    }));
  };
  draw();
}

/* ── Правила по услугам ──────────────────────────────────────────────────── */
const RULE_SCOPES = [
  ['tariff', 'Абонплата'], ['options', 'Опции'],
  ['overage', 'Сверх пакета'], ['roaming', 'Роуминг'],
];

/* ═══════════════════════════════════════════════════════════════════════════
 * РОУМИНГ: СТАВКИ ПО ЗОНАМ
 *
 * СПРАВОЧНИК, А НЕ КАЛЬКУЛЯТОР. Отчёт по этим ставкам ничего не пересчитывает:
 * роуминг как брался суммой из счёта, так и берётся. Экран нужен для другого —
 * когда за поездку прилетело восемь тысяч, надо видеть цену минуты и
 * мегабайта, чтобы понять, много это или норма.
 * ═══════════════════════════════════════════════════════════════════════════ */

// Колонки со ставками: поле, заголовок, подсказка. Один список на шапку,
// на строки и на подписи — иначе они разъедутся при первой же правке.
const ROAMING_COLUMNS = [
  ['incoming',   'Входящие',   '₽/мин, входящие вызовы'],
  ['call_home',  'В Россию',   '₽/мин, звонок в Россию'],
  ['call_local', 'По стране',  '₽/мин, звонок по стране пребывания'],
  ['call_other', 'В др. страны', '₽/мин, звонок в третьи страны'],
  ['sms',        'SMS',        '₽ за исходящее SMS'],
  ['mb',         'Интернет',   '₽ за 1 МБ'],
  ['satellite',  'Спутник',    '₽/мин, спутниковые сети'],
];

let roamingZones = [];

async function renderRoamingSettings(el) {
  // Справочник читаем с сервера ОДИН раз за сеанс: он меняется только здесь
  // же, и сохранение сразу возвращает новый список. Раньше каждое открытие
  // вкладки (и каждая правка одной ставки) начиналось с «Загрузка…» и похода
  // на сервер за теми же строками.
  if (!roamingZones.length) {
    el.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      roamingZones = (await getJSON('/api/roaming')).zones || [];
    } catch (err) {
      el.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(err.message)}</div>`;
      return;
    }
  }

  el.innerHTML = `
    <div class="settings-note">Ставки роуминга из тарифной сетки оператора, в
      рублях с НДС. Все страны разбиты на четыре зоны с едиными ценами внутри
      зоны; Крым идёт отдельно. Тарификация вызовов поминутная, входящие
      бесплатны. <b>Это справочник для сверки:</b> расход в отчёте берётся из
      счёта как есть и по этим цифрам не пересчитывается — в счёте бывают
      пакеты и акции, о которых таблица не знает.</div>
    <div class="rule-table rule-table-roaming" id="roamingRows"></div>
    <div class="settings-actions">
      <button class="btn btn-soft" id="roamingAdd">+ Добавить зону</button>
    </div>`;

  const draw = () => {
    $('roamingRows').innerHTML = `
      <div class="rule-head">
        <span>Зона</span>
        ${ROAMING_COLUMNS.map(([, title]) => `<span>${title}</span>`).join('')}
        <span></span>
      </div>
      ${roamingZones.map((z) => `
        <div class="rule-row" data-code="${esc(z.code)}" title="${esc(z.note || '')}">
          <input class="rule-zone" type="text" data-f="label" value="${esc(z.label)}"
                 maxlength="60" placeholder="Название зоны">
          ${ROAMING_COLUMNS.map(([field, title, hint]) => `
            <input type="number" data-f="${field}" value="${z[field]}"
                   min="0" step="0.01" title="${esc(hint)}" placeholder="${esc(title)}">`).join('')}
          ${z.builtin
            ? '<span class="rule-del is-locked" title="Зона из тарифной сетки — ставки поправить можно, удалить нельзя">🔒</span>'
            : `<button class="rule-del" data-del="${esc(z.code)}" title="Удалить">✕</button>`}
        </div>`).join('')}`;

    $$('.rule-row', el).forEach((row) => {
      $$('input', row).forEach((input) => input.addEventListener('change', () => {
        const payload = { code: row.dataset.code };
        $$('input', row).forEach((f) => { payload[f.dataset.f] = f.value; });
        saveZone(payload);
      }));
    });
    $$('[data-del]', el).forEach((btn) => btn.addEventListener('click', () => {
      if (!confirm('Удалить зону роуминга?')) return;
      saveZone({ code: btn.dataset.del }, '/api/roaming/delete');
    }));
  };

  const saveZone = async (payload, url = '/api/roaming') => {
    try {
      const data = await postJSON(url, payload);
      roamingZones = data.zones || roamingZones;
      draw();
      flashHint('Ставки роуминга сохранены.');
    } catch (err) { flashHint(err.message, 'error'); }
  };

  draw();
  $('roamingAdd').onclick = () => {
    const code = (prompt('Код новой зоны латиницей, например asia:') || '').trim();
    if (!code) return;
    saveZone({
      code, label: code, incoming: 0, call_home: 0, call_local: 0,
      call_other: 0, sms: 0, mb: 0, satellite: 0, sort_order: 100,
    });
  };
}

let paymentRules = [];

async function renderRuleSettings(el) {
  // Как и роуминг: список правил читается один раз за сеанс, дальше он живёт
  // в памяти и обновляется ответом на сохранение (см. saveRule).
  if (!paymentRules.length) {
    el.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      paymentRules = (await getJSON('/api/payment-rules')).rules || [];
    } catch (err) {
      el.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(err.message)}</div>`;
      return;
    }
  }

  el.innerHTML = `
    <div class="settings-note">Правило срабатывает, если название услуги в счёте
      СОДЕРЖИТ указанный текст (регистр не важен). Проверяются по возрастанию
      приоритета, побеждает первое совпадение — поэтому личные услуги стоит
      держать выше корпоративных. Правило по услуге слабее настроек номера:
      если абонент покрашен в «Личный тариф», опции всё равно на нём.</div>
    <div class="rule-table rule-table-payment" id="ruleRows"></div>
    <div class="settings-actions">
      <button class="btn btn-soft" id="ruleAdd">+ Добавить правило</button>
    </div>`;

  const draw = () => {
    $('ruleRows').innerHTML = `
      <div class="rule-head">
        <span>Вкл</span><span>Приор.</span><span>Корзина</span>
        <span>Текст в названии услуги</span><span>Платит</span><span>Пояснение</span><span></span>
      </div>
      ${paymentRules.map((r) => `
        <div class="rule-row" data-id="${r.id}">
          <input type="checkbox" data-f="enabled"${r.enabled ? ' checked' : ''}>
          <input type="number" data-f="priority" value="${r.priority}" min="1" max="999">
          <select data-f="scope">${RULE_SCOPES.map(([v, t]) =>
            `<option value="${v}"${v === r.scope ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <input type="text" data-f="match_value" value="${esc(r.match_value)}" maxlength="120">
          <select data-f="payer">
            <option value="company"${r.payer === 'company' ? ' selected' : ''}>компания</option>
            <option value="employee"${r.payer === 'employee' ? ' selected' : ''}>сотрудник</option>
          </select>
          <input type="text" data-f="note" value="${esc(r.note || '')}" maxlength="200">
          <button class="rule-del" data-del="${r.id}" title="Удалить">✕</button>
        </div>`).join('')}`;

    $$('.rule-row', el).forEach((row) => {
      $$('input, select', row).forEach((input) => input.addEventListener('change', () => {
        const payload = { id: Number(row.dataset.id), match_kind: 'service' };
        $$('input, select', row).forEach((f) => {
          payload[f.dataset.f] = f.type === 'checkbox' ? f.checked : f.value;
        });
        saveRule(payload);
      }));
    });
    $$('[data-del]', el).forEach((btn) => btn.addEventListener('click', () => {
      if (!confirm('Удалить правило?')) return;
      saveRule({ id: Number(btn.dataset.del) }, '/api/payment-rules/delete');
    }));
  };

  const saveRule = async (payload, url = '/api/payment-rules') => {
    try {
      const data = await postJSON(url, payload);
      paymentRules = data.rules || paymentRules;
      if (data.view) applyView(data.view);
      draw();
      flashHint('Правило сохранено, отчёт пересчитан.');
    } catch (err) { flashHint(err.message, 'error'); }
  };

  draw();
  $('ruleAdd').onclick = () => saveRule({
    priority: 100, enabled: true, scope: 'options',
    match_kind: 'service', match_value: '', payer: 'company', note: '',
  });
}

/* ── Командировки ────────────────────────────────────────────────────────── */

/**
 * Одна командировка — В ДВЕ СТРОКИ, а не в одну.
 *
 * ПОЧЕМУ. Раньше все шесть полей стояли в один ряд сеткой с фиксированными
 * колонками: 145 + 175 + 120 + 110 пикселей плюс зазоры — ровно 600, а
 * настройки шириной 640 минус поля дают те же 600. На долю ФИО и СТРАНЫ
 * (единственных гибких колонок) оставалось ноль пикселей, и они просто не
 * показывались. Страна при этом в разметке была — потому и выглядело, будто
 * её не выводят вовсе.
 *
 * Теперь сверху «кто» (номер, ФИО, утверждена ли), снизу «когда и куда»
 * (период, страна, заказ). Обе строки помещаются с запасом на любой ширине.
 */
function tripItem(t) {
  const facts = [
    // Класс именно trip-period, а НЕ trip-dates: trip-dates занят контейнером
    // полей ввода дат, у которого display:none по умолчанию, и период из-за
    // совпадения имён не показывался.
    `<span class="trip-period">${esc(t.date_start || '')} — ${esc(t.date_end || '')}</span>`,
    t.country ? `<span class="trip-country">${esc(t.country)}</span>` : '',
    t.order_no ? `<span class="trip-order">заказ ${esc(t.order_no)}</span>` : '',
    // № служебной записки — то же поле, что и в виджете на главной. Без него
    // вкладка не давала сверить командировку с бумагой, по которой её завели.
    t.memo_no ? `<span class="trip-order">№ СЗ ${esc(t.memo_no)}</span>` : '',
  ].filter(Boolean).join('');

  return `<div class="trip-item${t.approved ? '' : ' is-unapproved'}">
    <div class="trip-who">
      <span class="trip-number">${esc(formatPhone(t.number))}</span>
      <span class="trip-name" title="${esc(t.username || '')}">${esc(t.username || '')}</span>
      <span class="trip-approved">${t.approved ? 'утверждена' : 'НЕ утверждена'}</span>
    </div>
    <div class="trip-when">${facts}</div>
  </div>`;
}

async function renderTripSettings(el) {
  // Командировки приходят вместе с отчётом (build_month_view → trips), поэтому
  // при загруженном счёте вкладка открывается сразу, без «Загрузка…» и похода
  // на сервер за тем же списком: загрузка файла и очистка возвращают
  // пересчитанный отчёт, а вместе с ним и свежие командировки.
  //
  // ПОКА СЧЁТА НЕТ — отчёта тоже нет, и сервер на загрузку командировок
  // возвращает view: null. Тогда state.trips так и остаётся пустым, и вкладка
  // показывала «Командировки не загружены» сразу после успешной загрузки
  // файла. В этом случае — и только в нём — спрашиваем список отдельно.
  let trips = state.trips || [];
  if (!state.month) {
    el.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      trips = (await getJSON('/api/trips')).trips || [];
      state.trips = trips;
    } catch (err) {
      el.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(err.message)}</div>`;
      return;
    }
  }

  el.innerHTML = `
    <div class="settings-note">Загруженные командировки. Если период пересекается
      с расчётным месяцем счёта, роуминг этого номера переходит на компанию и
      перестаёт считаться нарушением лимита. Файл — выгрузка с колонками
      «Абонентский номер», «ФИО», период (две даты), «Страна», «Утверждено».</div>
    <div class="settings-actions">
      <button class="btn btn-primary" id="tripUpload">Загрузить файл командировок</button>
      <button class="btn btn-soft" id="tripClear">Очистить все</button>
    </div>
    ${trips.length
      // ОКНО НА ПЯТЬ СТРОК С ПРОКРУТКОЙ — как в виджете на главной. Кнопки
      // «Показать все» здесь больше нет: она разворачивала список, который всё
      // равно упирался в прокрутку, — то есть делала лишний шаг до того же
      // результата. Высоту окна держит CSS (.trip-list).
      ? `<div class="trip-list" id="tripList">${trips.map(tripItem).join('')}</div>
         ${trips.length > 5 ? `<div class="settings-note">Видно пять
           из ${trips.length} — список прокручивается.</div>` : ''}`
      : '<div class="empty">Командировки не загружены.</div>'}`;

  $('tripUpload').onclick = () => { closeOverlay('settingsPanel'); $('tripsFile').click(); };
  $('tripClear').onclick = async () => {
    if (!confirm('Удалить все загруженные командировки?')) return;
    try {
      const data = await postJSON('/api/trips/clear', {});
      if (data.view) applyView(data.view);
      // Отчёта может не быть вовсе (счёт ещё не загружен) — тогда сервер
      // возвращает view: null, и список нужно обнулить вручную, иначе вкладка
      // покажет уже удалённые командировки.
      else state.trips = [];
      renderSettings();
      flashHint('Командировки удалены, отчёт пересчитан.');
    } catch (err) { flashHint(err.message, 'error'); }
  };
}

/* Абоненты: статус, командировка, лимит — с сохранением на сервер. */
function renderSubscriberSettings(el) {
  if (!state.subscribers.length) {
    el.innerHTML = '<div class="empty">Загрузите счёт, чтобы настроить абонентов.</div>';
    return;
  }

  el.innerHTML = `
    <div class="settings-note">Статус, командировка и лимит сохраняются сразу.
      Лимит — месячный потолок расхода в рублях, с ним сравнивается сумма счёта.</div>
    <input type="search" id="settingsSearch" class="search-input settings-search"
           placeholder="Поиск по номеру, ФИО или должности…" value="${esc(settingsSearch)}">
    <div id="subscribersList" class="subscribers-list"></div>`;

  const search = $('settingsSearch');
  search.addEventListener('input', debounce((e) => {
    settingsSearch = e.target.value.trim().toLowerCase();
    drawSubscriberList();
  }, 180));

  drawSubscriberList();
}

function drawSubscriberList() {
  const list = $('subscribersList');
  if (!list) return;

  const rows = state.subscribers.filter((s) => {
    if (!settingsSearch) return true;
    return `${s.number} ${s.username} ${s.position}`.toLowerCase().includes(settingsSearch);
  });

  if (!rows.length) {
    list.innerHTML = '<div class="empty">Никого не найдено.</div>';
    return;
  }

  // Список статусов один на всех — собираем его РАЗ, а не на каждую строку.
  // Отмечать выбранный через selected не нужно: значение проставим свойством
  // value уже готовому <select>, это и быстрее, и короче.
  const statusOptions = state.statuses.map((st) =>
    `<option value="${esc(st.id)}">${esc(st.label)}</option>`).join('');

  // Порциями, как и карточки: в строке выпадающий список и три поля ввода, и
  // на всём парке номеров это самая тяжёлая разметка в программе. Из-за неё
  // настройки и открывались с задержкой.
  batchList(list, rows, (s) => {
    const st = state.statuses.find((x) => x.id === s.user_status) || state.statuses[0] || {};
    return `<div class="subscriber-item" data-number="${esc(s.number)}"
                 style="border-left-color:${esc(st.color || 'var(--border)')}">
      <div class="subscriber-info">
        <div class="subscriber-number">${esc(formatPhone(s.number))}</div>
        <div class="subscriber-name">${esc(s.username || '—')}</div>
        <div class="subscriber-pos">${esc(s.position || '')}</div>
        <div class="subscriber-cost">начислено ${money(s.total)}</div>
      </div>
      <div class="subscriber-controls">
        <label class="control-group">
          <span class="control-label">Статус</span>
          <select class="status-select" data-number="${esc(s.number)}">${statusOptions}</select>
        </label>
        <div class="control-group">
          <label class="trip-toggle">
            <input type="checkbox" class="trip-check" data-number="${esc(s.number)}"
                   ${s.is_business_trip ? 'checked' : ''}> В командировке
          </label>
          <div class="trip-dates${s.is_business_trip ? ' active' : ''}">${
            s.is_business_trip ? tripDateInputs(s) : ''}</div>
        </div>
        <div class="control-group">
          <span class="control-label">Лимит, ₽</span>
          <div class="limit-control">
            <input type="number" class="limit-input" min="0" step="10"
                   data-number="${esc(s.number)}" value="${s.limit_set ? s.limit : ''}" placeholder="не задан">
            <button class="btn btn-soft save-limit" data-number="${esc(s.number)}">Сохранить</button>
          </div>
        </div>
      </div>
    </div>`;
  }, {
    reset: true,
    more: (left) => `Ещё ${left} ${plural(left, 'номер', 'номера', 'номеров')} —`
      + ' дорисуются при прокрутке. Поиск ищет по всему списку.',
    // Значение <select> ставим свойством, а не атрибутом selected в разметке:
    // так шаблон строки одинаков для всех и браузер разбирает его быстрее.
    // Только по нарисованной порции — остальных строк ещё нет.
    after: (slice) => {
      slice.forEach((s) => {
        const sel = list.querySelector(
          `.subscriber-item[data-number="${CSS.escape(s.number)}"] .status-select`);
        if (!sel) return;
        sel.value = s.user_status || '';
        // Статус могли удалить из справочника, а у номера он ещё записан. Тогда
        // value не находит своего option и список показывает пустоту. Раньше в
        // такой ситуации ни у одного option не было selected и браузер сам
        // показывал первый — повторяем это поведение.
        if (sel.selectedIndex < 0) sel.selectedIndex = 0;
      });
    },
  });

  attachSubscriberListeners(list);
}

/**
 * Поля дат командировки. Рисуются ТОЛЬКО для тех, кто в командировке.
 *
 * ЗАЧЕМ ЛЕНИВО. `input type="date"` — самый дорогой из полей ввода: браузер
 * поднимает под него теневое дерево с кнопками и календарём. В командировке
 * же обычно единицы человек из сотни, а поля создавались всем — двести
 * календарей, из которых видно четыре. Остальным кладём пустой контейнер и
 * наполняем его, когда галку поставят (см. attachSubscriberListeners).
 */
function tripDateInputs(s) {
  return `<input type="date" class="trip-start" data-number="${esc(s.number)}" value="${esc(s.trip_start_date || '')}">
          <input type="date" class="trip-end" data-number="${esc(s.number)}" value="${esc(s.trip_end_date || '')}">`;
}

/**
 * Обработчики списка абонентов — ТРИ ШТУКИ НА ВЕСЬ СПИСОК.
 *
 * БЫЛО: по слушателю на каждый элемент управления. На сотне абонентов это
 * пять проходов по дереву и около пятисот подписок — и всё это заново после
 * каждого сохранения и каждой буквы в поиске. Отсюда и подвисание при
 * открытии настроек.
 *
 * СТАЛО: событие всплывает до контейнера, и уже там мы смотрим, во что
 * попали. Подписка одна, вешается один раз за жизнь списка — сколько бы
 * строк в нём ни перерисовали.
 */
function attachSubscriberListeners(root) {
  if (root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  const numberOf = (el) => el.dataset.number
    || el.closest('.subscriber-item')?.dataset.number || '';

  root.addEventListener('change', (e) => {
    const t = e.target;

    if (t.classList.contains('status-select')) {
      const item = t.closest('.subscriber-item');
      const st = state.statuses.find((x) => x.id === t.value);
      if (item && st) item.style.borderLeftColor = st.color;
      return saveSubscriber(numberOf(t), { status: t.value });
    }

    if (t.classList.contains('trip-check')) {
      const dates = t.closest('.control-group').querySelector('.trip-dates');
      dates.classList.toggle('active', t.checked);
      const payload = { is_business_trip: t.checked };
      if (t.checked) {
        const number = numberOf(t);
        // Полей может ещё не быть: всем подряд мы их не рисуем (см.
        // tripDateInputs). Раз галку поставили — вот теперь и создадим.
        if (!dates.querySelector('.trip-start')) {
          const sub = state.subscribers.find((x) => x.number === number) || { number };
          dates.innerHTML = tripDateInputs(sub);
        }
        const start = dates.querySelector('.trip-start');
        const end = dates.querySelector('.trip-end');
        const today = new Date().toISOString().slice(0, 10);
        if (!start.value) start.value = today;
        if (!end.value) end.value = today;
        payload.trip_start_date = start.value;
        payload.trip_end_date = end.value;
      }
      return saveSubscriber(numberOf(t), payload);
    }

    if (t.classList.contains('trip-start') || t.classList.contains('trip-end')) {
      const field = t.classList.contains('trip-start') ? 'trip_start_date' : 'trip_end_date';
      return saveSubscriber(numberOf(t), { [field]: t.value });
    }
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.save-limit');
    if (!btn) return;
    const item = btn.closest('.subscriber-item');
    const input = item && item.querySelector('.limit-input');
    if (!input) return;
    saveSubscriber(numberOf(btn), { limit: input.value === '' ? 0 : Number(input.value) }, btn);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('limit-input')) return;
    e.preventDefault();
    const item = e.target.closest('.subscriber-item');
    const btn = item && item.querySelector('.save-limit');
    if (btn) btn.click();
  });
}

async function saveSubscriber(number, payload, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const data = await postJSON(`/api/users/${encodeURIComponent(number)}`, payload);
    if (data.view) applyView(data.view);
    if (btn) { btn.textContent = 'Сохранено'; setTimeout(() => { btn.textContent = 'Сохранить'; }, 1400); }
    else flashHint(`Настройки ${formatPhone(number)} сохранены.`);
    // Список НЕ перерисовываем. Всё, что тут видно, — номер, ФИО, должность,
    // сумма счёта и то, что человек только что сам и поменял; ни одно из
    // этого от сохранения не меняется. А перерисовка сбрасывала фокус прямо
    // из-под курсора и заново собирала сотню строк на каждую галочку.
  } catch (err) {
    flashHint(`Не удалось сохранить: ${err.message}`, 'error');
    if (btn) btn.textContent = 'Сохранить';
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* Статусы: создание, переименование, цвет, удаление. */
function renderStatusSettings(el) {
  el.innerHTML = `
    <div class="settings-note">Статусы помечают абонентов в списке и становятся фильтрами.
      Встроенные статусы можно переименовать и перекрасить, но не удалить.</div>

    <div class="status-create">
      <input type="text" id="newStatusName" placeholder="Название статуса" maxlength="30">
      <input type="color" id="newStatusColor" value="#1f7a5c" title="Цвет">
      <button class="btn btn-primary" id="createStatusBtn">Добавить</button>
    </div>

    <div class="settings-section-title">Существующие статусы</div>
    <div id="statusList" class="status-list"></div>`;

  const draw = () => {
    const list = $('statusList');
    const counts = {};
    state.subscribers.forEach((s) => { counts[s.user_status] = (counts[s.user_status] || 0) + 1; });

    list.innerHTML = state.statuses.map((st) => `
      <div class="status-item">
        <input type="color" class="status-color" value="${esc(st.color)}" data-id="${esc(st.id)}" title="Цвет">
        <input type="text" class="status-label" value="${esc(st.label)}" data-id="${esc(st.id)}" maxlength="30">
        <span class="status-count">${counts[st.id] || 0}</span>
        ${st.builtin
          ? '<span class="pill pill-muted" title="Встроенный статус">базовый</span>'
          : `<button class="status-del" data-id="${esc(st.id)}" title="Удалить">✕</button>`}
      </div>`).join('');

    $$('.status-color, .status-label', list).forEach((input) => {
      input.addEventListener('change', async () => {
        const id = input.dataset.id;
        const current = state.statuses.find((x) => x.id === id);
        if (!current) return;
        const label = input.classList.contains('status-label') ? input.value.trim() : current.label;
        const color = input.classList.contains('status-color') ? input.value : current.color;
        if (!label) { flashHint('Название статуса не может быть пустым', 'error'); draw(); return; }
        try {
          const data = await postJSON('/api/statuses', { previous_id: id, label, color });
          state.statuses = data.statuses;
          renderStatusFilters();
          renderUsers();
          draw();
        } catch (err) {
          flashHint(err.message, 'error');
          draw();
        }
      });
    });

    $$('.status-del', list).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const st = state.statuses.find((x) => x.id === btn.dataset.id);
        if (!confirm(`Удалить статус «${st ? st.label : ''}»? Абоненты с ним перейдут в «Норма».`)) return;
        try {
          const data = await postJSON('/api/statuses/delete', { id: btn.dataset.id });
          state.statuses = data.statuses;
          if (data.view) applyView(data.view);
          draw();
          flashHint('Статус удалён.');
        } catch (err) {
          flashHint(err.message, 'error');
        }
      });
    });
  };
  draw();

  $('createStatusBtn').onclick = async () => {
    const label = $('newStatusName').value.trim();
    const color = $('newStatusColor').value;
    if (!label) { flashHint('Введите название статуса', 'error'); return; }
    try {
      const data = await postJSON('/api/statuses', { label, color });
      state.statuses = data.statuses;
      $('newStatusName').value = '';
      renderStatusFilters();
      draw();
      flashHint(`Статус «${label}» создан.`);
    } catch (err) {
      flashHint(err.message, 'error');
    }
  };
}

/* Каталог тарифов. */
function renderTariffSettings(el) {
  el.innerHTML = `
    <div class="settings-note">Каталог, по которому подбирается тариф. Пакет 0 означает
      «нет пакета, всё по факту потребления». После сохранения отчёт пересчитается.</div>
    <div class="tariff-editor">
      <div class="tariff-editor-head">
        <span>Тариф</span><span>₽/мес</span><span>Мин</span><span>SMS</span><span>МБ</span><span></span>
      </div>
      <div id="tariffRows"></div>
    </div>
    <div class="settings-actions">
      <button class="btn btn-soft" id="tariffAdd">+ Добавить тариф</button>
      <button class="btn btn-soft" id="tariffReset">Сбросить</button>
      <button class="btn btn-primary" id="tariffSave">Сохранить и пересчитать</button>
    </div>`;

  const draw = () => {
    const rows = $('tariffRows');
    rows.innerHTML = state.tariffs.map((t, i) => `
      <div class="tariff-editor-row">
        <input type="text" value="${esc(t.name)}" data-i="${i}" data-f="name" aria-label="Название">
        <input type="number" value="${t.fee}" data-i="${i}" data-f="fee" min="0" step="10" aria-label="Абонплата">
        <input type="number" value="${t.minutes}" data-i="${i}" data-f="minutes" min="0" step="100" aria-label="Минуты">
        <input type="number" value="${t.sms}" data-i="${i}" data-f="sms" min="0" step="50" aria-label="SMS">
        <input type="number" value="${t.internet_mb}" data-i="${i}" data-f="internet_mb" min="0" step="1024" aria-label="Мегабайты">
        <button class="tariff-del" data-del="${i}" title="Удалить">✕</button>
      </div>`).join('');

    $$('input', rows).forEach((input) => {
      input.addEventListener('change', () => {
        const t = state.tariffs[Number(input.dataset.i)];
        const f = input.dataset.f;
        t[f] = f === 'name' ? input.value : Number(input.value) || 0;
      });
    });
    $$('[data-del]', rows).forEach((btn) => {
      btn.addEventListener('click', () => { state.tariffs.splice(Number(btn.dataset.del), 1); draw(); });
    });
  };
  draw();

  $('tariffAdd').onclick = () => {
    state.tariffs.push({
      id: `custom_${Date.now()}`, name: 'Новый тариф', kind: 'voice', fee: 0,
      minutes: 0, sms: 0, internet_mb: 0, unlimited_internet: false,
      rate_min: 0.18, rate_sms: 0.05, rate_mb: 0.05, note: '',
    });
    draw();
  };
  $('tariffReset').onclick = async () => {
    try {
      state.tariffs = (await postJSON('/api/tariffs/reset', {})).tariffs;
      draw();
      await refreshView();
      flashHint('Каталог сброшен к значениям по умолчанию.');
    } catch (err) { flashHint(err.message, 'error'); }
  };
  $('tariffSave').onclick = async () => {
    try {
      state.tariffs = (await postJSON('/api/tariffs', { tariffs: state.tariffs })).tariffs;
      await refreshView();
      closeOverlay('settingsPanel');
      flashHint('Каталог сохранён, рекомендации пересчитаны.');
    } catch (err) { flashHint(err.message, 'error'); }
  };
}

/* Виджеты: что показывать в отчёте. Выбор запоминается в браузере. */
function renderWidgetSettings(el) {
  const total = allWidgets().length;
  const on = allWidgets().filter((w) => widgetOn(w.id)).length;

  el.innerHTML = `
    <div class="settings-note">Отчёт по умолчанию показывает всё, что можно посчитать
      по загруженному счёту. Выключите блоки, которые вам не нужны, — выбор сохранится
      в этом браузере и применится к следующим загрузкам.
      Сейчас включено <b>${on}</b> из ${total}.</div>
    <div class="widget-presets">
      <button class="btn btn-soft" id="widgetsAll">Включить всё</button>
      <button class="btn btn-soft" id="widgetsEssentials">Только основное</button>
    </div>
    <div id="widgetGroups"></div>
    <div class="settings-actions">
      <button class="btn btn-soft" id="resetAll">Очистить все данные</button>
    </div>`;

  const draw = () => {
    $('widgetGroups').innerHTML = WIDGET_GROUPS.map((group) => {
      const shown = group.items.filter((w) => widgetOn(w.id)).length;
      // Пока в группе включено хоть что-то, кнопка выключает всё. Иначе,
      // выключив один блок, группу нельзя было бы убрать одним нажатием:
      // кнопка сразу переключалась на «включить все».
      const anyOn = shown > 0;
      return `<div class="widget-group">
        <div class="widget-group-head">
          <span class="widget-group-title">${esc(group.title)}</span>
          <button class="widget-group-all" data-group="${esc(group.title)}"
            data-target="${anyOn ? 'off' : 'on'}">${anyOn ? 'выключить все' : 'включить все'}</button>
          <span class="widget-group-count">${shown} из ${group.items.length}</span>
        </div>
        ${group.items.map((w) => {
          const isOn = widgetOn(w.id);
          return `<div class="settings-item${isOn ? '' : ' is-off'}">
            <!-- ИСПРАВЛЕНО: раньше здесь выводилось ${w.icon}. После того как
                 эмодзи убрали из реестра виджетов, поле стало пустым и в
                 настройках печаталось слово «undefined». Вместо иконки —
                 точка-маркер: она же показывает, включён блок или нет. -->
            <span class="settings-item-icon" aria-hidden="true"></span>
            <span class="settings-item-label">${esc(w.label)}
              ${w.note ? `<small>${esc(w.note)}</small>` : ''}</span>
            <button class="settings-toggle${isOn ? ' on' : ''}" data-toggle="${esc(w.id)}"
              role="switch" aria-checked="${isOn}" aria-label="${esc(w.label)}"></button>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');

    $$('[data-toggle]', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggle;
        if (state.hiddenWidgets.has(id)) state.hiddenWidgets.delete(id);
        else state.hiddenWidgets.add(id);
        commit();
      });
    });

    $$('[data-group]', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const group = WIDGET_GROUPS.find((g) => g.title === btn.dataset.group);
        if (!group) return;
        const turnOn = btn.dataset.target === 'on';
        group.items.forEach((w) => {
          if (turnOn) state.hiddenWidgets.delete(w.id);
          else state.hiddenWidgets.add(w.id);
        });
        commit();
      });
    });
  };

  // Блоки перерисовываются целиком: график и матрица считают ширину по
  // контейнеру, а у скрытого элемента она равна нулю — без пересчёта
  // включённый блок остался бы с раскладкой «на 360 px».
  const commit = () => {
    saveWidgetPrefs();
    applyWidgetVisibility();
    if (state.subscribers.length) {
      drawTrendChart();
      // Выключенные блоки больше не рисуются вовсе (см. renderExtras), поэтому
      // только что включённый пуст — его нужно нарисовать здесь. Заодно это и
      // есть пересчёт раскладки: renderExtras рисует ровно включённые.
      renderExtras();
    }
    renderWidgetSettings(el);
  };

  draw();

  $('widgetsAll').onclick = () => {
    state.hiddenWidgets.clear();
    commit();
    flashHint('Показаны все блоки отчёта.');
  };
  $('widgetsEssentials').onclick = () => {
    state.hiddenWidgets = new Set(allWidgets()
      .map((w) => w.id).filter((id) => !WIDGET_ESSENTIALS.has(id)));
    commit();
    flashHint('Оставлены только основные блоки.');
  };

  $('resetAll').onclick = async () => {
    if (!confirm('Удалить все загруженные счета, лимиты и настройки абонентов?')) return;
    try {
      await postJSON('/api/reset', {});
      state.hasRoster = false;
      state.openPanels = {};
      applyView({ month: '', months: [], subscribers: [], summary: null, tariff_stats: [], trend: [] });
      closeOverlay('settingsPanel');
      flashHint('Данные очищены.');
    } catch (err) { flashHint(err.message, 'error'); }
  };
}

/* ── Экспорт отчёта ──────────────────────────────────────────────────────── */
function downloadReport() {
  if (!state.subscribers.length) return;

  const header = ['Номер', 'ФИО', 'Должность', 'Табельный', 'Статус абонента', 'В командировке',
    'Тариф', 'Абонплата ₽', 'Начислено ₽', 'Лимит ₽', 'Превышение лимита ₽', 'Оценка',
    'Минуты', 'Минуты ₽', 'Интернет ГБ', 'Интернет ₽', 'SMS', 'SMS ₽',
    'Вердикт минуты', 'Вердикт интернет', 'Вердикт SMS',
    'Рекомендация', 'Выгодный тариф', 'Экономия ₽/мес', 'Обоснование'];

  const rows = state.subscribers.map((s) => {
    const [voice, net, sms] = ['voice', 'internet', 'sms']
      .map((k) => s.categories.find((c) => c.key === k) || { used: 0, cost: 0, verdict: {} });
    const action = ACTION_META[s.recommendation.action] || ACTION_META.keep;
    const userStatus = state.statuses.find((x) => x.id === s.user_status);
    return [
      s.number, s.username, s.position, s.personnel_no,
      userStatus ? userStatus.label : '', s.on_trip ? 'да' : '',
      s.plan_name, s.plan_fee, s.total, s.limit_set ? s.limit : '', s.overpayment,
      (STATUS_META[s.status] || STATUS_META.normal).label,
      Math.round(voice.used), voice.cost,
      (net.used / 1024).toFixed(2), net.cost,
      Math.round(sms.used), sms.cost,
      voice.verdict.label || '', net.verdict.label || '', sms.verdict.label || '',
      action.label,
      s.recommendation.best ? s.recommendation.best.tariff_name : '',
      s.saving, s.recommendation.lines.join(' '),
    ];
  });

  const csv = '﻿' + [header, ...rows]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `анализ_тарифов_${state.month || 'отчёт'}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  flashHint(`Отчёт по ${state.subscribers.length} абонентам сохранён.`);
}

/* ── Вид и тема ──────────────────────────────────────────────────────────── */
function setView(mode) {
  state.view = mode;
  $$('.view').forEach((b) => b.classList.remove('active'));
  const btn = $(mode === 'table' ? 'tableView' : 'gridView');
  if (btn) btn.classList.add('active');
  const grid = $('usersGrid');
  if (grid) grid.classList.toggle('table-view', mode === 'table');
}

function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme');
  const isDark = current ? current === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = isDark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  if (state.subscribers.length) drawTrendChart();
}

/* ── Индикаторы ──────────────────────────────────────────────────────────── */
function showLoading(text, pct) {
  const box = $('loading');
  if (box) box.hidden = false;
  setText('loadingText', text);
  const fill = $('progressFill');
  if (fill) fill.style.width = `${pct}%`;
}

function hideLoading() {
  const fill = $('progressFill');
  if (fill) fill.style.width = '100%';
  setTimeout(() => {
    const box = $('loading');
    if (box) box.hidden = true;
    if (fill) fill.style.width = '0%';
  }, 220);
}

let hintTimer = null;
function flashHint(text, kind = 'ok', ms = 4200) {
  const hint = $('hint');
  if (!hint) return;
  hint.textContent = text;
  hint.className = `hint show hint-${kind}`;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.className = 'hint'; }, ms);
}

/* ── Форматирование ──────────────────────────────────────────────────────── */
function money(value) {
  const n = Number(value) || 0;
  const rounded = Math.abs(n) < 100 ? Math.round(n * 100) / 100 : Math.round(n);
  return rounded.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

function compact(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + ' млн';
  if (Math.abs(n) >= 10000) return Math.round(n / 1000) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
}

function fmtGb(mb) {
  const gb = (Number(mb) || 0) / 1024;
  return gb >= 1 ? `${gb.toFixed(1).replace('.', ',')} ГБ` : `${Math.round(mb)} МБ`;
}

function formatMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : String(month || '');
}

/** Месяц в именительном падеже — для оборота «за июнь 2026». */
function monthNom(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  return m ? `${MONTH_NOM[Number(m[2]) - 1]} ${m[1]}` : String(month || '');
}

function shortMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  return m ? `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1].slice(2)}` : String(month || '');
}

/* ОФОРМЛЕНИЕ НОМЕРА — ТОЛЬКО ДЛЯ ЭКРАНА.
 *
 * Вид: +7 (996) 305-40-30. Скобки вокруг кода дают глазу опору, а группы
 * по две цифры в конце читаются вслух без запинки — это важно, когда номер
 * диктуют по телефону.
 *
 * В БАЗЕ НОМЕР ХРАНИТСЯ КАК БЫЛ — десять цифр без разделителей. Форматируем
 * только при выводе, ни одно сохранение через эту функцию не проходит.
 * Причина простая: по номеру идут поиск, сверка со счётом и связь с
 * правилами. Начни мы хранить скобки — пришлось бы чистить их в каждом
 * запросе, и рано или поздно где-то забыли бы.
 *
 * Одиннадцать цифр с ведущей 7 или 8 тоже понимаем: в выгрузках оператора
 * встречаются оба варианта.
 */
function formatPhone(number) {
  let d = String(number || '').replace(/\D/g, '');
  // Отбрасываем код страны, если он есть: 8XXXXXXXXXX или 7XXXXXXXXXX.
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  // Непонятное не трогаем — лучше показать как есть, чем исказить.
  if (d.length !== 10) return String(number || '');
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
