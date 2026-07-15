'use strict';

// ═══════════════════════════════════════════════════════════════
//  SERVICE MAP — маппинг услуг CSV → внутренние ключи
// ═══════════════════════════════════════════════════════════════
var SERVICE_MAP = {
  '\u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u0438\u0439 \u043D\u043E\u043C\u0435\u0440': 'subscriber_number',
  '\u0442\u0430\u0440\u0438\u0444\u043D\u044B\u0439 \u043F\u043B\u0430\u043D': 'tariff_plan',
  '\u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043B\u0430\u0442\u0430 \u043F\u043E \u0442\u0430\u0440\u0438\u0444\u043D\u043E\u043C\u0443 \u043F\u043B\u0430\u043D\u0443 (\u043F\u043E\u0441\u0443\u0442\u043E\u0447\u043D\u043E\u0435 \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435)': 'plan_fee',
  '\u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043B\u0430\u0442\u0430 \u043F\u043E \u0442\u0430\u0440\u0438\u0444\u043D\u043E\u043C\u0443 \u043F\u043B\u0430\u043D\u0443': 'plan_fee',
  '\u0443\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u0430': 'call_hold',
  '\u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043B\u0430\u0442\u0430 \u0437\u0430 \u0443\u0441\u043B\u0443\u0433\u0443 \u0437\u0430\u0449\u0438\u0442\u0430 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432': 'employee_protection_fee',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_outgoing_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u043D\u0430 \u043D\u043E\u043C\u0435\u0440\u0430 \u0434\u0440\u0443\u0433\u0438\u0445 \u043E\u043F\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432 \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_other_operators',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u0435\u0442\u0438 \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_onnet_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043C\u0435\u0436\u0434\u0443\u0433\u043E\u0440\u043E\u0434\u043D\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_intercity_calls',
  '\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_mobile_internet',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_sms',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_incoming_calls',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_incoming_sms',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_incoming_calls',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_incoming_sms',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_outgoing_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043C\u0435\u0436\u0434\u0443\u0433\u043E\u0440\u043E\u0434\u043D\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_intercity_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_sms',
  '\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_mobile_internet',
  '\u0438\u0442\u043E\u0433\u043E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E': 'total_charged',
  '\u0432 \u0442.\u0447. \u043D\u0434\u0441': 'vat_included',
  '\u0432 \u0442\u043E\u043C \u0447\u0438\u0441\u043B\u0435 \u043D\u0434\u0441 (22%)': 'vat_included',
  '\u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0437\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0443 \u043C\u0443\u043B\u044C\u0442\u0438\u043C\u0435\u0434\u0438\u0430\u043B\u044C\u043D\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439': 'multimedia_messages',
  '\u043C\u0430\u0441\u0441\u043E\u0432\u044B\u0435 \u0432\u044B\u0437\u043E\u0432\u044B': 'mass_calls',
  '\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0430\u044F \u043F\u043E\u0447\u0442\u0430': 'voicemail',
  '\u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442\u0447\u0438\u043A': 'auto_answer',
  '\u0437\u0432\u043E\u043D\u043E\u043A \u0437\u0430 \u0441\u0447\u0451\u0442 \u0434\u0440\u0443\u0433\u0430': 'friend_call',
  '\u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430 \u0441\u0447\u0451\u0442\u0430 \u043D\u0430 email': 'email_invoice',
  '\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0432 \u043D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'national_roaming_internet',
  '\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u043D\u043E\u043C\u0435\u0440\u0430': 'number_blocking',
  '\u043E\u0444\u0438\u0441 \u0432 \u043A\u0430\u0440\u043C\u0430\u043D\u0435': 'office_in_pocket',
  '\u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435 sms': 'voice_sms',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043C\u0435\u0436\u0434\u0443\u0433\u043E\u0440\u043E\u0434\u043D\u044B\u0435 \u0432\u044B\u0437\u043E\u0432\u044B': 'international_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 sms \u0432 \u043C\u0435\u0436\u0434\u0443\u043D\u0430\u0440\u043E\u0434\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'international_roaming_sms',
  '\u043F\u0440\u043E\u0447\u0438\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F': 'misc_charges',
  '\u043C\u0438.\u0434\u0435\u0442\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u0441\u0447\u0435\u0442\u0430': 'mi_detailing',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 sms \u0432 \u043C\u0435\u0436\u0434\u0443\u043D\u0430\u0440\u043E\u0434\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'incoming_sms_intl_roaming',
  '\u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043C\u0435\u0436\u0434\u0443\u043D\u0430\u0440\u043E\u0434\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'calls_intl_roaming',
  '\u0443\u0441\u043B\u0443\u0433\u0438 \u043D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0430': 'national_roaming_services',
  '\u0443\u0441\u043B\u0443\u0433\u0438 \u043C\u0435\u0436\u0434\u0443\u043D\u0430\u0440\u043E\u0434\u043D\u043E\u0433\u043E \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0430': 'intl_roaming_services',
  '\u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0437\u0430 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435 \u0443\u0441\u043B\u0443\u0433\u0438 \u0432 \u043D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'national_roaming_voice',
  '\u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043B\u0430\u0442\u0430 m2m': 'm2m_fee',
  '\u0430\u0431\u043E\u043D\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043B\u0430\u0442\u0430 m2m \u0444\u043B\u0435\u043A\u0441': 'm2m_flex_fee',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_outgoing_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043C\u0435\u0436\u0434\u0443\u043D\u0430\u0440\u043E\u0434\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'outgoing_calls_intl_roaming',
  '\u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0437\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0443 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0432 \u043D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'national_roaming_messages'
};

