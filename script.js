'use strict';

// ═══════════════════════════════════════════════════════════════
//  SERVICE MAP
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
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043C\u0435\u0436\u0434\u0443\u0433\u043E\u0440\u043E\u0434\u043D\u044B\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_intercity_calls',
  '\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_mobile_internet',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_sms',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_incoming_calls',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u0434\u043E\u043C\u0430\u0448\u043D\u0435\u043C \u0440\u0435\u0433\u0438\u043E\u043D\u0435': 'home_incoming_sms',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_incoming_calls',
  '\u0432\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_incoming_sms',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_outgoing_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043C\u0435\u0436\u0434\u0443\u0433\u043E\u0440\u043E\u0434\u043D\u044B\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_intercity_calls',
  '\u0438\u0441\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_sms',
  '\u043C\u043E\u0431\u0438\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0432 \u043F\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u044F\u0445 \u043F\u043E \u0420\u043E\u0441\u0441\u0438\u0438': 'travel_mobile_internet',
  '\u0438\u0442\u043E\u0433\u043E \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E': 'total_charged',
  '\u0432 \u0442.\u0447. \u043D\u0434\u0441': 'vat_included',
  '\u0432 \u0442\u043E\u043C \u0447\u0438\u0441\u043B\u0435 \u043D\u0434\u0441 (22%)': 'vat_included',
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
  '\u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0437\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0443 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439 \u0432 \u043D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u043C \u0440\u043E\u0443\u043C\u0438\u043D\u0433\u0435': 'national_roaming_messages'
};

var META_KEYS = new Set(['subscriber_number','tariff_plan','total_charged','vat_included']);

// Категория услуги: v=голос, i=интернет, s=sms, o=прочее
var CAT_OF = {
  home_outgoing_calls:'v', home_other_operators:'v', home_onnet_calls:'v',
  home_intercity_calls:'v', home_incoming_calls:'v',
  travel_outgoing_calls:'v', travel_intercity_calls:'v',
  travel_onnet_russia_calls:'v', travel_other_operators:'v', mass_calls:'v',
  international_calls:'v', international_roaming_russia_calls:'v',
  international_roaming_local_calls:'v', friend_call:'v',
  voicemail:'v', auto_answer:'v', call_hold:'v',
  calls_intl_roaming:'v', outgoing_calls_intl_roaming:'v',
  home_mobile_internet:'i', travel_mobile_internet:'i', national_roaming_internet:'i',
  home_sms:'s', home_incoming_sms:'s',
  travel_sms:'s', travel_incoming_sms:'s',
  multimedia_messages:'s', international_roaming_sms:'s',
  national_roaming_messages:'s', voice_sms:'s', incoming_sms_intl_roaming:'s'
};

// Исходящий трафик — только исходящие вызовы, сообщения, интернет
// Входящие НЕ считаются в минутах/ГБ/шт
var OUTGOING_KEYS = new Set([
  'home_outgoing_calls', 'home_other_operators', 'home_onnet_calls',
  'home_intercity_calls', 'travel_outgoing_calls', 'travel_intercity_calls',
  'travel_onnet_russia_calls', 'travel_other_operators', 'mass_calls',
  'international_calls', 'international_roaming_russia_calls',
  'international_roaming_local_calls', 'friend_call',
  'calls_intl_roaming', 'outgoing_calls_intl_roaming',
  'home_mobile_internet', 'travel_mobile_internet', 'national_roaming_internet',
  'home_sms', 'travel_sms', 'multimedia_messages',
  'international_roaming_sms', 'national_roaming_messages', 'voice_sms'
]);

var TARIFFS = {
  "140": {minutes:700, sms:300, mb:15000, name:'\u0411\u0435\u0437 \u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442'},
  "230": {minutes:1500, sms:500, mb:25000, name:'\u0421\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442'},
  "400": {minutes:4000, sms:1000, mb:70000, name:'\u0424\u0435\u0434\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439'}
};
var DEF_TARIFF = {minutes:500, sms:200, mb:5000, name:'\u0414\u0440\u0443\u0433\u043E\u0439'};

var CAT_META = {
  v:{label:'\u041C\u0438\u043D\u0443\u0442\u044B', unit:'\u043C\u0438\u043D', icon:'\uD83D\uDCDE', ck:'minutes'},
  i:{label:'\u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442', unit:'\u041C\u0411', icon:'\uD83C\uDF10', ck:'mb'},
  s:{label:'SMS', unit:'\u0448\u0442', icon:'\u2709\uFE0F', ck:'sms'}
};

var MONTHS = ['\u042F\u043D\u0432','\u0424\u0435\u0432','\u041C\u0430\u0440','\u0410\u043F\u0440','\u041C\u0430\u0439','\u0418\u044E\u043D','\u0418\u044E\u043B','\u0410\u0432\u0433','\u0421\u0435\u043D','\u041E\u043A\u0442','\u041D\u043E\u044F','\u0414\u0435\u043A'];
var HIST = 6;
var allSubs = [], rendered = [], names = {};
var curF = 'all', curS = 'overpay', sortD = 'desc';

