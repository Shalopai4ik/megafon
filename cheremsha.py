#!/usr/bin/env python3
"""
cheremsha.py — сборка документации «Черемша» (cheremsha.html).
=============================================================================

    python cheremsha.py            → соберёт cheremsha.html рядом с собой

ЗАЧЕМ ГЕНЕРАТОР, А НЕ ПРОСТО HTML-ФАЙЛ. Документация про то, как считаются
деньги, живёт ровно до первой правки кода. Здесь таблицы — правила разнесения,
корзины, ставки, цвета чипсов, правила по услугам — вынимаются ИЗ САМОГО КОДА
и из базы в момент сборки. Разъехаться с исходниками они не могут: если кто-то
добавил строку в includes.INCLUDES, она появится в документе сама.

Руками написаны только объяснения и схемы — то, что из кода не достать.

БЕЗ БАЗЫ ТОЖЕ СОБИРАЕТСЯ: разделы, которым нужна база (цвета чипсов, правила
по услугам), просто отметятся как недоступные. Это чтобы документацию можно
было собрать на машине разработчика, где postgres не поднят.
"""

from __future__ import annotations

import html
import os
import sys
from datetime import datetime

import billing
import domain
import includes

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cheremsha.html")

PAYER_RU = {"company": "общество", "employee": "человек", "auto": "как решат правила"}
BUCKET_RU = billing.BUCKET_LABELS


def e(text: object) -> str:
    return html.escape(str(text))


def pill(payer: str) -> str:
    """Плашка плательщика. Цвет один и тот же во всём документе."""
    cls = {"company": "ok", "employee": "warn", "auto": "muted"}.get(payer, "muted")
    return f'<span class="pill pill-{cls}">{e(PAYER_RU.get(payer, payer))}</span>'


# ═══════════════════════════════════════════════════════════════════════════
#  Разделы, собираемые из кода
# ═══════════════════════════════════════════════════════════════════════════

def table_includes() -> str:
    """Таблица разнесения строк счёта — прямо из includes.INCLUDES."""
    rows = []
    for i, inc in enumerate(includes.INCLUDES, start=1):
        names = ", ".join(f"<code>{e(n)}</code>" for n in inc.names) or \
            '<em class="muted">любое название — это хвост таблицы</em>'
        also = ""
        if inc.also:
            also = ('<div class="also">и одновременно: '
                    + ", ".join(f"<code>{e(a)}</code>" for a in inc.also) + "</div>")
        bucket = BUCKET_RU.get(inc.bucket, inc.bucket)
        if inc.bucket == "skip":
            bucket = "— (в деньги не идёт)"
        rows.append(
            f"<tr>"
            f'<td class="num">{i}</td>'
            f'<td><b>{e(bucket)}</b><div class="muted">{e(inc.bucket)}</div></td>'
            f"<td>{pill(inc.pays) if inc.bucket != 'skip' else '—'}</td>"
            f"<td>{names}{also}</td>"
            f'<td class="why">{e(inc.why)}</td>'
            f"</tr>"
        )
    return f"""
    <table class="grid">
      <thead><tr>
        <th>№</th><th>Корзина</th><th>Платит<br>по умолчанию</th>
        <th>Срабатывает, если в названии есть</th><th>Что это</th>
      </tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


def table_buckets() -> str:
    rows = []
    for key in billing.BUCKETS:
        rows.append(
            f"<tr><td><b>{e(BUCKET_RU[key])}</b></td>"
            f"<td><code>{e(key)}</code></td>"
            f"<td><code>payer_{e(key)}</code></td>"
            f"<td>{pill(billing.EMPTY_BUCKET_PAYER[key])}</td></tr>"
        )
    return f"""
    <table class="grid">
      <thead><tr><th>Корзина</th><th>Ключ в коде</th>
        <th>Колонка в базе</th><th>Плательщик пустой корзины</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


