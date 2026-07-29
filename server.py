#!/usr/bin/env python3
"""
server.py — HTTP-слой и разбор загружаемых файлов.
=============================================================================

Чистый Python, ноль зависимостей: запускается как `python server.py`.

Разделение ответственности:
    domain.py   — что означают данные (категории, тарифы, рекомендации);
    queries.py  — где лежат данные (хранилище + SQL-эквиваленты);
    server.py   — как данные попадают внутрь (парсеры файлов) и наружу (API).

ДВА ФОРМАТА ЗАГРУЗКИ
--------------------
1. СЧЁТ ОПЕРАТОРА (`/api/upload-csv`) — выгрузка «Начисления по абонентским
   номерам». Блок на каждый номер:

        Абонентский номер 9001234567
        Тарифный план на 31.01.2026 «Федеральный Специальный B2B»
        Название услуги;Объём;Сумма без скидки;Сумма скидки;Сумма со скидкой
        Абонентская плата по тарифному плану (посуточное списание);31 шт;400.00;0.00;400.00
        Мобильный интернет в домашнем регионе;15.61 Мбайт;0.72;0.00;0.72
        Итого начислено;111.36;0.00;111.36
        в том числе НДС (22%);20.08

   Ключевая тонкость: у части строк КОЛОНКА «Объём» ОТСУТСТВУЕТ — тогда в
   строке не 5 полей, а 4 («Абонентская плата за услугу Защита сотрудников;
   90.00;0.00;90.00»). Разбирать по фиксированным индексам нельзя, иначе
   сумма услуги уезжает в объём и теряется. Поэтому раскладка выбирается по
   количеству полей — см. `_split_service_row`.

2. СПИСОК СОТРУДНИКОВ (`/api/upload-roster`) — выгрузка из Excel с колонками
   «Абонентский номер | Лимит | ФИО | Должность | Табельный номер | Прочие»
   и далее помесячными расходами. Именно отсюда берутся ЛИМИТЫ В РУБЛЯХ и
   реальная история по месяцам.
"""

from __future__ import annotations

import csv
import html
import http.server
import io
import json
import os
import re
import socketserver
import sys
import urllib.parse
from datetime import date, datetime
from typing import Any, Iterable, NamedTuple

import billing
import db
import domain

# Консоль Windows по умолчанию не в UTF-8, а мы печатаем по-русски.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:                                             # noqa: BLE001
    pass

# queries поднимает схему и справочники прямо на импорте, поэтому именно
# здесь всплывает «база недоступна». Простыня трассировки в этом месте
# бесполезна: причина всегда снаружи — не запущен сервер PostgreSQL или
# не те логин с паролем. Печатаем причину и выходим по-человечески.
try:
    import queries
except db.DbError as err:
    print(f"\n  НЕ УДАЛОСЬ ОТКРЫТЬ БАЗУ\n\n  {err}\n", file=sys.stderr)
    raise SystemExit(1)

PORT = int(os.environ.get("PORT", 3001))
HOST = os.environ.get("HOST", "0.0.0.0")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
MAX_UPLOAD = 64 * 1024 * 1024   # 64 МБ

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff", ".woff2": "font/woff2",
}

# ═══════════════════════════════════════════════════════════════════════════
#  Общие утилиты разбора текста
# ═══════════════════════════════════════════════════════════════════════════

ENCODINGS = ("utf-8-sig", "utf-8", "cp1251", "koi8-r")


def decode_bytes(raw: bytes) -> str:
    """Определить кодировку файла. Выгрузки бывают и в UTF-8, и в Windows-1251."""
    for enc in ENCODINGS:
        try:
            text = raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        # «Кракозябры»: cp1251-текст, прочитанный как utf-8, даёт много U+FFFD.
        if text.count("�") <= len(text) // 500:
            return text
    return raw.decode("utf-8", errors="replace")


DELIMITERS = (";", "|", "\t")


def detect_delimiter(lines: Iterable[str]) -> str:
    """Разделитель колонок: ';', '|' или табуляция — что чаще встречается."""
    counts = {d: 0 for d in DELIMITERS}
    for line in lines:
        for d in DELIMITERS:
            counts[d] += line.count(d)
    best = max(counts, key=lambda d: counts[d])
    return best if counts[best] else ";"


MONTHS_RU = {
    "январ": 1, "янв": 1, "феврал": 2, "фев": 2, "март": 3, "мар": 3,
    "апрел": 4, "апр": 4, "май": 5, "мая": 5, "июн": 6, "июл": 7,
    "август": 8, "авг": 8, "сентябр": 9, "сен": 9, "октябр": 10, "окт": 10,
    "ноябр": 11, "ноя": 11, "декабр": 12, "дек": 12,
}


# «январь 2026», «май.25», «дек.24», «фев 24» — название месяца и год.
MONTH_LABEL_RE = re.compile(r"^([а-я]{3,10})\s*[.\-/]?\s*(\d{4}|\d{2})$")


def parse_month_label(label: str) -> str | None:
    """«январь 2026» / «май.25» / «дек.24» / «2026-01» → 'YYYY-MM'.

    Метка без года («декабрь») однозначно не разбирается — возвращаем None,
    иначе колонки разных лет склеились бы в одну.
    """
    s = " ".join(str(label or "").strip().lower().replace("ё", "е").split())
    if not s or len(s) > 20:
        return None
    iso = re.fullmatch(r"(\d{4})[-.](\d{1,2})", s)
    if iso:
        month = int(iso.group(2))
        return f"{int(iso.group(1)):04d}-{month:02d}" if 1 <= month <= 12 else None
    m = MONTH_LABEL_RE.fullmatch(s)
    if not m:
        return None
    word, year_raw = m.group(1), m.group(2)
    year = int(year_raw) if len(year_raw) == 4 else 2000 + int(year_raw)
    if not (2000 <= year <= 2100):
        return None
    for prefix, num in sorted(MONTHS_RU.items(), key=lambda kv: -len(kv[0])):
        if word.startswith(prefix):
            return f"{year:04d}-{num:02d}"
    return None


def month_from_date(text: str) -> str | None:
    """Достать 'YYYY-MM' из даты вида 31.01.2026."""
    m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", str(text or ""))
    if not m:
        return None
    return f"{int(m.group(3)):04d}-{int(m.group(2)):02d}"


# ═══════════════════════════════════════════════════════════════════════════
#  Парсер счёта оператора
# ═══════════════════════════════════════════════════════════════════════════

# Мусорные строки: артефакты копирования из мессенджера, колонтитулы,
# сноски и постраничные номера («2 из 1356»).
GARBAGE_PATTERNS = (
    re.compile(r"^\[\d{2}\.\d{2}\.\d{4}"),          # [16.07.2026 12:54] Anikey:
    re.compile(r"^\d+\s+из\s+\d+\s*$"),             # 2 из 1356
    re.compile(r"^\s*[*•]\s"),                      # * Начисления приведены…
    re.compile(r"^\s*<"),                           # HTML-обрывки
    re.compile(r"^-{3,}$"),
)

GARBAGE_SUBSTRINGS = (
    "все суммы приведены", "начисления приведены с учётом",
    "начисления приведены с учетом", "развёрнутая информация",
    "развернутая информация", "подробные данные приведены",
    "для корректного и своевременного", "отсканируйте qr",
    "начисления по списку абонентских номеров",
)

HEADER_ROW_MARKERS = ("название услуги", "наименование услуги")

# ═══════════════════════════════════════════════════════════════════════════
#  КОЛОНТИТУЛ СТРАНИЦЫ «1411 из 1422»
#
#  Отдельной строкой его ловит GARBAGE_PATTERNS. Но в выгрузке из Excel он
#  приезжает ЯЧЕЙКОЙ ВНУТРИ строки счёта — в той же строке, что и итог:
#
#      Итого  начислено;;;;;;1411 из 1422;;;;
#
#  И это стоило нам всего отчёта. Мимо проходили все три защиты сразу:
#
#    * _is_garbage сверяет шаблон со ВСЕЙ строкой, а в ней есть «Итого
#      начислено» — значит не мусор;
#    * _split_records намеренно НЕ режет, когда после хвоста разделителей
#      идёт цифра: внутри записи так выглядит значение колонки. Колонтитул
#      начинается с цифры и притворяется значением;
#    * to_float выбрасывает всё нечисловое, поэтому «1411 из 1422»
#      превращается не в мусор, а во вполне правдоподобное число 14111422.
#
#  Итогом абонента становился номер страницы: на экране 14 111 422 ₽ вместо
#  ~1 400 ₽. Наружу это вылезало суммой «платит сотрудник» в 641 миллион.
#
#  Поэтому колонтитул гасим НА УРОВНЕ ЯЧЕЙКИ, до того как выбрана раскладка
#  колонок. Пустая ячейка дальше отбрасывается сама, как любая другая.
# ═══════════════════════════════════════════════════════════════════════════

_PAGE_FOOTER = re.compile(r"^\s*\d+\s+из\s+\d+\s*$")

# Разделители колонок — чтобы отличить «строка целиком колонтитул» от
# «колонтитул приклеился к настоящей строке счёта».
_DELIM_CHARS = re.compile(r"[;|\t]+")


def _is_page_footer_line(line: str) -> bool:
    """Строка целиком колонтитул — даже с хвостом пустых колонок.

    В выгрузке колонтитул занимает СВОЙ РЯД, а у ряда из Excel есть хвост
    пустых ячеек:

        1411  из  1422;;;;;;;;;;;;;

    Сравнивать с шаблоном «как есть» тут бесполезно: строка не кончается на
    цифре. Поэтому разделители сначала считаем пробелами, а потом смотрим,
    осталось ли что-нибудь кроме самого «N из M». Если нет — строку выкидываем
    целиком, она пустая по смыслу.

    Настоящую строку счёта это не заденет: у «Итого начислено;;;;1411 из 1422»
    после замены разделителей останется ещё и название, и шаблон не совпадёт.
    """
    return bool(_PAGE_FOOTER.match(_DELIM_CHARS.sub(" ", line)))


def _blank_page_footers(parts: list[str]) -> list[str]:
    """Обнулить ячейки-колонтитулы. Остальные не трогаем.

    Второй заслон — на случай, когда Excel положил колонтитул в ячейку ЧУЖОГО
    ряда, к настоящей строке счёта. Тогда всю строку выкидывать нельзя, в ней
    есть деньги; гасим только саму ячейку.
    """
    return ["" if _PAGE_FOOTER.match(p) else p for p in parts]