// ═══════ INIT ═══════
document.addEventListener('DOMContentLoaded', function() {
  var $ = function(id) { return document.getElementById(id); };
  if ($('workersBtn')) $('workersBtn').onclick = function() { $('workersFile').click(); };
  if ($('workersFile')) $('workersFile').onchange = function(e) { if (e.target.files[0]) loadWorkers(e.target.files[0]); };
  if ($('billsBtn')) $('billsBtn').onclick = function() { $('billsFile').click(); };
  if ($('billsFile')) $('billsFile').onchange = function(e) { if (e.target.files[0]) uploadCSV(e.target.files[0]); };
  if ($('demoBtn')) $('demoBtn').onclick = loadDemoData;
  if ($('searchInput')) $('searchInput').oninput = renderUsers;
  if ($('dynBtn')) {
    $('dynBtn').onclick = function() {
      var p = $('dynPanel'); if (!p) return;
      var open = p.classList.toggle('open');
      $('dynBtn').classList.toggle('open', open);
      var chev = $('dynBtn').querySelector('.chev');
      if (chev) chev.textContent = open ? '\u25BC' : '\u25B6';
      if (open) drawBigChart(false);
    };
  }
  if ($('dynPanel')) $('dynPanel').onclick = function() { drawBigChart(true); };
  if ($('themeBtn')) {
    $('themeBtn').onclick = function() {
      var r = document.documentElement;
      var dk = r.getAttribute('data-theme') === 'dark' || (!r.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches);
      r.setAttribute('data-theme', dk ? 'light' : 'dark');
      localStorage.setItem('theme', dk ? 'light' : 'dark');
    };
    var sv = localStorage.getItem('theme');
    if (sv) document.documentElement.setAttribute('data-theme', sv);
  }
  document.querySelectorAll('.f').forEach(function(b) {
    b.onclick = function() {
      document.querySelectorAll('.f').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active'); curF = b.dataset.filter; renderUsers();
    };
  });
  document.querySelectorAll('.s').forEach(function(b) {
    if (b.dataset.sort === curS) b.classList.add('active');
    b.onclick = function() {
      if (curS === b.dataset.sort) sortD = sortD === 'desc' ? 'asc' : 'desc';
      else { curS = b.dataset.sort; sortD = 'desc'; }
      document.querySelectorAll('.s').forEach(function(x) { x.classList.remove('active'); });
      b.classList.add('active'); renderUsers();
    };
  });
  if ($('gridView') && $('tableView')) {
    $('gridView').onclick = function() { setView('grid'); };
    $('tableView').onclick = function() { setView('table'); };
  }
  if ($('settingsBtn')) $('settingsBtn').onclick = function() { $('settingsPanel').classList.toggle('show'); };
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.stoggle') && !e.target.closest('.spanel')) { var sp = $('settingsPanel'); if (sp) sp.classList.remove('show'); }
  });
  var pMap = {togKpi:'kpiRow',togRisk:'riskCard',togTop:'topCard',togDyn:'dynBtn',togCards:'usersGrid'};
  Object.keys(pMap).forEach(function(id) {
    var cb = $(id); if (!cb) return;
    cb.onchange = function() {
      var el = $(pMap[id]); if (!el) return;
      el.style.display = cb.checked ? '' : 'none';
    };
  });
  window.addEventListener('resize', function() { var p = $('dynPanel'); if (p && p.classList.contains('open')) drawBigChart(false); });
});

// ═══════ UPLOAD ═══════
function uploadCSV(file) {
  showLoad('\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430\u2026', 10);
  var fd = new FormData(); fd.append('file', file);
  fetch('/api/upload-csv', {method:'POST', body:fd})
    .then(function(r) { return r.ok ? r.json() : r.json().then(function(e) { throw new Error(e.error); }); })
    .then(function(d) { showLoad('\u0410\u043D\u0430\u043B\u0438\u0437\u2026', 60); curF='all';curS='overpay';sortD='desc'; processServer(d); })
    .catch(function(e) { showLoad('\u041E\u0448\u0438\u0431\u043A\u0430: '+e.message, 100); setTimeout(hideLoad, 3000); });
}

function processServer(data) {
  showLoad('\u041F\u043E\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0435\u2026', 80);
  var rd = {};
  var entries = Object.entries(data.subscribers);
  for (var i = 0; i < entries.length; i++) {
    var num = entries[i][0], sub = entries[i][1], items = [], pf = sub.planFee || 0;
    for (var j = 0; j < sub.items.length; j++) {
      var it = sub.items[j], k = mkey(it.serviceName);
      if (!k) continue;
      if (k === 'plan_fee') { pf += it.withDiscount; continue; }
      if (META_KEYS.has(k)) continue;
      items.push({key:k, cat:CAT_OF[k]||'o', rawVol:it.rawVolume, vol:it.volume, unit:it.unit,
        noD:it.noDiscount, disc:it.discount, withD:it.withDiscount, name:it.serviceName});
    }
    rd[num] = {items:items, planFee:pf, planName:sub.planName||'\u0422\u0430\u0440\u0438\u0444 '+Math.round(pf)+'\u20BD'};
  }
  buildReport(rd);
}

function mkey(n) { var lo = n.toLowerCase(); var ks = Object.keys(SERVICE_MAP); for (var i=0;i<ks.length;i++) { if (lo.indexOf(ks[i])!==-1) return SERVICE_MAP[ks[i]]; } return null; }

function setView(m) {
  document.querySelectorAll('.vw').forEach(function(b){b.classList.remove('active');});
  var btn = document.getElementById(m==='table'?'tableView':'gridView');
  if (btn) btn.classList.add('active');
  var g = document.getElementById('usersGrid');
  if (g) g.classList.toggle('table-view', m==='table');
  renderUsers();
}

function loadWorkers(file) {
  var r = new FileReader();
  r.onload = function(e) { names = pw(e.target.result); flashHint('\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438: '+Object.keys(names).length); };
  r.readAsText(file, 'windows-1251');
}
function pw(t) {
  var m = {}, lines = t.split(/\r?\n/);
  for (var i=0;i<lines.length;i++) { var l=lines[i].trim(); if(!l)continue; var d=l.match(/\d{10,}/); if(!d)continue; var n=d[0].slice(-10); var ps=l.split(/[;,\t]/); for(var j=0;j<ps.length;j++){var p=ps[j].trim();if(p&&!/^\+?\d[\d\s()-]{6,}$/.test(p)){m[n]=p;break;}} }
  return m;
}