def table_rates() -> str:
    rates = [
        ("RATE_MIN", "минута сверх пакета, другие операторы"),
        ("RATE_MIN_INTERCITY", "минута междугородного вызова по России"),
        ("RATE_SMS", "SMS сверх пакета абонентам РФ"),
        ("RATE_SMS_ABROAD", "SMS абонентам СНГ и других стран"),
        ("RATE_MMS", "MMS абонентам РФ"),
        ("RATE_MMS_ABROAD", "MMS абонентам СНГ и других стран"),
        ("RATE_MB", "мегабайт сверх пакета"),
    ]
    rows = "".join(
        f"<tr><td><code>{e(name)}</code></td>"
        f'<td class="num">{getattr(domain, name):.2f} ₽</td>'
        f"<td>{e(what)}</td></tr>"
        for name, what in rates if hasattr(domain, name)
    )
    fmc = getattr(domain, "FMC_FEE", None)
    if fmc is not None:
        rows += (f"<tr><td><code>FMC_FEE</code></td>"
                 f'<td class="num">{fmc:.2f} ₽</td>'
                 f"<td>городской номер на трубке, в месяц</td></tr>")
    return f"""
    <table class="grid">
      <thead><tr><th>Имя в domain.py</th><th>Ставка</th><th>За что</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>"""


def table_categories() -> str:
    groups = [
        ("internet", "Интернет", includes.INTERNET_KW, includes.INTERNET_UNITS),
        ("sms", "SMS", includes.SMS_KW, ()),
        ("voice", "Минуты", includes.VOICE_KW, includes.VOICE_UNITS),
    ]
    rows = []
    for key, label, kw, units in groups:
        rows.append(
            f"<tr><td><b>{e(label)}</b><div class=\"muted\">{e(key)}</div></td>"
            f"<td>{', '.join(f'<code>{e(k)}</code>' for k in kw)}</td>"
            f"<td>{', '.join(f'<code>{e(u)}</code>' for u in units) or '—'}</td></tr>"
        )
    rows.append('<tr><td><b>Прочее</b><div class="muted">other</div></td>'
                '<td colspan="2"><em class="muted">всё, что не подошло выше, '
                'а также абонплата и строки-итоги</em></td></tr>')
    return f"""
    <table class="grid">
      <thead><tr><th>Категория</th><th>Слова в названии</th>
        <th>Или единица измерения</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


def table_catalog() -> str:
    """Каталог тарифов по умолчанию — то, с чем сравнивается фактическое потребление."""
    try:
        catalog = domain.normalize_catalog(None)
    except Exception as exc:                                   # noqa: BLE001
        return f'<p class="warn-box">Каталог не собрался: {e(exc)}</p>'

    rows = []
    for t in catalog[:60]:
        net = "без ограничения" if t["unlimited_internet"] else f"{t['internet_mb']:.0f} МБ"
        rows.append(
            f"<tr><td>{e(t['name'])}</td>"
            f'<td class="num">{t["fee"]:.2f}</td>'
            f'<td class="num">{t["minutes"]:.0f}</td>'
            f'<td class="num">{t["sms"]:.0f}</td>'
            f'<td class="num">{e(net)}</td>'
            f'<td class="why">{e(t["note"])}</td></tr>'
        )
    tail = (f'<p class="muted">Показаны первые 60 из {len(catalog)}.</p>'
            if len(catalog) > 60 else "")
    return f"""
    <table class="grid">
      <thead><tr><th>Тариф</th><th>Абонплата, ₽</th><th>Минут</th>
        <th>SMS</th><th>Интернет</th><th>Из чего собран</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>{tail}"""


# ═══════════════════════════════════════════════════════════════════════════
#  Разделы, которым нужна база
# ═══════════════════════════════════════════════════════════════════════════

def _no_db(what: str, exc: Exception) -> str:
    return (f'<p class="warn-box">Раздел «{e(what)}» собирается из базы, '
            f"а она сейчас недоступна: {e(exc)}<br>"
            f"Документ собран без него — на работу остальных разделов это "
            f"не влияет.</p>")


def table_chip_rules() -> str:
    try:
        import queries
        rules = queries.get_chip_rules()
    except Exception as exc:                                   # noqa: BLE001
        return _no_db("Цвета и пометки", exc)

    rows = []
    for r in sorted(rules, key=lambda x: (x.get("kind") or "", x.get("sort_order") or 0)):
        cells = "".join(
            f"<td>{pill(r.get(f'payer_{b}') or 'auto')}</td>" for b in billing.BUCKETS)
        kind = "цвет" if r.get("kind") == "color" else "пометка"
        swatch = ""
        if r.get("hex"):
            swatch = f'<span class="swatch" style="background:{e(r["hex"])}"></span>'
        rows.append(
            f"<tr><td>{swatch}<b>{e(r.get('label'))}</b>"
            f'<div class="muted"><code>{e(r.get("code"))}</code> · {kind}</div></td>'
            f"{cells}</tr>"
        )
    heads = "".join(f"<th>{e(BUCKET_RU[b])}</th>" for b in billing.BUCKETS)
    return f"""
    <table class="grid">
      <thead><tr><th>Правило номера</th>{heads}</tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