def _is_garbage(line: str) -> bool:
    line = line.strip()
    if not line:
        return True
    if _is_page_footer_line(line):
        return True
    for pat in GARBAGE_PATTERNS:
        if pat.match(line):
            return True
    # squash: в выгрузке из PDF пробелы какие угодно, вплоть до неразрывных.
    lo = domain.squash(line)
    return any(s in lo for s in GARBAGE_SUBSTRINGS)


def _split_service_row(parts: list[str]) -> dict[str, Any] | None:
    """Разложить строку услуги по колонкам с учётом того, что «Объём» бывает пуст.

    Возможные раскладки (после названия услуги):
        5 полей: объём | без скидки | скидка | со скидкой
        4 поля:           без скидки | скидка | со скидкой      (объёма нет)
        3 поля: объём | со скидкой                              (сокращённая)
        2 поля:           сумма                                 (напр. НДС)
    """
    # Колонтитул страницы гасим ПЕРВЫМ делом: иначе он сойдёт за значение
    # колонки и станет суммой. См. _blank_page_footers.
    parts = _blank_page_footers(parts)

    name = parts[0].strip()
    if not name:
        return None

    # ─────────────────────────────────────────────────────────────────────
    # ИСПРАВЛЕНО: выбрасываем ВСЕ пустые ячейки, а не только хвостовые.
    #
    # В чём была ошибка. Часть выгрузок (например otche.txt) приходит из
    # Excel с объединёнными ячейками, и значения там разделены пустыми
    # колонками:
    #
    #     Абонентская плата по тарифному плану;;;1 шт;400,00;;;0,00;;400,00;;;
    #                                          ^^^ объём ^^^^^^ скидка ^^^ итог
    #
    # Раскладка выбиралась по числу ячеек, пустые считались значащими —
    # и «1 шт» уезжало не в ту колонку. Объём терялся, потребление
    # выходило нулевым, а следом ломались вердикты по пакетам, подбор
    # тарифа и расчёт «платим впустую». Сумма при этом иногда совпадала
    # случайно, поэтому ошибка и не бросалась в глаза.
    # ─────────────────────────────────────────────────────────────────────
    rest = [p.strip() for p in parts[1:] if p.strip()]

    raw_volume, no_disc, disc, with_disc = "", 0.0, 0.0, 0.0

    # Есть ли у ячейки единица измерения («15,61 Мбайт», «5 мин»).
    def _has_unit(cell: str) -> bool:
        return bool(domain.parse_volume(cell)[1])

    if len(rest) >= 4:
        # Полная раскладка: объём | без скидки | скидка | со скидкой.
        raw_volume = rest[0]
        no_disc, disc, with_disc = (domain.to_float(rest[1]),
                                    domain.to_float(rest[2]),
                                    domain.to_float(rest[3]))
    elif len(rest) == 3:
        if _has_unit(rest[0]):
            # «5 мин | 12,50 | 12,50» — объём и две суммы.
            raw_volume = rest[0]
            no_disc, with_disc = domain.to_float(rest[1]), domain.to_float(rest[2])
        else:
            # «Защита сотрудников;90.00;0.00;90.00» — объёма нет, три суммы.
            no_disc, disc, with_disc = (domain.to_float(rest[0]),
                                        domain.to_float(rest[1]),
                                        domain.to_float(rest[2]))
    elif len(rest) == 2:
        if _has_unit(rest[0]):         # «5 мин;12.50» — первое поле это объём
            raw_volume = rest[0]
            no_disc = with_disc = domain.to_float(rest[1])
        else:                          # «100.00;100.00» — суммы
            no_disc, with_disc = domain.to_float(rest[0]), domain.to_float(rest[1])
    elif len(rest) == 1:
        no_disc = with_disc = domain.to_float(rest[0])
    else:
        return None

    volume, unit = domain.parse_volume(raw_volume)
    return {
        "service": name,
        "raw_volume": raw_volume,
        "volume": volume,
        "unit": unit,
        "cat": domain.categorize(name, unit=unit),
        "outgoing": domain.is_outgoing(name),
        "no_discount": no_disc,
        "discount": disc,
        "cost": with_disc,
    }


# Следы мессенджера. Выгрузки доезжают до нас пересланными в чате, и в тексте
# остаются служебные вставки: штамп «[15.07.2026 6:45] Имя:» перед строкой и
# отдельная строка-подпись «> Имя:».
#
# Это не косметика. Штамп приклеивается К НАЧАЛУ строки счёта, и она перестаёт
# быть строкой счёта: у одного абонента так потерялись 90 ₽ «Защиты
# сотрудников», у другого — 29,32 ₽ за интернет. Подпись же встаёт ПОСРЕДИ
# разорванной записи и мешает склеить её половинки.
#
# Шаблоны намеренно узкие: штамп обязан начинаться с даты в квадратных
# скобках, подпись — с «>» и состоять только из имени. Обычные строки счёта
# («Абонент:», «МИ.Детализация счета») под них не попадают.
_CHAT_STAMP = re.compile(r"^\s*\[\d{1,2}\.\d{1,2}\.\d{4}[^\]]{0,20}\]\s*[^:;]{1,40}:\s*")
_CHAT_SENDER = re.compile(r"^\s*>\s*[^:;]{1,40}:\s*$")


def _strip_chat_noise(lines: list[str]) -> list[str]:
    """Убрать вставки мессенджера, не трогая содержимое строк счёта."""
    out: list[str] = []
    for line in lines:
        if _CHAT_SENDER.match(line):
            continue                     # подпись отправителя, данных в ней нет
        out.append(_CHAT_STAMP.sub("", line))
    return out


def _unwrap_lines(lines: list[str], delim: str) -> list[str]:
    """Склеить строки, разорванные посередине записи.

    ЗАЧЕМ. Часть выгрузок приходит с «переносом» внутри ячейки — одна
    логическая строка счёта записана в два физических ряда:

        Абонентская плата по тарифному плану;;;174,56      ← обрыв
        шт;;;33409,69;;;;0,00;;;;33409,69;;;;;;            ← продолжение

    Без склейки объём «174,56 шт» разваливается: число уходит в одну строку,
    единица измерения в другую, и потребление считается неверно.

    КАК ОТЛИЧИТЬ ОБРЫВ ОТ ОБЫЧНОЙ СТРОКИ. В таких выгрузках у каждой полной
    строки есть хвост из разделителей (`;;;;;`) — это пустые колонки Excel.
    Значит строка БЕЗ разделителя на конце и есть оборванная.

    ЗАЩИТА ОТ ЛОЖНОГО СРАБАТЫВАНИЯ. Приём работает только если файл вообще
    пишет хвостовые разделители. Если большинство строк заканчивается
    значением (обычный CSV), склейка не применяется — иначе весь файл
    слился бы в одну строку.
    """
    filled = [ln for ln in lines if ln.strip()]
    if not filled or not delim:
        return lines
    with_tail = sum(1 for ln in filled if ln.rstrip().endswith(delim))
    if with_tail < len(filled) * 0.6:
        return lines           # обычный CSV — склеивать нечего

    out: list[str] = []
    buffer = ""
    for line in lines:
        if not line.strip():
            # ПУСТАЯ СТРОКА НЕ ЗАКАНЧИВАЕТ ЗАПИСЬ. В таких выгрузках пустой
            # ряд выглядит как «;;;;;;», а по-настоящему пустая строка — это
            # след пересылки файла. Раньше она обрывала склейку: у номера
            # 9111111122 «Исходящие вызовы внутри сети;;;31» и «мин;0,00…»
            # так и остались двумя кусками, и «31» ушло в расход как 31 ₽.
            if not buffer:
                out.append(line)
            continue
        if buffer:
            # Перенос обычно рвёт слово или пару «число + единица», поэтому
            # склеиваем через пробел: «Специальный»+«B2B» → «Специальный B2B»,
            # «174,56»+«шт» → «174,56 шт». Исключение — разрыв внутри самого
            # числа: там пробел добавлять нельзя, иначе получится два числа.
            glue = "" if (buffer[-1].isdigit() and line[:1].isdigit()) else " "
            buffer = f"{buffer}{glue}{line}"
        else:
            buffer = line
        if buffer.rstrip().endswith(delim):
            out.append(buffer)
            buffer = ""
    if buffer:
        out.append(buffer)
    return out


def _split_records(lines: list[str], delim: str) -> list[str]:
    """Разрезать физические строки, в которые слиплось несколько записей.

    ЗАЧЕМ. В выгрузке встречается обратная беда к переносу: в одном ряду
    подряд идут несколько логических строк счёта —

        …;;0,00;;;;;;;;;;; Итого начислено;;;;;;490,00;;;;0,00;;;490,00;;;;;;;

    Парсер брал только ПЕРВУЮ запись, а остальные молча терял. Из-за этого
    пропадало «Итого начислено», и суммой счёта становилось случайное число
    из объёма соседней услуги (у одного номера — 36 ₽ вместо 490 ₽).

    КАК ОТЛИЧИТЬ ГРАНИЦУ ЗАПИСЕЙ ОТ ПУСТЫХ КОЛОНОК ВНУТРИ ЗАПИСИ.
    Внутри записи после разделителей сразу идёт ЧИСЛО — это значение колонки:
        «Итого начислено;;;;;;490,00»  → после «;» стоит цифра, не режем.
    А на стыке двух записей после хвоста разделителей начинается НАЗВАНИЕ
    следующей услуги, то есть буква. Пробел на стыке бывает, но не всегда:
        «…;;;;;;;;;;; Исходящие вызовы…»      ← с пробелом
        «…;;543,32;;;;;;в том числе НДС (22%)» ← без пробела
    Второй случай стоил нам суммы счёта: строка не резалась, «в том числе
    НДС (22%)» оставалась хвостом записи «Итого начислено», и разборщик
    колонок брал из неё «22» — итогом абонента становилось 22 ₽ вместо 543.
    Поэтому режем и по пробелу, и по букве сразу за хвостом разделителей.
    """
    if not delim:
        return lines
    # {5,} — хвост из пустых колонок Excel; дальше либо пробел и текст, либо
    # сразу буква (кириллица или латиница) — начало названия услуги.
    boundary = re.compile(
        rf"{re.escape(delim)}{{5,}}(?:\s+(?=\S)|(?=[A-Za-zА-Яа-яЁё]))")
    out: list[str] = []
    for line in lines:
        out.extend(part for part in boundary.split(line) if part.strip())
    return out