var META_KEYS = new Set(['subscriber_number', 'tariff_plan', 'total_charged', 'vat_included']);

var CATEGORY_OF = {
  home_outgoing_calls: 'voice', home_other_operators: 'voice', home_onnet_calls: 'voice',
  home_intercity_calls: 'voice', home_incoming_calls: 'voice',
  travel_outgoing_calls: 'voice', travel_intercity_calls: 'voice',
  travel_onnet_russia_calls: 'voice', travel_other_operators: 'voice', mass_calls: 'voice',
  international_calls: 'voice', international_roaming_russia_calls: 'voice',
  international_roaming_local_calls: 'voice', friend_call: 'voice',
  voicemail: 'voice', auto_answer: 'voice', call_hold: 'voice',
  calls_intl_roaming: 'voice', outgoing_calls_intl_roaming: 'voice',
  home_mobile_internet: 'internet', travel_mobile_internet: 'internet', national_roaming_internet: 'internet',
  home_sms: 'sms', home_incoming_sms: 'sms', travel_sms: 'sms', travel_incoming_sms: 'sms',
  multimedia_messages: 'sms', international_roaming_sms: 'sms',
  national_roaming_messages: 'sms', voice_sms: 'sms', incoming_sms_intl_roaming: 'sms',
};

var TARIFFS = {
  "140": { minutes: 700, sms: 300, internet_mb: 15000, name: '\u0411\u0435\u0437 \u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442' },
  "230": { minutes: 1500, sms: 500, internet_mb: 25000, name: '\u0421\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442' },
  "400": { minutes: 4000, sms: 1000, internet_mb: 70000, name: '\u0424\u0435\u0434\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439' }
};

var DEFAULT_TARIFF = { minutes: 500, sms: 200, internet_mb: 5000, name: '\u0414\u0440\u0443\u0433\u043E\u0439' };

var CATEGORY_META = {
  voice: { label: '\u041C\u0438\u043D\u0443\u0442\u044B', unit: '\u043C\u0438\u043D', icon: '\uD83D\uDCDE', color: '#0071CE', quotaKey: 'minutes' },
  internet: { label: '\u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442', unit: '\u041C\u0411', icon: '\uD83C\uDF10', color: '#68B944', quotaKey: 'internet_mb' },
  sms: { label: 'SMS', unit: '\u0448\u0442', icon: '\u2709\uFE0F', color: '#F7941D', quotaKey: 'sms' }
};

var TARIFF_COLORS = ['#68B944', '#0071CE', '#F7941D', '#D32F2F', '#00897B'];
var MONTH_NAMES = ['\u042F\u043D\u0432', '\u0424\u0435\u0432', '\u041C\u0430\u0440', '\u0410\u043F\u0440', '\u041C\u0430\u0439', '\u0418\u044E\u043D', '\u0418\u044E\u043B', '\u0410\u0432\u0433', '\u0421\u0435\u043D', '\u041E\u043A\u0442', '\u041D\u043E\u044F', '\u0414\u0435\u043A'];
var HISTORY_MONTHS = 6;

var allSubscribers = [];
var renderedSubscribers = [];
var nameByNumber = {};
var currentFilter = 'all';
var currentSort = 'overpay';
var sortDirection = 'desc';

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  var $ = function(id) { return document.getElementById(id); };

  if ($('workersBtn')) $('workersBtn').onclick = function() { $('workersFile').click(); };
  if ($('workersFile')) $('workersFile').onchange = function(e) { if (e.target.files[0]) loadWorkers(e.target.files[0]); };
  if ($('billsBtn')) $('billsBtn').onclick = function() { $('billsFile').click(); };
  if ($('billsFile')) $('billsFile').onchange = function(e) { if (e.target.files[0]) uploadCSV(e.target.files[0]); };
  if ($('demoBtn')) $('demoBtn').onclick = loadDemoData;
  if ($('searchInput')) $('searchInput').oninput = renderUsers;

  document.querySelectorAll('.filter').forEach(function(b) {
    b.onclick = function() {
      document.querySelectorAll('.filter').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active');
      currentFilter = b.dataset.filter;
      renderUsers();
    };
  });

  document.querySelectorAll('.sort').forEach(function(b) {
    if (b.dataset.sort === currentSort) b.classList.add('active');
    b.onclick = function() {
      if (currentSort === b.dataset.sort) {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        currentSort = b.dataset.sort;
        sortDirection = 'desc';
      }
      document.querySelectorAll('.sort').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderUsers();
    };
  });

  if ($('gridView') && $('tableView')) {
    $('gridView').onclick = function() { setView('grid'); };
    $('tableView').onclick = function() { setView('table'); };
  }

  if ($('toggleChartBtn')) {
    $('toggleChartBtn').onclick = function() {
      var p = $('chartPanel');
      if (!p) return;
      var open = p.classList.toggle('open');
      $('toggleChartBtn').textContent = open ? '\u25B4' : '\u25BE';
      if (open) drawBigChart();
    };
  }

  if ($('themeBtn')) {
    $('themeBtn').onclick = function() {
      var r = document.documentElement;
      var isDark = r.getAttribute('data-theme') === 'dark' ||
        (!r.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme:dark)').matches);
      r.setAttribute('data-theme', isDark ? 'light' : 'dark');
      localStorage.setItem('theme', isDark ? 'light' : 'dark');
    };
    var saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  // Settings toggle
  if ($('settingsBtn')) {
    $('settingsBtn').onclick = function() { $('settingsPanel').classList.toggle('show'); };
  }
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.settings-toggle') && !e.target.closest('.settings-panel')) {
      var sp = $('settingsPanel');
      if (sp) sp.classList.remove('show');
    }
  });

  // Panel toggles in settings
  var panelMap = {
    togKpi: 'kpiPanel', togStatus: 'analyticsPanel', togRank: 'analyticsPanel',
    togCat: 'analyticsPanel', togTariff: 'analyticsPanel',
    togChart: 'analyticsPanel', togCards: 'usersGrid'
  };
  var childMap = {
    togStatus: 'stat-card', togRank: 'rank-card', togCat: 'cat-card',
    togTariff: 'tariff-card', togChart: 'chart-card'
  };
  Object.keys(panelMap).forEach(function(id) {
    var cb = $(id);
    if (!cb) return;
    cb.onchange = function() {
      var el = $(panelMap[id]);
      if (!el) return;
      if (childMap[id]) {
        var card = el.querySelector('.' + childMap[id]);
        if (card) card.style.display = cb.checked ? '' : 'none';
      } else {
        el.style.display = cb.checked ? '' : 'none';
      }
    };
  });

  window.addEventListener('resize', function() {
    var p = $('chartPanel');
    if (p && p.classList.contains('open')) drawBigChart();
  });
});