def table_payment_rules() -> str:
    try:
        import queries
        rules = queries.get_payment_rules()
    except Exception as exc:                                   # noqa: BLE001
        return _no_db("Правила по названию услуги", exc)

    rows = []
    for r in sorted(rules, key=lambda x: (domain.to_int(x.get("priority"), 100), x.get("id") or 0)):
        if not r.get("enabled", True):
            continue
        rows.append(
            f'<tr><td class="num">{e(r.get("priority"))}</td>'
            f"<td><code>{e(r.get('match_value'))}</code></td>"
            f"<td>{e(BUCKET_RU.get(r.get('scope'), r.get('scope') or 'любая'))}</td>"
            f"<td>{pill(r.get('payer') or 'auto')}</td>"
            f'<td class="why">{e(r.get("note") or "")}</td></tr>'
        )
    return f"""
    <table class="grid">
      <thead><tr><th>Приоритет</th><th>Если в названии есть</th>
        <th>Корзина</th><th>Платит</th><th>Почему</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
    <p class="muted">Проверяются сверху вниз, побеждает первое подошедшее.
      Правятся в интерфейсе: Настройки → Правила оплаты.</p>"""


# ═══════════════════════════════════════════════════════════════════════════
#  Схемы. Рисуются разметкой, без картинок и библиотек: документ обязан
#  открываться в закрытом контуре, где интернета нет.
# ═══════════════════════════════════════════════════════════════════════════

FLOW_MAIN = """
<div class="flow">
  <div class="step"><b>Файл</b><span>счёт оператора,<br>список сотрудников,<br>командировки</span></div>
  <div class="arrow">→</div>
  <div class="step"><b>Разбор</b><span>server.py<br>xlsx.py</span></div>
  <div class="arrow">→</div>
  <div class="step"><b>База</b><span>queries.py<br>PostgreSQL</span></div>
  <div class="arrow">→</div>
  <div class="step"><b>Смысл</b><span>domain.py<br>категории, тарифы,<br>рекомендации</span></div>
  <div class="arrow">→</div>
  <div class="step"><b>Деньги</b><span>includes.py<br>billing.py<br>кто за что платит</span></div>
  <div class="arrow">→</div>
  <div class="step accent"><b>Карточка</b><span>script.js</span></div>
</div>"""

FLOW_LINE = """
<div class="flow flow-v">
  <div class="step wide"><b>Строка счёта</b>
    <span>«Исходящие международные вызовы; 70 мин; 229,50»</span></div>
  <div class="arrow">↓</div>
  <div class="split">
    <div class="step"><b>Категория</b>
      <span>чего потратили:<br>минуты / интернет / SMS</span>
      <em>domain.categorize</em></div>
    <div class="step"><b>Корзина</b>
      <span>кто платит:<br>абонплата / опции /<br>сверх пакета / роуминг</span>
      <em>includes.match</em></div>
  </div>
  <div class="arrow">↓</div>
  <div class="split">
    <div class="step"><b>Вердикт по пакету</b>
      <span>перерасход, вне пакета,<br>недоиспользование</span>
      <em>domain.category_verdict</em></div>
    <div class="step"><b>Плательщик</b>
      <span>общество или человек</span>
      <em>billing.split_payment</em></div>
  </div>
</div>"""

