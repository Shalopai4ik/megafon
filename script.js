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
  summary: null, tariffStats: [], tariffs: [],
  trend: [], invoice: {},
  // Разделение оплаты и правила номеров. Правила приезжают ОДНИМ списком,
  // как они лежат в базе; цвет от пометки отличает поле kind.
  paymentSummary: null, chipRules: [], trips: [],
  // payer — какая группа списка открыта: 'company' | 'self' | 'all'.
  // По умолчанию «платит компания»: отчёт про наши деньги, и открываться он
  // должен на них, а не на перемешанном списке.
  payer: 'company',
  // Лайт-режим: на экране только карточки тех, кому надо понизить тариф.
  // Читается из localStorage до первой отрисовки — см. loadLitePref.
  lite: false,
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
      { id: 'exSaving', label: 'Матрица «расход × экономия»', note: 'сколько платим и сколько вернём' },
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

/* ═══════════════════════════════════════════════════════════════════════════
 * ЛАЙТ-РЕЖИМ
 *
 * Экран сводится к одному списку: карточки абонентов, которым надо понизить
 * тариф. Ни показателей, ни графиков, ни расширенной аналитики, ни фильтров.
 *
 * ПОЧЕМУ ПЕРЕЗАГРУЗКА СТРАНИЦЫ, А НЕ ПРОСТО СКРЫТИЕ БЛОКОВ. Скрытый блок всё
 * равно собран: сотня строк разметки, четыре графика, полтора десятка
 * проходов по всему парку номеров. От «лайта», который делает ту же работу и
 * прячет результат, толку нет. Перезагрузка гарантирует, что тяжёлое просто
 * не начнёт считаться — за это и держим выбор в localStorage, а не в памяти.
 *
 * Настройки виджетов режим НЕ трогает: вышел из лайта — экран ровно такой,
 * каким его оставили.
 * ═════════════════════════════════════════════════════════════════════════ */

const LITE_STORAGE_KEY = 'liteMode';

function loadLitePref() {
  try {
    state.lite = localStorage.getItem(LITE_STORAGE_KEY) === '1';
  } catch (_) {
    state.lite = false;      // приватный режим — просто обычный вид
  }
}

/** Включить или выключить лайт и перезагрузить страницу. */
function setLite(on) {
  try {
    if (on) localStorage.setItem(LITE_STORAGE_KEY, '1');
    else localStorage.removeItem(LITE_STORAGE_KEY);
  } catch (_) {
    // Записать не вышло — переживём: режим продержится до перезагрузки.
    state.lite = on;
  }
  location.reload();
}

/**
 * Кому понижение тарифа МОЖНО НЕСТИ НА ПОДПИСЬ.
 *
 * Строго `lower` — «пакет избыточен, тот же месяц дешевле на меньшем тарифе».
 * Соседний `switch` («подобрать тариф») сюда НЕ входит: это другой случай —
 * тариф не опознан или нужен не меньший, а другой. В обычном фильтре
 * «Понизить тариф» они идут вместе, здесь — нет: список, названный
 * «кому понизить», должен состоять только из тех, кому понизить.
 *
 * Самоплатящие и исключённые отсеиваются вместе со всеми: за них компания не
 * платит, и понижать им тариф не её забота.
 *
 * ДОПОЛНИТЕЛЬНЫХ ОТСЕВОВ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ.
 *
 * Был заход, когда список резался жёстче: выбрасывались номера с перерасходом
 * пакета, с превышением лимита, в командировке и с экономией меньше сотни.
 * Замысел был «показать только бесспорное», а на деле экран начал ВРАТЬ ПРО
 * ДЕНЬГИ: в шапке лайта стоит сумма экономии, и она молча оказывалась меньше
 * настоящей — на этих данных 548 ₽ вместо 986 ₽, то есть каждый второй рубль
 * пропадал без объяснения.
 *
 * Пусть уж лучше в списке будет спорная строка, которую человек отбросит
 * глазом, чем в шапке — заниженная сумма, которую он проверить не может.
 * Решение об «уверены/не уверены» принимает тот, кто пойдёт с этим списком
 * к руководителю, а не фильтр.
 *
 * Единственное условие осталось прежним: строго `action === 'lower'`.
 */
function lowerCandidates() {
  return companySubs()
    .filter((s) => s.recommendation && s.recommendation.action === 'lower')
    .sort((a, b) => b.saving - a.saving);
}

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
  // Тема и свои цвета — до всего остального: перекрашивать уже нарисованный
  // экран значит показать человеку вспышку стандартной палитры.
  applyTheme({ redraw: false });
  loadWidgetPrefs();
  loadLitePref();

  bindUpload('billsBtn', 'billsFile', (file) => uploadFile(file, 'bill'));
  bindUpload('rosterBtn', 'rosterFile', (file) => uploadFile(file, 'roster'));
  bindUpload('tripsBtn', 'tripsFile', (file) => uploadFile(file, 'trips'));
  on('welcomeBillBtn', 'click', () => $('billsFile').click());
  on('welcomeRosterBtn', 'click', () => $('rosterFile').click());
  on('welcomeTripsBtn', 'click', () => $('tripsFile').click());
  on('downloadBtn', 'click', downloadReport);
  on('themeBtn', 'click', openTheme);
  on('statsBtn', 'click', openStats);
  on('settingsBtn', 'click', openSettings);
  on('liteBtn', 'click', () => setLite(!state.lite));
  on('billAlertClose', 'click', () => {
    billAlertDismissed = state.month || '-';
    $('billAlert').hidden = true;
  });
  on('liteExitBtn', 'click', () => setLite(false));
  on('monthSelect', 'change', (e) => loadMonth(e.target.value));
  bindMainMenu();

  on('searchInput', 'input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderUsers(true);
  }, 180));

  // Фильтр и сортировка — выпадающие списки. Обработчик один на список
  // вместо двадцати на кнопки, и порядок пунктов правится в разметке.
  on('filterSelect', 'change', (e) => {
    state.filter = e.target.value;
    renderUsers(true);
  });
  on('sortSelect', 'change', (e) => {
    state.sort = e.target.value;
    // Новый ключ — снова по убыванию: наверху списка должно оказаться
    // самое крупное, за этим сюда и приходят.
    state.sortDir = 'desc';
    updateSortDirButton();
    renderUsers(true);
  });
  on('sortDirBtn', 'click', () => {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    updateSortDirButton();
    renderUsers(true);
  });

  bindPayerTabs();

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
      else if (what === 'theme') closeOverlay('themeModal');
      else closeOverlay('subModal');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['subModal', 'settingsPanel', 'statsModal', 'themeModal'].forEach(closeOverlay);
    }
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

/** Стрелка у кнопки порядка: ↓ по убыванию, ↑ по возрастанию. */
function updateSortDirButton() {
  const btn = $('sortDirBtn');
  if (!btn) return;
  const desc = state.sortDir === 'desc';
  btn.textContent = desc ? '↓' : '↑';
  btn.title = desc ? 'Сначала большие значения' : 'Сначала малые значения';
}

/* ── Переключатель «кто платит» ──────────────────────────────────────────────
 *
 * Три группы: все номера, номера компании и те, за кого платит сам сотрудник.
 * Это не фильтр: фильтр сужает список внутри выбранной группы, а группа
 * решает, чьи деньги мы вообще смотрим. Поэтому переключатель живёт отдельной
 * строкой над фильтрами и переживает их сброс.
 * ─────────────────────────────────────────────────────────────────────────── */
function bindPayerTabs() {
  $$('.payer-tab').forEach((btn) => btn.addEventListener('click', () => {
    state.payer = btn.dataset.payer;
    renderPayerTabs();
    renderUsers(true);
  }));
}

function renderPayerTabs() {
  const panel = $('payerTabs');
  if (!panel) return;

  // Считаем ТОЙ ЖЕ функцией, что отбирает карточки (inPayerGroup): число на
  // кнопке и длина списка под ней обязаны сходиться. Исключённый номер в две
  // группы сразу не попадёт — иначе счётчики в сумме дали бы больше, чем
  // номеров в парке.
  const count = (group) => state.subscribers.filter((s) => inPayerGroup(s, group)).length;
  const off = count('excluded');
  const self = count('self');
  setText('payerCountAll', count('all'));
  setText('payerCountCompany', count('company'));
  setText('payerCountSelf', self);
  setText('payerCountExcluded', off);

  // ВЫБОР ПОПРАВЛЯЕМ ДО ПОДСВЕТКИ, а не после. Группа, которую только что
  // опустошили (сняли последнюю пометку), не должна остаться выбранной: на
  // экране будет пусто, а почему — непонятно. Раньше это стояло ниже, и
  // подсветка на один проход оставалась на кнопке, которой уже нет.
  if (self === 0 && state.payer === 'self') state.payer = 'company';
  if (off === 0 && state.payer === 'excluded') state.payer = 'company';

  $$('.payer-tab', panel).forEach((b) => {
    b.classList.toggle('active', b.dataset.payer === state.payer);
    // Пустую группу не показываем вовсе: пустая вкладка выглядит поломкой.
    // «Все» и «Платит компания» есть всегда.
    if (b.dataset.payer === 'self') b.hidden = self === 0;
    if (b.dataset.payer === 'excluded') b.hidden = off === 0;
  });

  // Пока нет ни самоплатящих, ни исключённых, переключатель только мешает:
  // все группы, кроме одной, пустые. Прячем его целиком.
  panel.hidden = self === 0 && off === 0;

  // Подпись объясняет расхождение, которое иначе выглядит как ошибка: в
  // группе «Платит компания» номеров меньше, чем всего в парке.
  const ps = state.paymentSummary;
  const note = [];
  if (self && ps) {
    note.push(`сотрудники вносят за себя ${money(ps.self_paid_total)}`
      + ' — в расходы и экономию компании это не входит');
  }
  if (off && ps) {
    note.push(`${off} ${plural(off, 'номер', 'номера', 'номеров')} в группе`
      + ` «Не считаем»${ps.excluded_total ? ` на ${money(ps.excluded_total)}` : ''}`
      + ' — ни в одну цифру над списком они не входят');
  }
  setText('payerTabsNote', note.join(' · '));
}

/** Платит ли сотрудник за номер сам. Считает сервер, здесь только читаем. */
function isSelfPaid(s) {
  return !!(s.payment || {}).self_paid;
}

/**
 * Номер из группы «Не считаем» — за него ТОЧНО не считаем и его ТОЧНО не
 * учитываем.
 *
 *     Черемшу берут не всю, что на делянке выросла:
 *     Эта под трактором мятая, ту собака метила, а вон та вовсе не та.
 *     Их не в кузов кладут и не на весы, но и не выбрасывают —
 *     Кладут отдельно, с краю. Чтоб рука второй раз не потянулась.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ГРУППА, А НЕ ПРОСТО ПОМЕТКА. Пометка «не учитывать» и
 * раньше убирала номер из всех сводок, но сам он оставался лежать в общем
 * списке — среди тех, за кого компания платит. Выглядело это так: в KPI одно
 * число, в списке под ним другое, и объяснить разницу нечем.
 *
 * ПОЧЕМУ НЕ ПРЯЧЕМ СОВСЕМ. Спрятанный номер нельзя вернуть: снять пометку не с
 * чего. Поэтому группа своя, видимая и в один щелчок доступная.
 *
 * ЧЕМ ЗАДАЁТСЯ СОСТАВ. Признаком «Искл.» у правила номера (Настройки →
 * Правила номеров). Значит группа настолько же гибкая, насколько и правила:
 * признак вешают на любое правило, правило — на любой номер мышью в «⚙» или
 * списком через «Загрузить правила списком». Отдельного справочника «кого не
 * считать» нарочно нет — он был бы третьим местом, где хранится одно и то же.
 */
function isExcluded(s) {
  return !!(s.payment || {}).excluded;
}