// ═══════════════════════════════════════════════════════════════
//  UPLOAD
// ═══════════════════════════════════════════════════════════════
function uploadCSV(file) {
  showLoading('\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430\u2026', 10);
  var fd = new FormData();
  fd.append('file', file);
  fetch('/api/upload-csv', { method: 'POST', body: fd })
    .then(function(r) { return r.ok ? r.json() : r.json().then(function(e) { throw new Error(e.error); }); })
    .then(function(d) {
      showLoading('\u0410\u043D\u0430\u043B\u0438\u0437\u2026', 60);
      currentFilter = 'all';
      currentSort = 'overpay';
      sortDirection = 'desc';
      processServerData(d);
    })
    .catch(function(e) {
      showLoading('\u041E\u0448\u0438\u0431\u043A\u0430: ' + e.message, 100);
      setTimeout(hideLoading, 3000);
    });
}

function processServerData(data) {
  showLoading('\u041F\u043E\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0435\u2026', 80);
  var rd = {};
  var entries = Object.entries(data.subscribers);
  for (var i = 0; i < entries.length; i++) {
    var num = entries[i][0];
    var sub = entries[i][1];
    var items = [];
    var pf = sub.planFee || 0;
    for (var j = 0; j < sub.items.length; j++) {
      var it = sub.items[j];
      var k = mkey(it.serviceName);
      if (!k) continue;
      if (k === 'plan_fee') { pf += it.withDiscount; continue; }
      if (META_KEYS.has(k)) continue;
      items.push({
        key: k, category: CATEGORY_OF[k] || 'other',
        rawVolume: it.rawVolume, volume: it.volume, unit: it.unit,
        noDiscount: it.noDiscount, discount: it.discount,
        withDiscount: it.withDiscount, serviceName: it.serviceName
      });
    }
    rd[num] = { items: items, planFee: pf, planName: sub.planName || '\u0422\u0430\u0440\u0438\u0444 ' + Math.round(pf) + '\u20BD' };
  }
  buildReportFromData(rd);
}

function mkey(name) {
  var lo = name.toLowerCase();
  var keys = Object.keys(SERVICE_MAP);
  for (var i = 0; i < keys.length; i++) {
    if (lo.indexOf(keys[i]) !== -1) return SERVICE_MAP[keys[i]];
  }
  return null;
}

function setView(m) {
  document.querySelectorAll('.view').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById(m === 'table' ? 'tableView' : 'gridView');
  if (btn) btn.classList.add('active');
  var g = document.getElementById('usersGrid');
  if (g) g.classList.toggle('table-view', m === 'table');
  renderUsers();
}

function loadWorkers(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    nameByNumber = parseWorkers(e.target.result);
    flashHint('\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438: ' + Object.keys(nameByNumber).length);
  };
  reader.readAsText(file, 'windows-1251');
}

function parseWorkers(text) {
  var map = {};
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var digits = line.match(/\d{10,}/);
    if (!digits) continue;
    var num = digits[0].slice(-10);
    var parts = line.split(/[;,\t]/);
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j].trim();
      if (p && !/^\+?\d[\d\s()-]{6,}$/.test(p)) { map[num] = p; break; }
    }
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
//  BUILD REPORT
// ═══════════════════════════════════════════════════════════════
function buildReportFromData(rd) {
  showLoading('\u0410\u043D\u0430\u043B\u0438\u0437\u2026', 70);
  allSubscribers = [];
  var entries = Object.entries(rd);
  for (var i = 0; i < entries.length; i++) {
    allSubscribers.push(buildRec(entries[i][0], entries[i][1]));
  }
  showLoading('\u0413\u043E\u0442\u043E\u0432\u043E', 100);

  var ws = document.getElementById('welcomeSection');
  if (ws) ws.style.display = 'none';
  var kp = document.getElementById('kpiPanel');
  if (kp) kp.style.display = 'grid';
  var ap = document.getElementById('analyticsPanel');
  if (ap) ap.style.display = 'grid';
  var fp = document.getElementById('filtersPanel');
  if (fp) fp.style.display = 'flex';

  updateKpis();
  updateStatusChart();
  updateRankList();
  updateCategoryChart();
  updateTariffChart();

  setTimeout(function() { hideLoading(); renderUsers(); }, 350);
}