LADDER = [
    ("1", "Ручной переключатель в карточке",
     "Настройки плательщика прямо на номере. Сильнее всего: поставили руками — значит так и надо.",
     "chip_settings.payer_*"),
    ("2", "Цвет номера",
     "«Личный тариф — платит сам», «Безлимит», «Устройство». Один цвет на номер.",
     "chip_rules (kind=color)"),
    ("3", "Пометки номера",
     "Несколько на номер, применяются по порядку sort_order.",
     "chip_rules (kind=mark)"),
    ("4", "Командировка",
     "Действует ТОЛЬКО на корзину «Роуминг»: утверждённая командировка переводит её на общество.",
     "business_trips"),
    ("5", "Правило по названию услуги",
     "Построчно внутри корзины: в одной корзине бывают и рабочие, и личные услуги.",
     "payment_rules"),
    ("6", "Умолчание самой услуги",
     "Самый слабый уровень. Поле pays в таблице разнесения.",
     "includes.INCLUDES"),
]


def ladder_html() -> str:
    items = "".join(
        f'<div class="rung">'
        f'<div class="rung-n">{e(n)}</div>'
        f"<div class=\"rung-body\"><b>{e(title)}</b><span>{e(text)}</span></div>"
        f'<div class="rung-src"><code>{e(src)}</code></div>'
        f"</div>"
        for n, title, text, src in LADDER
    )
    return f'<div class="ladder">{items}</div>'


# ═══════════════════════════════════════════════════════════════════════════
#  «Хочу изменить — где править»
# ═══════════════════════════════════════════════════════════════════════════

WHERE_TO_EDIT = [
    ("Услуга попала не в ту корзину",
     "includes.py → INCLUDES",
     "Добавь правило ВЫШЕ того, которое её сейчас ловит. Побеждает первое подошедшее."),
    ("За услугу должен платить не тот, кто платит",
     "includes.py → поле pays в нужной строке",
     "Одно слово: COMPANY или EMPLOYEE. Если правило нужно не всем номерам, "
     "а некоторым — это уже не сюда, а в Настройки → Правила оплаты."),
    ("Оператор придумал новое название услуги",
     "includes.py → names у подходящего правила",
     "Достаточно куска названия строчными буквами. Сравнение идёт по «сплющенному» "
     "названию, про пробелы думать не надо."),
    ("Новая категория потребления или единица измерения",
     "includes.py → INTERNET_KW / SMS_KW / VOICE_KW и *_UNITS",
     "Категория отвечает на «чего потратили», корзина — на «кто платит». Это разные оси."),
    ("Изменились ставки оператора",
     "domain.py → RATE_*",
     "По ним считается, во сколько встал бы месяц на другом тарифе."),
    ("Изменился набор тарифов",
     "Настройки → Тарифы (в интерфейсе)",
     "Каталог правится без кода. domain.build_catalog() — только значение по умолчанию "
     "для чистой установки."),
    ("В книге Excel другие листы",
     "server.py → XLSX_SHEET",
     "Номер листа считается с единицы: счёт 1, сотрудники 2, командировки 4."),
    ("Сколько вариантов тарифа показывать",
     "domain.py → TARIFF_CHOICES",
     "Больше пяти в карточку не помещается."),
    ("Порог, ниже которого не советуем менять тариф",
     "domain.py → MIN_SAVING_RUB, MIN_SAVING_SHARE",
     "Чтобы не советовать смену тарифа ради тридцати рублей."),
    ("Что считать неиспользуемым номером",
     "domain.py → IDLE_VOICE_MIN, IDLE_SMS_CNT, IDLE_INTERNET_MB",
     "Порог «живой SIM-карты»: служебный трафик набегает сам."),
]


