#!/usr/bin/env python3
"""
xlsx.py — превращение книги Excel в CSV. Только стандартная библиотека.
=============================================================================

ЗАЧЕМ. Списки сотрудников и командировок приходят книгой Excel, а разборщики
у нас текстовые. Раньше сервер такой файл отвергал с советом «сохраните как
CSV» — и это была ручная работа на каждую загрузку, причём с шансом сохранить
не тот лист. Теперь книга разбирается на месте.

ПОЧЕМУ НЕ openpyxl. Прод — Astra Linux без интернета: поставить пакет туда
нельзя. А xlsx это обычный ZIP с XML внутри, и всё нужное достаётся
`zipfile` и `xml.etree`, которые есть всегда.

ЧТО ВНУТРИ КНИГИ
----------------
    xl/workbook.xml            — список листов В ПОРЯДКЕ КНИГИ, с r:id
    xl/_rels/workbook.xml.rels — r:id → файл листа
    xl/sharedStrings.xml       — все строковые значения одной таблицей
    xl/worksheets/sheetN.xml   — сами ячейки
    xl/styles.xml              — форматы; по ним отличается дата от числа

Порядок листов берётся ИМЕННО из workbook.xml, а не из имён файлов:
sheet1.xml запросто оказывается третьим листом книги, если листы двигали
мышью. На этом ломаются самодельные конвертеры — и лист «Командировки»
приезжает вместо «Сотрудников».

ДАТЫ. В файле они лежат числами: 46023 — это 21.04.2026. Отличить дату от
обычного числа можно только по формату ячейки, поэтому styles.xml читается
обязательно. Без этого в командировках вместо периода приезжали бы пятизначные
числа, и ни одна командировка не разобралась бы.
"""

from __future__ import annotations

import re
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from typing import Any
from xml.etree import ElementTree as ET

# Excel считает дни от 30.12.1899. «Ноль» смещён на два дня из-за того, что
# 1900 год в Excel високосный (его там нет, но совместимость с Lotus дороже).
# Для дат нашего века это смещение и есть верный ответ.
EPOCH_1900 = datetime(1899, 12, 30)
EPOCH_1904 = datetime(1904, 1, 1)

# Встроенные форматы-даты. 14–22 — даты и время, 45–47 — длительности.
BUILTIN_DATE_FORMATS = set(range(14, 23)) | set(range(45, 48))

# Признак даты в самодельном формате: буквы дня/месяца/года вне кавычек.
_DATE_CHARS = re.compile(r"[dmyhsDMYHS]")
_QUOTED = re.compile(r'"[^"]*"|\\.|\[[^\]]*\]')


class XlsxError(ValueError):
    """Книга не читается: не тот файл, битый архив, нет листов."""


def _tag(elem: ET.Element) -> str:
    """Имя тега без пространства имён: '{...}sheet' → 'sheet'."""
    return elem.tag.rsplit("}", 1)[-1]


def _find_all(root: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in root.iter() if _tag(e) == name]


def _attr(elem: ET.Element, name: str) -> str:
    """Значение атрибута без учёта пространства имён (r:id и просто id)."""
    for key, value in elem.attrib.items():
        if key.rsplit("}", 1)[-1] == name:
            return value
    return ""


def col_index(ref: str) -> int:
    """'A1' → 0, 'C7' → 2, 'AA3' → 26. Нужно, чтобы пустые ячейки не съезжали."""
    idx = 0
    for ch in ref:
        if not ch.isalpha():
            break
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return max(0, idx - 1)


# ═══════════════════════════════════════════════════════════════════════════
#  Разбор служебных частей книги
# ═══════════════════════════════════════════════════════════════════════════

def _shared_strings(zf: zipfile.ZipFile) -> list[str]:
    """Таблица строк. Значения ячеек с t="s" — это индексы в ней."""
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except (KeyError, ET.ParseError):
        return []
    out: list[str] = []
    for si in root:
        # Внутри может быть либо один <t>, либо несколько <r><t> — Excel
        # режет строку на куски, если её части оформлены по-разному.
        out.append("".join(t.text or "" for t in si.iter() if _tag(t) == "t"))
    return out