function buildRec(number, data) {
  var pf = data.planFee;
  var pfi = Math.round(pf);
  var tr = TARIFFS[String(pfi)] || DEFAULT_TARIFF;
  var ec = 0;
  var cats = {
    voice: { used: 0, cost: 0 },
    internet: { used: 0, cost: 0 },
    sms: { used: 0, cost: 0 },
    other: { used: 0, cost: 0 }
  };

  for (var i = 0; i < data.items.length; i++) {
    var it = data.items[i];
    ec += it.withDiscount;
    var c = cats[it.category];
    c.cost += it.withDiscount;
    if (it.category === 'voice' && it.unit === '\u043C\u0438\u043D') c.used += it.volume;
    else if (it.category === 'internet') c.used += it.volume;
    else if (it.category === 'sms' && it.unit === '\u0448\u0442') c.used += it.volume;
  }

  var tc = pf + ec;
  var op = ec;
  var cats2 = [];
  var catKeys = ['voice', 'internet', 'sms'];
  for (var j = 0; j < catKeys.length; j++) {
    var cat = catKeys[j];
    var meta = CATEGORY_META[cat];
    var lim = tr[meta.quotaKey] || 0;
    var u = cats[cat].used;
    var r = lim > 0 ? u / lim : 0;
    cats2.push({
      cat: cat, label: meta.label, unit: meta.unit, icon: meta.icon,
      color: meta.color, quotaKey: meta.quotaKey,
      used: u, limit: lim, cost: cats[cat].cost, ratio: r,
      advice: catAdv(r, cats[cat].cost)
    });
  }

  var ou = 0;
  for (var k = 0; k < cats2.length; k++) { if (cats2[k].ratio > 1) ou++; }
  var opr = pf > 0 ? op / pf : (op > 0 ? 1 : 0);
  var st = 'normal';
  if (op > 50) st = 'danger';
  else if (op > 1) st = 'warning';
  var rs = Math.max(0, Math.min(100, Math.round(opr * 100 + ou * 15)));

  var rnd = sRand(number);
  var mo = [];
  for (var m = 0; m < HISTORY_MONTHS - 1; m++) {
    mo.push(tc * (0.82 + rnd() * 0.36));
  }
  mo.push(tc);
  var avg = 0;
  for (var a = 0; a < mo.length; a++) avg += mo[a];
  avg = avg / mo.length;
  var pv = mo[mo.length - 2];
  var tr2 = pv > 0 ? ((tc - pv) / pv) * 100 : 0;

  return {
    number: number,
    name: nameByNumber[number] || '',
    planName: data.planName || '\u0422\u0430\u0440\u0438\u0444 ' + pfi + '\u20BD',
    totalCost: tc, planFee: pf, overpayment: op,
    categories: cats2, overuse: ou, status: st, riskScore: rs,
    recommendation: buildRec2(st, op, cats2),
    monthly: mo, avg: avg, trend: tr2, tariffName: tr.name
  };
}

function catAdv(r, cost) {
  if (r > 1) return { type: 'raise', text: '\u041F\u0435\u0440\u0435\u0440\u0430\u0441\u0445\u043E\u0434 ' + mny(cost) };
  if (r > 0 && r < 0.4) return { type: 'lower', text: '\u041F\u0430\u043A\u0435\u0442 \u043D\u0435\u0434\u043E\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D' };
  return { type: 'ok', text: '\u0412 \u043F\u0440\u0435\u0434\u0435\u043B\u0430\u0445 \u043F\u0430\u043A\u0435\u0442\u0430' };
}

function buildRec2(s, op, cats) {
  var r = [], l = [], p = [];
  for (var i = 0; i < cats.length; i++) {
    if (cats[i].advice.type === 'raise') r.push(cats[i].label.toLowerCase());
    if (cats[i].advice.type === 'lower') l.push(cats[i].label.toLowerCase());
  }
  if (r.length) p.push('\u041F\u043E\u0432\u044B\u0441\u0438\u0442\u044C: ' + r.join(', '));
  if (l.length) p.push('\u041F\u043E\u043D\u0438\u0437\u0438\u0442\u044C: ' + l.join(', '));
  if (s === 'danger') p.unshift('\u041A\u0440\u0438\u0442\u0438\u0447\u043D\u043E: ' + mny(op));
  else if (s === 'warning') p.unshift('\u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430 ' + mny(op));
  if (!p.length) p.push('\u0422\u0430\u0440\u0438\u0444 \u041E\u041A');
  return p;
}