def table_where() -> str:
    rows = "".join(
        f"<tr><td><b>{e(what)}</b></td><td><code>{e(where)}</code></td>"
        f'<td class="why">{e(how)}</td></tr>'
        for what, where, how in WHERE_TO_EDIT
    )
    return f"""
    <table class="grid">
      <thead><tr><th>Хочу изменить</th><th>Где правится</th><th>Как</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>"""


def table_uploads() -> str:
    import server
    rows = []
    what = {"bill": "Счёт оператора", "roster": "Список сотрудников",
            "trips": "Командировки"}
    for kind, sheet in server.XLSX_SHEET.items():
        rows.append(
            f"<tr><td><b>{e(what.get(kind, kind))}</b></td>"
            f"<td><code>{e(kind)}</code></td>"
            f'<td class="num">{e(sheet)}</td></tr>'
        )
    return f"""
    <table class="grid">
      <thead><tr><th>Что грузим</th><th>Ключ</th><th>Лист книги Excel</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


# ═══════════════════════════════════════════════════════════════════════════
#  Сборка
# ═══════════════════════════════════════════════════════════════════════════

CSS = """
:root{
  --bg:#ffffff; --fg:#14201a; --muted:#6b7c74; --line:#dfe7e3; --line2:#eef3f1;
  --card:#f7faf9; --accent:#1f7a5c; --ok:#1f7a5c; --warn:#b4472c; --code:#f0f4f2;
}
:root[data-theme="dark"], html[data-theme="dark"]{
  --bg:#111714; --fg:#e6eeea; --muted:#93a49c; --line:#26332d; --line2:#1b241f;
  --card:#161e1a; --accent:#4fd1a5; --ok:#4fd1a5; --warn:#ff9878; --code:#1b241f;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#111714; --fg:#e6eeea; --muted:#93a49c; --line:#26332d; --line2:#1b241f;
    --card:#161e1a; --accent:#4fd1a5; --ok:#4fd1a5; --warn:#ff9878; --code:#1b241f;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;}
.wrap{max-width:1100px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:34px;line-height:1.15;margin:0 0 6px}
h2{font-size:23px;margin:52px 0 14px;padding-top:14px;border-top:2px solid var(--line)}
h3{font-size:17px;margin:28px 0 10px}
p{margin:10px 0}
code{background:var(--code);padding:1px 5px;border-radius:4px;
  font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}
.lead{font-size:17px;color:var(--muted);margin-bottom:4px}
.stamp{color:var(--muted);font-size:13px;margin-top:18px}
.muted{color:var(--muted);font-size:13px}
em.muted{font-style:italic}

/* ── оглавление ─────────────────────────────────────────────────────────── */
.toc{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:16px 20px;margin:26px 0}
.toc ol{margin:6px 0 0;padding-left:22px}
.toc li{margin:4px 0}
.toc a{color:var(--accent);text-decoration:none}
.toc a:hover{text-decoration:underline}

/* ── таблицы ────────────────────────────────────────────────────────────── */
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:14px 0}
table.grid{border-collapse:collapse;width:100%;min-width:640px;font-size:14px}
table.grid th,table.grid td{border:1px solid var(--line);padding:8px 10px;
  text-align:left;vertical-align:top}
table.grid th{background:var(--card);font-weight:600;font-size:13px}
table.grid tbody tr:nth-child(even){background:var(--line2)}
td.num,th.num{text-align:right;white-space:nowrap}
td.why{color:var(--muted);font-size:13px}
.also{margin-top:4px;color:var(--muted);font-size:12px}
.swatch{display:inline-block;width:11px;height:11px;border-radius:3px;
  margin-right:6px;border:1px solid var(--line);vertical-align:baseline}

.pill{display:inline-block;padding:1px 8px;border-radius:20px;font-size:12px;
  white-space:nowrap;border:1px solid transparent}