def _date_styles(zf: zipfile.ZipFile) -> set[int]:
    """Номера стилей (cellXfs), которые означают дату."""
    try:
        root = ET.fromstring(zf.read("xl/styles.xml"))
    except (KeyError, ET.ParseError):
        return set()

    custom: dict[int, str] = {}
    for fmt in _find_all(root, "numFmt"):
        code = _attr(fmt, "formatCode")
        fid = _attr(fmt, "numFmtId")
        if fid.isdigit():
            custom[int(fid)] = code

    def is_date_code(code: str) -> bool:
        # Из формата выкидываем всё закавыченное и служебное в скобках —
        # иначе «"мая" 0.00» сойдёт за дату из-за буквы «m» внутри текста.
        return bool(_DATE_CHARS.search(_QUOTED.sub("", code)))

    date_styles: set[int] = set()
    cell_xfs = next((e for e in root if _tag(e) == "cellXfs"), None)
    for i, xf in enumerate(list(cell_xfs) if cell_xfs is not None else []):
        fid = _attr(xf, "numFmtId")
        if not fid.isdigit():
            continue
        num = int(fid)
        if num in BUILTIN_DATE_FORMATS or (num in custom and is_date_code(custom[num])):
            date_styles.add(i)
    return date_styles


def _sheet_targets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Листы книги: [(имя, путь к xml)] В ПОРЯДКЕ, В КОТОРОМ ОНИ В КНИГЕ."""
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
    except (KeyError, ET.ParseError) as exc:
        raise XlsxError("это не книга Excel: внутри нет xl/workbook.xml") from exc

    rels: dict[str, str] = {}
    try:
        rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        for rel in rel_root:
            target = _attr(rel, "Target").lstrip("/")
            if target.startswith("xl/"):
                target = target[3:]
            rels[_attr(rel, "Id")] = target
    except (KeyError, ET.ParseError):
        rels = {}

    out: list[tuple[str, str]] = []
    for i, sheet in enumerate(_find_all(wb, "sheet"), start=1):
        name = _attr(sheet, "name") or f"Лист {i}"
        target = rels.get(_attr(sheet, "id"), "")
        path = f"xl/{target}" if target else f"xl/worksheets/sheet{i}.xml"
        out.append((name, path))
    if not out:
        raise XlsxError("в книге не нашлось ни одного листа")
    return out


def _is_1904(zf: zipfile.ZipFile) -> bool:
    """Книга может считать дни от 1904 года — так делает Excel для Mac."""
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
    except (KeyError, ET.ParseError):
        return False
    for pr in _find_all(wb, "workbookPr"):
        if _attr(pr, "date1904") in ("1", "true"):
            return True
    return False


# ═══════════════════════════════════════════════════════════════════════════
#  Значения ячеек
# ═══════════════════════════════════════════════════════════════════════════

def _serial_to_date(value: float, epoch: datetime) -> str:
    """Число Excel → 'ДД.ММ.ГГГГ'. Формат тот же, что в CSV-выгрузках."""
    try:
        moment = epoch + timedelta(days=float(value))
    except (OverflowError, ValueError):
        return str(value)
    return moment.strftime("%d.%m.%Y")


def _number_text(raw: str) -> str:
    """Число без хвостовых нулей: 400.0 → '400', 5725.73 → '5725.73'.

    Excel хранит всё числом с плавающей точкой, и без этой чистки в CSV
    уезжали бы «9217236516.0» вместо номера телефона.
    """
    try:
        num = float(raw)
    except ValueError:
        return raw
    if num.is_integer() and abs(num) < 1e15:
        return str(int(num))
    return repr(round(num, 10))


def _cell_text(cell: ET.Element, strings: list[str], date_styles: set[int],
               epoch: datetime) -> str:
    """Текст одной ячейки с учётом её типа и формата."""
    ctype = _attr(cell, "t")

    if ctype == "inlineStr":
        return "".join(t.text or "" for t in cell.iter() if _tag(t) == "t")

    value = next((v.text or "" for v in cell if _tag(v) == "v"), "")
    if value == "":
        return ""

    if ctype == "s":
        try:
            return strings[int(value)]
        except (ValueError, IndexError):
            return ""
    if ctype in ("str", "e"):
        return value
    if ctype == "b":
        return "да" if value == "1" else "нет"

    style = _attr(cell, "s")
    if style.isdigit() and int(style) in date_styles:
        return _serial_to_date(value, epoch)
    return _number_text(value)


# ═══════════════════════════════════════════════════════════════════════════
#  Точки входа
# ═══════════════════════════════════════════════════════════════════════════

def is_xlsx(raw: bytes) -> bool:
    """Похож ли файл на книгу Excel. XLSX — это ZIP, а ZIP начинается с 'PK'."""
    if not raw.startswith(b"PK\x03\x04"):
        return False
    try:
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            return "xl/workbook.xml" in zf.namelist()
    except (zipfile.BadZipFile, OSError):
        return False


def sheet_names(raw: bytes) -> list[str]:
    """Имена листов в порядке книги."""
    with zipfile.ZipFile(BytesIO(raw)) as zf:
        return [name for name, _ in _sheet_targets(zf)]


def rows_of(raw: bytes, sheet: int = 1) -> list[list[str]]:
    """Строки листа. `sheet` — НОМЕР В КНИГЕ, считая с единицы.

    Пустые ячейки не пропускаются, а восстанавливаются по адресу (r="C5"):
    иначе строка с пропуском посередине съезжает на колонку влево, и,
    например, страна командировки встаёт в колонку «Утверждено».
    """
    try:
        zf = zipfile.ZipFile(BytesIO(raw))
    except (zipfile.BadZipFile, OSError) as exc:
        raise XlsxError("файл повреждён и не читается как книга Excel") from exc

    with zf:
        sheets = _sheet_targets(zf)
        if not 1 <= sheet <= len(sheets):
            names = ", ".join(f"{i}. {n}" for i, (n, _) in enumerate(sheets, 1))
            raise XlsxError(
                f"в книге {len(sheets)} лист(ов), а запрошен {sheet}-й. "
                f"Листы: {names}")

        name, path = sheets[sheet - 1]
        strings = _shared_strings(zf)
        date_styles = _date_styles(zf)
        epoch = EPOCH_1904 if _is_1904(zf) else EPOCH_1900
        try:
            root = ET.fromstring(zf.read(path))
        except (KeyError, ET.ParseError) as exc:
            raise XlsxError(f"лист «{name}» не читается") from exc

        out: list[list[str]] = []
        for row in _find_all(root, "row"):
            cells: list[str] = []
            for cell in row:
                if _tag(cell) != "c":
                    continue
                ref = _attr(cell, "r")
                idx = col_index(ref) if ref else len(cells)
                while len(cells) < idx:
                    cells.append("")
                cells.append(_cell_text(cell, strings, date_styles, epoch))
            out.append(cells)
        return out


def to_csv(raw: bytes, sheet: int = 1, delimiter: str = ";") -> str:
    """Лист книги → CSV-текст, который дальше читают обычные разборщики.

    Точка с запятой, а не запятая: разборщики счёта и списков ждут именно её,
    да и в русской локали Excel сохраняет CSV так же.
    """
    lines = []
    for row in rows_of(raw, sheet):
        # Кавычки внутри значения удвоить, само значение закавычить, если в
        # нём есть разделитель, кавычка или перенос строки — правило CSV.
        cells = []
        for value in row:
            text = str(value).replace("\r\n", " ").replace("\n", " ")
            if delimiter in text or '"' in text:
                text = '"' + text.replace('"', '""') + '"'
            cells.append(text)
        lines.append(delimiter.join(cells))
    return "\n".join(lines)