// ═══════ BUILD REPORT ═══════
function buildReport(rd) {
  showLoad('\u0410\u043D\u0430\u043B\u0438\u0437\u2026', 70);
  allSubs = [];
  var entries = Object.entries(rd);
  for (var i=0;i<entries.length;i++) allSubs.push(buildRec(entries[i][0], entries[i][1]));
  showLoad('\u0413\u043E\u0442\u043E\u0432\u043E', 100);
  var ws = document.getElementById('welcomeSection'); if(ws) ws.style.display='none';
  var dt = document.getElementById('dashTop'); if(dt) dt.style.display='';
  var fp = document.getElementById('filtersPanel'); if(fp) fp.style.display='flex';
  updateKPIs(); updateRisk(); updateTopList();
  setTimeout(function(){hideLoad();renderUsers();},350);
}

function buildRec(num, data) {
  var pf = data.planFee, pfi = Math.round(pf);
  var tr = TARIFFS[String(pfi)] || DEF_TARIFF;

  var ec = 0;
  var cats = {v:{cost:0,used:0}, i:{cost:0,used:0}, s:{cost:0,used:0}, o:{cost:0}};

  for (var i=0; i<data.items.length; i++) {
    var it = data.items[i];
    ec += it.withDiscount;
    var cat = it.cat;
    if (!cats[cat]) cats[cat] = {cost:0, used:0};
    cats[cat].cost += it.withDiscount;

    // Считаем исходящий трафик (минуты/ГБ/шт) ТОЛЬКО для исходящих услуг
    if (OUTGOING_KEYS.has(it.key)) {
      if (cat === 'v' && it.unit === '\u043C\u0438\u043D') cats.v.used += it.vol;
      else if (cat === 'i') cats.i.used += it.vol;
      else if (cat === 's' && it.unit === '\u0448\u0442') cats.s.used += it.vol;
    }
  }

  var tc = pf + ec, op = ec;
  var cats2 = ['v','i','s'].map(function(c) {
    var m = CAT_META[c], lim = tr[m.ck] || 0;
    return {cat:c, label:m.label, unit:m.unit, icon:m.icon, cost:cats[c].cost, used:cats[c].used, limit:lim};
  });

  var ou = 0;
  for (var j=0; j<cats2.length; j++) if (cats2[j].cost > cats2[j].limit * 0.8) ou++;
  var opr = pf > 0 ? op/pf : (op > 0 ? 1 : 0);
  var st = 'normal';
  if (op > 50) st = 'danger';
  else if (op > 1) st = 'warning';
  var rs = Math.max(0, Math.min(100, Math.round(opr * 100 + ou * 15)));

  var rnd = sRand(num), mo = [];
  for (var m = 0; m < HIST-1; m++) mo.push(tc * (0.82 + rnd() * 0.36));
  mo.push(tc);
  var avg = 0;
  for (var a = 0; a < mo.length; a++) avg += mo[a];
  avg /= mo.length;
  var pv = mo[mo.length - 2];
  var tr2 = pv > 0 ? ((tc - pv) / pv) * 100 : 0;

  return {
    number: num,
    name: names[num] || '',
    planName: data.planName || '\u0422\u0430\u0440\u0438\u0444 ' + pfi + '\u20BD',
    totalCost: tc, planFee: pf, overpayment: op,
    categories: cats2, overuse: ou, status: st, riskScore: rs,
    recommendation: buildRec2(st, op, cats2),
    monthly: mo, avg: avg, trend: tr2, tariffName: tr.name
  };
}

function buildRec2(s, op, cats) {
  var p = [];
  if (s === 'danger') p.push('\u041A\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0443\u0440\u043E\u0432\u0435\u043D\u044C: \u043F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430 ' + mny(op));
  else if (s === 'warning') p.push('\u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430 ' + mny(op));
  var raise = [], lower = [];
  for (var i=0; i<cats.length; i++) {
    if (cats[i].limit > 0 && cats[i].cost > cats[i].limit * 0.8) raise.push(cats[i].label.toLowerCase());
    if (cats[i].limit > 0 && cats[i].cost < cats[i].limit * 0.2) lower.push(cats[i].label.toLowerCase());
  }
  if (raise.length) p.push('\u041F\u043E\u0432\u044B\u0441\u0438\u0442\u044C \u043B\u0438\u043C\u0438\u0442: ' + raise.join(', '));
  if (lower.length) p.push('\u041F\u043E\u043D\u0438\u0437\u0438\u0442\u044C \u043B\u0438\u043C\u0438\u0442: ' + lower.join(', '));
  if (!p.length) p.push('\u0422\u0430\u0440\u0438\u0444 \u043F\u043E\u0434\u043E\u0431\u0440\u0430\u043D \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E');
  return p;
}

function sRand(s) {
  var h = 1779033703 ^ s.length;
  for (var i=0; i<s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h<<13)|(h>>>19); }
  var a = h >>> 0;
  return function() { a|=0; a=(a+0x6D2B79F5)|0; var t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
}