.pill-ok{background:rgba(31,122,92,.13);color:var(--ok);border-color:rgba(31,122,92,.35)}
.pill-warn{background:rgba(180,71,44,.13);color:var(--warn);border-color:rgba(180,71,44,.35)}
.pill-muted{background:var(--code);color:var(--muted);border-color:var(--line)}

/* ── схемы ──────────────────────────────────────────────────────────────── */
.flow{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap;margin:18px 0}
.flow .step{flex:1 1 140px;min-width:130px;background:var(--card);
  border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.flow .step b{display:block;font-size:14px;margin-bottom:3px}
.flow .step span{display:block;color:var(--muted);font-size:12.5px;line-height:1.45}
.flow .step em{display:block;margin-top:6px;font-style:normal;font-size:11.5px;
  color:var(--accent);font-family:ui-monospace,Consolas,monospace}
.flow .step.accent{border-color:var(--accent)}
.flow .arrow{align-self:center;color:var(--muted);font-size:19px;flex:0 0 auto}
.flow-v{flex-direction:column;align-items:stretch}
.flow-v .arrow{align-self:center}
.flow .step.wide{flex:1 1 100%}
.split{display:flex;gap:8px;flex-wrap:wrap}
.split .step{flex:1 1 220px}

.ladder{margin:16px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.rung{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;
  border-bottom:1px solid var(--line)}
.rung:last-child{border-bottom:0}
.rung:nth-child(even){background:var(--line2)}
.rung-n{flex:0 0 26px;height:26px;border-radius:50%;background:var(--accent);
  color:#fff;display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700}
.rung-body{flex:1 1 auto;min-width:200px}
.rung-body b{display:block;font-size:14.5px}
.rung-body span{display:block;color:var(--muted);font-size:13px}
.rung-src{flex:0 0 auto;align-self:center}

.note{background:var(--card);border-left:3px solid var(--accent);
  border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0}
.note b{display:block;margin-bottom:3px}
.warn-box{background:rgba(180,71,44,.10);border-left:3px solid var(--warn);
  border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;font-size:14px}
.formula{background:var(--card);border:1px solid var(--line);border-radius:10px;
  padding:14px 16px;margin:14px 0;font:13.5px/1.9 ui-monospace,Consolas,monospace;
  overflow-x:auto}
"""


def build() -> str:
    stamp = datetime.now().strftime("%d.%m.%Y %H:%M")
    sections: list[str] = []
    add = sections.append

    add(f"""
<div class="wrap">
<h1>Черемша</h1>
<p class="lead">Как в этой программе получаются деньги: откуда берутся суммы,
почему услуга попала в эту корзину и кто в итоге платит.</p>
<p class="muted">Для администраторов и разработчиков. Таблицы в документе
собраны из самого кода и базы — разъехаться с исходниками они не могут.</p>

<div class="toc">
  <b>О чём здесь</b>
  <ol>
    <li><a href="#map">Карта: путь от файла до карточки</a></li>
    <li><a href="#price">Как получается цена</a></li>
    <li><a href="#includes">Таблица разнесения: какая услуга в какую корзину</a></li>
    <li><a href="#who">Кто платит: лестница правил</a></li>
    <li><a href="#chips">Чипсы: цвета, пометки, правила по услугам</a></li>
    <li><a href="#tariffs">Подбор тарифа и ставки</a></li>
    <li><a href="#files">Загрузка файлов и листы книги Excel</a></li>
    <li><a href="#edit">Хочу изменить — где править</a></li>
  </ol>
</div>

<h2 id="map">1. Карта: путь от файла до карточки</h2>
<p>Пять модулей, у каждого своя работа. Разделение жёсткое: пока оно
соблюдается, любой вопрос «почему такая сумма» имеет ровно один адрес.</p>
{FLOW_MAIN}
<div class="note">
  <b>Главное правило</b>
  <code>domain.py</code> отвечает на вопрос «что это значит»,
  <code>includes.py</code> и <code>billing.py</code> — на вопрос «кто за это платит».
  Смешивать нельзя: именно из-за смешения международные звонки когда-то
  попадали в «перерасход пакета» и вешались на человека.
</div>

<h2 id="price">2. Как получается цена</h2>
<p>Сумма в карточке не пересчитывается нами заново — она берётся из счёта
оператора. Наша работа в другом: разложить эти деньги так, чтобы было видно,
за что они и чьи они.</p>
<p>Каждая строка счёта проходит по двум независимым осям.</p>
{FLOW_LINE}

<h3>Ось первая: категория — чего потратили</h3>
<p>Нужна, чтобы сравнить потребление с пакетом тарифа и подобрать другой
тариф. Определяется по словам в названии, а если название незнакомое — по
единице измерения. Единица надёжнее: оператор придумывает новые формулировки
быстрее, чем мы их вносим, а «Мбайт» остаётся «Мбайт».</p>
<div class="scroll">{table_categories()}</div>

<h3>Ось вторая: корзина — кто платит</h3>
<p>Корзин четыре. Их ровно четыре не случайно: на каждую в базе заведена своя
колонка <code>payer_*</code> в четырёх таблицах, и пятая означала бы миграцию
уже установленных контуров. Услуге, которой нужен свой плательщик, он
задаётся полем <code>pays</code> в таблице разнесения, а не новой корзиной.</p>
<div class="scroll">{table_buckets()}</div>

<h3>Вердикт по пакету</h3>
<p>Главный признак перерасхода — <b>деньги в счёте, а не наш расчёт</b>.
Размеры пакетов в каталоге это наше предположение: оператор мог подключить
опцию или акцию. А начисление по категории — факт.</p>
<div class="formula">
если за категорию списано 0 ₽ .......... перерасхода не было, сколько бы ни потратили<br>
если потрачено больше пакета и списано . перерасход<br>
если потрачено меньше пакета, но списано &gt; 0 .. «вне пакета»<br>
&nbsp;&nbsp;&nbsp;&nbsp;это межгород, международка или спецномера:<br>
&nbsp;&nbsp;&nbsp;&nbsp;пакет их не покрывает в принципе<br>
если потрачено меньше половины пакета ... недоиспользование<br>
если не потрачено вовсе ................ пакет не использован
</div>
<div class="note">
  <b>Почему это важно</b>
  Номер с 368 минутами из 4000 показывал красное «Перерасход пакета 230 ₽»
  и вешал его на человека. Пакет был почти не тронут — платили за
  международные звонки, которые пакетом не покрываются вообще. Вердикт по
  категории это понимал верно, а раскладка по корзинам врала.
</div>

<h2 id="includes">3. Таблица разнесения</h2>
<p>Единственное место, где название услуги превращается в решение.
Файл <code>includes.py</code>, список <code>INCLUDES</code>.</p>
<p><b>Как читается:</b> правила проверяются сверху вниз, побеждает первое
подошедшее. Поэтому частное стоит выше общего. Строка счёта подходит правилу,
если её название содержит любую подстроку из колонки «Срабатывает».
Если у правила заполнено «и одновременно» — название обязано содержать
вдобавок что-то оттуда.</p>
<p>Сравнение идёт по «сплющенному» названию: нижний регистр, схлопнутые
пробелы. Поэтому в таблице всё строчными, и про то, сколько пробелов оператор
поставил в этот раз, думать не надо.</p>
<div class="scroll">{table_includes()}</div>

<h2 id="who">4. Кто платит: лестница правил</h2>
<p>Плательщик корзины ищется сверху вниз. Первое сработавшее правило
побеждает, до нижних дело не доходит.</p>
{ladder_html()}
<div class="note">
  <b>Настройки номера сильнее правил по услуге</b>
  Если номер помечен «Личный тариф», опции остаются на человеке, что бы ни
  говорило правило про «Офис в кармане». Каждое решение сопровождается
  объяснением — в карточке видно не только «общество», но и почему.
</div>
<p>Корзина может оказаться <b>смешанной</b>: в «Связи сверх пакета» лежат и
перерасход пакета (человек), и межгород с международкой (общество). Тогда
плашка так и пишет — «разные услуги, разные плательщики», а разбор по строкам
виден в подробной карточке абонента.</p>

<h2 id="chips">5. Чипсы</h2>
<h3>Цвета и пометки номера</h3>
<p>Цвет на номере один, пометок может быть несколько. Значение
<code>auto</code> означает «не вмешиваться, пусть решают правила ниже».</p>
<div class="scroll">{table_chip_rules()}</div>
<h3>Правила по названию услуги</h3>
<p>Работают построчно внутри корзины: в одной корзине бывают и рабочие, и
личные услуги.</p>
<div class="scroll">{table_payment_rules()}</div>

<h2 id="tariffs">6. Подбор тарифа и ставки</h2>
<p>Считается только тарифозависимая часть: абонплата плюс перерасход по
минутам, SMS и интернету. Опции (ВАТС, антифрод, роуминговые пакеты) в
сравнение не входят — иначе тарифы сравнивались бы нечестно.</p>
<div class="formula">
месяц на тарифе = абонплата<br>
&nbsp;&nbsp;+ max(0, минуты − пакет_минут) × ставка_минуты<br>
&nbsp;&nbsp;+ max(0, SMS − пакет_SMS) × ставка_SMS<br>
&nbsp;&nbsp;+ max(0, МБ − пакет_МБ) × ставка_МБ&nbsp;&nbsp;<span class="muted">(0, если интернет безлимитный)</span>
</div>
<div class="note">
  <b>Рекомендация выдаётся, только если модель побеждает факт с запасом</b>
  Если наш каталог неточен — например, у абонента подключена опция, о которой
  мы не знаем, — модель окажется дороже факта, и тариф честно оставят как есть.
  Придуманной экономии не будет.
</div>
<div class="scroll">{table_rates()}</div>
<h3>Каталог тарифов по умолчанию</h3>
<p>Реальный набор — это комбинации: голосовая база × FMC × интернет-пакет.
Отсюда суммы, которых нет ни в одной строке тарифной сетки оператора.
Каталог правится в интерфейсе (Настройки → Тарифы); ниже — то, с чем
начинает работать чистая установка.</p>
<div class="scroll">{table_catalog()}</div>

<h2 id="files">7. Загрузка файлов</h2>
<p>Книга Excel читается сама, конвертировать в CSV руками не нужно. Внутри
книги берётся один лист:</p>
<div class="scroll">{table_uploads()}</div>
<p>Порядок листов определяется по <code>workbook.xml</code>, а не по именам
файлов внутри архива: <code>sheet1.xml</code> запросто оказывается четвёртым
листом книги, если листы двигали мышью. Если на нужном листе пусто, книга
обходится целиком и берётся первый лист с шапкой и абонентскими номерами.
С какого листа взяли — написано в сообщении после загрузки.</p>
<div class="note">
  <b>Даты в книге лежат числами</b>
  46203 — это 30.06.2026. Отличить дату от обычного числа можно только по
  формату ячейки, поэтому читается <code>styles.xml</code>. Без этого в
  командировках вместо периода приезжали бы пятизначные числа.
</div>

<h2 id="edit">8. Хочу изменить — где править</h2>
<p>Почти всё, что меняется в жизни, меняется в одном файле и одной строкой.</p>
<div class="scroll">{table_where()}</div>
<div class="note">
  <b>Что править НЕ надо</b>
  Логику разнесения в <code>billing.py</code> — там больше нет ни одного
  <code>if</code> про названия услуг, только чтение таблицы. Если тянет
  дописать туда условие, значит нужна строка в <code>INCLUDES</code>.
</div>

<p class="stamp">Собрано {e(stamp)} · <code>python cheremsha.py</code></p>
</div>""")

    body = "".join(sections)
    return f"""<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Черемша — как считаются деньги</title>
<style>{CSS}</style>
</head><body>{body}</body></html>"""


def main() -> int:
    html_text = build()
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html_text)
    print(f"  Черемша собрана: {OUT}")
    print(f"  {len(html_text) // 1024} КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