def parse_bill(text: str) -> dict[str, Any]:
    """Разобрать выгрузку счёта.

    Возвращает {'month', 'invoice', 'subscribers': {номер: {...}}, 'stats'}.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # Порядок важен и выстрадан:
    #   1. убрать следы мессенджера — иначе они приклеены к строкам счёта и
    #      мешают всему остальному;
    #   2. склеить разорванные записи;
    #   3. разрезать слипшиеся. В этом файле встречается и то, и другое.
    lines = _strip_chat_noise(lines)
    # Колонтитулы отдельной строкой убираем ДО склейки. Голая строка
    # «1411 из 1422» не кончается разделителем, поэтому _unwrap_lines считает
    # её продолжением оборванной записи и вклеивает внутрь чужих колонок.
    # Ячейку внутри строки гасит _split_service_row — там своя защита.
    lines = [ln for ln in lines if not _is_page_footer_line(ln)]
    delim = detect_delimiter(lines[:400])
    lines = _unwrap_lines(lines, delim)
    lines = _split_records(lines, delim)

    invoice: dict[str, Any] = {}
    subscribers: dict[str, dict[str, Any]] = {}
    current: str | None = None
    bill_month: str | None = None
    in_summary = False          # дошли ли до сводного блока по организации
    skipped, parsed_rows = 0, 0

    for raw_line in lines:
        line = raw_line.strip()
        if _is_garbage(line):
            # Реквизиты счёта всё же вытащим до того, как выбросить строку.
            _sniff_invoice(line, invoice, current is not None)
            continue
        _sniff_invoice(line, invoice, current is not None)

        # Схлопнутый текст строки. Именно из-за сравнения «как есть» строка
        # «Итого  начислено» (в счёте два пробела) не опознавалась итоговой
        # и ложилась в расходы обычной услугой — расход абонента удваивался.
        lo = domain.squash(line)

        # --- Начало блока абонента -----------------------------------------
        if "абонентский номер" in lo:
            m = re.search(r"(\d{9,15})", line)
            if m:
                current = _normalize_number(m.group(1))
                subscribers.setdefault(current, _blank_subscriber())
            continue

        # --- Тарифный план абонента ----------------------------------------
        if "тарифный план" in lo and current:
            quoted = re.search(r"[«\"](.+?)[»\"]", line)
            if quoted:
                subscribers[current]["plan_name"] = quoted.group(1).strip()
            month = month_from_date(line)
            if month:
                subscribers[current]["month"] = month
                bill_month = bill_month or month
            continue

        # --- Начало сводного блока по всей организации ----------------------
        # После этого заголовка идут те же услуги, но суммами по ВСЕЙ
        # организации — это и есть содержимое окна «Общая статистика».
        # А ВЫШЕ него лежит шапка счёта: балансы, пени, «Абонент:», название
        # оператора. Без этой отсечки шапка уезжала в статистику услугами —
        # «Баланс на начало периода» на два миллиона и «Руководитель» на ноль.
        if "начислено за расчетный период" in lo:
            in_summary = True
            continue

        # --- Расчётный период счёта ----------------------------------------
        if "расчётный период" in lo or "расчетный период" in lo:
            months = re.findall(r"\d{1,2}\.\d{1,2}\.\d{4}", line)
            if months:
                bill_month = bill_month or month_from_date(months[-1])
            continue

        if any(marker in lo for marker in HEADER_ROW_MARKERS):
            continue

        if delim not in line:
            continue    # заголовок раздела («Абонентская плата», «Прочие»)

        parts = line.split(delim)
        first = parts[0].strip()

        # Сводная таблица «Начисления по списку абонентских номеров»: строка
        # начинается с голого номера. Это не услуга — пропускаем, иначе номер
        # попал бы в расходы предыдущего абонента.
        if re.fullmatch(r"\d{9,15}", first):
            skipped += 1
            continue

        if current is None:
            # Сводный блок «Начислено за расчётный период» по всему счёту:
            # те же услуги, но суммы по ВСЕЙ организации. В разрезе абонентов
            # его использовать нельзя — итоги задвоились бы. Зато он и есть
            # содержимое окна «Общая статистика», поэтому складываем отдельно.
            row = _split_service_row(parts) if in_summary else None
            if row and not domain.is_meta(row["service"]) and row["service"]:
                invoice.setdefault("services", []).append({
                    "name": row["service"],
                    "volume": row["raw_volume"],
                    "no_discount": row["no_discount"],
                    "discount": row["discount"],
                    "amount": row["cost"],
                })
            skipped += 1
            continue

        sub = subscribers[current]

        # --- Итоговые строки -----------------------------------------------
        if "итого начислено" in lo:
            row = _split_service_row(parts)
            if row:
                sub["total_charged"] = row["cost"] or row["no_discount"]
            continue
        if "итого по услугам" in lo:
            continue
        if "ндс" in lo and "в т" in lo.replace("том числе", "т"):
            row = _split_service_row(parts)
            if row:
                sub["vat"] = row["cost"] or row["no_discount"]
            continue
        if domain.is_meta(first):
            continue

        row = _split_service_row(parts)
        if row is None:
            skipped += 1
            continue

        sub["items"].append(row)
        parsed_rows += 1
        if domain.is_plan_fee(row["service"]):
            sub["plan_fee"] += row["cost"]

    # Месяц: из счёта, иначе — текущий.
    fallback_month = bill_month or invoice.get("month") or date.today().strftime("%Y-%m")
    for sub in subscribers.values():
        sub["month"] = sub.get("month") or fallback_month

    # Если сводного блока «Начислено за расчётный период» в файле не было
    # (выгрузка только по абонентам), собираем свод сами из строк абонентов.
    # Данные те же, просто просуммированные — окно «Общая статистика» не
    # должно оставаться пустым из-за формата выгрузки.
    if not invoice.get("services") and subscribers:
        totals: dict[str, dict[str, Any]] = {}
        for sub in subscribers.values():
            for item in sub["items"]:
                agg = totals.setdefault(item["service"], {
                    "name": item["service"], "volume": 0.0, "unit": item["unit"],
                    "no_discount": 0.0, "discount": 0.0, "amount": 0.0, "count": 0,
                })
                agg["volume"] += item["volume"]
                agg["no_discount"] += item["no_discount"]
                agg["discount"] += item["discount"]
                agg["amount"] += item["cost"]
                agg["count"] += 1
        invoice["services"] = [
            {"name": a["name"],
             "volume": f"{a['volume']:.2f} {a['unit']}".strip() if a["unit"] else "",
             "no_discount": round(a["no_discount"], 2),
             "discount": round(a["discount"], 2),
             "amount": round(a["amount"], 2),
             "count": a["count"]}
            for a in sorted(totals.values(), key=lambda x: x["amount"], reverse=True)
        ]
        invoice["services_derived"] = True

    # СВОДНЫЕ СУММЫ, ЕСЛИ ИХ В СЧЁТЕ НЕТ.
    # Часть выгрузок приходит без шапки со сводкой — сразу блоками абонентов.
    # Раньше окно реквизитов в таком случае показывало итог ПЕРВОГО абонента
    # (111,36 ₽ вместо 14 952,93 ₽ по счёту): строка «Итого начислено» есть у
    # каждого номера, и разборщик хватал первую попавшуюся. Брать эти суммы
    # изнутри блоков запрещено, поэтому недостающее складываем сами — из
    # итогов абонентов, и честно помечаем, что это наш подсчёт, а не счёт.
    amounts = invoice.setdefault("amounts", {})
    if "total_charged" not in amounts and subscribers:
        amounts["total_charged"] = round(
            sum(s["total_charged"] or sum(i["cost"] for i in s["items"])
                for s in subscribers.values()), 2)
        vat = round(sum(s["vat"] for s in subscribers.values()), 2)
        if vat:
            amounts.setdefault("vat_total", vat)
        invoice["amounts_derived"] = True

    return {
        "month": fallback_month,
        "invoice": invoice,
        "subscribers": subscribers,
        "stats": {"rows": parsed_rows, "skipped": skipped,
                  "subscribers": len(subscribers), "delimiter": delim},
    }


def _blank_subscriber() -> dict[str, Any]:
    return {"items": [], "plan_fee": 0.0, "plan_name": "",
            "total_charged": 0.0, "vat": 0.0, "month": ""}


def _normalize_number(digits: str) -> str:
    """Привести номер к 10 цифрам (без 7/8 в начале)."""
    d = re.sub(r"\D", "", digits)
    if len(d) == 11 and d[0] in "78":
        d = d[1:]
    return d[-10:] if len(d) > 10 else d


def _is_mobile(number: str) -> bool:
    """Похоже ли это на абонентский номер: десять цифр, первая — девятка.

    ЗАЧЕМ ПРОВЕРКА. В файлах полно чисел, которые «выглядят как номер»:
    даты («31.01.2026» → 310120262), постраничные сноски («113 из 1052026»),
    лицевые счета. Раньше в список абонентов проходило всё, что длиннее
    девяти цифр, — и достаточно было по ошибке загрузить счёт как список
    сотрудников, чтобы в базе навсегда осели восемь десятков номеров-призраков.
    Корпоративные SIM в России — все 9xx, поэтому правило простое и жёсткое.
    """
    return len(number) == 10 and number.startswith("9")


# --- Реквизиты и сводные суммы счёта («Общая статистика») -------------------
# Каждое поле ищется по своему шаблону; берём ПЕРВОЕ совпадение, потому что
# шапка счёта идёт до постраничных повторов и содержит верные значения.

INVOICE_FIELDS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("account_number", re.compile(r"лицевой\s*счёт\s*:?\s*№?\s*(\d{6,})", re.I)),
    ("invoice_number", re.compile(r"с?чёт\s*№\s*([\w\-/]+)", re.I)),
    ("invoice_date", re.compile(r"с?чёт\s*№\s*[\w\-/]+\s*от\s*([\d.]{8,10})", re.I)),
    ("factura", re.compile(r"счета?-фактуры?\s*(№.+)$", re.I)),
    ("contract", re.compile(r"договор\s*:?\s*договор\s*№?\s*(.+)$", re.I)),
    ("payment_form", re.compile(r"форма\s+оплаты\s*:?\s*(.+)$", re.I)),
    ("director", re.compile(r"^руководитель[|;\s]+(.+)$", re.I)),
    ("bik", re.compile(r"БИК\s*(\d{9})")),
    ("inn_kpp", re.compile(r"(ИНН\s*\d{10,12}\s*КПП\s*\d{9})", re.I)),
    ("rs", re.compile(r"Р/с\s*(\d{20})", re.I)),
    ("ks", re.compile(r"к/с\s*(\d{20})", re.I)),
    ("bank", re.compile(r"банк\s+получателя\s*:?\s*(.+)$", re.I)),
    ("recipient", re.compile(r"наименование\s+получателя\s*:?\s*(.+)$", re.I)),
)

# Сводные суммы: «Баланс на начало периода|-2398399,11 руб.»
INVOICE_AMOUNTS: tuple[tuple[str, str], ...] = (
    ("balance_start", "баланс на начало периода"),
    ("balance_end", "баланс на конец периода"),
    ("charged", "сумма начислений"),
    ("paid", "сумма платежей"),
    ("penalty_start", "пени на начало периода"),
    ("penalty_accrued", "начисленные пени"),
    ("penalty_end", "пени на конец периода"),
    ("due_period", "всего к оплате за период"),
    ("due_total", "всего к оплате на конец периода"),
    ("days_to_pay", "количество дней для оплаты"),
    ("unpaid_previous", "не оплачено по ранее выставленным счетам"),
    ("vat_total", "в том числе ндс"),
    ("total_charged", "итого начислено"),
    ("total_vatable", "итого по услугам, облагаемым ндс"),
)


def _first_amount(line: str) -> float | None:
    """Первое денежное значение в строке после названия показателя."""
    for chunk in re.split(r"[|;\t]", line)[1:]:
        cleaned = chunk.replace("руб.", "").replace("руб", "").strip()
        if re.search(r"\d", cleaned):
            return domain.to_float(cleaned)
    # Значение может стоять в той же ячейке: «Количество дней для оплаты 45»
    m = re.search(r"(-?[\d\s ]*\d(?:[.,]\d+)?)\s*(?:руб\.?)?\s*$", line)
    return domain.to_float(m.group(1)) if m else None


def _sniff_invoice(line: str, invoice: dict[str, Any],
                  inside_subscriber: bool = False) -> None:
    """Реквизиты и сводные суммы счёта — для окна «Общая статистика».

    `inside_subscriber` — разбор идёт внутри блока конкретного номера.
    Тогда сводные суммы НЕ берём: строка «Итого начислено» там своя,
    абонентская. Без этой оговорки итогом всего счёта становился итог
    ПЕРВОГО абонента — в выгрузке за январь окно реквизитов показывало
    111,36 ₽ вместо 14 952,93 ₽ по счёту.
    """
    for key, pattern in INVOICE_FIELDS:
        if key in invoice:
            continue
        m = pattern.search(line)
        if m:
            value = m.group(1).strip().strip('"').strip("|;").strip()
            if value:
                invoice[key] = value

    if inside_subscriber:
        return
    lo = " ".join(line.lower().replace("ё", "е").split())
    amounts = invoice.setdefault("amounts", {})
    for key, marker in INVOICE_AMOUNTS:
        if key in amounts:
            continue
        if lo.startswith(marker.replace("ё", "е")):
            value = _first_amount(line)
            if value is not None:
                amounts[key] = value

    if "period" not in invoice and ("расчётный период" in line.lower() or "расчетный период" in line.lower()):
        dates = re.findall(r"\d{1,2}\.\d{1,2}\.\d{4}", line)
        if len(dates) >= 2:
            invoice["period"] = f"{dates[0]} – {dates[1]}"
            invoice["period_start"], invoice["period_end"] = dates[0], dates[1]
            invoice["month"] = month_from_date(dates[1])
        elif dates:
            invoice["month"] = month_from_date(dates[0])

    # «Оператор:» и «Абонент:» в плоской выгрузке нередко стоят в одной строке
    # двумя колонками. Тогда после двоеточия окажется не название, а вторая
    # подпись — такие значения отбрасываем.
    for key, marker in (("subscriber_name", "абонент:"), ("operator_name", "оператор:")):
        if key in invoice or not lo.startswith(marker):
            continue
        name = line.split(":", 1)[1].strip().strip('"').strip("|;").strip()
        if name and ":" not in name and "номер" not in name.lower():
            invoice[key] = name


# ═══════════════════════════════════════════════════════════════════════════
#  Парсер списка сотрудников (tablespisok)
# ═══════════════════════════════════════════════════════════════════════════

COLUMN_ALIASES = {
    "number": ("абонентский номер", "номер телефона", "телефон", "номер"),
    "limit": ("лимит",),
    "username": ("фио", "сотрудник", "работник", "ф.и.о"),
    "position": ("должность",),
    "personnel_no": ("табельный номер", "табельный", "таб. номер"),
    "note": ("прочие", "примечание", "комментарий"),
}

MONEY_TOKEN = re.compile(r"^-?\d{1,3}(?:[  ]?\d{3})*(?:[.,]\d+)?$")


def _match_column(header: str) -> str | None:
    h = " ".join(str(header or "").lower().replace("ё", "е").split())
    if not h:
        return None
    for key, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if h == alias:
                return key
    for key, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in h:
                return key
    return None


def _looks_like_header(line: str) -> bool:
    lo = domain.squash(line)
    return ("номер" in lo and ("лимит" in lo or "фио" in lo)) or ("лимит" in lo and "фио" in lo)


def parse_roster(text: str) -> dict[str, Any]:
    """Разобрать список сотрудников: номер, лимит, ФИО, должность + история.

    Поддерживаются два вида файла:
      * с разделителем (';', '|', табуляция) — обычный экспорт из Excel;
      * «как есть» из буфера обмена, где колонки разделены пробелами —
        тогда раскладка восстанавливается позиционно (см. `_parse_spaced_row`).
    """
    lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    lines = [ln for ln in lines if ln.strip()]
    if not lines:
        return {"rows": [], "months": [], "stats": {"rows": 0, "skipped": 0}}

    delim = detect_delimiter(lines[:200])
    delimited = any(delim in ln for ln in lines[:200])

    header_idx = next((i for i, ln in enumerate(lines[:50]) if _looks_like_header(ln)), None)
    columns: dict[str, int] = {}
    month_columns: list[tuple[int, str]] = []

    if header_idx is not None and delimited:
        cells = [c.strip() for c in lines[header_idx].split(delim)]
        for idx, cell in enumerate(cells):
            key = _match_column(cell)
            if key and key not in columns:
                columns[key] = idx
            month = parse_month_label(cell)
            if month:
                month_columns.append((idx, month))
    elif header_idx is not None:
        # Пробельный файл: колонки не разделить, но заголовок даёт список месяцев
        # в том же порядке, в каком идут числовые значения в строках.
        month_columns = list(enumerate(_months_from_free_header(lines[header_idx])))

    body = lines[header_idx + 1:] if header_idx is not None else lines
    rows: list[dict[str, Any]] = []
    skipped = 0

    for line in body:
        if _is_garbage(line) or _looks_like_header(line):
            continue
        row = (_parse_delimited_row(line, delim, columns, month_columns) if delimited
               else _parse_spaced_row(line, month_columns))
        if row is None:
            skipped += 1
            continue
        rows.append(row)

    return {
        "rows": rows,
        "months": [m for _, m in month_columns],
        "stats": {"rows": len(rows), "skipped": skipped,
                  "delimiter": delim if delimited else "space",
                  "month_columns": len(month_columns)},
    }


def _months_from_free_header(header: str) -> list[str]:
    """Достать месяцы из заголовка, разделённого одиночными пробелами."""
    tokens = header.split()
    out: list[str] = []
    i = 0
    while i < len(tokens):
        pair = " ".join(tokens[i:i + 2])
        month = parse_month_label(pair)
        if month:
            out.append(month)
            i += 2
            continue
        month = parse_month_label(tokens[i])
        if month:
            out.append(month)
        i += 1
    return out


def _cell(cells: list[str], idx: int | None) -> str:
    if idx is None or idx >= len(cells):
        return ""
    return cells[idx].strip()


def _parse_delimited_row(line: str, delim: str, columns: dict[str, int],
                         month_columns: list[tuple[int, str]]) -> dict[str, Any] | None:
    cells = [c.strip() for c in line.split(delim)]
    number_raw = _cell(cells, columns.get("number", 0))
    digits = re.sub(r"\D", "", number_raw)
    number = _normalize_number(digits)
    if not _is_mobile(number):
        return None
    history = {}
    for idx, month in month_columns:
        value = _cell(cells, idx)
        if value:
            amount = domain.to_float(value)
            if amount:
                history[month] = amount
    return {
        "number": number,
        "limit": domain.to_int(_cell(cells, columns.get("limit"))),
        "username": _cell(cells, columns.get("username")),
        "position": _cell(cells, columns.get("position")),
        "personnel_no": _cell(cells, columns.get("personnel_no")),
        "note": _cell(cells, columns.get("note")),
        "history": history,
    }


def _parse_spaced_row(line: str, month_columns: list[tuple[int, str]]) -> dict[str, Any] | None:
    """Разобрать строку, где колонки разделены пробелами.

    Раскладка восстанавливается позиционно: номер, лимит, затем текстовые поля
    (ФИО / должность / прочие), затем сплошной «хвост» из чисел — помесячные
    расходы. Хвост определяем как самую длинную концевую последовательность
    числовых токенов.
    """
    tokens = line.split()
    if len(tokens) < 2:
        return None
    number = _normalize_number(re.sub(r"\D", "", tokens[0]))
    if not _is_mobile(number):
        return None

    limit = domain.to_int(tokens[1]) if MONEY_TOKEN.match(tokens[1]) else 0
    rest = tokens[2:] if MONEY_TOKEN.match(tokens[1]) else tokens[1:]

    tail_start = len(rest)
    while tail_start > 0 and MONEY_TOKEN.match(rest[tail_start - 1]):
        tail_start -= 1
    text_tokens, money_tokens = rest[:tail_start], rest[tail_start:]

    # ФИО — первые три слова (фамилия, имя, отчество), остальное — должность.
    username = " ".join(text_tokens[:3])
    position = " ".join(text_tokens[3:])

    history = {}
    for i, (_, month) in enumerate(month_columns):
        if i >= len(money_tokens):
            break
        amount = domain.to_float(money_tokens[i])
        if amount:
            history[month] = amount

    return {
        "number": number,
        "limit": limit,
        "username": username,
        "position": position,
        "personnel_no": "",
        "note": "",
        "history": history,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  РАЗБОР СПИСКА КОМАНДИРОВОК
#
#  Формат взят из вашей выгрузки (komandirovki). Шапка занимает ДВЕ строки,
#  потому что часть заголовков объединена:
#
#      A                 B     C          D          E      F+G          H            I
#      Абонентский номер ФИО   период командировки   Страна Примечание   Утверждено   № СЗ
#                              начало     конец             Номер  Дата  (да/нет)
#      9111111111  Картофель Д.Г.  24.06.2023 01.07.2023 Китай 41111111 23.06.2023 да
#
#  Разбор НЕ привязан к номерам колонок: у разных выгрузок порядок и число
#  колонок отличаются. Поэтому:
#      * номер абонента ищем как первое поле из 10–11 цифр;
#      * две даты периода — первые две даты в строке;
#      * страна — первое текстовое поле после дат;
#      * «да/нет» — признак утверждения.
#  Так файл читается, даже если добавили или переставили колонку.
# ═══════════════════════════════════════════════════════════════════════════

# Дата в формате ДД.ММ.ГГГГ (в выгрузке используется только он).
_TRIP_DATE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b")

# Слова шапки — по ним строка распознаётся как заголовок и пропускается.
_TRIP_HEADER_KW = ("абонентский номер", "фио", "период командировки",
                   "страна", "утверждено", "примечание", "номер заказа")


def _iso_date(text: str) -> str:
    """ДД.ММ.ГГГГ → ГГГГ-ММ-ДД. В базе даты хранятся сортируемым форматом."""
    m = _TRIP_DATE.search(str(text or ""))
    if not m:
        return ""
    day, month, year = m.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


def _is_trip_header(line: str) -> bool:
    lo = " ".join(str(line).lower().replace("ё", "е").split())
    return sum(1 for kw in _TRIP_HEADER_KW if kw in lo) >= 2


# Заголовок → ключ колонки. Ищем вхождением, потому что подписи в разных
# выгрузках отличаются: «Утверждено (да/нет)», «Утверждено», «Согласовано».
_TRIP_COLUMNS = (
    ("number", ("абонентский номер", "номер телефона", "телефон")),
    ("username", ("фио", "сотрудник", "ф.и.о")),
    ("country", ("страна",)),
    ("order_no", ("номер заказа", "заказ")),
    ("approved", ("утверждено", "согласовано")),
    ("memo_no", ("сз", "служебная записка")),
)


def _trip_header_map(line: str, delim: str) -> dict[str, int]:
    """Сопоставить колонки файла с полями по тексту заголовка."""
    cells = [" ".join(c.strip().strip('"').lower().replace("ё", "е").split())
             for c in line.split(delim)]
    out: dict[str, int] = {}
    for key, aliases in _TRIP_COLUMNS:
        for idx, cell in enumerate(cells):
            if cell and any(a in cell for a in aliases) and key not in out:
                out[key] = idx
    return out


def parse_trips(text: str) -> dict[str, Any]:
    """Разобрать выгрузку командировок в строки для таблицы business_trips.

    Две стратегии, в порядке надёжности:

      1. ПО ЗАГОЛОВКУ. Если в файле есть строка «Абонентский номер | ФИО |
         … | Страна | … | Утверждено», берём значения из этих колонок.
      2. ПО СОДЕРЖИМОМУ. Заголовка нет — угадываем: номер это поле из 10–11
         цифр, период — первые две даты, страна — текстовое поле и т.д.

    ИСПРАВЛЕНО: сначала работала только вторая стратегия. Она разваливалась,
    если в ФИО есть цифры («Сотрудник 9596»): такое поле не считалось
    текстовым, именем становилась страна, а «№ СЗ» подхватывал цифры из
    фамилии. Теперь при наличии заголовка колонки берутся строго по нему.
    """
    lines = [ln.rstrip() for ln in
             text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    lines = [ln for ln in lines if ln.strip()]
    if not lines:
        return {"rows": [], "stats": {"rows": 0, "skipped": 0}}

    delim = detect_delimiter(lines[:200])
    # Шапка ДВУХСТРОЧНАЯ: в первой строке «Примечание» на две колонки, во
    # второй — подписи «Номер заказа | Дата». Поэтому не выбираем одну лучшую
    # строку, а СКЛАДЫВАЕМ находки со всех строк шапки: первая найденная
    # колонка для каждого поля побеждает. Без этого «Номер заказа» терялся.
    columns: dict[str, int] = {}
    header_rows = 0
    for line in lines[:20]:
        if delim not in line:
            continue
        found = _trip_header_map(line, delim)
        if not found:
            continue
        # Строка шапки — либо явная (два ключевых слова), либо строка
        # подзаголовков сразу под ней.
        if _is_trip_header(line) or header_rows:
            header_rows += 1
            for key, idx in found.items():
                columns.setdefault(key, idx)
        if header_rows >= 2:
            break

    rows: list[dict[str, Any]] = []
    skipped = 0

    def cell(cells: list[str], key: str) -> str:
        idx = columns.get(key)
        return cells[idx].strip() if idx is not None and idx < len(cells) else ""

    for line in lines:
        if _is_trip_header(line):
            continue

        cells = [c.strip().strip('"') for c in line.split(delim)] if delim in line \
            else line.split()

        # 1. Абонентский номер. Из колонки заголовка, иначе — первое поле
        #    из 10–11 цифр.
        #    ВНИМАНИЕ: переменная цикла названа `raw`, а не `cell` — иначе она
        #    затирала бы функцию cell() выше и разбор падал бы с
        #    «'str' object is not callable».
        number = ""
        by_header = cell(cells, "number")
        if by_header:
            digits = re.sub(r"\D", "", by_header)
            if 10 <= len(digits) <= 11:
                number = _normalize_number(digits)
        if not number:
            for raw in cells:
                digits = re.sub(r"\D", "", raw)
                if 10 <= len(digits) <= 11:
                    number = _normalize_number(digits)
                    break
        if not number:
            skipped += 1
            continue

        # 2. Даты: первые две в строке — период командировки, третья (если
        #    есть) — дата заявки из блока «Примечание».
        dates = [f"{y}-{int(m):02d}-{int(d):02d}"
                 for d, m, y in _TRIP_DATE.findall(line)]
        date_start = dates[0] if dates else ""
        date_end = dates[1] if len(dates) > 1 else date_start
        order_date = dates[2] if len(dates) > 2 else ""

        # 3–6. Остальные поля. Если заголовок разобран — берём строго по нему;
        #      иначе угадываем по содержимому (см. докстроку функции).
        username = cell(cells, "username")
        country = cell(cells, "country")
        order_no = re.sub(r"\D", "", cell(cells, "order_no"))
        memo_no = re.sub(r"\D", "", cell(cells, "memo_no"))
        approved_cell = cell(cells, "approved").lower()

        if "approved" in columns:
            approved = approved_cell in ("да", "yes", "+", "1")
        else:
            # Отдельная ячейка «да», а не подстрока: иначе «Данные» сойдёт за «да».
            approved = any(c.strip().lower() in ("да", "yes", "+", "1") for c in cells)

        if not columns:
            # Запасной путь: ФИО — самое длинное поле без цифр, страна — сле́дующее.
            text_cells = [c for c in cells if c and not re.search(r"\d", c)]
            username = max(text_cells, key=len) if text_cells else ""
            for c in text_cells:
                if c != username and c.lower() not in ("да", "нет", "-", "—"):
                    country = c
                    break
            for c in cells:
                digits = re.sub(r"\D", "", c)
                if not digits or digits == re.sub(r"\D", "", number) or _TRIP_DATE.search(c):
                    continue
                if len(digits) >= 6 and not order_no:
                    order_no = digits
                elif len(digits) <= 5 and not memo_no:
                    memo_no = digits

        rows.append({
            "number": number, "username": username,
            "date_start": date_start, "date_end": date_end,
            "country": country, "order_no": order_no,
            "order_date": order_date, "approved": approved,
            "memo_no": memo_no,
        })

    return {
        "rows": rows,
        "stats": {"rows": len(rows), "skipped": skipped,
                  "approved": sum(1 for r in rows if r["approved"]),
                  "delimiter": delim},
    }


def apply_roster(parsed: dict[str, Any]) -> dict[str, Any]:
    """Записать разобранный список в хранилище.

    Весь список пишется ОДНОЙ транзакцией. Дело не только в целостности:
    каждый выход в базу — это отдельный запуск psql, и на списке в двести
    строк поштучная запись превращается в минуты ожидания.
    """
    applied, with_limit, with_history = 0, 0, 0
    # Справочники материализуются ДО транзакции, а не внутри: заливка сама
    # читает базу после записи, а внутри блока команды ещё не отправлены.
    queries.ensure_reference_data()
    with db.transaction():
        for row in parsed["rows"]:
            queries.upsert_user(
                row["number"],
                username=row["username"],
                limit=row["limit"],
                position=row["position"],
                personnel_no=row["personnel_no"],
                note=row["note"],
                fetch=False,
            )
            applied += 1
            if 0 < row["limit"] < domain.LIMIT_SENTINEL:
                with_limit += 1
            if row["history"]:
                queries.set_roster_history(row["number"], row["history"])
                with_history += 1
    return {"applied": applied, "with_limit": with_limit,
            "with_history": with_history, "months": parsed["months"],
            "stats": parsed["stats"]}


def apply_bill(parsed: dict[str, Any]) -> dict[str, Any]:
    """Записать разобранный счёт в хранилище.

    Несколько счетов за разные месяцы накапливаются — так набирается реальная
    история. Повторная загрузка того же месяца перезаписывает его целиком.
    """
    saved = 0
    # СНАЧАЛА СПРАВОЧНИКИ, ПОТОМ ДАННЫЕ. Это и есть момент, когда база
    # перестаёт быть пустой: до первой загрузки в ней нет ни одной строки,
    # ни данных, ни справочников. Здесь ложатся оба разом — расчёт без
    # правил чипса и правил оплаты посчитал бы не то.
    #
    # Обязательно ДО транзакции: заливка справочников сама читает базу между
    # записями, а внутри db.transaction() команды только копятся в буфере и
    # своих же незакоммиченных строк не видят.
    queries.ensure_reference_data()

    # Весь счёт — одна транзакция: и целостнее, и на порядок быстрее, чем
    # отдельный поход в базу на каждого абонента.
    with db.transaction():
        for number, sub in parsed["subscribers"].items():
            if not sub["items"]:
                continue
            queries.save_report(
                number, sub["month"], sub["items"],
                report_date=sub["month"],
                plan_name=sub["plan_name"],
                total_charged=sub["total_charged"],
                vat=sub["vat"],
            )
            saved += 1

    # Реквизиты — уже ПОСЛЕ транзакции. Если в них не указан период,
    # set_invoice берёт последний загруженный, а увидеть его можно только
    # когда счёт уже лежит в базе.
    if parsed["invoice"]:
        queries.set_invoice(parsed["invoice"])
    return {"saved": saved, "month": parsed["month"], "stats": parsed["stats"]}


# ═══════════════════════════════════════════════════════════════════════════
#  Сборка представлений (то, что уезжает на фронтенд)
# ═══════════════════════════════════════════════════════════════════════════

def _tariff_cost_of(bundle: dict[str, Any]) -> float:
    """Тарифозависимая часть счёта: абонплата + минуты/SMS/интернет.

    ИСПРАВЛЕНО: роуминг исключён — так же, как в domain.build_record.
    Иначе среднее по истории считалось бы по другой формуле, чем текущий
    месяц, и рекомендация опиралась бы на две несопоставимые величины.
    """
    total = 0.0
    for it in bundle["items"]:
        if domain.is_plan_fee(it["service"]):
            total += it["cost"]
        elif (it["cat"] in domain.CATEGORY_ORDER
              and not domain.is_addon(it["service"])
              and not domain.is_roaming(it["service"])):
            total += it["cost"]
    return total


def _averages(history: list[dict[str, Any]],
              bundles: list[dict[str, Any]]) -> tuple[float | None, float | None]:
    """Средний расход и средняя тарифозависимая часть по всей истории номера."""
    avg_total = (sum(h["total"] for h in history) / len(history)) if history else None
    avg_tariff = (sum(_tariff_cost_of(b) for b in bundles) / len(bundles)) if bundles else None
    return avg_total, avg_tariff


def build_month_view(month: str) -> dict[str, Any]:
    catalog = domain.normalize_catalog(queries.get_tariffs())

    # Справочники для разделения оплаты читаем ОДИН раз на весь отчёт.
    # Если читать их внутри цикла, на сотне абонентов получится сотня
    # лишних запросов к базе за одними и теми же строками.
    resolver = billing.PayerResolver(
        colors=queries.get_chip_colors(),
        marks=queries.get_chip_marks(),
        rules=queries.get_payment_rules(only_enabled=True),
    )

    # ВСЁ ОСТАЛЬНОЕ — ТОЖЕ ОДНИМ НАБОРОМ ЗАПРОСОВ. История, потребление по
    # категориям, профили, командировки и чипсы читаются на весь парк сразу
    # (queries.month_dataset), а ниже разбираются по номерам уже в памяти.
    # Пока это делалось «по номеру», главный экран на сотне абонентов
    # открывался минутами: полторы тысячи обращений к базе на один отчёт.
    data = queries.month_dataset(month)
    chips = data["chips"]

    # Счета расчётного месяца берём из того же набора: перечитывать их
    # отдельным запросом незачем, они уже прочитаны.
    month_bundles = sorted(
        (b for own in data["bundles"].values() for b in own if b["month"] == data["month"]),
        key=lambda b: b["number"])

    records = []
    for bundle in month_bundles:
        number = bundle["number"]
        own_bundles = data["bundles"].get(number, [])
        history = queries.history_rows(own_bundles, data["roster"].get(number, {}))
        avg_total, avg_tariff = _averages(history, own_bundles)
        record = domain.build_record(
            number, bundle["items"],
            month=bundle["month"],
            profile=queries.dataset_profile(data, number),
            catalog=catalog,
            plan_name=bundle["plan_name"],
            total_charged=bundle["total_charged"],
            avg_total=avg_total,
            avg_tariff_cost=avg_tariff,
        )
        record["history"] = history
        record["category_history"] = queries.category_rows(own_bundles)
        record["trend"] = _trend_percent(record["history"], bundle["month"])

        # НОВОЕ: разделение «мы / сотрудник» и расчёт впустую потраченного.
        chip = chips.get(number) or queries.blank_chip(number)
        trip = queries.pick_trip(data["trips"].get(number, []), bundle["month"])
        record["chip"] = chip
        record["trip"] = trip
        record["payment"] = billing.split_payment(
            bundle["items"], chip=chip, resolver=resolver,
            on_trip=bool(record.get("on_trip")), trip=trip,
        )
        record["waste"] = billing.waste_of(record, record["payment"])
        records.append(record)

    # Индекс невыгодности считается по всему парку сразу, поэтому только
    # после того, как собраны все записи.
    billing.assign_waste_index(records)

    records.sort(key=lambda r: (r["saving"], r["total"]), reverse=True)
    return {
        "month": month,
        "months": queries.months(),
        "subscribers": records,
        "summary": domain.build_summary(records),
        "payment_summary": billing.summarize(records),
        "tariff_stats": domain.build_tariff_stats(records),
        "trend": queries.trend(),
        "invoice": queries.get_invoice(),
        "tariffs": catalog,
        "statuses": queries.get_statuses(),
        "chip_colors": queries.get_chip_colors(),
        "chip_marks": queries.get_chip_marks(),
        # Единый список правил (цвета + пометки) — интерфейс
        # показывает их одной группой, без искусственного деления.
        "chip_rules": queries.get_chip_rules(),
        # Командировки идут вместе с отчётом, чтобы таблица на главной
        # рисовалась сразу, без отдельного запроса при каждой перерисовке.
        "trips": queries.get_trips(),
    }


def _trend_percent(history: list[dict[str, Any]], month: str) -> float:
    """Изменение расхода к предыдущему месяцу, в процентах."""
    idx = next((i for i, h in enumerate(history) if h["month"] == month), len(history) - 1)
    if idx <= 0:
        return 0.0
    prev = history[idx - 1]["total"]
    if prev <= 0:
        return 0.0
    return round((history[idx]["total"] - prev) / prev * 100, 1)


def build_subscriber_view(number: str, month: str | None = None) -> dict[str, Any]:
    catalog = domain.normalize_catalog(queries.get_tariffs())
    bundles = queries.bundles_for_number(number)
    if not bundles:
        return {}
    bundle = next((b for b in bundles if b["month"] == month), bundles[-1])
    history = queries.history_rows(bundles, queries.get_roster_history(number))
    avg_total, avg_tariff = _averages(history, bundles)
    record = domain.build_record(
        number, bundle["items"],
        month=bundle["month"],
        profile=queries.get_profile(number, bundle["month"]),
        catalog=catalog,
        plan_name=bundle["plan_name"],
        total_charged=bundle["total_charged"],
        avg_total=avg_total,
        avg_tariff_cost=avg_tariff,
    )
    record["history"] = history
    record["category_history"] = queries.category_rows(bundles)
    record["trend"] = _trend_percent(record["history"], bundle["month"])
    record["months"] = [b["month"] for b in bundles]
    return record


# ═══════════════════════════════════════════════════════════════════════════
#  multipart/form-data
# ═══════════════════════════════════════════════════════════════════════════

def parse_multipart(body: bytes, content_type: str) -> dict[str, bytes]:
    """Минимальный разбор multipart/form-data → {имя поля: содержимое}."""
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.lower().startswith("boundary="):
            boundary = part[9:].strip().strip('"')
            break
    if not boundary:
        return {}

    sep = b"--" + boundary.encode("latin-1")
    fields: dict[str, bytes] = {}
    for chunk in body.split(sep):
        if not chunk or chunk in (b"--", b"--\r\n", b"\r\n"):
            continue
        head_end = chunk.find(b"\r\n\r\n")
        if head_end == -1:
            continue
        headers = chunk[:head_end].decode("utf-8", errors="replace")
        content = chunk[head_end + 4:]
        if content.endswith(b"\r\n"):
            content = content[:-2]
        name_m = re.search(r'name="([^"]*)"', headers)
        name = name_m.group(1) if name_m else "file"
        fields[name] = content
    return fields


# ═══════════════════════════════════════════════════════════════════════════
#  СТРАНИЦА СЫРЫХ СТРОК  (/raw)
#
#  Собирается НА СЕРВЕРЕ, обычным HTML, без единой строчки JavaScript. Это не
#  лень, а требование площадки: в закрытом контуре на Астре смотреть базу
#  нечем — ни pgAdmin, ни клиента постгреса там нет. Страница должна
#  открываться в любом браузере, который найдётся на машине, и работать даже
#  если основной скрипт приложения не загрузился.
#
#  Формы отправляются методом GET: тогда фильтр целиком лежит в адресной
#  строке, и ссылку на конкретную выборку можно просто переслать коллеге.
# ═══════════════════════════════════════════════════════════════════════════

RAW_PAGE_CSS = """
  body { margin: 0; padding: 16px; background: #10201b; color: #dfe9e4;
         font: 14px/1.45 "Segoe UI", Arial, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #8fa79d; margin-bottom: 14px; }
  .sub a { color: #6fd0a8; }
  form { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end;
         margin-bottom: 14px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px;
          color: #8fa79d; }
  input { background: #163029; border: 1px solid #2b4c42; border-radius: 6px;
          color: #eef6f2; padding: 7px 9px; font-size: 14px; min-width: 150px; }
  button, .btn { background: #2f8f6b; border: 0; border-radius: 6px;
                 color: #fff; padding: 8px 16px; font-size: 14px;
                 cursor: pointer; text-decoration: none; display: inline-block; }
  .btn.ghost { background: #2b4c42; }
  .wrap { overflow-x: auto; border: 1px solid #2b4c42; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; white-space: nowrap; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #1e3b33; text-align: left; }
  th { background: #163029; position: sticky; top: 0; font-size: 12px;
       text-transform: uppercase; letter-spacing: .04em; color: #8fa79d; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: #16302980; }
  .pager { display: flex; gap: 8px; align-items: center; margin-top: 12px;
           flex-wrap: wrap; }
  .empty { padding: 24px; text-align: center; color: #8fa79d; }
"""

# Колонки с деньгами и объёмами прижимаем вправо: столбик цифр читается
# только когда разряды стоят друг под другом.
RAW_NUMERIC = {"no_discount", "discount", "with_discount", "total_charged",
               "vat", "parameter_id", "report_id", "value_id"}


def _raw_query_string(filters: dict[str, str], **extra: Any) -> str:
    """Собрать адрес выборки: фильтры плюс постраничные параметры."""
    params = {k: v for k, v in filters.items() if v}
    params.update({k: v for k, v in extra.items() if v not in (None, "")})
    return urllib.parse.urlencode(params)


def render_raw_page(data: dict[str, Any]) -> bytes:
    """Нарисовать таблицу сырых строк."""
    filters = data["filters"]
    limit, offset, total = data["limit"], data["offset"], data["total"]

    def field(name: str, title: str, value: str) -> str:
        return (f'<label>{html.escape(title)}'
                f'<input name="{name}" value="{html.escape(value)}"></label>')

    head = "".join(f"<th>{html.escape(c['title'])}</th>" for c in data["columns"])

    body = []
    for row in data["rows"]:
        cells = []
        for column in data["columns"]:
            key = column["key"]
            value = row.get(key)
            text = "" if value is None else str(value)
            css = ' class="num"' if key in RAW_NUMERIC else ""
            cells.append(f"<td{css}>{html.escape(text)}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")

    if body:
        table = (f'<div class="wrap"><table><thead><tr>{head}</tr></thead>'
                 f'<tbody>{"".join(body)}</tbody></table></div>')
    else:
        table = ('<div class="wrap"><div class="empty">Ничего не найдено. '
                 'Проверьте фильтры или загрузите отчёт.</div></div>')

    # Постраничный обход. Кнопки показываем только когда им есть куда вести,
    # чтобы не тыкать в неработающее.
    pager = [f'<span>Показано {len(data["rows"])} из {total}, '
             f'начиная с {offset + 1 if data["rows"] else 0}</span>']
    if offset > 0:
        back = _raw_query_string(filters, limit=limit, offset=max(0, offset - limit))
        pager.append(f'<a class="btn ghost" href="/raw?{back}">← Предыдущие</a>')
    if offset + limit < total:
        fwd = _raw_query_string(filters, limit=limit, offset=offset + limit)
        pager.append(f'<a class="btn ghost" href="/raw?{fwd}">Следующие →</a>')

    csv_link = _raw_query_string(filters, limit=queries.RAW_LIMIT_MAX)

    page = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сырые строки счёта</title>
<style>{RAW_PAGE_CSS}</style></head>
<body>
  <h1>Сырые строки счёта</h1>
  <div class="sub">Содержимое таблиц <b>reports</b> и <b>pvalues</b> как есть,
    без пересчётов и правил. <a href="/">← к анализу</a></div>
  <form method="get" action="/raw">
    {field("month", "Период (2026-06)", filters.get("month", ""))}
    {field("number", "Номер", filters.get("number", ""))}
    {field("service", "Услуга", filters.get("service", ""))}
    {field("limit", "Строк на странице", str(limit))}
    <button type="submit">Показать</button>
    <a class="btn ghost" href="/api/raw.csv?{csv_link}">Скачать CSV</a>
  </form>
  {table}
  <div class="pager">{"".join(pager)}</div>
</body></html>"""
    return page.encode("utf-8")


def render_raw_csv(data: dict[str, Any]) -> bytes:
    """Выгрузка сырых строк в CSV.

    Точка с запятой и BOM — те же, что у convert.py: с ними файл открывается
    двойным щелчком и в Excel, и в LibreOffice, без мастера импорта.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow([c["title"] for c in data["columns"]])
    for row in data["rows"]:
        writer.writerow(["" if row.get(c["key"]) is None else row[c["key"]]
                         for c in data["columns"]])
    return buffer.getvalue().encode("utf-8-sig")


# ═══════════════════════════════════════════════════════════════════════════
#  HTTP
# ═══════════════════════════════════════════════════════════════════════════

class DictEndpoint(NamedTuple):
    """Описание одной ручки-справочника.

    Три справочника — цвета, пометки, правила оплаты — обслуживались шестью
    почти дословно одинаковыми блоками кода. Отличались они ровно четырьмя
    вещами, которые здесь и перечислены; сам обработчик теперь один.

    field    — под каким именем справочник уезжает в ответе;
    save     — что вызвать при сохранении;
    delete   — что вызвать при удалении;
    key_of   — как достать ключ удаляемой записи из тела запроса
               (у цветов и пометок это строковый код, у правил — числовой id);
    expects  — текст ошибки, если прислали не объект.
    """
    field: str
    save: Any
    delete: Any
    key_of: Any
    expects: str


_DICT_ENDPOINTS: dict[str, DictEndpoint] = {
    "/api/chip-colors": DictEndpoint(
        "colors", queries.save_chip_color, queries.delete_chip_color,
        lambda p: str(p.get("code") or ""), "Ожидается объект цвета"),
    "/api/chip-marks": DictEndpoint(
        "marks", queries.save_chip_mark, queries.delete_chip_mark,
        lambda p: str(p.get("code") or ""), "Ожидается объект пометки"),
    "/api/payment-rules": DictEndpoint(
        "rules", queries.save_payment_rule, queries.delete_payment_rule,
        lambda p: domain.to_int(p.get("id")), "Ожидается объект правила"),
    "/api/roaming": DictEndpoint(
        "zones", queries.save_roaming_zone, queries.delete_roaming_zone,
        lambda p: str(p.get("code") or ""), "Ожидается объект зоны роуминга"),
}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "MegafonAnalytics/2.0"
    protocol_version = "HTTP/1.1"

    # --- ответы ----------------------------------------------------------
    def _send(self, code: int, body: bytes, content_type: str,
              extra: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, data: Any) -> None:
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _error(self, code: int, message: str) -> None:
        self._json(code, {"error": message})

    # --- маршруты --------------------------------------------------------
    def do_OPTIONS(self) -> None:            # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:               # noqa: N802
        self.do_GET()

    # Браузер имеет полное право уйти, не дочитав ответ: человек закрыл
    # вкладку, нажал F5 на медленном отчёте, свернул ноутбук. Для сокета это
    # обрыв, и запись в него бросает ConnectionError.
    #
    # ОТВЕЧАТЬ НА ЭТО ОШИБКОЙ 500 НЕЛЬЗЯ — писать всё равно некуда, вторая
    # запись бросит то же самое уже мимо обработчика, и в консоль уедет
    # двухэкранная трассировка. В закрытом контуре, где консоль сервера и есть
    # единственный признак жизни, это выглядит как падение приложения, хотя
    # не случилось ровно ничего.
    def do_GET(self) -> None:                # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if path == "/raw":
                return self._raw_page(query)
            if path.startswith("/api/"):
                return self._api_get(path, query)
            return self._static(path)
        except ConnectionError:
            return self._client_gone("GET", path)
        except Exception as exc:                          # noqa: BLE001
            self.log_error("GET %s failed: %s", path, exc)
            self._reply_error(500, f"Внутренняя ошибка: {exc}")

    def do_POST(self) -> None:               # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        try:
            self._api_post(path)
        except ConnectionError:
            return self._client_gone("POST", path)
        except ValueError as exc:
            self._reply_error(400, str(exc))
        except Exception as exc:                          # noqa: BLE001
            self.log_error("POST %s failed: %s", path, exc)
            self._reply_error(500, f"Внутренняя ошибка: {exc}")

    def _client_gone(self, method: str, path: str) -> None:
        """Клиент отвалился. Это не ошибка сервера — строчкой в лог и всё."""
        self.close_connection = True
        self.log_message("%s %s — клиент закрыл соединение", method, path)

    def _reply_error(self, code: int, message: str) -> None:
        """Отправить ошибку, пережив обрыв соединения на самой отправке."""
        try:
            self._error(code, message)
        except ConnectionError:
            self.close_connection = True

    # --- сырые строки счёта ----------------------------------------------
    def _raw_filters(self, query: dict[str, list[str]]) -> dict[str, Any]:
        """Разобрать параметры адресной строки для страницы /raw."""
        def one(name: str, default: str = "") -> str:
            return (query.get(name) or [default])[0].strip()

        def num(name: str, default: int) -> int:
            try:
                return int(one(name) or default)
            except ValueError:
                return default

        return queries.raw_rows(
            month=one("month"), number=one("number"), service=one("service"),
            limit=num("limit", 200), offset=num("offset", 0))

    def _raw_page(self, query: dict[str, list[str]]) -> None:
        data = self._raw_filters(query)
        self._send(200, render_raw_page(data), "text/html; charset=utf-8")

    # --- GET API ---------------------------------------------------------
    def _api_get(self, path: str, query: dict[str, list[str]]) -> None:
        if path == "/api/raw.csv":
            data = self._raw_filters(query)
            self._send(200, render_raw_csv(data), "text/csv; charset=utf-8",
                       extra={"Content-Disposition":
                              'attachment; filename="raw_rows.csv"'})
            return
        if path == "/api/health":
            return self._json(200, {"ok": True, "storage": queries.stats(),
                                    "month": queries.latest_month()})
        if path == "/api/months":
            return self._json(200, {"months": queries.months(),
                                    "latest": queries.latest_month()})
        if path == "/api/tariffs":
            return self._json(200, {"tariffs": queries.get_tariffs()})
        if path == "/api/trend":
            return self._json(200, {"trend": queries.trend()})
        if path == "/api/statuses":
            return self._json(200, {"statuses": queries.get_statuses()})
        if path == "/api/invoice":
            invoice = queries.get_invoice()
            month = queries.latest_month()
            # Свод по услугам есть не во всякой выгрузке — тогда считаем его
            # сами по сохранённым строкам, чтобы окно не осталось пустым.
            if not invoice.get("services") and month:
                invoice["services"] = queries.services_summary(month)
                invoice["services_derived"] = True
            return self._json(200, {"invoice": invoice, "month": month,
                                    "months": queries.months(),
                                    "storage": queries.stats()})
        if path == "/api/users":
            return self._json(200, {"users": queries.all_users(),
                                    "statuses": queries.get_statuses()})
        # ── Справочники правил распределения оплаты ──────────────────────
        if path == "/api/chip-colors":
            return self._json(200, {"colors": queries.get_chip_colors()})
        if path == "/api/chip-marks":
            return self._json(200, {"marks": queries.get_chip_marks()})
        if path == "/api/payment-rules":
            return self._json(200, {"rules": queries.get_payment_rules()})
        if path == "/api/roaming":
            return self._json(200, {"zones": queries.get_roaming_zones()})
        if path == "/api/trips":
            number = (query.get("number") or [""])[0]
            return self._json(200, {"trips": queries.get_trips(number)})
        if path.startswith("/api/chips/"):
            return self._json(200, {"chip": queries.get_chip(path.rsplit("/", 1)[-1])})
        if path.startswith("/api/users/"):
            number = path.rsplit("/", 1)[-1]
            user = queries.get_user(number)
            if user is None:
                return self._error(404, "Абонент не найден")
            return self._json(200, user)
        if path == "/api/subscribers":
            month = (query.get("month") or [queries.latest_month()])[0]
            if not month:
                return self._json(200, {"month": "", "months": [], "subscribers": [],
                                        "summary": domain.build_summary([]),
                                        "tariff_stats": [], "trend": [],
                                        "invoice": {}, "tariffs": queries.get_tariffs()})
            return self._json(200, build_month_view(month))
        if path.startswith("/api/subscriber/"):
            number = path.rsplit("/", 1)[-1]
            month = (query.get("month") or [None])[0]
            record = build_subscriber_view(number, month)
            if not record:
                return self._error(404, "Абонент не найден")
            return self._json(200, record)
        if path.startswith("/api/history/"):
            number = path.rsplit("/", 1)[-1]
            return self._json(200, {"number": number,
                                    "history": queries.history_for_number(number),
                                    "categories": queries.category_history(number)})
        return self._error(404, "Неизвестный эндпоинт")

    # --- POST API --------------------------------------------------------
    def _api_post(self, path: str) -> None:
        if path == "/api/upload-csv":
            return self._upload(kind="bill")
        if path == "/api/upload-roster":
            return self._upload(kind="roster")
        if path == "/api/tariffs":
            payload = self._read_json()
            tariffs = payload.get("tariffs") if isinstance(payload, dict) else payload
            if not isinstance(tariffs, list):
                return self._error(400, "Ожидается список тарифов")
            return self._json(200, {"tariffs": queries.set_tariffs(tariffs)})
        if path == "/api/tariffs/reset":
            return self._json(200, {"tariffs": queries.reset_tariffs()})
        if path.startswith("/api/users/"):
            number = path.rsplit("/", 1)[-1]
            payload = self._read_json()
            if not isinstance(payload, dict):
                raise ValueError("Ожидается объект с настройками абонента")
            user = queries.update_user_settings(number, payload)
            month = queries.latest_month()
            return self._json(200, {"ok": True, "user": user,
                                    "view": build_month_view(month) if month else None})
        if path == "/api/statuses":
            payload = self._read_json()
            if not isinstance(payload, dict):
                raise ValueError("Ожидается объект статуса")
            statuses = queries.save_status(payload, str(payload.get("previous_id") or ""))
            return self._json(200, {"statuses": statuses})
        if path == "/api/statuses/delete":
            payload = self._read_json()
            status_id = str((payload or {}).get("id") or "")
            statuses = queries.delete_status(status_id)
            month = queries.latest_month()
            return self._json(200, {"statuses": statuses,
                                    "view": build_month_view(month) if month else None})
        # ── ЧИПСЫ: настройки конкретного номера ──────────────────────────
        # Именно они позволяют не ходить каждый раз в «Настройки → Абоненты»:
        # цвет, заметка, пометки и плательщик правятся прямо в карточке.
        if path.startswith("/api/chips/"):
            number = path.rsplit("/", 1)[-1]
            payload = self._read_json()
            if not isinstance(payload, dict):
                raise ValueError("Ожидается объект с настройками чипса")
            chip = queries.save_chip(number, payload)
            month = queries.latest_month()
            return self._json(200, {"ok": True, "chip": chip,
                                    "view": build_month_view(month) if month else None})

        # ── Справочник цветов-правил ─────────────────────────────────────
        # ── Справочники: цвета, пометки, правила оплаты ──────────────────
        #
        # Три справочника обслуживались шестью почти дословно совпадающими
        # блоками. Разница между ними умещается в четыре значения, поэтому
        # они вынесены в таблицу _DICT_ENDPOINTS (см. рядом с классом), а
        # здесь остался один общий обработчик.
        #
        # Ответ у всех одинаковый по смыслу: обновлённый справочник плюс
        # пересчитанный отчёт — правка справочника меняет деньги, и клиенту
        # нужны сразу обе половины.
        spec = _DICT_ENDPOINTS.get(path.removesuffix("/delete"))
        if spec is not None:
            payload = self._read_json() or {}
            if path.endswith("/delete"):
                items = spec.delete(spec.key_of(payload))
            else:
                if not isinstance(payload, dict):
                    raise ValueError(spec.expects)
                items = spec.save(payload)
            return self._json(200, {spec.field: items, "view": self._fresh_view()})

        # ── Загрузка списка командировок ─────────────────────────────────
        if path == "/api/upload-trips":
            return self._upload(kind="trips")
        if path == "/api/trips/clear":
            queries.delete_trips()
            return self._json(200, {"ok": True, "view": self._fresh_view()})

        if path == "/api/reset":
            queries.reset()
            return self._json(200, {"ok": True})
        return self._error(404, "Неизвестный эндпоинт")

    def _fresh_view(self) -> dict[str, Any] | None:
        """Пересобрать отчёт после изменения справочника.

        Любая правка цвета, пометки или правила меняет распределение денег,
        поэтому фронтенду сразу возвращается пересчитанный отчёт — иначе на
        экране остались бы старые суммы.
        """
        month = queries.latest_month()
        return build_month_view(month) if month else None

    # --- вспомогательные -------------------------------------------------
    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > MAX_UPLOAD:
            raise ValueError("файл слишком большой")
        return self.rfile.read(length)

    def _read_json(self) -> Any:
        """Разобрать тело запроса как JSON.

        Молча возвращать {} нельзя: тогда битое тело выглядит как «поле не
        передано», и причина ошибки теряется. Поэтому непустое, но не
        разобранное тело — это явная ошибка запроса.
        """
        body = self._read_body()
        if not body:
            return {}
        try:
            return json.loads(decode_bytes(body))
        except ValueError as exc:
            raise ValueError(f"тело запроса не является корректным JSON: {exc}") from exc

    def _upload(self, kind: str) -> None:
        content_type = self.headers.get("Content-Type", "")
        body = self._read_body()
        if not body:
            return self._error(400, "Пустой запрос")

        if "multipart/form-data" in content_type:
            fields = parse_multipart(body, content_type)
            raw = fields.get("file") or next(iter(fields.values()), b"")
        else:
            raw = body
        if not raw:
            return self._error(400, "Файл не найден в запросе")

        text = decode_bytes(raw)

        if kind == "bill":
            parsed = parse_bill(text)
            if not parsed["subscribers"]:
                return self._error(
                    400,
                    "В файле не найдено ни одного абонента. Ожидается выгрузка "
                    "«Начисления по абонентским номерам» со строками "
                    "«Абонентский номер 9XXXXXXXXX»."
                )
            result = apply_bill(parsed)
            month = result["month"]
            return self._json(200, {"ok": True, **result,
                                    "view": build_month_view(month)})

        if kind == "trips":
            parsed = parse_trips(text)
            if not parsed["rows"]:
                return self._error(
                    400,
                    "В файле не найдено ни одной командировки. Ожидаются колонки "
                    "«Абонентский номер», «ФИО», «период командировки» (две даты), "
                    "«Страна», «Утверждено»."
                )
            saved = queries.save_trips(parsed["rows"])
            month = queries.latest_month()
            return self._json(200, {"ok": True, "saved": saved,
                                    "stats": parsed["stats"],
                                    "view": build_month_view(month) if month else None})

        parsed = parse_roster(text)
        if not parsed["rows"]:
            return self._error(
                400,
                "В списке не найдено ни одной строки с абонентским номером. "
                "Ожидаются колонки «Абонентский номер», «Лимит», «ФИО»."
            )
        result = apply_roster(parsed)
        month = queries.latest_month()
        return self._json(200, {"ok": True, **result,
                                "view": build_month_view(month) if month else None})

    # --- статика ---------------------------------------------------------
    def _static(self, path: str) -> None:
        if path in ("/", ""):
            path = "/index.html"
        rel = os.path.normpath(path.lstrip("/")).replace("\\", "/")
        if rel.startswith("..") or os.path.isabs(rel):
            return self._error(403, "Запрещено")
        full = os.path.join(STATIC_DIR, rel)
        if not os.path.isfile(full):
            return self._error(404, "Файл не найден")
        with open(full, "rb") as fh:
            data = fh.read()
        ext = os.path.splitext(full)[1].lower()
        self._send(200, data, MIME.get(ext, "application/octet-stream"))

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{datetime.now():%H:%M:%S}] {fmt % args}", flush=True)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _setup_console() -> None:
    """Заставить консоль принимать кириллицу.

    В Windows консоль по умолчанию работает в cp1251/cp866, и print() с
    русским текстом или символом «→» роняет процесс с UnicodeEncodeError
    ещё до запуска сервера. Переключаем потоки на UTF-8, а если конкретный
    символ всё же не поддерживается — заменяем его, но не падаем.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def main() -> None:
    _setup_console()

    # ПОРТ МОЖНО ЗАДАТЬ АРГУМЕНТОМ: python server.py 8080
    #
    # Раньше он брался ТОЛЬКО из переменной окружения PORT, а аргумент
    # командной строки молча игнорировался. Человек запускал
    # `python server.py 8080`, видел в логе 3001 и не понимал, почему сайт
    # не открывается по нужному адресу. В закрытом контуре, где занятые
    # порты обычное дело, такая ловушка особенно неприятна.
    #
    # Порядок теперь очевидный: аргумент важнее переменной окружения,
    # переменная важнее значения по умолчанию.
    port = PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
            if not (1 <= port <= 65535):
                raise ValueError
        except ValueError:
            print(f"  Порт «{sys.argv[1]}» не похож на число от 1 до 65535.")
            print(f"  Запускаю на {PORT}.", flush=True)
            port = PORT

    try:
        server = ThreadingHTTPServer((HOST, port), Handler)
    except OSError as err:
        # Занятый порт — самая частая причина «не запускается». Раньше в
        # ответ прилетала голая трассировка, по которой непонятно, что делать.
        print(f"\n  Не удалось занять порт {port}: {err}")
        print("  Скорее всего он уже занят другим экземпляром.")
        print(f"  Попробуйте другой: python server.py {port + 1}\n", flush=True)
        raise SystemExit(1)

    print(f"\n  Анализ тарифных планов -> http://localhost:{port}\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Остановка сервера", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