/**
 * Входит ли номер в группу переключателя.
 *
 * ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЭТО РЕШАЕТСЯ. По этой же функции считаются число на
 * кнопке группы, знаменатель «N из M» над списком и сам отбор карточек. Пока
 * правило было расписано в трёх местах, оно и разъезжалось: на кнопке одно
 * число, в списке другое, и понять, кто из них врёт, было нечем.
 *
 * ПОРЯДОК ПРОВЕРОК ВАЖЕН. «Не считаем» сильнее всех: номер оттуда не всплывает
 * ни у компании, ни у самоплатящих, даже если он помечен и тем и другим.
 * В «Все номера» видно всех — это ровно тот случай, когда человек хочет
 * посмотреть парк целиком, ничего не отсеивая.
 *
 * НЕЗНАКОМОЕ ИМЯ ГРУППЫ РАВНО «ВСЕМ», и это не придирка: имя приезжает из
 * разметки кнопки и переживает перезагрузку вкладки. Стоит когда-нибудь
 * переименовать группу — и номера начнут молча пропадать с экрана. Пусть уж
 * лучше покажется лишнее: пропажу заметить нечем, а лишнее видно сразу.
 */
const PAYER_GROUPS = new Set(['company', 'self', 'excluded']);

function inPayerGroup(s, group) {
  if (!PAYER_GROUPS.has(group)) return true;         // «Все номера»
  if (isExcluded(s)) return group === 'excluded';
  if (group === 'excluded') return false;
  return group === 'self' ? isSelfPaid(s) : !isSelfPaid(s);
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

/* ═══════════════════════════════════════════════════════════════════════════
 * ПЕРЕРИСОВКА, КОТОРАЯ НЕ ВЫБРАСЫВАЕТ НАВЕРХ
 *
 *     Пришёл на делянку, дошёл до дальнего края,
 *     Нагнулся к кусту, срезал, разогнулся — а ты у ворот.
 *     И так двадцать раз: срезал пучок — и обратно к воротам,
 *     К вечеру ног нет, а в кузове три пучка черемши.
 *
 *     Не поле виновато и не спина твоя, милок,
 *     А тот, кто тропу за тобой каждый раз заново стелет.
 *     Раз уж встал человек на своё место — там его и оставь,
 *     А правь то, что поправить просили. Вот и вся недолга.
 *
 * ЧТО БЫЛО. Любая правка — выбрал плательщика в выпадающем списке, щёлкнул
 * правило в карточке, включил блок в виджетах — уходила на сервер, сервер
 * возвращал пересчитанный отчёт, а мы перерисовывали ЦЕЛИКОМ тот кусок, где
 * человек в этот момент стоял. Прокрутка при этом сбрасывается в ноль: и у
 * окна настроек (`.settings-content` — свой прокручиваемый блок), и у главного
 * экрана. Со стороны это ровно то самое «выбрал пункт — перекинуло обратно».
 * Заодно из-под курсора улетал фокус, а из полей — набранный текст.
 *
 * ЧТО СТАЛО. Перерисовка обёрнута: до неё запоминаем, где человек стоял и в
 * каком поле держал курсор, после — возвращаем. Обёртка одна на все разделы,
 * поэтому разъехаться они не могут.
 *
 * ПОЧЕМУ НЕ «ПРОСТО НЕ ПЕРЕРИСОВЫВАТЬ». Кое-где перерисовка нужна по делу:
 * правило меняет суммы во всех карточках, счётчик «Номеров» в таблице правил
 * считается по отчёту. Отказаться от неё значит показывать старые числа.
 *
 * АДРЕС ПОЛЯ, а не ссылка на элемент: старый элемент после перерисовки
 * выброшен, и возвращать фокус надо НОВОМУ — тому, что встало на его место.
 * Адрес складывается из ключа строки (data-code / data-id / data-number) и
 * имени поля (data-f); у одиночных полей хватает id.
 * ═══════════════════════════════════════════════════════════════════════════ */

const EDITABLE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

// Ставится изнутри перерисовки, когда та сама решает, куда смотреть (см.
// flashRow). Живёт ровно один вызов keepPlace и им же гасится.
let placeClaimed = false;

/** Ключ строки таблицы: по нему поле находится заново после перерисовки. */
function rowKeyOf(el) {
  const row = el.closest('[data-code],[data-id],[data-number]');
  if (!row) return '';
  return row.dataset.code || row.dataset.id || row.dataset.number || '';
}

// Имя поля в разметке: в таблицах справочников это data-f, в панели «⚙»
// карточки — data-field. Держим оба, чтобы фокус возвращался и там, и там:
// именно выпадающий список плательщика в карточке и жаловались, что «кидает».
const fieldNameOf = (el) => el.dataset.f || el.dataset.field || '';

function fieldAddress(el) {
  if (!el || !EDITABLE_TAGS.has(el.tagName)) return null;
  if (el.id) return { id: el.id };
  const field = fieldNameOf(el);
  if (!field) return null;
  // data-i отличает строки каталога тарифов: ключа у них нет, только номер.
  return { key: rowKeyOf(el), field, index: el.dataset.i || '' };
}

/**
 * Найти поле по адресу. Перебором, а не селектором: в ключах лежат коды
 * правил и номера телефонов, и собирать из них строку селектора — верный
 * способ однажды получить синтаксическую ошибку на пустом месте.
 */
function findField(addr, root = document) {
  if (!addr) return null;
  if (addr.id) return document.getElementById(addr.id);
  return $$('input, select, textarea', root).find((el) =>
    fieldNameOf(el) === addr.field
    && (el.dataset.i || '') === addr.index
    && rowKeyOf(el) === addr.key) || null;
}

/**
 * Перерисовать, оставив человека на месте.
 *
 * Прокрутку запоминаем у ВСЕХ прокручиваемых предков активного элемента, а не
 * только у окна: настройки прокручиваются внутри модалки, список абонентов —
 * внутри своего блока, а главный экран — самим окном.
 */
// Прокручиваемые блоки, которые переживают перерисовку не сами, а по адресу:
// сам элемент может быть выброшен и создан заново, поэтому запоминаем его
// МЕСТО (селектор + порядковый номер), а не ссылку.
const SCROLL_BOXES = '.settings-content, .subscribers-list, .trip-list, .num-list';

function keepPlace(redraw) {
  // Гасим флаг НА ВХОДЕ, а не только на выходе: flashRow вызывают и снаружи
  // keepPlace, и оставленный им взведённый флаг съел бы восстановление места
  // у следующей, ни в чём не повинной перерисовки.
  placeClaimed = false;
  const boxes = $$(SCROLL_BOXES).map((el, i) => [i, el.scrollTop, el.scrollLeft]);
  const pageX = window.scrollX;
  const pageY = window.scrollY;

  const was = document.activeElement;
  const addr = fieldAddress(was);
  // Каретку возвращаем только там, где она вообще есть: у input[type=number]
  // и у select обращение к setSelectionRange бросает исключение.
  let caret = null;
  if (addr && was.setSelectionRange && ['text', 'search', 'textarea', 'url', 'tel', 'password']
      .includes(was.type || 'textarea')) {
    try { caret = [was.selectionStart, was.selectionEnd]; } catch (_) { caret = null; }
  }

  redraw();

  // ПЕРЕРИСОВКА МОГЛА САМА ЗАХОТЕТЬ ДРУГОГО МЕСТА. Заводя новое правило,
  // экран нарочно доводит взгляд до свежей строки (flashRow) — она садится в
  // конец группы, обычно за краем окна. Возвращать человека на прежнее место
  // в этом случае значит спрятать от него то, что он только что создал.
  if (placeClaimed) { placeClaimed = false; return; }

  const fresh = $$(SCROLL_BOXES);
  boxes.forEach(([i, top, left]) => {
    const el = fresh[i];
    if (!el) return;
    el.scrollTop = top;
    el.scrollLeft = left;
  });
  window.scrollTo(pageX, pageY);

  if (!addr) return;
  const again = findField(addr);
  if (!again) return;
  // preventScroll — иначе браузер сам догоняет до поля и рушит только что
  // восстановленную прокрутку.
  try { again.focus({ preventScroll: true }); } catch (_) { return; }
  if (caret) { try { again.setSelectionRange(caret[0], caret[1]); } catch (_) { /* не текст */ } }
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
    // Счёт мог не сойтись сам с собой — тогда об этом говорим ОТДЕЛЬНО и
    // навсегда, а не строчкой в общей сводке загрузки (см. showBillAlert).
    if (isBill) showBillAlert(data.checksum);
    flashHint(uploadSummary(data, kind, file.name));
  } catch (err) {
    hideLoading();
    flashHint(`Не удалось обработать «${file.name}»: ${err.message}`, 'error', 7000);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * СЧЁТ, КОТОРЫЙ НЕ СХОДИТСЯ САМ С СОБОЙ
 *
 *     Черемшу принимают на складе по весу, по счёту,
 *     Наверху накладная: «сто сорок кило ровно».
 *     Развязали мешки, перевесили каждый по одному —
 *     Сто двадцать. И кладовщик глядит на тебя виновно.
 *
 *     Не спорь с кладовщиком, не ищи, кто из вас виноват:
 *     Может, лист потеряли, а может, воз недовезли до места.
 *     Твоё дело — не подписать накладную, покуда не сойдётся,
 *     Потому что подпишешь — и недостача станет твоя.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Сервер складывает итоги всех абонентов и сравнивает с
 * «Итого начислено» из шапки счёта (см. server._bill_checksum). Сошлось —
 * файл целый. Не сошлось — на экране НЕ ТОТ счёт, по которому платят.
 *
 * ПОЧЕМУ ПЛАШКА, А НЕ ПОДСКАЗКА. Подсказка гаснет через четыре секунды, а
 * неверные числа остаются на весь день. Здесь как раз тот случай, когда
 * молчать дороже, чем мозолить глаз: по этим числам идут к руководителю.
 * ═══════════════════════════════════════════════════════════════════════ */
// Период, по которому плашку уже закрыли руками. Закрыл — не мозолим глаз до
// конца сеанса, но при переключении на другой период показываем снова: там
// свой счёт и своя сверка.
let billAlertDismissed = '';

function showBillAlert(checksum) {
  const box = $('billAlert');
  if (!box) return;

  const c = checksum || {};
  // Не проверяли (в шапке счёта своего итога не было) или сошлось — прячем.
  if (!c.checked || c.ok) { box.hidden = true; return; }
  // Новый разбор — плашка снова в силе, даже если её закрывали.
  billAlertDismissed = '';

  const facts = $('billAlertFacts');
  if (facts) {
    facts.innerHTML = `
      В счёте указано <b>${money(c.declared)}</b>,
      по абонентам набирается <b>${money(c.computed)}</b>,
      расхождение <b>${money(Math.abs(c.diff))}</b>.
      Абонентов в файле: ${c.subscribers}.`;
  }
  box.hidden = false;
}

/** Показать сверку по тому периоду, который открыт сейчас. */
function refreshBillAlert() {
  const box = $('billAlert');
  if (!box) return;
  if (billAlertDismissed && billAlertDismissed === state.month) {
    box.hidden = true;
    return;
  }
  showBillAlert((state.invoice || {}).checksum);
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
    // Номера, пришедшие в счёте несколькими блоками (перенос номера, смена
    // тарифа посреди периода), и выброшенные дословные повторы блоков.
    // Про оба случая говорим вслух: в первом сумма номера СЛОЖЕНА из двух, во
    // втором — наоборот, лишний блок не посчитан. Промолчи — и человек будет
    // сверять экран со счётом построчно, не понимая, кто из них врёт.
    const merged = (s.merged || []).length;
    const parts = merged
      ? `, склеено по номеру из нескольких блоков — ${merged} `
        + `${plural(merged, 'номер', 'номера', 'номеров')} (перенос или смена)`
      : '';
    const repeats = s.repeats
      ? `, отброшено повторов блоков — ${s.repeats}`
      : '';
    return `Счёт «${fileName}» загружен: ${data.saved} абонентов, `
      + `${s.rows || 0} строк начислений${parts}${repeats}, `
      + `период ${formatMonth(data.month)}.`;
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

/** Вернуть выпадающие списки к тому, что лежит в состоянии. */
function resetFilterButtons() {
  const filter = $('filterSelect');
  const sort = $('sortSelect');
  if (filter) filter.value = state.filter;
  if (sort) sort.value = state.sort;
  updateSortDirButton();
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

/**
 * Разложить ответ сервера по state.
 *
 *     Черемшу в кузов класть — не всю телегу перетряхивать,
 *     Пучок положил на место, а прочее не тронь.
 *     Кто на каждый пучок весь воз перекладывает —
 *     Тот к вечеру не в поле, а под возом, как конь.
 *
 * ОТВЕТ БЫВАЕТ ДВУХ ВИДОВ, и различает их поле `partial`.
 *
 * ПОЛНЫЙ — весь отчёт. Приходит при открытии, смене месяца и загрузке файла.
 * Заменяет всё подряд.
 *
 * ЧАСТИЧНЫЙ — только те номера, которые правка реально изменила, плюс сводки.
 * Приходит на каждое действие в настройках и в карточке номера. Раньше и там
 * ехал полный отчёт: тридцать мегабайт на снятую галочку (см. шапку
 * server.patch_month_view). Здесь такой ответ ВЛИВАЕТСЯ в уже имеющийся
 * список, а не подменяет его.
 *
 * Ключ — номер. Сортировка не важна: списки на экране всё равно
 * пересортировываются под свой фильтр (см. renderUsers).
 */
function applyViewData(data) {
  // Любой ответ меняет записи — производные списки больше не действительны.
  companySubsCache = null;

  if (data.partial) {
    const byNumber = new Map(state.subscribers.map((s, i) => [s.number, i]));
    (data.subscribers || []).forEach((fresh) => {
      const at = byNumber.get(fresh.number);
      if (at === undefined) state.subscribers.push(fresh);
      else state.subscribers[at] = fresh;
    });
    // Индекс невыгодности считается по всему парку: правка одного номера
    // сдвигает шкалу остальным. Ради одного числа целую запись не гоняем —
    // сервер присылает его отдельной строчкой (см. server.patch_month_view).
    (data.waste || []).forEach((w) => {
      const at = byNumber.get(w.number);
      if (at === undefined) return;
      const sub = state.subscribers[at];
      sub.waste = { ...(sub.waste || {}), index: w.index, reference: w.reference };
    });
  } else {
    state.month = data.month || '';
    state.subscribers = data.subscribers || [];
    state.invoice = data.invoice || {};
    state.tariffs = data.tariffs || state.tariffs;
  }

  // Сводки, справочники и списки приезжают целиком в обоих случаях: они
  // крошечные, а считать их «разницей» — верный способ разойтись с отчётом.
  state.months = data.months || state.months;
  state.summary = data.summary || null;
  state.tariffStats = data.tariff_stats || [];
  state.trend = data.trend || [];
  state.paymentSummary = data.payment_summary || null;
  state.chipRules = data.chip_rules || state.chipRules;
  state.trips = data.trips || state.trips;
  state.hasRoster = state.hasRoster || state.subscribers.some((s) => s.limit_set || s.username);
}

/** Вся отрисовка главного экрана. Дорого: сотня карточек и четыре графика. */
function renderMain() {
  const hasData = state.subscribers.length > 0;
  const lite = state.lite;

  // Отметка в меню, чтобы было видно, где выключается.
  const liteBtn = $('liteBtn');
  if (liteBtn) {
    liteBtn.classList.toggle('is-on', lite);
    liteBtn.setAttribute('aria-pressed', String(lite));
    const note = liteBtn.querySelector('.menu-item-note');
    if (note) {
      note.textContent = lite ? 'включён — вернуться к обычному виду'
        : 'только карточки тех, кому понизить тариф';
    }
  }

  toggle('welcomeSection', !hasData);
  // Сверка итогов лежит в реквизитах периода, а значит переживает и
  // обновление вкладки, и переключение месяца: счёт-то не сошёлся навсегда.
  refreshBillAlert();
  if (lite) hideEverythingButCards(); else applyWidgetVisibility();
  toggle('liteBar', lite && hasData);
  // Отчёт CSV и общая статистика — про весь парк, в лайте им не место.
  ['downloadBtn', 'statsBtn'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = !hasData || lite;
  });
  const picker = $('monthPickerWrap');
  if (picker) picker.hidden = state.months.length < 2;

  renderMonthSelect();
  if (!hasData) { $('usersGrid').innerHTML = ''; return; }

  if (lite) return renderLite();

  renderPayerTabs();
  renderRuleFilterOptions();
  resetFilterButtons();

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

/**
 * Лайт: гасим всё, кроме карточек.
 *
 * Идём по тому же реестру виджетов, что и applyWidgetVisibility, но ничего в
 * нём не меняем — только прячем узлы. Настройки виджетов остаются как были:
 * вышел из лайта, и экран ровно такой, каким его оставили.
 */
function hideEverythingButCards() {
  WIDGET_GROUPS.forEach((group) => {
    group.items.forEach((w) => {
      const el = document.querySelector(`[data-widget="${w.id}"]`);
      if (el) el.hidden = true;
    });
    if (group.container) toggle(group.container, false);
  });
  // Секции вне реестра виджетов — гасим по именам.
  ['payerTabs', 'filtersPanel', 'tariffCompareSection'].forEach((id) => toggle(id, false));
}

/** Единственный экран лайт-режима: список тех, кому понизить тариф. */
function renderLite() {
  const grid = $('usersGrid');
  if (!grid) return;

  const list = lowerCandidates();
  state.filtered = list;

  // ПОЧЕМУ ЗДЕСЬ МЕНЬШЕ, ЧЕМ В «ПОТЕНЦИАЛЕ ЭКОНОМИИ» НА ГЛАВНОЙ.
  //
  // Показатель на главной складывает ВСЕ рекомендации по тарифам: и
  // понижение, и повышение (да, повышение тоже экономит — когда перерасход
  // дороже большего пакета), и подбор тарифа для номеров, у которых он не
  // опознан. Лайт — только про понижение, поэтому его сумма меньше по самому
  // определению.
  //
  // Молча оставлять две разные цифры под одним словом «экономия» нельзя:
  // человек видит их рядом, решает, что программа считает как попало, и
  // перестаёт верить обеим. Поэтому разницу проговариваем вслух и числом.
  const saving = list.reduce((sum, s) => sum + s.saving, 0);
  const parkSaving = companySubs().reduce((sum, s) => sum + s.saving, 0);
  const rest = Math.round(parkSaving - saving);

  setText('liteBarSub', list.length
    ? `${list.length} ${plural(list.length, 'номер', 'номера', 'номеров')}`
      + ` · понижение даёт ${money(saving)} в месяц, ${money(saving * 12)} за год`
      + (rest > 0
        ? `. Ещё ${money(rest)} в месяц по парку дают другие рекомендации —`
          + ' повышение и подбор тарифа; их в лайте нет'
        : '')
    : 'таких номеров нет — понижать некому');

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">Ни одному номеру понижение тарифа'
      + ' не рекомендовано: пакеты подобраны по потреблению.'
      + (rest > 0
        ? ` При этом по парку есть ${money(rest)} в месяц на других`
          + ' рекомендациях — повышение и подбор тарифа. Они в обычном виде,'
          + ' фильтром «Понизить тариф» и «Повысить тариф».'
        : '')
      + '</div>';
    grid.dataset.drawn = '0';
    return;
  }

  resetCardBatch();
  drawCardBatch(grid, true, true);
  bindCardActions(grid);
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

/**
 * Действующие правила становятся пунктами фильтра.
 *
 * Показываем только те, что реально навешены хоть на один номер: список из
 * дюжины правил, половина которых никого не находит, — это способ потратить
 * время на пустые выборки. Считаем по rule_codes, а не по chip.rules, потому
 * что правило могло навеситься само, по лимиту-признаку.
 */
function renderRuleFilterOptions() {
  const group = $('filterRuleGroup');
  const select = $('filterSelect');
  if (!group || !select) return;

  $$('option[data-rule]', group).forEach((o) => o.remove());

  const used = new Set();
  state.subscribers.forEach((s) =>
    ((s.payment || {}).rule_codes || []).forEach((c) => used.add(c)));

  state.chipRules.filter((r) => used.has(r.code) && r.code !== 'normal').forEach((r) => {
    const option = document.createElement('option');
    option.value = `rule:${r.code}`;
    option.dataset.rule = r.code;
    option.textContent = r.label;
    group.appendChild(option);
  });

  // Выбранное правило могли только что удалить — тогда возвращаемся ко «всем»,
  // иначе список молча оставался бы пустым.
  if (!$$('option', select).some((o) => o.value === state.filter)) state.filter = 'all';
  select.value = state.filter;
}

/* ── KPI и аналитика ─────────────────────────────────────────────────────── */
function renderKpis() {
  const s = state.summary;
  if (!s) return;

  setText('kpiCount', s.subscribers);
  const trips = companySubs().filter((x) => x.on_trip).length;
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
  const chronic = companySubs().filter((x) => x.chronic).length;
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

  const roamers = companySubs().filter((x) => x.roaming_cost > 0);
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
  return companySubs().filter((s) => s.usage_level === 'none' || s.usage_level === 'idle');
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
  const top = companySubs().filter((s) => s.saving > 0)
    .sort((a, b) => b.saving - a.saving).slice(0, 6);

  if (!top.length) {
    el.innerHTML = '<div class="empty">Тарифы подобраны верно — менять нечего.</div>';
    return;
  }

  el.innerHTML = top.map((s, i) => `
    <button class="rank-item" data-goto="${esc(s.number)}">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${esc(s.username || formatPhone(s.number))}</span>
      <!-- БЕЗ МИНУСА. Здесь стоял «−1 234 ₽»: имелось в виду «счёт
           уменьшится», а читалось «экономия минус тысяча» — то есть ровно
           наоборот, да ещё зелёным цветом рядом со словом «Экономия».
           Блок и так называется «Наибольшая экономия», знак тут лишний. -->
      <span class="rank-val" title="Столько вернётся за месяц, если сменить тариф">${money(s.saving)}</span>
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
  companySubs().forEach((s) => s.categories.forEach((c) => {
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
 * Все блоки ниже считаются из `companySubs()` — номеров, за которые платит
 * компания. Сервер для них ничего дополнительно не отдаёт, поэтому цифры
 * здесь и в карточке абонента гарантированно совпадают.
 *
 * ПОЧЕМУ НЕ `state.subscribers`. Раньше было именно так, и это делало
 * бесполезной галку «исключить». Человек помечал номер «не учитывать», сервер
 * честно выбрасывал его из своих сводок — а полтора десятка блоков на клиенте
 * считали по всему массиву и продолжали показывать его в топах, в ABC-анализе
 * и в матрице риска. Со стороны это выглядело ровно как «галка не работает»:
 * одна цифра менялась, остальные пятнадцать — нет.
 *
 * Блок, которому не хватает данных (нет лимитов, нет второго месяца, нет
 * списка сотрудников), не исчезает молча, а объясняет, что нужно загрузить,
 * — иначе пустое место читается как поломка.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Номера, за которые платит компания: без исключённых и самоплатящих.
 *
 * ЕДИНСТВЕННЫЙ источник данных для KPI, графиков и аналитики. Признак считает
 * сервер (billing.counts_for_company) и кладёт в запись полем company_pays —
 * на клиенте правила не разбираются, иначе две реализации одного решения
 * рано или поздно разойдутся.
 *
 * Список карточек — намеренное исключение: там показываются ВСЕ номера
 * выбранной группы, включая исключённые. Иначе номер, который человек только
 * что пометил, исчезал бы с экрана вместе с шестерёнкой, и снять пометку было
 * бы нечем.
 *
 * СЧИТАЕТСЯ ОДИН РАЗ НА ОТЧЁТ, дальше отдаётся тот же массив.
 *
 * Функцию зовут двадцать шесть раз за отрисовку — из KPI, из каждого блока
 * аналитики, из обеих матриц. Каждый вызов заново просеивал весь парк номеров
 * и создавал новый массив: на двух тысячах номеров это полсотни тысяч лишних
 * сравнений и двадцать шесть массивов в мусор, ровно с одинаковым
 * содержимым. Список меняется только вместе с отчётом — там кэш и сбрасываем
 * (см. applyViewData).
 *
 * ВОЗВРАЩАЕМЫЙ МАССИВ ОБЩИЙ, ПОРТИТЬ ЕГО НЕЛЬЗЯ. Сортировать надо по копии:
 * `[...companySubs()].sort(...)`. Пока функция каждый раз отдавала свежий
 * результат filter, сортировка на месте была безобидной — теперь она
 * переставила бы номера всем остальным блокам.
 */
let companySubsCache = null;

function companySubs() {
  if (!companySubsCache) {
    companySubsCache = state.subscribers.filter((s) => s.company_pays !== false);
  }
  return companySubsCache;
}

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
  ['exSaving', renderExSaving],
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

/**
 * Клик по строке рейтинга или точке матрицы открывает карточку номера.
 *
 * ОДИН СЛУШАТЕЛЬ НА БЛОК, а не по одному на каждый элемент. Раньше здесь был
 * обход всех [data-goto] с подпиской на каждый: в двух матрицах и полудюжине
 * рейтингов это тысячи подписок на парк из двух тысяч номеров — и все они
 * создавались заново при каждой перерисовке, то есть после любой правки
 * фильтра. Флаг на узле не даёт навесить слушателя дважды: блоки
 * перерисовываются через innerHTML, сам контейнер при этом живёт.
 */
function bindGoto(root) {
  if (!root || root.dataset.goto === '1') return;
  root.dataset.goto = '1';
  root.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-goto]');
    if (hit && root.contains(hit)) openModal(hit.dataset.goto);
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
  companySubs().forEach((s) => { if (s.trip) inMonth.set(s.number, s); });

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

  const rows = companySubs()
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
    ['Номеров', String(companySubs().filter(
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
    <div class="panel-hint">Считаем только номера компании. Перерасход и роуминг
      в строке компании означают, что сработало правило: цвет номера, пометка
      или командировка. По умолчанию их платит сотрудник.${ps.excluded_count
        ? ` Исключено из подсчёта номеров: ${ps.excluded_count}.` : ''}${ps.self_paid_count
        ? ` Платят сами за себя: ${ps.self_paid_count} на ${money(ps.self_paid_total)} — сюда не входят.` : ''}</div>`;
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
  // Правила, пойманные по лимиту-признаку, показываем включёнными, но
  // помечаем отдельно: снять их щелчком нельзя, они держатся на лимите
  // абонента. Без этой пометки человек будет тыкать в правило и не понимать,
  // почему оно не гаснет.
  const manual = new Set([...(chip.rules || [])]);
  const active = new Set(pay.rule_codes || []);
  const ruleButtons = (state.chipRules || []).map((r) => {
    const on = r.kind === 'color' ? r.code === colorCode : marks.includes(r.code);
    const auto = active.has(r.code) && !manual.has(r.code);
    return `<button type="button" class="chip-rule${on || auto ? ' is-on' : ''}${auto ? ' is-auto' : ''}"
      data-rule="${esc(r.code)}" data-kind="${r.kind}"
      style="--swatch:${esc(r.hex || '#8a9a94')}"
      aria-pressed="${on || auto ? 'true' : 'false'}"
      title="${auto ? `Навешено автоматически: лимит абонента совпал со списком в правиле (${esc(r.match_limits || '')})`
        : esc(r.description || r.label)}">
      <span class="chip-rule-dot"></span>
      <span class="chip-rule-label">${esc(r.label)}</span>
      ${auto ? '<span class="chip-rule-auto">по лимиту</span>' : ''}
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
      // Перерисовка списка — под keepPlace: человек стоит у своей карточки,
      // а карточек в списке весь парк. Без этого выбор плательщика в «⚙»
      // отбрасывал к самому верху отчёта — то самое «перекинуло обратно».
      if (data.view) {
        state.openPanels[number] = 'chip';
        keepPlace(() => applyView(data.view));
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

    // Правило, пойманное по лимиту-признаку, щелчком не снимается: оно
    // держится не на этом номере, а на лимите абонента. Без этой проверки
    // кнопка гасла, уходил запрос, отчёт возвращался — и кнопка загоралась
    // обратно. Мигание, которое выглядит как поломка.
    if (btn.classList.contains('is-auto')) {
      flash('Правило навешено по лимиту абонента — снимите лимит или '
        + 'поправьте список в настройках правила', true);
      return;
    }

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
  const subs = companySubs();
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
  const values = companySubs().map((s) => s.total).sort((a, b) => a - b);
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
  // По копии: массив companySubs() общий на всю отрисовку (см. его шапку).
  const sorted = [...companySubs()].sort((a, b) => b.total - a.total);
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
  const sorted = [...companySubs()].sort((a, b) => b.total - a.total).slice(0, 10);
  if (!sorted.length) { el.innerHTML = exEmpty('Нет данных.'); return; }

  const total = companySubs().reduce((a, s) => a + s.total, 0);
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
  const withLimit = companySubs().filter((s) => s.limit_set && s.limit > 0);

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
    <div class="panel-hint">Лимиты заданы у ${withLimit.length} из ${companySubs().length}
      ${plural(companySubs().length, 'номера', 'номеров', 'номеров')}.
      Группа «до 50%» — это лимиты, выданные с запасом: их можно снизить, не мешая работе.</div>`;
}

/* ── Роуминг и командировки ──────────────────────────────────────────────── */
function renderExRoaming() {
  const el = $('exRoaming');
  if (!el) return;
  const roamers = companySubs().filter((s) => s.roaming_cost > 0)
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

  const changes = companySubs().map((s) => {
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
  companySubs().forEach((s) => {
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
  companySubs().forEach((s) => (s.categories || []).forEach((c) => {
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
  const subs = companySubs();
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

/* ═══════════════════════════════════════════════════════════════════════════
 * МАТРИЦА «РАСХОД × ЭКОНОМИЯ»
 *
 * Соседняя матрица «расход × риск» отвечает на вопрос «где плохо». Эта — на
 * вопрос «где деньги»: по горизонтали то, что компания за номер уже заплатила,
 * по вертикали то, что вернётся, если выполнить рекомендацию по тарифу.
 *
 * ОБЕ ОСИ В РУБЛЯХ И ОБЕ ДО 100 000 — по требованию заказчика. Это даёт то,
 * чего не даёт автомасштаб: масштаб не пляшет от месяца к месяцу, и две
 * выгрузки можно положить рядом и сравнить глазом. Плата за это — номера
 * дороже потолка, и они не выбрасываются, а прижимаются к краю и рисуются
 * треугольником: «здесь больше, чем показано».
 *
 * ДИАГОНАЛЬ — ЛИНИЯ «ЭКОНОМИЯ РАВНА РАСХОДУ». Выше неё точек не бывает:
 * вернуть больше, чем заплатили, нельзя. Чем ближе точка к диагонали, тем
 * большая доля денег по этому номеру уходит впустую.
 * ═════════════════════════════════════════════════════════════════════════ */

// Потолок обеих осей, ₽. Заказчик просил фиксированные 100 тысяч.
const SAVING_MATRIX_MAX = 100000;

function renderExSaving() {
  const host = $('exSaving');
  if (!host) return;

  // Номера без экономии заняли бы всю нижнюю кромку сплошной полосой и
  // ничего бы не сказали: у них по этой матрице просто нет темы.
  const subs = companySubs().filter((s) => s.saving > 0);
  if (!subs.length) {
    host.innerHTML = exEmpty('Ни по одному номеру смена тарифа не даёт экономии.');
    return;
  }

  const W = Math.max(420, Math.round(host.clientWidth || 900));
  const H = 300, padL = 62, padR = 18, padT = 22, padB = 34;
  const cw = W - padL - padR;
  const ch = H - padT - padB;

  const clamp = (v) => Math.max(0, Math.min(SAVING_MATRIX_MAX, v));
  const x = (v) => padL + (clamp(v) / SAVING_MATRIX_MAX) * cw;
  const y = (v) => padT + ch - (clamp(v) / SAVING_MATRIX_MAX) * ch;

  // Сетка на четыре клетки по каждой оси: 0 / 25 / 50 / 75 / 100 тысяч.
  // Подписи те же слева и снизу — шкалы одинаковые, и это должно быть видно.
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const value = (SAVING_MATRIX_MAX / 4) * i;
    const gy = padT + ch - (i / 4) * ch;
    const gx = padL + (i / 4) * cw;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="grid"/>`
      + `<line x1="${gx.toFixed(1)}" y1="${padT}" x2="${gx.toFixed(1)}" y2="${padT + ch}" class="grid"/>`
      + `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="axis-label">${compact(value)}</text>`
      + `<text x="${gx.toFixed(1)}" y="${H - 12}" class="axis-label"
          text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${compact(value)}</text>`;
  }

  const diagonal = `<line x1="${padL}" y1="${padT + ch}" x2="${(padL + cw).toFixed(1)}"
    y2="${padT}" class="grid ex-diagonal"/>`;

  // Крупная экономия рисуется последней, чтобы не утонуть в облаке мелочи.
  const dots = [...subs].sort((a, b) => a.saving - b.saving).map((s) => {
    const cx = x(s.total);
    const cy = y(s.saving);
    const off = s.total > SAVING_MATRIX_MAX || s.saving > SAVING_MATRIX_MAX;
    const share = s.total > 0 ? Math.round((s.saving / s.total) * 100) : 0;
    const tip = `${esc(s.username || formatPhone(s.number))} — начислено ${money(s.total)}, `
      + `экономия ${money(s.saving)} (${share}% счёта)`
      + (off ? '\nЗа пределами шкалы: точка прижата к краю' : '');
    // Треугольник вместо кружка = «на самом деле дальше». Без такой отметки
    // прижатая к краю точка врала бы, будто номер ровно на ста тысячах.
    return off
      ? `<polygon class="ex-dot ex-dot-off" data-goto="${esc(s.number)}"
          points="${cx.toFixed(1)},${(cy - 5.5).toFixed(1)} ${(cx + 5).toFixed(1)},${(cy + 4).toFixed(1)} ${(cx - 5).toFixed(1)},${(cy + 4).toFixed(1)}">
          <title>${tip}</title></polygon>`
      : `<circle class="ex-dot ex-dot-saving" data-goto="${esc(s.number)}"
          cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5"><title>${tip}</title></circle>`;
  }).join('');

  const total = subs.reduce((sum, s) => sum + s.saving, 0);
  const off = subs.filter((s) => s.total > SAVING_MATRIX_MAX || s.saving > SAVING_MATRIX_MAX).length;

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ex-scatter" preserveAspectRatio="xMidYMid meet">
    ${grid}${diagonal}${dots}
    <text x="${padL - 8}" y="12" text-anchor="end" class="axis-label">экономия, ₽</text>
    <text x="${W - padR}" y="12" text-anchor="end" class="axis-label">начислено, ₽</text>
  </svg>
  <div class="ex-scatter-note">Каждая точка — номер: по горизонтали начислено за месяц,
    по вертикали экономия от смены тарифа. Обе шкалы жёстко до
    ${money(SAVING_MATRIX_MAX)} — масштаб не меняется от месяца к месяцу, и две
    выгрузки можно сравнить глазом. Косая линия — «вернём столько же, сколько
    платим»; чем ближе к ней точка, тем большая часть денег по номеру уходит
    впустую. Итого по ${subs.length} ${plural(subs.length, 'номеру', 'номерам', 'номерам')}
    — ${money(total)} в месяц${off ? `, из них ${off} ${plural(off, 'номер вышел', 'номера вышли', 'номеров вышли')} за шкалу (треугольники у края)` : ''}.
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
    // ГРУППА «КТО ПЛАТИТ» — проверяется до фильтра и сильнее его.
    // Фильтр сужает список внутри группы; сама группа решает, чьи деньги мы
    // смотрим, и подменять её фильтром нельзя. Само правило — в inPayerGroup.
    if (!inPayerGroup(s, state.payer)) return false;

    // Фильтр по правилу номера: rule:unlimited, rule:personal и т.п.
    // Список таких пунктов собирается из действующих правил (см.
    // renderRuleFilterOptions), поэтому здесь достаточно общей проверки.
    if (state.filter.startsWith('rule:')) {
      return ((s.payment || {}).rule_codes || []).includes(state.filter.slice(5));
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

  // Знаменатель «N из M» — размер ВЫБРАННОЙ группы, а не всего парка: иначе
  // «12 из 153» в группе на дюжину номеров читается как потерянные сто сорок.
  const groupSize = state.subscribers.filter((s) => inPayerGroup(s, state.payer)).length;
  setText('resultCount', `${list.length} из ${groupSize}`);

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
        <!-- В ЛАЙТЕ ПЕРВАЯ ПЛАШКА — ПРО ТАРИФ, А НЕ ПРО ЛИМИТ.
             Здесь была плашка статуса, и на экране «кому понизить тариф»
             у каждой второй карточки светилась «Норма». Формально верно —
             статус считается по лимиту расхода, а не по размеру пакета, —
             но читалось как «этого трогать не надо», то есть ровно
             наоборот. Лайт открывают, чтобы узнать одно: сколько дадут
             понижением. Это и пишем. -->
        ${state.lite
          ? `<span class="badge badge-accent" title="Пакет избыточен: ${
              esc(s.recommendation.best ? s.recommendation.best.tariff_name : '')
            } закрывает то же потребление дешевле">↓ ${money(s.saving)}/мес</span>`
          : `<span class="badge badge-${status.cls}">${status.label}</span>`}
        ${USAGE_BADGE[s.usage_level] || ''}
        ${s.on_trip ? '<span class="badge badge-trip" title="В командировке">командировка</span>' : ''}
        <!-- Запись склеена из двух лицевых счетов. Без этой плашки человек
             увидит расход вдвое больше привычного и решит, что программа
             врёт: карточка-то одна, а денег в ней за два номера. -->
        ${(s.merged_from || []).length ? `<span class="badge badge-merged"
          title="Сюда сведены счета прежних номеров: ${
            s.merged_from.map((n) => esc(formatPhone(n))).join(', ')
          }. Расход, история и лимит показаны по человеку целиком">номер изменён</span>` : ''}
        <!-- Тот же номер пришёл в счёте несколькими блоками (перенос на другой
             лицевой счёт, смена тарифа посреди периода). Итоги блоков сложены,
             и об этом надо сказать ровно там же, где показана сумма. -->
        ${(s.bill_parts || 1) > 1 ? `<span class="badge badge-merged"
          title="${esc(s.bill_parts_note || '')}. Итоги всех частей сложены в один счёт">счёт из ${
            s.bill_parts} ${plural(s.bill_parts, 'части', 'частей', 'частей')}</span>` : ''}
        ${chipColor ? `<span class="badge badge-chip" style="--chip:${esc(chipColor.hex)}"
          title="${esc(chipColor.label)} — правило применено">${esc(chipColor.label)}</span>` : ''}
        ${pay.self_paid ? `<span class="badge badge-self"
          title="Сотрудник платит за номер сам — ${esc(pay.self_paid_reason || 'правило номера')}. В расходы и экономию компании не входит">платит сам</span>` : ''}
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
      ${s.saving > 0 ? `<span class="rec-saving"
        title="Столько вернётся за месяц, если выполнить рекомендацию">${money(s.saving)}/мес</span>` : ''}
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
    ${(s.bill_parts || 1) > 1 ? `<div class="panel-hint">В счёте этот номер разбит
      на <b>${s.bill_parts} ${plural(s.bill_parts, 'часть', 'части', 'частей')}</b> —
      их итоги сложены, иначе на экране была бы только последняя.
      ${esc(s.bill_parts_note || '')}</div>` : ''}
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
      <span class="tp-cell-value">${saving > 0 ? money(saving) : money(0)}</span>
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
  const rec = s.recommendation;

  let h = `<header class="sm-header">
    <div>
      <div class="sm-name">
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
  numbers: renderNumberChangeSettings,
  trips: renderTripSettings,
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

/**
 * Общий обработчик сохранения справочника: шлём на сервер, применяем отчёт,
 * перерисовываем ТОЛЬКО то, что попросили, — и оставляем человека на месте.
 *
 * `redraw` — что перерисовать после ответа. Раньше здесь безусловно стоял
 * renderSettings(), то есть вкладка собиралась заново ЦЕЛИКОМ на каждую
 * правку. Это сбрасывало прокрутку в ноль и заодно вычищало всё, что человек
 * успел набрать в полях вкладки (например, список в «Загрузить правила
 * списком»). Разделы, у которых есть свой draw() по своим строкам, передают
 * его сюда; остальным по-прежнему годится renderSettings.
 *
 * `after` вызывается уже ПОСЛЕ перерисовки, внутри той же обёртки: там ищут
 * только что созданную строку, а до перерисовки её на экране ещё нет.
 */
async function saveDictionary(url, payload, { redraw = renderSettings, after = null } = {}) {
  try {
    const data = await postJSON(url, payload);
    if (data.chip_rules) state.chipRules = data.chip_rules;
    // Обе перерисовки — под одной обёрткой: applyView трогает главный экран,
    // redraw — открытую вкладку. Порознь они дважды сбрасывали бы прокрутку,
    // и вторая затирала бы восстановленную первой.
    keepPlace(() => {
      if (data.view) applyView(data.view);
      redraw();
      if (after) after(data);
    });
    flashHint('Сохранено, отчёт пересчитан.');
  } catch (err) {
    flashHint(err.message, 'error');
  }
}

/* ── Правила номеров: цвета и пометки в одном месте ──────────────────────────
 *
 * БЫЛО две вкладки-близнеца с одинаковыми таблицами. Разница между ними ровно
 * одна: цвет у номера ОДИН и красит карточку, пометок можно навесить сколько
 * угодно. Всё остальное — те же поля, те же эффекты на деньги.
 *
 * СТАЛО одна вкладка с двумя группами. В базе они тоже одна таблица
 * chip_rules с полем kind ('color' | 'mark'), и одна ручка /api/chip-rules,
 * так что интерфейс повторяет то, как данные лежат на самом деле.
 *
 * ЦВЕТ — ЭТО ПРАВИЛО, а не украшение: он решает, кто платит. Поэтому колонка
 * с кистью стоит первой, а рядом — колонки эффектов.
 * ────────────────────────────────────────────────────────────────────────── */

// Всё, что отличает цвет от пометки — собрано в одном месте, чтобы обе группы
// рисовались одним кодом и не разъезжались при правках.
const CHIP_RULE_KINDS = [
  {
    kind: 'color',
    title: 'Цвета', hint: 'У номера действует один. Красит карточку на главной.',
    addLabel: '+ Цвет', addName: 'Новый цвет',
    confirm: 'Удалить цвет? Номера с ним станут обычными.',
  },
  {
    kind: 'mark',
    title: 'Пометки',
    hint: 'Навешиваются поверх цвета, их может быть несколько. Приоритет ниже цвета.',
    addLabel: '+ Пометка', addName: 'Новая пометка',
    confirm: 'Удалить пометку? Она снимется со всех номеров.',
  },
];

const CHIP_RULES_API = '/api/chip-rules';

// «Обычный» — не правило, а признак «цвета нет»: на него ссылаются карточки
// без цвета. Единственная строка, которую удалять нельзя (см.
// queries.FALLBACK_COLOR).
const FALLBACK_COLOR = 'normal';

// Правила, которые навешиваются САМИ и снимаются тоже сами. Показываем их
// иначе: удалять-то можно, а вот снять с конкретного номера мышью — нет,
// признак придёт из данных заново.
const AUTO_RULES = {
  trip: 'Навешивается сама: период командировки пересёкся с расчётным месяцем.',
};

function renderChipRuleSettings(el) {
  el.innerHTML = `
    <div class="settings-note">Правило — это набор эффектов: кто платит за
      абонплату, опции, перерасход и роуминг, платит ли сотрудник за номер сам,
      убирать ли номер из сводок и считать ли пакет безлимитным. Навесили
      правило на номер — эффекты применились, отчёт пересчитался сразу.
      <br>«Лимиты» — суммы из списка работников, по которым правило навешивается
      САМО: совпал лимит абонента с одним из чисел — правило сработало, отмечать
      номера руками не нужно. Несколько значений пишите через запятую.</div>
    <div id="chipRuleGroups"></div>
    ${bulkRuleForm()}`;

  const draw = () => {
    // Считаем, сколько номеров носит каждое правило — админу важно видеть,
    // что он правит: мёртвую строку или правило на половину парка. Считаем по
    // ДЕЙСТВУЮЩИМ правилам (payment.rule_codes), поэтому в счётчик попадают и
    // те номера, которым правило досталось по лимиту-признаку.
    const counts = {};
    state.subscribers.forEach((s) => ((s.payment || {}).rule_codes || [])
      .forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));

    $('chipRuleGroups').innerHTML = CHIP_RULE_KINDS.map((k) => {
      const list = state.chipRules.filter((r) => (r.kind || 'mark') === k.kind);
      return `
      <section class="rule-group" data-kind="${k.kind}">
        <div class="rule-group-head">
          <h4>${k.title} <span class="rule-group-n">${list.length}</span></h4>
          <span class="rule-group-hint">${k.hint}</span>
          <button class="btn btn-soft btn-sm" data-add="${k.kind}">${k.addLabel}</button>
        </div>
        <div class="rule-table">
          <div class="rule-head">
            <span>Цвет</span><span>Название</span><span>Абонплата</span><span>Опции</span>
            <span>Перерасход</span><span>Роуминг</span>
            <span title="Лимиты из списка работников, по которым правило навешивается само">Лимиты</span>
            <span title="Сотрудник платит за номер сам — в деньги компании номер не входит">Сам</span>
            <span title="Убрать номера с этим правилом из всех сводок">Искл.</span>
            <span title="Пакет безлимитный — перерасхода по нему не бывает">Безлим.</span>
            <span>Номеров</span><span></span>
          </div>
          ${list.map((r) => `
            <div class="rule-row" data-code="${esc(r.code)}" data-kind="${k.kind}">
              <input type="color" data-f="hex" value="${esc(r.hex || '#6b7a74')}">
              <input type="text" data-f="label" value="${esc(r.label)}" maxlength="40">
              ${payerSelect('payer_tariff', r.payer_tariff)}
              ${payerSelect('payer_options', r.payer_options)}
              ${payerSelect('payer_overage', r.payer_overage)}
              ${payerSelect('payer_roaming', r.payer_roaming)}
              <input type="text" class="rule-limits" data-f="match_limits"
                     value="${esc(r.match_limits || '')}"
                     ${AUTO_RULES[r.code]
                       ? `disabled placeholder="авто" title="${esc(AUTO_RULES[r.code])}"`
                       : 'placeholder="490, 90…" title="Лимиты-признаки через запятую.'
                         + ' Совпал лимит абонента — правило навесилось само"'}>
              <input type="checkbox" data-f="is_self_paid"${r.is_self_paid ? ' checked' : ''}
                     title="Сотрудник платит за номер сам: номер уходит в свою группу списка и не даёт компании ни расхода, ни экономии">
              <input type="checkbox" data-f="is_excluded"${r.is_excluded ? ' checked' : ''}
                     title="Убрать номера с этим правилом из всех сводок">
              <input type="checkbox" data-f="is_unlimited"${r.is_unlimited ? ' checked' : ''}
                     title="Пакет безлимитный — перерасхода по нему не бывает">
              <span class="rule-count${counts[r.code] ? '' : ' is-zero'}">${counts[r.code] || 0}</span>
              ${r.code === FALLBACK_COLOR
                ? `<button class="rule-del is-locked" type="button" disabled
                     title="«Обычный» — это признак «цвета нет», а не правило. Переименовать и перекрасить можно, удалить нельзя">🔒</button>`
                : `<button class="rule-del" type="button" data-del="${esc(r.code)}" title="Удалить">✕</button>`}
            </div>`).join('')}
        </div>
      </section>`;
    }).join('');
  };

  // ОДИН ОБРАБОТЧИК НА КОНТЕЙНЕР, а не по паре на каждую строку.
  //
  // Так было: draw() перерисовывал таблицу и заново развешивал слушателей на
  // каждое поле каждой строки — под три сотни подписок на два десятка правил.
  // И развешивал он их по `el`, тогда как перерисовывал только внутренность
  // `#chipRuleGroups`: любая перерисовка не по этому пути (а сохранение
  // тянет за собой renderSettings) оставляла кнопки без обработчиков —
  // ровно то самое «кнопка ничего не делает».
  //
  // Делегирование снимает оба вопроса разом: слушателя ровно два, и живут
  // они на узле, который draw() не трогает.
  const groups = $('chipRuleGroups');

  groups.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const k = CHIP_RULE_KINDS.find((x) => x.kind === add.dataset.add);
      const before = new Set(state.chipRules.map((r) => r.code));
      // Код НЕ шлём: пустой код — это «заведи новое правило». Раньше сервер
      // выводил его из названия, оно у всех новых правил одинаковое, и второе
      // нажатие молча перезаписывало первое правило вместо создания второго.
      return saveDictionary(CHIP_RULES_API, {
        label: k.addName, kind: k.kind, hex: '#6b7a74', sort_order: 900,
      }, {
        redraw: draw,
        // Свежая строка садится в конец своей группы, а групп две — вторая
        // обычно за краем окна. Доводим взгляд до неё сами; keepPlace об этом
        // узнаёт через flashRow и прежнее место не возвращает.
        after: (data) => {
          const fresh = (data.chip_rules || []).find((r) => !before.has(r.code));
          if (fresh) flashRow(groups.querySelector(`.rule-row[data-code="${cssEsc(fresh.code)}"]`));
        },
      });
    }

    const del = e.target.closest('[data-del]');
    if (!del) return;
    const k = CHIP_RULE_KINDS.find((x) => x.kind === del.closest('.rule-row').dataset.kind);
    if (!confirm(k.confirm)) return;
    saveDictionary(`${CHIP_RULES_API}/delete`, { code: del.dataset.del }, { redraw: draw });
  });

  // Правка любого поля строки сразу летит на сервер: отдельной кнопки
  // «сохранить» нет намеренно — она только плодит несохранённые состояния.
  //
  // Перерисовываем ТОЛЬКО таблицы правил (draw), а не вкладку целиком: ниже
  // на этой же вкладке живёт поле «Загрузить правила списком», и полный
  // перерендер стирал бы из него набранный текст на каждую правку строки.
  groups.addEventListener('change', (e) => {
    const row = e.target.closest('.rule-row');
    if (!row) return;
    const source = state.chipRules.find((x) => x.code === row.dataset.code) || {};
    const payload = { ...source, code: row.dataset.code, kind: row.dataset.kind };
    $$('input, select', row).forEach((f) => {
      payload[f.dataset.f] = f.type === 'checkbox' ? f.checked : f.value;
    });
    saveDictionary(CHIP_RULES_API, payload, { redraw: draw });
  });

  draw();
  bindBulkRuleForm();
}

/* ── ПРАВИЛА НОМЕРОВ СПИСКОМ ────────────────────────────────────────────────
 *
 *     Пришёл на делянку — а она вся размечена колышками,
 *     Тут режь, тут не тронь, а вон там черемша не наша.
 *     Ходить с бумажкой от куста к кусту — до вечера не управишься,
 *     А делянка что вчера, что нынче: колышки те же самые.
 *
 *     Так перепиши разметку разом, одной тетрадкой,
 *     И не тычь пальцем в каждый куст по второму кругу.
 *     Только имена в тетрадке сверь со своими, а не со стороны:
 *     Чужое имя на колышке — и вырубишь ты не то.
 *
 * ЗАЧЕМ. Правило вешалось мышью — по номеру за раз. А приходит оно списком:
 * выгрузка из кадров, письмо от бухгалтерии, старая таблица. На парке в
 * полторы тысячи номеров расставить их руками нельзя физически.
 *
 * ДВА СПОСОБА ПРИНЕСТИ СПИСОК — вставить в поле и выбрать файл. Файл читается
 * ЗДЕСЬ, в браузере, и просто ложится в то же поле: так человек видит, что
 * именно он сейчас отправит, и может поправить перед отправкой. Отдельной
 * ручки загрузки файла для этого не нужно.
 *
 * Разбор — server.parse_rule_links, запись — queries.link_rules_bulk. Там же
 * объяснено, почему незнакомые названия не заводятся сами.
 * ───────────────────────────────────────────────────────────────────────── */

// Итог последней загрузки списка. Держим СНАРУЖИ функции: после загрузки
// вкладка перерисовывается целиком (счётчик «Номеров» у каждого правила
// считается по отчёту, а отчёт только что приехал заново), и всё, что лежало
// в разметке, пропадает. А отчёт о загрузке — единственное место, где сказано,
// какие строки не легли и почему; терять его нельзя.
let bulkRulesLast = null;

function bulkRuleForm() {
  return `
    <div class="settings-section-title">Загрузить правила списком</div>
    <div class="settings-note">Строка — пара «номер и название правила»:
      <code>9001234567: Личный тариф</code>. Разделителем годятся «:», «;»,
      «|», запятая, табуляция или два пробела. Номер в любом виде —
      <code>+7&nbsp;900…</code>, <code>8&nbsp;900…</code>, просто десять цифр.
      <br>Цвет у номера заменяется, пометка добавляется к тем, что уже стоят.
      Правила, которых нет в списке, ни с кого не снимаются — сначала заведите
      правило в таблице выше, потом грузите список.</div>
    <div class="bulk-rules">
      <textarea id="bulkRulesText" class="bulk-rules-text" rows="6" spellcheck="false"
        placeholder="9001234567: Личный тариф&#10;9007654321; Платит сам&#10;+7 900 111-22-33 | Руководство"></textarea>
      <div class="bulk-rules-actions">
        <input type="file" id="bulkRulesFile" accept=".txt,.csv,.tsv,text/plain" hidden>
        <button class="btn btn-soft btn-sm" id="bulkRulesPick">Выбрать файл</button>
        <button class="btn btn-primary" id="bulkRulesApply">Загрузить список</button>
      </div>
      <div id="bulkRulesResult" class="bulk-rules-result"${bulkRulesLast ? '' : ' hidden'}>${
        bulkRulesLast ? bulkRulesReport(bulkRulesLast) : ''}</div>
    </div>`;
}

function bindBulkRuleForm() {
  const area = $('bulkRulesText');
  const file = $('bulkRulesFile');
  const out = $('bulkRulesResult');
  if (!area) return;

  $('bulkRulesPick').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    try {
      area.value = await chosen.text();
      flashHint(`Файл «${chosen.name}» прочитан — проверьте список и нажмите «Загрузить».`);
    } catch (err) {
      flashHint(`Не удалось прочитать файл: ${err.message}`, 'error');
    }
    // Сбрасываем выбор: иначе повторный выбор ТОГО ЖЕ файла не даёт события
    // change, и кнопка выглядит сломанной.
    file.value = '';
  });

  $('bulkRulesApply').addEventListener('click', async () => {
    const text = area.value.trim();
    if (!text) return flashHint('Список пуст — вставьте строки или выберите файл', 'error');
    try {
      const data = await postJSON('/api/chip-rules/bulk', { text });
      if (data.view) applyView(data.view);
      bulkRulesLast = data;
      // Перерисовываем вкладку целиком: счётчик «Номеров» у каждого правила
      // считается по отчёту, а отчёт только что приехал заново. Сам итог
      // загрузки переживёт перерисовку — он лежит в bulkRulesLast.
      renderSettings();
      flashHint(`Правила навешены: ${data.applied} на ${data.numbers} `
        + `${plural(data.numbers, 'номер', 'номера', 'номеров')}.`);
    } catch (err) {
      out.hidden = false;
      out.innerHTML = `<div class="panel-hint warn">Не удалось загрузить: ${esc(err.message)}</div>`;
    }
  });
}

/** Отчёт о загрузке: что легло, а что нет и почему. */
function bulkRulesReport(data) {
  const s = data.stats || {};
  const lines = [`<div class="panel-hint">Навешено правил: <b>${data.applied}</b>`
    + ` на ${data.numbers} ${plural(data.numbers, 'номер', 'номера', 'номеров')}`
    + (data.colors ? `, цветов ${data.colors}` : '')
    + (data.marks ? `, пометок ${data.marks}` : '')
    + '.</div>'];

  // НЕЗАГРУЖЕННОЕ ПОКАЗЫВАЕМ ПОИМЁННО. «Загружено 40 из 300» без объяснения,
  // где потерялись остальные, хуже, чем отказ целиком: человек не знает, что
  // чинить, и грузит тот же файл заново.
  if ((data.unknown || []).length) {
    lines.push(`<div class="panel-hint warn">Таких правил в справочнике нет —
      строки пропущены (${s.unknown}). Заведите правило в таблице выше с точно
      таким названием и загрузите список ещё раз:<br>${
        data.unknown.map((u) => `<b>${esc(u.name)}</b> — ${u.count} `
          + `${plural(u.count, 'строка', 'строки', 'строк')}`).join('; ')}</div>`);
  }
  if ((data.bad || []).length) {
    lines.push(`<div class="panel-hint warn">Не разобрано строк: ${s.bad}. В них
      не нашлось либо номера, либо названия правила. Например:<br>${
        data.bad.slice(0, 5).map((b) => `<code>${esc(b)}</code>`).join('<br>')}</div>`);
  }
  return lines.join('');
}


/** Экранирование строки для подстановки в селектор querySelector. */
function cssEsc(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

/** Подсветить только что появившуюся строку и прокрутить к ней. */
function flashRow(row) {
  if (!row) return;
  // Говорим keepPlace не возвращать прокрутку: место здесь выбираем мы.
  placeClaimed = true;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('is-fresh');
  // Через полторы секунды подсветка снимается сама: она нужна ровно на то
  // время, пока глаз ищет, что изменилось.
  setTimeout(() => row.classList.remove('is-fresh'), 1500);
  const name = row.querySelector('[data-f="label"], [data-f="match_value"], [data-f="name"]');
  if (name) name.focus();
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
      // Таблица зон длинная и правится по ставке за раз: без keepPlace каждая
      // поправленная цифра отбрасывала к первой зоне.
      keepPlace(draw);
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
          <button class="rule-del" type="button" data-del="${r.id}" title="Удалить">✕</button>
        </div>`).join('')}`;
  };

  // Делегирование вместо подписки на каждое поле каждой строки — ровно по той
  // же причине, что и в правилах номера: слушатели вешались на узлы, которые
  // draw() тут же выбрасывал и создавал заново.
  const rows = $('ruleRows');

  rows.addEventListener('change', (e) => {
    const row = e.target.closest('.rule-row');
    if (!row) return;
    const payload = { id: Number(row.dataset.id), match_kind: 'service' };
    $$('input, select', row).forEach((f) => {
      payload[f.dataset.f] = f.type === 'checkbox' ? f.checked : f.value;
    });
    saveRule(payload);
  });

  rows.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    if (!confirm('Удалить правило?')) return;
    saveRule({ id: Number(del.dataset.del) }, '/api/payment-rules/delete');
  });

  const saveRule = async (payload, url = '/api/payment-rules') => {
    const before = new Set(paymentRules.map((r) => r.id));
    try {
      const data = await postJSON(url, payload);
      paymentRules = data.rules || paymentRules;
      // Правил под три десятка, и у каждого два выпадающих списка. Выбор
      // «Корзина» или «Платит» в середине таблицы без keepPlace отбрасывал к
      // её началу — ровно то, на что жаловались.
      keepPlace(() => {
        if (data.view) applyView(data.view);
        draw();
      });
      // Новое правило пустое: ни условия, ни пояснения. Среди трёх десятков
      // заполненных строк его глазом не найти, поэтому подсвечиваем и ставим
      // курсор прямо в поле условия — дописывать всё равно придётся.
      const fresh = paymentRules.find((r) => !before.has(r.id));
      if (fresh) flashRow(rows.querySelector(`.rule-row[data-id="${fresh.id}"]`));
      flashHint('Правило сохранено, отчёт пересчитан.');
    } catch (err) { flashHint(err.message, 'error'); }
  };

  draw();
  // ПРИОРИТЕТ НОВОГО ПРАВИЛА — ВЫШЕ ВСЕХ. Раньше здесь стояла жёсткая сотня,
  // а встроенные правила сидят на 10…61 — свежая строка всегда падала в самый
  // хвост таблицы, за нижний край окна настроек. Человек жал кнопку, на
  // экране не менялось ничего, и правило считалось незаведённым.
  //
  // Наверху ему и место по смыслу: правила проверяются по возрастанию
  // приоритета, а частное исключение, ради которого правило и заводят, должно
  // побеждать общее корпоративное.
  $('ruleAdd').addEventListener('click', () => saveRule({
    priority: Math.max(1, Math.min(...paymentRules.map((r) => r.priority), 100) - 1),
    enabled: true, scope: 'options',
    match_kind: 'service', match_value: '', payer: 'company', note: '',
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * СМЕНА НОМЕРА
 *
 *     Черемша по весне одна, а зовут её кто как:
 *     Тут колба, там медвежий лук, а дальше — дикий чеснок.
 *     Свесил три мешка порознь, записал в три строки,
 *     А куст-то был один. И корень у него один.
 *
 *     Не считай мешки по названьям — обочтёшься втрое,
 *     Не дели один куст на три, коли режешь с одного.
 *     Сперва разберись, где имя, а где взаправду другое,
 *     А после уже и клади на весы. Вот и всё ремесло.
 *
 * ЗАЧЕМ ЭКРАН. Сотруднику меняют номер — оператор заводит новый лицевой счёт,
 * и в выгрузке появляются ДВА абонента: старый с начислениями до смены, новый
 * с начислениями после. Человек один, расход один, а в отчёте их двое, и оба
 * с половинными суммами. Хуже того, в списке работников остаётся только один
 * из номеров — у второго нет ни ФИО, ни лимита, и в списке он выглядит голыми
 * цифрами. Это и есть тот самый «абонент, который не подгрузился».
 *
 * Здесь эти пары сводят обратно. Программа их ПРЕДЛАГАЕТ (совпало ФИО,
 * история встык, без нахлёста), но связывает только человек: склеенные по
 * ошибке номера дадут карточку с чужим расходом, и заметить это будет нечем.
 * ═══════════════════════════════════════════════════════════════════════ */

const NUMBER_CHANGES_API = '/api/number-changes';
let numberChanges = null;      // { changes: [...], suggestions: [...] }

async function renderNumberChangeSettings(el) {
  if (!numberChanges) {
    el.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      numberChanges = await getJSON(NUMBER_CHANGES_API);
    } catch (err) {
      el.innerHTML = `<div class="empty">Не удалось загрузить: ${esc(err.message)}</div>`;
      return;
    }
  }

  el.innerHTML = `
    <div class="settings-note">Сотруднику сменили номер — в счёте появляются
      два абонента: старый с начислениями до смены и новый после. Свяжите их,
      и программа сложит оба счёта в одну карточку: полный расход, целая
      история, ФИО и лимит подтянутся с того номера, у которого они есть.
      <br>Связь действует на все загруженные периоды сразу и в любой момент
      снимается — счета при этом не меняются, расходятся обратно.</div>
    <div id="numberChangeBody"></div>`;

  const body = $('numberChangeBody');

  const draw = () => {
    const rows = numberChanges.changes || [];
    const hints = numberChanges.suggestions || [];
    body.innerHTML = `
      <div class="settings-section-title">Добавить связь</div>
      <div class="num-form">
        <input type="text" id="numOld" class="search-input" placeholder="Старый номер"
               inputmode="numeric" maxlength="20">
        <span class="num-arrow" aria-hidden="true">→</span>
        <input type="text" id="numNew" class="search-input" placeholder="Новый номер"
               inputmode="numeric" maxlength="20">
        <input type="text" id="numWhen" class="search-input num-when"
               placeholder="Когда сменили" maxlength="20">
        <input type="text" id="numNote" class="search-input" placeholder="Комментарий" maxlength="120">
        <button class="btn btn-primary" id="numAdd">Связать</button>
      </div>

      ${hints.length ? `
        <div class="settings-section-title">Похоже на смену номера
          <span class="rule-group-n">${hints.length}</span></div>
        <div class="settings-note">Совпало ФИО, старый номер замолчал, новый
          ровно тогда же заговорил. Программа сама ничего не связывает —
          проверьте и подтвердите.</div>
        <div class="num-list">
          ${hints.map((h) => `
            <div class="num-hint">
              <div class="num-hint-who">
                <b>${esc(h.username || '—')}</b>
                ${h.same_personnel_no
                  ? '<span class="pill pill-good" title="У обоих номеров один табельный номер">табельный совпал</span>'
                  : ''}
              </div>
              <div class="num-hint-pair">
                ${esc(formatPhone(h.old_number))}
                <span class="num-arrow">→</span>
                ${esc(formatPhone(h.new_number))}
              </div>
              <div class="num-hint-when">последний счёт ${esc(formatMonth(h.old_last_month))},
                первый ${esc(formatMonth(h.new_first_month))}</div>
              <button class="btn btn-soft btn-sm" data-accept="${esc(h.old_number)}"
                      data-new="${esc(h.new_number)}">Связать</button>
            </div>`).join('')}
        </div>` : ''}

      <div class="settings-section-title">Связанные номера
        <span class="rule-group-n">${rows.length}</span></div>
      ${rows.length ? `
        <div class="num-list">
          ${rows.map((r) => `
            <div class="num-row">
              <div class="num-row-pair">
                <span class="num-old">${esc(formatPhone(r.old_number))}</span>
                <span class="num-arrow">→</span>
                <span class="num-new">${esc(formatPhone(r.new_number))}</span>
              </div>
              <div class="num-row-meta">${esc(r.changed_at || '')}${
                r.changed_at && r.note ? ' · ' : ''}${esc(r.note || '')}</div>
              <button class="rule-del" type="button" data-unlink="${esc(r.old_number)}"
                      title="Снять связь">✕</button>
            </div>`).join('')}
        </div>`
      : '<div class="empty">Связей нет. Если ни у кого номер не менялся — так и должно быть.</div>'}`;
  };

  const save = async (payload, url = NUMBER_CHANGES_API) => {
    try {
      const data = await postJSON(url, payload);
      numberChanges = {
        changes: data.changes || [],
        // Подсказки сервер шлёт только на чтение — после связывания
        // пересчитываем список сами: связанная пара из него уходит.
        suggestions: (numberChanges.suggestions || []).filter(
          (h) => !(data.changes || []).some(
            (c) => c.old_number === h.old_number || c.new_number === h.new_number
              || c.old_number === h.new_number || c.new_number === h.old_number)),
      };
      // Подсказок «похоже на смену номера» бывает десятки: связал одну —
      // остальные должны остаться там же, где были, а не уехать к началу.
      keepPlace(() => {
        if (data.view) applyView(data.view);
        draw();
      });
      flashHint('Готово, отчёт пересчитан.');
    } catch (err) { flashHint(err.message, 'error'); }
  };

  body.addEventListener('click', (e) => {
    const accept = e.target.closest('[data-accept]');
    if (accept) {
      return save({ old_number: accept.dataset.accept, new_number: accept.dataset.new,
                    note: 'подтверждено по совпадению ФИО' });
    }
    const unlink = e.target.closest('[data-unlink]');
    if (unlink) {
      if (!confirm('Снять связь? Счета разойдутся обратно на два номера.')) return;
      return save({ old_number: unlink.dataset.unlink }, `${NUMBER_CHANGES_API}/delete`);
    }
    if (!e.target.closest('#numAdd')) return;
    const old = $('numOld').value.trim();
    const fresh = $('numNew').value.trim();
    if (!old || !fresh) return flashHint('Нужны оба номера: и старый, и новый', 'error');
    save({ old_number: old, new_number: fresh,
           changed_at: $('numWhen').value.trim(), note: $('numNote').value.trim() });
  });

  draw();
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
      keepPlace(renderSettings);
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

  // Порциями, как и карточки: в строке три поля ввода, и на всём парке
  // номеров это самая тяжёлая разметка в программе. Из-за неё настройки и
  // открывались с задержкой.
  batchList(list, rows, (s) => {
    // Полоса слева — цвет действующего правила номера. Раньше здесь был цвет
    // статуса, но статус ни на что не влиял; правило влияет на деньги, и
    // видеть его в списке абонентов куда полезнее.
    const stripe = ((s.payment || {}).color || {}).hex || '';
    // Командировка из файла — не галочка, а факт из данных: снять её здесь
    // нельзя, и притворяться, что можно, тоже. Поэтому она отдельной плашкой
    // рядом с номером, а галочка остаётся про ручную отметку.
    const byFile = s.on_trip && !s.is_business_trip;
    return `<div class="subscriber-item" data-number="${esc(s.number)}"
                 style="border-left-color:${esc(stripe || 'var(--border)')}">
      <div class="subscriber-info">
        <div class="subscriber-number">${esc(formatPhone(s.number))}${
          s.on_trip ? '<span class="badge badge-trip" title="Период командировки'
            + ' пересекается с расчётным месяцем: роуминг переведён на компанию'
            + '">командировка</span>' : ''}</div>
        <div class="subscriber-name">${esc(s.username || '—')}</div>
        <div class="subscriber-pos">${esc(s.position || '')}</div>
        <div class="subscriber-cost">начислено ${money(s.total)}${
          isSelfPaid(s) ? ' · платит сам' : ''}</div>
      </div>
      <div class="subscriber-controls">
        <div class="control-group">
          <label class="trip-toggle">
            <input type="checkbox" class="trip-check" data-number="${esc(s.number)}"
                   ${s.is_business_trip ? 'checked' : ''}> В командировке
          </label>
          ${byFile ? '<div class="trip-auto">отмечен по файлу командировок —'
            + ' галочка не нужна</div>' : ''}
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
      btn.addEventListener('click', () => {
        state.tariffs.splice(Number(btn.dataset.del), 1);
        keepPlace(draw);
      });
    });
  };
  draw();

  $('tariffAdd').onclick = () => {
    state.tariffs.push({
      id: `custom_${Date.now()}`, name: 'Новый тариф', kind: 'voice', fee: 0,
      minutes: 0, sms: 0, internet_mb: 0, unlimited_internet: false,
      rate_min: 0.18, rate_sms: 0.05, rate_mb: 0.05, note: '',
    });
    // Новый тариф садится в конец списка — сюда и доводим взгляд, как это
    // делают правила (flashRow). Прежнее место человеку тут уже не нужно.
    draw();
    const rows = $$('.tariff-editor-row', $('tariffRows'));
    flashRow(rows[rows.length - 1]);
  };
  $('tariffReset').onclick = async () => {
    try {
      state.tariffs = (await postJSON('/api/tariffs/reset', {})).tariffs;
      keepPlace(draw);
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
  // ВСЯ ПЕРЕРИСОВКА — ОДНИМ КУСКОМ ПОД keepPlace.
  // Список блоков длинный, переключателей в нём под три десятка, и вкладка
  // после каждого щелчка собиралась заново целиком — вместе с прокруткой,
  // сброшенной в ноль. Выключил блок в середине списка — и ищи его снова
  // сверху. Это и есть то самое «перекидывает обратно».
  const commit = () => keepPlace(() => {
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
  });

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

  const header = ['Номер', 'ФИО', 'Должность', 'Табельный', 'Кто платит', 'В командировке',
    'Тариф', 'Абонплата ₽', 'Начислено ₽', 'Лимит ₽', 'Превышение лимита ₽', 'Оценка',
    'Минуты', 'Минуты ₽', 'Интернет ГБ', 'Интернет ₽', 'SMS', 'SMS ₽',
    'Вердикт минуты', 'Вердикт интернет', 'Вердикт SMS',
    'Рекомендация', 'Выгодный тариф', 'Экономия ₽/мес', 'Обоснование'];

  const rows = state.subscribers.map((s) => {
    const [voice, net, sms] = ['voice', 'internet', 'sms']
      .map((k) => s.categories.find((c) => c.key === k) || { used: 0, cost: 0, verdict: {} });
    const action = ACTION_META[s.recommendation.action] || ACTION_META.keep;
    // Вместо бывшего «статуса абонента» — то, что действительно решает
    // судьбу строки: чьи это деньги. Статус был подписью без последствий.
    const payerWord = isSelfPaid(s) ? 'платит сам'
      : ((s.payment || {}).excluded ? 'не учитывается' : 'компания');
    return [
      s.number, s.username, s.position, s.personnel_no,
      payerWord, s.on_trip ? 'да' : '',
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

/* ═══════════════════════════════════════════════════════════════════════════
 * ОФОРМЛЕНИЕ: ТЕМА И СВОИ ЦВЕТА
 *
 * Тема — светлая, тёмная или «как в системе». Поверх темы можно перекрасить
 * пять красок; всё остальное в интерфейсе — оттенки серого, и от выбора они
 * не зависят.
 *
 * КАК ЭТО ДЕРЖИТСЯ. Выбранные цвета выставляются переменными прямо на <html>
 * через style.setProperty. Инлайновый стиль сильнее любого правила таблицы,
 * поэтому одна настройка перебивает и светлую тему, и тёмную — а значения
 * под каждую из них пересчитываются заново, при каждом переключении.
 *
 * ПОЧЕМУ ЦВЕТ НЕ КЛАДЁТСЯ НАПРЯМУЮ. Покрасить одной краской и заливку, и
 * мелкий текст нельзя: яркий зелёный на белом даёт контраст около 2 при
 * норме 4.5, и подписи под цифрами читаются с усилием — ровно та беда, из-за
 * которой в палитре изначально сидят --brand и --primary по отдельности.
 * Поэтому из одной выбранной краски получаются три:
 *
 *     --brand    — как выбрали: заливки, полосы, значки;
 *     --primary  — сдвинутый к чёрному (в тёмной теме — к белому) ровно
 *                  настолько, чтобы контраст с фоном дотянул до 4.5: буквы,
 *                  кнопки, ссылки;
 *     --*-soft   — та же краска прозрачностью .16: подложки плашек.
 *
 * ХРАНИТСЯ В localStorage, А НЕ В БАЗЕ. Оформление — дело рабочего места:
 * на одну базу смотрят с разных машин, и навязывать всем чужой выбор цвета
 * не нужно. Заодно не нужна миграция схемы.
 */

const THEME_KEY = 'theme';
const THEME_COLORS_KEY = 'themeColors';

const THEME_MODES = [['light', 'Светлая'], ['dark', 'Тёмная'], ['auto', 'Как в системе']];

// Пять красок — всё, что в интерфейсе ЗНАЧИТ состояние. Фон, границы и текст
// не настраиваются намеренно: их подбирали по контрасту, и «свой» фон ломает
// читаемость быстрее, чем человек успевает понять, что он сделал.
const THEME_PAINTS = [
  { key: 'brand', label: 'Фирменный', note: 'кнопки, полосы, заливки' },
  { key: 'accent', label: 'Акцент', note: 'вторые по важности выделения' },
  { key: 'good', label: 'В норме', note: 'расход укладывается в лимит' },
  { key: 'warning', label: 'Внимание', note: 'подошёл к лимиту' },
  { key: 'danger', label: 'Превышение', note: 'лимит пробит' },
];

/* ── Цветовая арифметика ──────────────────────────────────────────────────
   Всё по WCAG: яркость и контраст считаются так же, как их считает любая
   проверялка доступности, — иначе «поправил до 4.5» ничего не значит. */

/** '#0b5', '#00b956' или 'rgb(0, 185, 86)' → {r, g, b}. */
function toRgb(value) {
  const text = String(value || '').trim();
  const fn = text.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3] };
  const hex = text.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }) {
  const p = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** Относительная яркость по WCAG. */
function luminance({ r, g, b }) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Сдвиг к белому (amount > 0) или к чёрному (amount < 0), доля 0…1. */
function shade(rgb, amount) {
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return { r: rgb.r + (to - rgb.r) * k, g: rgb.g + (to - rgb.g) * k,
           b: rgb.b + (to - rgb.b) * k };
}

/**
 * Тот же цвет, но читаемый на этом фоне: двигаем к белому или к чёрному,
 * пока контраст не дотянет до 4.5. Шаг мелкий (5%), чтобы не проскочить
 * дальше нужного и не потерять сам цвет — фирменный зелёный должен
 * остаться зелёным, а не стать чёрным.
 */
function readableOn(rgb, bg) {
  if (contrastRatio(rgb, bg) >= 4.5) return rgb;
  const lighten = luminance(bg) < 0.4;
  let out = rgb;
  for (let i = 1; i <= 20; i += 1) {
    out = shade(rgb, (lighten ? 1 : -1) * i * 0.05);
    if (contrastRatio(out, bg) >= 4.5) break;
  }
  return out;
}

/** Какими буквами писать ПО этой заливке — белыми или почти чёрными. */
function inkOn(rgb) {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 12, g: 18, b: 16 };
  return contrastRatio(rgb, white) >= contrastRatio(rgb, black) ? white : black;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ── Чтение и запись выбора ───────────────────────────────────────────────── */

function themeMode() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'auto';
}

function themeColors() {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_COLORS_KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    return {};
  }
}

/**
 * Навесить тему и свои цвета на <html>.
 *
 * `redraw` выключается, пока человек ведёт пипетку: событие input летит на
 * каждый пиксель, а перерисовка графика по всему парку номеров на каждом
 * таком шаге превращает выбор цвета в слайд-шоу.
 */
function applyTheme({ redraw = true } = {}) {
  const root = document.documentElement;
  const mode = themeMode();
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);

  // Прошлый выбор снимаем ДО того, как читать фон и стандартные цвета:
  // иначе getComputedStyle вернёт уже перекрашенное значение, оно уйдёт в
  // расчёт как «стандартное», и палитра будет уползать с каждым открытием
  // настроек.
  ['--primary', '--primary-ink'].forEach((v) => root.style.removeProperty(v));
  THEME_PAINTS.forEach(({ key }) => {
    ['', '-soft', '-ink'].forEach((suf) => root.style.removeProperty(`--${key}${suf}`));
  });

  const surface = toRgb(cssVar('--surface')) || { r: 255, g: 255, b: 255 };

  Object.entries(themeColors()).forEach(([key, hex]) => {
    const rgb = toRgb(hex);
    if (!rgb || !THEME_PAINTS.some((p) => p.key === key)) return;
    const readable = readableOn(rgb, surface);
    const soft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .16)`;

    if (key === 'brand') {
      // Заливка — как выбрали, буквы и кнопки — притемнённой версией.
      root.style.setProperty('--brand', toHex(rgb));
      root.style.setProperty('--primary', toHex(readable));
      root.style.setProperty('--primary-ink', toHex(inkOn(readable)));
      return;
    }
    root.style.setProperty(`--${key}`, toHex(readable));
    root.style.setProperty(`--${key}-soft`, soft);
    if (key === 'accent') root.style.setProperty('--accent-ink', toHex(inkOn(readable)));
  });

  if (redraw && state.subscribers.length) drawTrendChart();
}

function setThemeMode(mode) {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme();
}

/** Что показать в пипетке: свой цвет, а если его нет — нынешний из темы. */
function paintValue(key) {
  const custom = themeColors()[key];
  if (custom && toRgb(custom)) return toHex(toRgb(custom));
  const rgb = toRgb(cssVar(`--${key}`));
  return rgb ? toHex(rgb) : '#00b956';
}

/* ── Окно «Оформление» ────────────────────────────────────────────────────
   Открывается из главного меню, а не из настроек. В настройках правят то,
   от чего зависят деньги: правила, тарифы, лимиты. Цвет не влияет ни на
   один расчёт, и его место — рядом с выбором темы, а не в одном ряду с
   тем, что может испортить отчёт. */
function openTheme() {
  const panel = $('themeModal');
  if (!panel) return;
  panel.hidden = false;
  renderTheme();
}

function renderTheme() {
  const el = $('themeContent');
  if (!el) return;
  const mode = themeMode();
  const custom = themeColors();

  el.innerHTML = `
    <div class="settings-title theme-title">Оформление</div>
    <div class="settings-note">Тема и цвета запоминаются в этом браузере, на
      расчёты они не влияют. Выбранной краской красится заливка, а буквы и
      кнопки автоматически притемняются до читаемого контраста — иначе
      подписи под цифрами пришлось бы разглядывать.</div>

    <div class="theme-modes">
      ${THEME_MODES.map(([id, label]) => `<button type="button"
        class="btn ${id === mode ? 'btn-primary' : 'btn-soft'}"
        data-mode="${id}">${label}</button>`).join('')}
    </div>

    <div class="panel-title theme-paints-title">Цвета</div>
    <div class="theme-paints">
      ${THEME_PAINTS.map((p) => `<label class="theme-paint">
        <input type="color" data-paint="${esc(p.key)}" value="${esc(paintValue(p.key))}"
               aria-label="${esc(p.label)}">
        <span class="theme-paint-text">
          <span class="theme-paint-name">${esc(p.label)}${
            custom[p.key] ? '<em>изменён</em>' : ''}</span>
          <span class="theme-paint-note">${esc(p.note)}</span>
        </span>
      </label>`).join('')}
    </div>

    <div class="settings-actions">
      <button class="btn btn-soft" id="themeReset">Вернуть стандартные цвета</button>
    </div>`;

  $$('[data-mode]', el).forEach((btn) => {
    btn.onclick = () => { setThemeMode(btn.dataset.mode); renderTheme(); };
  });

  // input — пока пипетку водят, change — когда её закрыли. Перерисовка окна
  // только по change: на каждом шаге она вырывала бы фокус из открытого
  // системного окна выбора цвета.
  $$('[data-paint]', el).forEach((inp) => {
    inp.oninput = () => {
      localStorage.setItem(THEME_COLORS_KEY,
        JSON.stringify({ ...themeColors(), [inp.dataset.paint]: inp.value }));
      applyTheme({ redraw: false });
    };
    inp.onchange = () => { applyTheme(); renderTheme(); };
  });

  $('themeReset').onclick = () => {
    localStorage.removeItem(THEME_COLORS_KEY);
    applyTheme();
    renderTheme();
    flashHint('Цвета вернулись к стандартным.');
  };
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