// ═══════ KPI + RISK + TOP ═══════
function updateKPIs() {
  var tc=0, to=0, cr=0;
  for (var i=0; i<allSubs.length; i++) { tc+=allSubs[i].totalCost; to+=allSubs[i].overpayment; if(allSubs[i].status==='danger') cr++; }
  var el = document.getElementById('kpiRow');
  if (!el) return;
  el.innerHTML =
    kpiCard('\uD83D\uDC65','\u0410\u0431\u043E\u043D\u0435\u043D\u0442\u043E\u0432',allSubs.length)+
    kpiCard('\uD83D\uDCB3','\u0418\u0442\u043E\u0433\u043E',mny(tc))+
    kpiCard('\uD83D\uDCC8','\u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430',mny(to))+
    kpiCard('\uD83D\uDCB0','\u042D\u043A\u043E\u043D\u043E\u043C\u0438\u044F',mny(to*0.7))+
    kpiCard('\u26A0\uFE0F','\u041A\u0440\u0438\u0442\u0438\u0447\u043D\u044B\u0445',cr);
}
function kpiCard(ico,label,val) {
  return '<div class="kpi"><div class="kpi-ico">'+ico+'</div><div><div class="kpi-lb">'+label+'</div><div class="kpi-val">'+val+'</div></div></div>';
}

function updateRisk() {
  var cr = 0;
  for (var i=0; i<allSubs.length; i++) if (allSubs[i].status === 'danger') cr++;
  var pct = allSubs.length ? Math.round((cr / allSubs.length) * 100) : 0;
  var riskVal = Math.min(100, Math.round(pct * 1.5));
  var color = riskVal >= 60 ? '#D32F2F' : riskVal >= 30 ? '#F7941D' : '#198754';
  var label = riskVal >= 60 ? '\u0412\u044B\u0441\u043E\u043A\u0438\u0439' : riskVal >= 30 ? '\u0421\u0440\u0435\u0434\u043D\u0438\u0439' : '\u041D\u0438\u0437\u043A\u0438\u0439';

  var r2 = 40, cx = 50, cy = 50;
  var startA = Math.PI * 0.8, endA = Math.PI * 2.2;
  var range = endA - startA;
  var valA = startA + range * (riskVal / 100);
  function arc(a) { return (cx + r2 * Math.cos(a)).toFixed(1) + ',' + (cy + r2 * Math.sin(a)).toFixed(1); }
  var bg = 'M' + arc(startA) + ' A' + r2 + ' ' + r2 + ' 0 1 1 ' + arc(endA);
  var fg = 'M' + arc(startA) + ' A' + r2 + ' ' + r2 + ' 0 ' + (riskVal > 50 ? 1 : 0) + ' 1 ' + arc(valA);

  var el = document.getElementById('riskCard');
  if (!el) return;
  el.innerHTML = '<div class="risk-title">\u0418\u043D\u0434\u0435\u043A\u0441 \u0440\u0438\u0441\u043A\u0430</div>' +
    '<div class="risk-gauge"><svg viewBox="0 0 100 70" width="120" height="84">' +
    '<path d="' + bg + '" fill="none" stroke="#edf1ef" stroke-width="8" stroke-linecap="round"/>' +
    '<path d="' + fg + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>' +
    '</svg><div class="risk-num" style="color:' + color + '">' + riskVal + '</div></div>' +
    '<div class="risk-label">' + label + '</div>';
}

function updateTopList() {
  var sorted = allSubs.slice().sort(function(a,b){return b.totalCost-a.totalCost;}).slice(0,5);
  var rc = document.getElementById('topCount'); if(rc) rc.textContent = allSubs.length;
  var el = document.getElementById('topList');
  if (!el) return;
  if (!sorted.length) { el.innerHTML = '<div style="color:var(--muted);font-size:10px">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>'; return; }
  var h = '';
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i], pc = i < 3 ? 'top-pos-' + (i+1) : 'top-pos-n';
    h += '<div class="top-item" data-goto="' + s.number + '"><div class="top-pos ' + pc + '">' + (i+1) + '</div>';
    h += '<div style="flex:1;min-width:0"><div class="top-nm">' + esc(s.name || s.number) + '</div>';
    if (s.name) h += '<div class="top-ph">' + s.number + '</div>';
    h += '</div><div class="top-val">' + mny(s.totalCost) + '</div></div>';
  }
  el.innerHTML = h;
  el.querySelectorAll('[data-goto]').forEach(function(it) {
    it.onclick = function() {
      var c = document.querySelector('.ucard[data-phone="' + it.dataset.goto + '"]');
      if (c) { c.scrollIntoView({behavior:'smooth',block:'center'}); c.classList.add('flash'); setTimeout(function(){c.classList.remove('flash');},900); }
    };
  });
}