function sRand(s) {
  var h = 1779033703 ^ s.length;
  for (var i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  var a = h >>> 0;
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══════════════════════════════════════════════════════════════
//  KPI + CHARTS
// ═══════════════════════════════════════════════════════════════
function updateKpis() {
  var tc = 0, to = 0, cr = 0;
  for (var i = 0; i < allSubscribers.length; i++) {
    tc += allSubscribers[i].totalCost;
    to += allSubscribers[i].overpayment;
    if (allSubscribers[i].status === 'danger') cr++;
  }
  stxt('totalCount', allSubscribers.length);
  stxt('totalCost', mny(tc));
  stxt('totalOverpay', mny(to));
  stxt('totalEconomy', mny(to * 0.7));
  stxt('criticalCount', cr);
}

function updateStatusChart() {
  var el = document.getElementById('statusChart');
  if (!el) return;
  var t = allSubscribers.length || 1;
  var c = { normal: 0, warning: 0, danger: 0 };
  for (var i = 0; i < allSubscribers.length; i++) c[allSubscribers[i].status]++;
  var st2 = [
    { k: 'normal', l: '\u041D\u043E\u0440\u043C\u0430', c: '#68B944' },
    { k: 'warning', l: '\u0412\u043D\u0438\u043C\u0430\u043D\u0438\u0435', c: '#F7941D' },
    { k: 'danger', l: '\u041A\u0440\u0438\u0442\u0438\u0447\u043D\u043E', c: '#D32F2F' }
  ];
  var html = '';
  for (var j = 0; j < st2.length; j++) {
    var p = Math.round(c[st2[j].k] / t * 100);
    html += '<div class="status-row"><div class="status-dot" style="background:' + st2[j].c + '"></div>';
    html += '<div class="status-label">' + st2[j].l + '</div><div class="status-val">' + c[st2[j].k] + '</div></div>';
    html += '<div class="status-bar"><div class="status-fill" style="width:' + p + '%;background:' + st2[j].c + '"></div></div>';
  }
  el.innerHTML = html;
}

function updateRankList() {
  var el = document.getElementById('rankList');
  if (!el) return;
  var sorted = allSubscribers.slice().sort(function(a, b) { return b.totalCost - a.totalCost; }).slice(0, 8);
  var rc = document.getElementById('rankCount');
  if (rc) rc.textContent = allSubscribers.length;
  if (!sorted.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:11px">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>'; return; }
  var html = '';
  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var pc = i < 3 ? 'rank-pos-' + (i + 1) : 'rank-pos-n';
    html += '<div class="rank-item" data-goto="' + s.number + '">';
    html += '<div class="rank-pos ' + pc + '">' + (i + 1) + '</div>';
    html += '<div class="rank-info"><div class="rank-name">' + esc(s.name || s.number) + '</div>';
    if (s.name) html += '<div class="rank-phone">' + s.number + '</div>';
    html += '</div><div class="rank-val">' + mny(s.totalCost) + '</div></div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-goto]').forEach(function(it) {
    it.onclick = function() {
      var card = document.querySelector('.user-card[data-phone="' + it.dataset.goto + '"]');
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(function() { card.classList.remove('flash'); }, 900); }
    };
  });
}

function updateCategoryChart() {
  var el = document.getElementById('categoryChart');
  if (!el) return;
  var tot = { voice: 0, internet: 0, sms: 0 };
  for (var i = 0; i < allSubscribers.length; i++) {
    for (var j = 0; j < allSubscribers[i].categories.length; j++) {
      var c = allSubscribers[i].categories[j];
      tot[c.cat] = (tot[c.cat] || 0) + c.cost;
    }
  }
  var pt = 0;
  for (var k = 0; k < allSubscribers.length; k++) pt += allSubscribers[k].planFee;
  var mx = Math.max(tot.voice, tot.internet, tot.sms, pt, 1);
  var cs = [
    { l: '\u0410\u0431\u043E\u043D\u043F\u043B\u0430\u0442\u0430', i: '\uD83D\uDCB3', c: '#0071CE', v: pt },
    { l: '\u0413\u043E\u043B\u043E\u0441', i: '\uD83D\uDCDE', c: '#0071CE', v: tot.voice },
    { l: '\u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442', i: '\uD83C\uDF10', c: '#68B944', v: tot.internet },
    { l: 'SMS', i: '\u2709\uFE0F', c: '#F7941D', v: tot.sms }
  ];
  var html = '';
  for (var m = 0; m < cs.length; m++) {
    var p = Math.round(cs[m].v / mx * 100);
    html += '<div class="cat-row"><div class="cat-icon">' + cs[m].i + '</div>';
    html += '<div class="cat-info"><div class="cat-name">' + cs[m].l + '</div>';
    html += '<div class="cat-bar"><div class="cat-fill" style="width:' + p + '%;background:' + cs[m].c + '"></div></div></div>';
    html += '<div class="cat-amount" style="color:' + cs[m].c + '">' + mny(cs[m].v) + '</div></div>';
  }
  el.innerHTML = html;
}

function updateTariffChart() {
  var el = document.getElementById('tariffChart');
  if (!el) return;
  var tc = {};
  for (var i = 0; i < allSubscribers.length; i++) {
    var k = allSubscribers[i].tariffName || '\u0414\u0440\u0443\u0433\u043E\u0439';
    tc[k] = (tc[k] || 0) + 1;
  }
  var t = allSubscribers.length || 1;
  var sr = Object.entries(tc).sort(function(a, b) { return b[1] - a[1]; });
  var html = '';
  for (var j = 0; j < sr.length; j++) {
    var p = Math.round(sr[j][1] / t * 100);
    var cl = TARIFF_COLORS[j % TARIFF_COLORS.length];
    html += '<div class="tariff-row"><div class="tariff-color" style="background:' + cl + '"></div>';
    html += '<div class="tariff-info"><div class="tariff-name">' + esc(sr[j][0]) + '</div>';
    html += '<div class="tariff-count">' + sr[j][1] + ' \u0430\u0431\u043E\u043D\u0435\u043D\u0442\u043E\u0432</div>';
    html += '<div class="tariff-bar"><div class="tariff-fill" style="width:' + p + '%;background:' + cl + '"></div></div></div>';
    html += '<div class="tariff-pct" style="color:' + cl + '">' + p + '%</div></div>';
  }
  el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
//  RENDER USERS
// ═══════════════════════════════════════════════════════════════
function renderUsers() {
  var g = document.getElementById('usersGrid');
  var searchEl = document.getElementById('searchInput');
  var s = searchEl ? searchEl.value.trim().toLowerCase() : '';
  var f = [];
  for (var i = 0; i < allSubscribers.length; i++) {
    var x = allSubscribers[i];
    if (s && x.number.indexOf(s) === -1 && x.name.toLowerCase().indexOf(s) === -1) continue;
    if (currentFilter === 'all') { f.push(x); continue; }
    if (currentFilter === 'overpay') { if (x.overpayment > 100) f.push(x); continue; }
    if (currentFilter === 'growing') { if (x.overpayment > 0) f.push(x); continue; }
    if (x.status === currentFilter) f.push(x);
  }
  var dir = sortDirection === 'desc' ? -1 : 1;
  var sorters = {
    overpay: function(a, b) { return a.overpayment - b.overpayment; },
    cost: function(a, b) { return a.totalCost - b.totalCost; },
    risk: function(a, b) { return a.riskScore - b.riskScore; },
    number: function(a, b) { return a.number.localeCompare(b.number); }
  };
  f.sort(function(a, b) { return dir * (sorters[currentSort] || sorters.overpay)(a, b); });
  renderedSubscribers = f;
  if (!f.length) { g.innerHTML = '<div class="empty-state">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>'; return; }
  var html = '';
  for (var j = 0; j < f.length; j++) html += renderCard(f[j]);
  g.innerHTML = html;
  var rc = document.getElementById('resultCount');
  if (rc) rc.textContent = f.length + ' \u0438\u0437 ' + allSubscribers.length;
}

function renderCard(s) {
  var rt = s.status === 'danger' ? '\u041A\u0440\u0438\u0442\u0438\u0447\u043D\u043E' : s.status === 'warning' ? '\u0412\u043D\u0438\u043C\u0430\u043D\u0438\u0435' : '\u041D\u043E\u0440\u043C\u0430';
  var tc = s.trend > 0.5 ? 'up' : s.trend < -0.5 ? 'down' : 'flat';
  var ta = tc === 'up' ? '\u2197' : tc === 'down' ? '\u2198' : '\u2192';
  var t = s.name ? esc(s.name) : '\u0410\u0431\u043E\u043D\u0435\u043D\u0442 ' + s.number;
  var nameLine = s.name ? s.number + ' \u00B7 ' : '';

  var h = '<div class="user-card card-' + s.status + '" data-phone="' + s.number + '">';
  h += '<div class="card-header"><div><div class="user-name">' + t + '</div>';
  h += '<div class="user-sub">' + nameLine + esc(s.planName) + '</div></div>';
  h += '<span class="badge badge-' + s.status + '">' + rt + '</span></div>';

  h += '<div class="cost-row"><div><div class="cost-main">' + mny(s.totalCost) + '</div>';
  h += '<div class="cost-sub">\u0410\u0431\u043E\u043D\u043F\u043B\u0430\u0442\u0430 ' + mny(s.planFee) + ' \u00B7 \u043F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430 <span class="' + (s.overpayment > 0 ? 'txt-danger' : 'txt-good') + '">' + mny(s.overpayment) + '</span></div></div>';
  h += '<span class="trend trend-' + tc + '">' + ta + ' ' + (s.trend > 0 ? '+' : '') + s.trend.toFixed(0) + '%</span></div>';

  h += '<div class="cat-chips">';
  for (var i = 0; i < s.categories.length; i++) h += catChip(s.categories[i]);
  h += '</div>';

  h += '<div class="spark-wrap">' + sparklineSVG(s) + '</div>';

  h += '<div class="card-actions"><button class="act" data-act="details">\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435 \u25BE</button>';
  h += '<button class="act" data-act="limits">\u041B\u0438\u043C\u0438\u0442\u044B \u25BE</button></div>';

  // Details panel
  h += '<div class="panel panel-details"><div class="panel-section"><div class="panel-title">\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u044F</div><ul class="rec-list">';
  for (var j = 0; j < s.recommendation.length; j++) h += '<li>' + esc(s.recommendation[j]) + '</li>';
  h += '</ul><div class="econo">\u042D\u043A\u043E\u043D\u043E\u043C\u0438\u044F: <b>' + mny(s.overpayment * 0.7) + '/\u043C\u0435\u0441</b> \u00B7 \u043F\u0440\u043E\u0433\u043D\u043E\u0437 ' + mny(s.avg * 1.05) + '</div></div>';
  h += '<div class="panel-section"><div class="panel-title">\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430</div><div class="months">' + monthsHistory(s) + '</div></div></div>';

  // Limits panel
  h += '<div class="panel panel-limits"><div class="panel-section"><div class="panel-title">\u041F\u0430\u043A\u0435\u0442\u044B</div><div>';
  for (var k = 0; k < s.categories.length; k++) h += limitRow(s.categories[k]);
  h += '</div><div class="panel-hint">\u0422\u0430\u0440\u0438\u0444 \u00AB' + esc(s.planName) + '\u00BB</div></div></div>';

  h += '</div>';
  return h;
}

function catChip(c) {
  var lvl = c.ratio > 1 ? 'danger' : c.ratio >= 0.8 ? 'warning' : 'good';
  var p = c.limit ? Math.min(100, Math.round(c.ratio * 100)) : 0;
  return '<div class="chip chip-' + lvl + '"><span class="chip-ico">' + c.icon + '</span><span>' + c.label + '</span><span>' + p + '%</span></div>';
}

function limitRow(c) {
  var lvl = c.ratio > 1 ? 'danger' : c.ratio >= 0.8 ? 'warning' : 'good';
  var p = c.limit ? Math.min(100, c.ratio * 100) : 0;
  var pc = c.advice.type === 'raise' ? 'pill-danger' : c.advice.type === 'lower' ? 'pill-accent' : 'pill-good';
  var pl = c.advice.type === 'raise' ? '\u2191 \u043F\u043E\u0432\u044B\u0441\u0438\u0442\u044C' : c.advice.type === 'lower' ? '\u2193 \u043F\u043E\u043D\u0438\u0437\u0438\u0442\u044C' : '\u2713 \u043E\u043A';
  var u = c.cat === 'internet' ? fmtUsed(c) : Math.round(c.used);
  var h = '<div class="limit-row"><div class="limit-head">';
  h += '<span>' + c.icon + '</span><span class="limit-name">' + c.label + '</span>';
  h += '<span class="limit-val">' + u + ' / ' + c.limit + ' ' + c.unit + '</span>';
  h += '<span class="pill ' + pc + '">' + pl + '</span></div>';
  h += '<div class="bar bar-lg' + (p > 100 ? ' bar-over' : '') + '"><div class="bar-fill fill-' + lvl + '" style="width:' + Math.min(100, p) + '%"></div></div>';
  h += '<div class="limit-advice">' + esc(c.advice.text) + '</div></div>';
  return h;
}

function monthsHistory(s) {
  var lb = getMoLb(HISTORY_MONTHS);
  var h = '';
  for (var i = 0; i < s.monthly.length; i++) {
    var r = i === s.monthly.length - 1;
    h += '<span class="m-item' + (r ? ' m-real' : '') + '"><b>' + mny(s.monthly[i]) + '</b> <em>' + lb[i] + '</em></span>';
  }
  return h;
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('.act');
  if (!btn) return;
  var c = btn.closest('.user-card');
  var w = btn.dataset.act === 'limits' ? 'panel-limits' : 'panel-details';
  var o = c.classList.toggle('open-' + btn.dataset.act);
  var panel = c.querySelector('.' + w);
  if (panel) panel.classList.toggle('show', o);
  btn.textContent = btn.textContent.replace(o ? '\u25BE' : '\u25B4', o ? '\u25B4' : '\u25BE');
});

// ═══════════════════════════════════════════════════════════════
//  SPARKLINE + BIG CHART
// ═══════════════════════════════════════════════════════════════
function sparklineSVG(s) {
  var data = s.monthly;
  var W = 280, H = 70, pL = 4, pR = 4, pT = 8, pB = 14;
  var cW = W - pL - pR, cH = H - pT - pB;
  var mx = Math.max.apply(null, data.concat([s.planFee, 1])) * 1.18;
  var xFn = function(i) { return pL + (i / (data.length - 1)) * cW; };
  var yFn = function(v) { return pT + cH - (v / mx) * cH; };
  var lb = getMoLb(data.length);
  var pts = [];
  for (var i = 0; i < data.length; i++) pts.push(xFn(i).toFixed(1) + ',' + yFn(data[i]).toFixed(1));
  var areaD = 'M' + xFn(0).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' L' + pts.join(' L') + ' L' + xFn(data.length - 1).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' Z';
  var ly = yFn(s.planFee).toFixed(1);
  var dots = '';
  for (var j = 0; j < data.length; j++) {
    var real = j === data.length - 1;
    dots += '<circle cx="' + xFn(j).toFixed(1) + '" cy="' + yFn(data[j]).toFixed(1) + '" r="' + (real ? 2.5 : 1.5) + '" class="' + (real ? 'spark-dot-real' : 'spark-dot') + '"/>';
  }
  var xl = '';
  for (var k = 0; k < lb.length; k++) {
    xl += '<text x="' + xFn(k).toFixed(1) + '" y="' + (H - 2) + '" class="spark-xlabel">' + lb[k] + '</text>';
  }
  var limitLine = s.planFee > 0 ? '<line x1="' + pL + '" y1="' + ly + '" x2="' + (W - pR) + '" y2="' + ly + '" class="spark-limit"/>' : '';
  return '<svg width="' + W + '" height="' + H + '" class="spark"><path d="' + areaD + '" class="spark-area"/><polyline points="' + pts.join(' ') + '" class="spark-line"/>' + limitLine + dots + xl + '</svg>';
}

function drawBigChart() {
  var h = document.getElementById('bigChart');
  if (!h || !renderedSubscribers.length) { if (h) h.innerHTML = '<div style="color:var(--text-muted);font-size:12px">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>'; return; }
  var mo = getMoLb(HISTORY_MONTHS);
  var tot = [];
  for (var i = 0; i < HISTORY_MONTHS; i++) tot.push(0);
  for (var j = 0; j < renderedSubscribers.length; j++) {
    for (var k = 0; k < renderedSubscribers[j].monthly.length; k++) tot[k] += renderedSubscribers[j].monthly[k];
  }
  var W = 750, H = 240, pL = 60, pR = 16, pT = 20, pB = 30;
  var cW = W - pL - pR, cH = H - pT - pB;
  var mx = Math.max.apply(null, tot.concat([1])) * 1.12;
  var xFn = function(i) { return pL + (i / (tot.length - 1)) * cW; };
  var yFn = function(v) { return pT + cH - (v / mx) * cH; };

  var gr = '';
  for (var g = 0; g <= 4; g++) {
    var gy = pT + (g / 4) * cH;
    var val = mx * (1 - g / 4);
    gr += '<line x1="' + pL + '" y1="' + gy + '" x2="' + (W - pR) + '" y2="' + gy + '" class="grid"/>';
    gr += '<text x="' + (pL - 8) + '" y="' + (gy + 3) + '" text-anchor="end" class="axis-label">' + Math.round(val).toLocaleString('ru-RU') + '</text>';
  }
  var pts = [];
  for (var p = 0; p < tot.length; p++) pts.push(xFn(p).toFixed(1) + ',' + yFn(tot[p]).toFixed(1));
  var ar = 'M' + xFn(0).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' L' + pts.join(' L') + ' L' + xFn(tot.length - 1).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' Z';
  var dots = '';
  for (var d = 0; d < tot.length; d++) dots += '<circle cx="' + xFn(d).toFixed(1) + '" cy="' + yFn(tot[d]).toFixed(1) + '" r="4" class="big-dot"/>';
  var xl = '';
  for (var x = 0; x < mo.length; x++) xl += '<text x="' + xFn(x).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis-label">' + mo[x] + '</text>';
  var vl = '';
  for (var v = 0; v < tot.length; v++) vl += '<text x="' + xFn(v).toFixed(1) + '" y="' + (yFn(tot[v]) - 8) + '" text-anchor="middle" class="big-vlabel">' + mny(tot[v]) + '</text>';

  h.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="big-svg">' + gr + '<path d="' + ar + '" class="big-area"/><polyline points="' + pts.join(' ') + '" class="big-line"/>' + dots + vl + xl + '</svg>';
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function mny(v) { return (Math.round(v) || 0).toLocaleString('ru-RU') + ' \u20BD'; }
function fmtUsed(c) { return c.cat === 'internet' ? c.used.toFixed(c.used < 10 ? 1 : 0) : Math.round(c.used); }
function esc(s) { return String(s).replace(/[&<>"']/g, function(ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
function getMoLb(n) {
  var now = new Date(), lb = [];
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    lb.push(MONTH_NAMES[d.getMonth()]);
  }
  return lb;
}
function stxt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
function showLoading(t, p) {
  var l = document.getElementById('loading'); if (l) l.style.display = 'flex';
  var lt = document.getElementById('loadingText'); if (lt) lt.textContent = t;
  var pf = document.getElementById('progressFill'); if (pf) pf.style.width = p + '%';
}
function hideLoading() { var l = document.getElementById('loading'); if (l) l.style.display = 'none'; }
function flashHint(t) { var h = document.getElementById('hint'); if (h) { h.textContent = t; h.classList.add('show'); setTimeout(function() { h.classList.remove('show'); }, 3000); } }

// ═══════════════════════════════════════════════════════════════
//  DEMO
// ═══════════════════════════════════════════════════════════════
var DEMO_PLANS = [
  { fee: 140, name: '\u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442. \u0411\u0435\u0437 \u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442 04.23', minutes: 700, sms: 300, internet_mb: 15000 },
  { fee: 230, name: '\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u0439! \u0421\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442 +', minutes: 1500, sms: 500, internet_mb: 25000 },
  { fee: 400, name: '\u0424\u0435\u0434\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439 \u0421\u043F\u0435\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 B2B', minutes: 4000, sms: 1000, internet_mb: 70000 }
];

function loadDemoData() {
  showLoading('\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F\u2026', 30);
  var rd = {};
  for (var i = 0; i < 50; i++) {
    var ph = gPh();
    var pl = DEMO_PLANS[Math.floor(Math.random() * DEMO_PLANS.length)];
    var items = [];

    function addItem(key, cat, vol, unit, cost) {
      items.push({ key: key, category: cat, rawVolume: vol + ' ' + unit, volume: vol, unit: unit, withDiscount: cost, noDiscount: cost });
    }

    var om = Math.floor(Math.random() * 500);
    if (om) addItem('home_outgoing_calls', 'voice', om, '\u043C\u0438\u043D', 0);
    addItem('home_incoming_calls', 'voice', Math.floor(Math.random() * 600) + 50, '\u043C\u0438\u043D', 0);
    var on = Math.floor(Math.random() * 300);
    if (on) addItem('home_onnet_calls', 'voice', on, '\u043C\u0438\u043D', 0);
    var ot = Math.floor(Math.random() * 100);
    if (ot) addItem('home_other_operators', 'voice', ot, '\u043C\u0438\u043D', +(ot * 0.18).toFixed(2));
    var ic = Math.floor(Math.random() * 80);
    if (ic) addItem('home_intercity_calls', 'voice', ic, '\u043C\u0438\u043D', +(ic * 0.25).toFixed(2));
    var mb = +(Math.random() * 50000).toFixed(2);
    addItem('home_mobile_internet', 'internet', mb, '\u041C\u0431\u0430\u0439\u0442', +(Math.max(0, mb - 5000) * 0.0001).toFixed(2));
    var ins = Math.floor(Math.random() * 200);
    if (ins) addItem('home_incoming_sms', 'sms', ins, '\u0448\u0442', 0);
    var ons = Math.floor(Math.random() * 60);
    if (ons) addItem('home_sms', 'sms', ons, '\u0448\u0442', +(ons * 0.05).toFixed(2));
    if (Math.random() < 0.3) addItem('employee_protection_fee', 'other', 1, '', 90);
    if (Math.random() < 0.15) { var t1 = Math.floor(Math.random() * 40) + 1; addItem('travel_outgoing_calls', 'voice', t1, '\u043C\u0438\u043D', +(t1 * 0.18).toFixed(2)); }
    if (Math.random() < 0.1) { var t2 = Math.floor(Math.random() * 20) + 1; addItem('travel_sms', 'sms', t2, '\u0448\u0442', +(t2 * 0.1).toFixed(2)); }

    rd[ph] = { items: items, planFee: pl.fee, planName: pl.name };
  }
  currentFilter = 'all';
  currentSort = 'overpay';
  sortDirection = 'desc';
  buildReportFromData(rd);
}

function gPh() {
  var prefixes = [900,901,902,903,904,905,906,908,909,910,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927,928,929,930,950,951,952,953];
  var pr = prefixes[Math.floor(Math.random() * prefixes.length)];
  var r = '';
  for (var i = 0; i < 7; i++) r += Math.floor(Math.random() * 10);
  return pr + r;
}