// ═══════ RENDER USERS ═══════
function renderUsers() {
  var g = document.getElementById('usersGrid');
  var sr = document.getElementById('searchInput') ? document.getElementById('searchInput').value.trim().toLowerCase() : '';
  var f = [];
  for (var i=0; i<allSubs.length; i++) {
    var x = allSubs[i];
    if (sr && x.number.indexOf(sr) === -1 && x.name.toLowerCase().indexOf(sr) === -1) continue;
    if (curF === 'all') { f.push(x); continue; }
    if (curF === 'overpay') { if (x.overpayment > 100) f.push(x); continue; }
    if (curF === 'growing') { if (x.overpayment > 0) f.push(x); continue; }
    if (x.status === curF) f.push(x);
  }
  var dir = sortD === 'desc' ? -1 : 1;
  var sk = {overpay:function(a,b){return a.overpayment-b.overpayment;},cost:function(a,b){return a.totalCost-b.totalCost;},risk:function(a,b){return a.riskScore-b.riskScore;}};
  f.sort(function(a,b){return dir*(sk[curS]||sk.overpay)(a,b);});
  rendered = f;
  if (!f.length) { g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>'; return; }
  var h = '';
  for (var j=0; j<f.length; j++) h += renderCard(f[j]);
  g.innerHTML = h;
  var rc = document.getElementById('resultCount'); if(rc) rc.textContent = f.length + ' \u0438\u0437 ' + allSubs.length;
}

function renderCard(s) {
  var t = s.name ? esc(s.name) : '\u0410\u0431\u043E\u043D\u0435\u043D\u0442 ' + s.number;
  var nm = s.name ? s.number + ' \u00B7 ' : '';

  var h = '<div class="ucard s-' + s.status + '" data-phone="' + s.number + '">';

  // Шапка: стоимость + статус
  h += '<div class="u-cost"><div><div class="u-main">' + mny(s.totalCost) + '</div>';
  h += '<div class="u-sub2">\u0410\u0431\u043E\u043D\u043F\u043B\u0430\u0442\u0430 ' + mny(s.planFee) + ' \u2014 \u043F\u0435\u0440\u0435\u043F\u043B\u0430\u0442\u0430 <span class="over ' + (s.overpayment > 0 ? 'neg' : 'pos') + '">' + mny(s.overpayment) + '</span></div></div>';
  var badge = s.status === 'danger' ? '\u041F\u043E\u0432\u044B\u0441\u0438\u0442\u044C \u043B\u0438\u043C\u0438\u0442' : s.status === 'warning' ? '\u0412 \u0437\u043E\u043D\u0435 \u0440\u0438\u0441\u043A\u0430' : '\u041B\u0438\u043C\u0438\u0442 \u043E\u043A';
  h += '<span class="badge badge-' + s.status + '">' + badge + '</span></div>';

  // Имя и тариф
  h += '<div style="margin-bottom:8px"><div class="u-name">' + t + '</div><div class="u-sub">' + nm + esc(s.planName) + '</div></div>';

  // Контейнеры: Минуты, Интернет, SMS (исходящий трафик + стоимость)
  h += '<div class="u-cats">';
  for (var i=0; i<s.categories.length; i++) {
    var c = s.categories[i];
    var cl = c.cost > c.limit * 0.8 ? 'd' : c.cost > c.limit * 0.5 ? 'w' : 'g';
    var volStr = fmtVol(c);
    h += '<div class="chip chip-' + cl + '">';
    h += '<span class="chip-ico">' + c.icon + '</span>';
    h += '<span>' + volStr + '</span>';
    h += '<span>' + mny(c.cost) + '</span>';
    h += '</div>';
  }
  h += '</div>';

  // Рекомендация (сразу под контейнерами, как на screen2)
  h += '<div class="u-rec">';
  for (var j=0; j<s.recommendation.length; j++) h += '<div class="u-rec-item">' + esc(s.recommendation[j]) + '</div>';
  h += '</div>';

  // Кнопки раскрытия
  h += '<div class="u-acts">';
  h += '<button class="act" data-act="details">\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435 \u25BE</button>';
  h += '<button class="act" data-act="limits">\u0414\u0435\u0442\u0430\u043B\u044C\u043D\u043E \u043F\u043E \u043B\u0438\u043C\u0438\u0442\u0430\u043C \u25BE</button>';
  h += '</div>';

  // Панель "Подробнее": крупнейшие начисления + динамика
  h += '<div class="panel panel-details">';

  // Крупнейшие начисления
  h += '<div class="p-title">\u041A\u0440\u0443\u043F\u043D\u0435\u0439\u0448\u0438\u0435 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F</div>';
  h += '<div class="charges-list">';
  // Сортируем категории по убыванию стоимости
  var sortedCats = s.categories.slice().sort(function(a,b){return b.cost - a.cost;});
  for (var k=0; k<sortedCats.length; k++) {
    var cc = sortedCats[k];
    if (cc.cost <= 0) continue;
    h += '<div class="charge-row">';
    h += '<span>' + cc.icon + ' ' + cc.label + '</span>';
    h += '<span class="charge-amt">' + mny(cc.cost) + '</span>';
    h += '</div>';
  }
  h += '</div>';

  // Динамика расхода ( мини-график )
  h += '<div class="p-title" style="margin-top:10px">\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430 \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432</div>';
  h += '<div class="months">' + moH(s) + '</div>';

  // Прогноз
  h += '<div class="econo" style="margin-top:6px">\u042D\u043A\u043E\u043D\u043E\u043C\u0438\u044F: <b>' + mny(s.overpayment * 0.7) + '/\u043C\u0435\u0441</b> \u00B7 \u043F\u0440\u043E\u0433\u043D\u043E\u0437 \u0441\u043B\u0435\u0434. \u043C\u0435\u0441. ' + mny(s.avg * 1.05) + '</div>';
  h += '</div>';

  // Панель "Детально по лимитам"
  h += '<div class="panel panel-limits">';
  h += '<div class="p-title">\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u043E\u0442\u043D\u043E\u0441\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u043B\u0438\u043C\u0438\u0442\u0430</div>';

  // Общий прогресс-бар
  var totalLimit = 0, totalCost2 = 0;
  for (var m=0; m<s.categories.length; m++) { totalLimit += s.categories[m].limit; totalCost2 += s.categories[m].cost; }
  var totalPct = totalLimit > 0 ? Math.min(100, (totalCost2 / totalLimit) * 100) : 0;
  var totalCl = totalCost2 > totalLimit * 0.8 ? 'd' : totalCost2 > totalLimit * 0.5 ? 'w' : 'g';
  h += '<div style="margin-bottom:10px">';
  h += '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span>\u041D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u043E <b>' + mny(totalCost2) + '</b></span>';
  h += '<span>\u041B\u0438\u043C\u0438\u0442 ' + mny(totalLimit) + '</span></div>';
  h += '<div class="bar bar-lg' + (totalPct > 100 ? ' bar-over' : '') + '"><div class="bar-fill fill-' + totalCl + '" style="width:' + Math.min(100, totalPct) + '%"></div></div>';
  h += '</div>';

  // Детально по каждой категории
  for (var n=0; n<s.categories.length; n++) h += limitRow(s.categories[n]);
  h += '<div class="lhint">\u0422\u0430\u0440\u0438\u0444 \u00AB' + esc(s.planName) + '\u00BB</div>';
  h += '</div>';

  h += '</div>';
  return h;
}

// Форматирование объёма: "37 мин", "1.7 ГБ", "28 шт"
function fmtVol(c) {
  if (c.used === 0 && c.cost === 0) return '\u2014';
  if (c.cat === 'i') {
    if (c.used >= 1024) return (c.used / 1024).toFixed(1) + ' \u0422\u0411';
    return c.used.toFixed(0) + ' \u041C\u0411';
  }
  return Math.round(c.used) + ' ' + c.unit;
}

function moH(s) {
  var lb = getMoLb(HIST), h = '';
  for (var i=0; i<s.monthly.length; i++) {
    var r = i === s.monthly.length - 1;
    h += '<span class="m-item' + (r ? ' m-real' : '') + '"><b>' + mny(s.monthly[i]) + '</b> <em>' + lb[i] + '</em></span>';
  }
  return h;
}

function limitRow(c) {
  var pct = c.limit > 0 ? Math.min(100, (c.cost / c.limit) * 100) : 0;
  var cl = c.cost > c.limit * 0.8 ? 'd' : c.cost > c.limit * 0.5 ? 'w' : 'g';
  var pc = cl === 'd' ? 'pill-d' : cl === 'w' ? 'pill-w' : 'pill-g';
  var pl = cl === 'd' ? '\u2191 \u043F\u043E\u0432\u044B\u0441\u0438\u0442\u044C' : cl === 'w' ? '\u2193 \u043F\u043E\u043D\u0438\u0437\u0438\u0442\u044C' : '\u2713 \u043E\u043A';
  var volStr = fmtVol(c);
  var h = '<div class="lrow"><div class="lhead"><span>' + c.icon + '</span><span class="lname">' + c.label + '</span>';
  h += '<span class="lval">' + volStr + ' / \u043B\u0438\u043C\u0438\u0442 ' + mny(c.limit) + '</span>';
  h += '<span class="pill ' + pc + '">' + pl + '</span></div>';
  h += '<div class="bar' + (pct > 100 ? ' bar-over' : '') + '"><div class="bar-fill fill-' + cl + '" style="width:' + Math.min(100, pct) + '%"></div></div></div>';
  return h;
}

document.addEventListener('click', function(e) {
  // Клик по спарклайну → открыть график в модальном окне
  var sparkEl = e.target.closest('.u-spark');
  if (sparkEl) {
    var card = sparkEl.closest('.ucard');
    if (card) {
      var phone = card.getAttribute('data-phone');
      var sub = null;
      for (var i=0; i<allSubs.length; i++) { if (allSubs[i].number === phone) { sub = allSubs[i]; break; } }
      if (sub) {
        var mc = document.getElementById('modalChart');
        if (mc) {
          // Рисуем увеличенный график
          var lb = getMoLb(HIST);
          var d = sub.monthly;
          var W = 700, H = 300, pL = 70, pR = 20, pT = 30, pB = 40;
          var cW = W - pL - pR, cH = H - pT - pB;
          var mx = 0; for (var j=0; j<d.length; j++) if (d[j]>mx) mx=d[j];
          mx = Math.max(mx, sub.planFee, 1) * 1.18;
          var xFn = function(i2) { return pL + (i2 / (d.length - 1)) * cW; };
          var yFn = function(v) { return pT + cH - (v / mx) * cH; };
          var gr = '';
          for (var g = 0; g <= 4; g++) {
            var gy = pT + (g / 4) * cH, val = mx * (1 - g / 4);
            gr += '<line x1="'+pL+'" y1="'+gy+'" x2="'+(W-pR)+'" y2="'+gy+'" stroke="var(--bdr)" stroke-width="1"/>';
            gr += '<text x="'+(pL-10)+'" y="'+(gy+4)+'" text-anchor="end" fill="var(--light)" font-size="11">'+Math.round(val).toLocaleString('ru-RU')+'\u20BD</text>';
          }
          var pts = []; for (var p2=0; p2<d.length; p2++) pts.push(xFn(p2).toFixed(1)+','+yFn(d[p2]).toFixed(1));
          var ar = 'M'+xFn(0).toFixed(1)+','+(pT+cH).toFixed(1)+' L'+pts.join(' L')+' L'+xFn(d.length-1).toFixed(1)+','+(pT+cH).toFixed(1)+' Z';
          var dots = ''; for (var d2=0; d2<d.length; d2++) { var rl2 = d2===d.length-1; dots += '<circle cx="'+xFn(d2).toFixed(1)+'" cy="'+yFn(d[d2]).toFixed(1)+'" r="'+(rl2?5:3)+'" fill="'+(rl2?'var(--orange)':'var(--primary)')+'" stroke="var(--surf)" stroke-width="2"/>'; }
          var xl = ''; for (var x=0; x<lb.length; x++) xl += '<text x="'+xFn(x).toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle" fill="var(--light)" font-size="12">'+lb[x]+'</text>';
          var vl = ''; for (var v=0; v<d.length; v++) vl += '<text x="'+xFn(v).toFixed(1)+'" y="'+(yFn(d[v])-10)+'" text-anchor="middle" fill="var(--primary-d)" font-size="12" font-weight="600">'+mny(d[v])+'</text>';
          var lim = sub.planFee > 0 ? '<line x1="'+pL+'" y1="'+yFn(sub.planFee).toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yFn(sub.planFee).toFixed(1)+'" stroke="var(--red)" stroke-width="1.5" stroke-dasharray="5 5" opacity=".6"/>' : '';

          mc.innerHTML = '<div style="text-align:center;margin-bottom:12px;font-size:14px;font-weight:600">\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430 \u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432 \u2014 ' + esc(sub.name || sub.number) + '</div>' +
            '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">' + gr + '<path d="'+ar+'" fill="rgba(25,135,84,.08)"/><polyline points="'+pts.join(' ')+'" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round"/>'+lim+dots+vl+xl+'</svg>' +
            '<div style="text-align:center;margin-top:8px;font-size:11px;color:var(--muted)">\u0410\u0431\u043E\u043D\u043F\u043B\u0430\u0442\u0430: '+mny(sub.planFee)+' \u00B7 \u0418\u0442\u043E\u0433\u043E: '+mny(sub.totalCost)+'</div>';
          openModal();
        }
      }
    }
    return;
  }

  // Кнопки раскрытия панелей
  var btn = e.target.closest('.act');
  if (!btn) return;
  var c = btn.closest('.ucard');
  if (!c) return;
  var w = btn.dataset.act === 'limits' ? 'panel-limits' : 'panel-details';
  var o = c.classList.toggle('open-' + btn.dataset.act);
  var p = c.querySelector('.' + w);
  if (p) p.classList.toggle('show', o);
  btn.textContent = btn.textContent.replace(o ? '\u25BE' : '\u25B4', o ? '\u25B4' : '\u25BE');
});

// ═══════ SPARKLINE ═══════
function sparkline(s) {
  var d = s.monthly, W = 280, H = 65, pL = 4, pR = 4, pT = 6, pB = 12;
  var cW = W - pL - pR, cH = H - pT - pB;
  var mx = 0;
  for (var i=0; i<d.length; i++) if (d[i] > mx) mx = d[i];
  mx = Math.max(mx, s.planFee, 1) * 1.18;
  var xFn = function(i) { return pL + (i / (d.length - 1)) * cW; };
  var yFn = function(v) { return pT + cH - (v / mx) * cH; };
  var lb = getMoLb(d.length);
  var pts = [];
  for (var j=0; j<d.length; j++) pts.push(xFn(j).toFixed(1) + ',' + yFn(d[j]).toFixed(1));
  var ar = 'M' + xFn(0).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' L' + pts.join(' L') + ' L' + xFn(d.length-1).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' Z';
  var ly = yFn(s.planFee).toFixed(1);
  var dots = '';
  for (var k=0; k<d.length; k++) {
    var rl = k === d.length - 1;
    dots += '<circle cx="' + xFn(k).toFixed(1) + '" cy="' + yFn(d[k]).toFixed(1) + '" r="' + (rl ? 2.5 : 1.5) + '" class="' + (rl ? 'spark-real' : 'spark-dot') + '"/>';
  }
  var xl = '';
  for (var m=0; m<lb.length; m++) xl += '<text x="' + xFn(m).toFixed(1) + '" y="' + (H - 2) + '" class="spark-xl">' + lb[m] + '</text>';
  var lim = s.planFee > 0 ? '<line x1="' + pL + '" y1="' + ly + '" x2="' + (W - pR) + '" y2="' + ly + '" class="spark-limit"/>' : '';
  return '<svg width="' + W + '" height="' + H + '" class="spark"><path d="' + ar + '" class="spark-area"/><polyline points="' + pts.join(' ') + '" class="spark-line"/>' + lim + dots + xl + '</svg>';
}

function drawBigChart(modal) {
  var host = modal ? document.getElementById('modalChart') : document.getElementById('bigChart');
  if (!host) return;
  if (!rendered.length) { host.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:40px">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</div>'; if (modal) openModal(); return; }
  var lb = getMoLb(HIST), tot = [];
  for (var i=0; i<HIST; i++) tot.push(0);
  for (var j=0; j<rendered.length; j++) for (var k=0; k<rendered[j].monthly.length; k++) tot[k] += rendered[j].monthly[k];

  var W = modal ? 750 : 720, H = modal ? 280 : 200, pL = 60, pR = 16, pT = 20, pB = 30;
  var cW = W - pL - pR, cH = H - pT - pB;
  var mx = 0;
  for (var m=0; m<tot.length; m++) if (tot[m] > mx) mx = tot[m];
  mx = Math.max(mx, 1) * 1.12;
  var xFn = function(i) { return pL + (i / (tot.length - 1)) * cW; };
  var yFn = function(v) { return pT + cH - (v / mx) * cH; };

  var gr = '';
  for (var g = 0; g <= 4; g++) {
    var gy = pT + (g / 4) * cH, val = mx * (1 - g / 4);
    gr += '<line x1="' + pL + '" y1="' + gy + '" x2="' + (W - pR) + '" y2="' + gy + '" stroke="var(--bdr)" stroke-width="1"/>';
    gr += '<text x="' + (pL - 8) + '" y="' + (gy + 3) + '" text-anchor="end" fill="var(--light)" font-size="10">' + Math.round(val).toLocaleString('ru-RU') + '</text>';
  }
  var pts = [];
  for (var p2 = 0; p2 < tot.length; p2++) pts.push(xFn(p2).toFixed(1) + ',' + yFn(tot[p2]).toFixed(1));
  var ar = 'M' + xFn(0).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' L' + pts.join(' L') + ' L' + xFn(tot.length-1).toFixed(1) + ',' + (pT + cH).toFixed(1) + ' Z';
  var dots = '';
  for (var d2 = 0; d2 < tot.length; d2++) dots += '<circle cx="' + xFn(d2).toFixed(1) + '" cy="' + yFn(tot[d2]).toFixed(1) + '" r="' + (modal ? 5 : 4) + '" fill="var(--primary)" stroke="var(--surf)" stroke-width="2"/>';
  var xl = '';
  for (var x = 0; x < lb.length; x++) xl += '<text x="' + xFn(x).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" fill="var(--light)" font-size="' + (modal ? 11 : 10) + '">' + lb[x] + '</text>';
  var vl = '';
  for (var v = 0; v < tot.length; v++) vl += '<text x="' + xFn(v).toFixed(1) + '" y="' + (yFn(tot[v]) - 8) + '" text-anchor="middle" fill="var(--primary-d)" font-size="' + (modal ? 11 : 10) + '" font-weight="600">' + mny(tot[v]) + '</text>';

  host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + gr + '<path d="' + ar + '" fill="rgba(25,135,84,.08)"/><polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--primary)" stroke-width="' + (modal ? 2.5 : 2) + '" stroke-linejoin="round"/>' + dots + vl + xl + '</svg>';
  if (modal) openModal();
}

function openModal() { document.getElementById('chartModal').style.display = 'flex'; }
function closeModal() { document.getElementById('chartModal').style.display = 'none'; }
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

// ═══════ HELPERS ═══════
function mny(v) { return (Math.round(v) || 0).toLocaleString('ru-RU') + ' \u20BD'; }
function esc(s) { return String(s).replace(/[&<>"']/g, function(ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
function getMoLb(n) { var now = new Date(), lb = []; for (var i=n-1; i>=0; i--) { var d = new Date(now.getFullYear(), now.getMonth()-i, 1); lb.push(MONTHS[d.getMonth()]); } return lb; }
function stxt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
function showLoad(t, p) { var l = document.getElementById('loading'); if (l) l.style.display = 'flex'; var lt = document.getElementById('loadText'); if (lt) lt.textContent = t; var pf = document.getElementById('progFill'); if (pf) pf.style.width = p + '%'; }
function hideLoad() { var l = document.getElementById('loading'); if (l) l.style.display = 'none'; }
function flashHint(t) { var h = document.getElementById('hint'); if (h) { h.textContent = t; h.classList.add('show'); setTimeout(function(){h.classList.remove('show');},3000); } }

// ═══════ DEMO ═══════
var DEMO_PLANS = [
  {fee:140,name:'\u0418\u043D\u0442\u0435\u0440\u043D\u0435\u0442. \u0411\u0435\u0437 \u041F\u0435\u0440\u0435\u043F\u043B\u0430\u0442 04.23',minutes:700,sms:300,mb:15000},
  {fee:230,name:'\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u0439! \u0421\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442 +',minutes:1500,sms:500,mb:25000},
  {fee:400,name:'\u0424\u0435\u0434\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439 \u0421\u043F\u0435\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0439 B2B',minutes:4000,sms:1000,mb:70000}
];

function loadDemoData() {
  showLoad('\u0413\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F\u2026', 30);
  var rd = {};
  for (var i = 0; i < 50; i++) {
    var ph = gPh(), pl = DEMO_PLANS[Math.floor(Math.random() * DEMO_PLANS.length)], items = [];
    function addI(key, cat, vol, unit, cost) { items.push({key:key,category:cat,rawVolume:vol+' '+unit,volume:vol,unit:unit,withDiscount:cost,noDiscount:cost}); }
    var om = Math.floor(Math.random() * 500); if (om) addI('home_outgoing_calls','voice',om,'\u043C\u0438\u043D',0);
    addI('home_incoming_calls','voice',Math.floor(Math.random()*600)+50,'\u043C\u0438\u043D',0);
    var on = Math.floor(Math.random() * 300); if (on) addI('home_onnet_calls','voice',on,'\u043C\u0438\u043D',0);
    var ot = Math.floor(Math.random() * 100); if (ot) addI('home_other_operators','voice',ot,'\u043C\u0438\u043D',+(ot*0.18).toFixed(2));
    var ic = Math.floor(Math.random() * 80); if (ic) addI('home_intercity_calls','voice',ic,'\u043C\u0438\u043D',+(ic*0.25).toFixed(2));
    var mb = +(Math.random() * 50000).toFixed(2); addI('home_mobile_internet','internet',mb,'\u041C\u0431',+(Math.max(0,mb-5000)*0.0001).toFixed(2));
    var ins = Math.floor(Math.random() * 200); if (ins) addI('home_incoming_sms','sms',ins,'\u0448\u0442',0);
    var ons = Math.floor(Math.random() * 60); if (ons) addI('home_sms','sms',ons,'\u0448\u0442',+(ons*0.05).toFixed(2));
    if (Math.random() < 0.3) addI('employee_protection_fee','other',1,'',90);
    if (Math.random() < 0.15) { var t1 = Math.floor(Math.random()*40)+1; addI('travel_outgoing_calls','voice',t1,'\u043C\u0438\u043D',+(t1*0.18).toFixed(2)); }
    if (Math.random() < 0.1) { var t2 = Math.floor(Math.random()*20)+1; addI('travel_sms','sms',t2,'\u0448\u0442',+(t2*0.1).toFixed(2)); }
    rd[ph] = {items:items, planFee:pl.fee, planName:pl.name};
  }
  curF = 'all'; curS = 'overpay'; sortD = 'desc';
  buildReport(rd);
}
function gPh() {
  var p = [900,901,902,903,904,905,906,908,909,910,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927,928,929,930,950,951,952,953];
  var pr = p[Math.floor(Math.random() * p.length)];
  var r = '';
  for (var i=0; i<7; i++) r += Math.floor(Math.random() * 10);
  return pr + r;
}
