#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
КОНВЕРТЕР ВЫГРУЗКИ ОПЕРАТОРА В ЧИСТЫЙ CSV
═════════════════════════════════════════════════════════════════════════════

ЗАЧЕМ. Оператор отдаёт счёт файлом .txt, который только притворяется таблицей.
Внутри него хватает того, что обычный Excel или скрипт не переварят:

  · шапка счёта, реквизиты и QR-код лежат теми же строками, что и данные;
  · одна запись бывает разорвана переносом на несколько физических строк;
  · несколько записей, наоборот, склеены в одну строку длинной цепочкой «;»;
  · кодировка гуляет между UTF-8 и windows-1251;
  · пустые ячейки-разделители стоят где попало.

Разбирать это заново мы не стали. Конвертер вызывает ТОТ ЖЕ разбор, что и
сайт при загрузке счёта (server.parse_bill), — значит, CSV на выходе всегда
совпадает с тем, что увидит приложение. Если однажды поправят разбор, файл
поправится сам.

ЧТО НА ВЫХОДЕ. Три файла, потому что в счёте три разных по смыслу таблицы:

  <имя>.subscribers.csv   строка = номер: тариф, потребление, начисления
  <имя>.services.csv      строка = одна услуга одного номера
  <имя>.invoice.csv       итоги счёта: период, суммы, НДС, номер счёта

Разделитель — точка с запятой, кодировка — UTF-8 со спецметкой (BOM).
Так Excel открывает файл сразу и правильно, без «Мастера импорта текста».

КАК ЗАПУСТИТЬ.

    python convert.py otche.txt
    python convert.py otche.txt --out C:\\выгрузки
    python convert.py *.txt

Файлы кладутся рядом с исходным, если не указан --out.
"""

from __future__ import annotations

import csv
import glob
import os
import sys

import server

# Кодировки перебираются в этом порядке. UTF-8 первым: если файл в нём, то
# декодируется без ошибок. windows-1251 вторым — на нём отдаёт выгрузку
# большинство старых систем. Последний вариант с errors='replace' никогда
# не падает, он нужен, чтобы конвертер не умирал на одном битом символе.
ENCODINGS = ("utf-8-sig", "utf-8", "cp1251")


def read_text(path: str) -> tuple[str, str]:
    """Прочитать файл, сам подобрав кодировку. Возвращает текст и её имя."""
    raw = open(path, "rb").read()
    for enc in ENCODINGS:
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("cp1251", errors="replace"), "cp1251 (с потерями)"


def write_csv(path: str, rows: list[dict], columns: list[str]) -> int:
    """Записать таблицу. Возвращает число строк без учёта заголовка."""
    # utf-8-sig — это UTF-8 плюс метка в начале файла. Без неё Excel в
    # русской Windows открывает файл как cp1251 и показывает кракозябры.
    # newline='' обязателен: иначе в Windows между строками появится
    # лишняя пустая строка.
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, delimiter=";",
                                extrasaction="ignore", restval="")
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


# Названия колонок в таблице итогов — на человеческом языке.
INVOICE_RU = {
    "invoice_number": "Счёт №", "invoice_date": "Дата счёта",
    "period": "Период", "period_start": "Период с", "period_end": "Период по",
    "month": "Месяц", "factura": "Счета-фактуры",
    "account_number": "Лицевой счёт", "payment_form": "Форма оплаты",
    "inn_kpp": "ИНН / КПП", "contract": "Договор",
    "recipient": "Получатель", "bank": "Банк", "ks": "Корр. счёт", "bik": "БИК",
    "director": "Руководитель", "subscriber_name": "Абонент",
    "services": "Расшифровка услуг",
    "balance_start": "Остаток на начало", "charged": "Начислено",
    "paid": "Оплачено", "balance_end": "Остаток на конец",
    "penalty_start": "Пени на начало", "due_period": "К оплате за период",
    "due_total": "К оплате всего", "days_to_pay": "Дней на оплату",
    "unpaid_previous": "Долг за прошлые периоды",
    "total_vatable": "Облагается НДС", "total_charged": "Начислено всего",
    "total_vat": "НДС", "total_without_vat": "Без НДС",
}

# Как parse_bill называет категории услуг и как это читается по-русски.
CATEGORY_RU = {
    "voice": "Минуты", "internet": "Интернет", "sms": "SMS",
    "roaming": "Роуминг", "other": "Прочее",
}


def flatten_subscriber(number: str, data: dict) -> dict:
    """Один номер — одна строка.

    Потребление в счёте не лежит готовой суммой: оно рассыпано по строкам
    услуг с пометкой категории. Поэтому здесь мы его СОБИРАЕМ — отдельно
    объём (минуты, мегабайты, штуки) и отдельно деньги.
    """
    items = data.get("items") or []
    volume: dict[str, float] = {}
    money: dict[str, float] = {}
    for it in items:
        cat = it.get("cat") or "other"
        volume[cat] = volume.get(cat, 0.0) + float(it.get("volume") or 0)
        money[cat] = money.get(cat, 0.0) + float(it.get("cost") or 0)

    return {
        "Номер": number,
        "Тариф": data.get("plan_name") or "",
        "Абонплата": data.get("plan_fee") or 0,
        "Начислено всего": data.get("total_charged") or 0,
        "НДС": data.get("vat") or 0,
        "Минуты": round(volume.get("voice", 0), 2),
        "Минуты, ₽": round(money.get("voice", 0), 2),
        "Интернет, МБ": round(volume.get("internet", 0), 2),
        "Интернет, ₽": round(money.get("internet", 0), 2),
        "SMS, шт": round(volume.get("sms", 0), 2),
        "SMS, ₽": round(money.get("sms", 0), 2),
        "Роуминг, ₽": round(money.get("roaming", 0), 2),
        "Прочее, ₽": round(money.get("other", 0), 2),
        "Строк услуг": len(items),
    }


def flatten_services(number: str, data: dict) -> list[dict]:
    """Одна услуга — одна строка. Это самая подробная из трёх таблиц.

    Скидку и сумму до скидки оставляем: без них не проверишь, почему
    итог по номеру не сходится со ставкой тарифа.
    """
    rows = []
    for svc in data.get("items") or []:
        rows.append({
            "Номер": number,
            "Услуга": svc.get("service") or "",
            "Категория": CATEGORY_RU.get(svc.get("cat") or "other", svc.get("cat") or ""),
            "Объём": svc.get("volume") if svc.get("volume") is not None else "",
            "Единица": svc.get("unit") or "",
            "Как в счёте": svc.get("raw_volume") or "",
            "До скидки, ₽": svc.get("no_discount") or 0,
            "Скидка, ₽": svc.get("discount") or 0,
            "Сумма, ₽": svc.get("cost") or 0,
        })
    return rows


def convert(path: str, out_dir: str | None) -> None:
    text, enc = read_text(path)
    print(f"\n  {os.path.basename(path)}  (кодировка: {enc})")

    try:
        parsed = server.parse_bill(text)
    except Exception as err:                                  # noqa: BLE001
        print(f"    ОШИБКА разбора: {err}")
        return

    subs = parsed.get("subscribers") or {}
    if not subs:
        print("    номеров не найдено — это точно выгрузка счёта?")
        return

    base = os.path.splitext(os.path.basename(path))[0]
    target = out_dir or os.path.dirname(os.path.abspath(path))
    os.makedirs(target, exist_ok=True)
    stem = os.path.join(target, base)

    # ── Абоненты ─────────────────────────────────────────────────────────
    sub_rows = [flatten_subscriber(num, data) for num, data in sorted(subs.items())]
    n1 = write_csv(f"{stem}.subscribers.csv", sub_rows, list(sub_rows[0].keys()))

    # ── Услуги ───────────────────────────────────────────────────────────
    svc_rows: list[dict] = []
    for num, data in sorted(subs.items()):
        svc_rows.extend(flatten_services(num, data))
    svc_cols = ["Номер", "Услуга", "Категория", "Объём", "Единица",
                "Как в счёте", "До скидки, ₽", "Скидка, ₽", "Сумма, ₽"]
    n2 = write_csv(f"{stem}.services.csv", svc_rows, svc_cols)

    # ── Итоги счёта ──────────────────────────────────────────────────────
    # Счёт один, поэтому таблица из одной строки: так её удобно
    # присоединять к остальным в сводных отчётах.
    inv = dict(parsed.get("invoice") or {})
    inv.pop("raw_json", None)                 # служебное поле, в CSV не нужно
    amounts = inv.pop("amounts", None)
    if isinstance(amounts, dict):
        inv.update(amounts)                   # вложенные суммы — в колонки
    inv["Расчётный период"] = parsed.get("month") or ""
    # Внутри программы поля названы по-английски. В файле, который открывает
    # бухгалтер, им делать нечего — переименовываем. Чего нет в словаре,
    # остаётся как есть: лучше английское название, чем потерянная колонка.
    inv = {INVOICE_RU.get(k, k): v for k, v in inv.items()}

    # В поле services оператор складывает полную расшифровку услуг одной
    # простынёй — из-за неё файл итогов раздувался до 19 КБ ради одной
    # строки. Расшифровка и так лежит в отдельной таблице услуг, поэтому
    # здесь режем всё длинное: в итогах должны быть итоги.
    for key, value in list(inv.items()):
        if isinstance(value, str) and len(value) > 300:
            inv[key] = value[:300] + "… (полностью — в таблице услуг)"
        elif isinstance(value, (list, dict)):
            inv[key] = f"{len(value)} записей — см. таблицу услуг"
    n3 = write_csv(f"{stem}.invoice.csv", [inv], list(inv.keys()))

    stats = parsed.get("stats") or {}
    print(f"    абонентов {n1}, услуг {n2}, итогов {n3}"
          + (f"  ·  строк разобрано {stats.get('rows', '?')}" if stats else ""))
    print(f"    → {base}.subscribers.csv   для Excel")
    print(f"    → {base}.services.csv      для Excel")
    print(f"    → {base}.invoice.csv       для Excel")

    # Четвёртый файл — тот самый, который грузится обратно на сайт.
    # Делаем его всегда: именно им проверяют, что загрузка живая.
    bill = make_bill_csv(path, out_dir)
    if bill:
        print(f"    → {base}.bill.csv          ЭТОТ ГРУЗИТЬ НА САЙТ")
        verify_roundtrip(path, bill)


def make_bill_csv(path: str, out_dir: str | None) -> str | None:
    """Сделать CSV, который МОЖНО ЗАГРУЗИТЬ ОБРАТНО В ПРИЛОЖЕНИЕ.

    ЧЕМ ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ ТРЁХ ФАЙЛОВ. Те три — витрина для Excel:
    там данные уже разобраны по колонкам, и сайт такое не примет, он ждёт
    выгрузку оператора. Этот файл — сама выгрузка, слово в слово.

    ЗДЕСЬ МЕНЯЕТСЯ ТОЛЬКО КОДИРОВКА, И ЭТО ПРИНЦИПИАЛЬНО.

    Сперва я честно вычистил файл перед сохранением: собрал разорванные
    переносом записи, расклеил слипшиеся. Круговая проверка поймала
    результат за руку:

        оригинал        5291.64 руб
        после чистки    2741.21 руб   — потеряна почти половина

    Причина: сайт при загрузке чистит файл САМ, тем же кодом. Моя чистка
    оказывалась первой, а вторая проходила уже по обработанному тексту и
    ломала записи. Двойная обработка — не «чище», а хуже.

    Вывод простой: конвертер к содержимому НЕ ПРИКАСАЕТСЯ. Он переводит
    файл в UTF-8 с меткой для Excel и даёт ему расширение .csv. Разбор —
    забота приложения, у него это уже отлажено.
    """
    text, enc = read_text(path)

    base = os.path.splitext(os.path.basename(path))[0]
    target = out_dir or os.path.dirname(os.path.abspath(path))
    os.makedirs(target, exist_ok=True)
    out_path = os.path.join(target, f"{base}.bill.csv")

    # newline='' — чтобы Windows не удваивал переводы строк.
    with open(out_path, "w", encoding="utf-8-sig", newline="") as fh:
        fh.write(text)

    print(f"    строк {len(text.splitlines())}, содержимое не тронуто "
          f"(кодировка {enc} → utf-8)")
    return out_path


def verify_roundtrip(original: str, converted: str) -> bool:
    """Сверить: разбор CSV даёт то же самое, что разбор исходника.

    Без этой проверки конвертер — обещание, а не инструмент. Сравниваем
    самое существенное: расчётный месяц, состав номеров и сумму по каждому.
    """
    a = server.parse_bill(read_text(original)[0])
    b = server.parse_bill(read_text(converted)[0])

    sa, sb = a.get("subscribers") or {}, b.get("subscribers") or {}
    ok = True

    if a.get("month") != b.get("month"):
        print(f"    месяц:   было {a.get('month')}, стало {b.get('month')}  РАСХОЖДЕНИЕ")
        ok = False
    if set(sa) != set(sb):
        print(f"    номера:  было {len(sa)}, стало {len(sb)}  РАСХОЖДЕНИЕ")
        ok = False

    diff = [n for n in sa if n in sb
            and round(float(sa[n].get("total_charged") or 0), 2)
            != round(float(sb[n].get("total_charged") or 0), 2)]
    if diff:
        print(f"    суммы:   разошлись по {len(diff)} номерам  РАСХОЖДЕНИЕ")
        ok = False

    if ok:
        total = sum(float(v.get("total_charged") or 0) for v in sa.values())
        print(f"    сверка:  месяц {a.get('month')}, номеров {len(sa)}, "
              f"начислено {total:.2f} — совпало полностью")
    return ok


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    out_dir = None
    if "--out" in argv:
        idx = argv.index("--out")
        if idx + 1 < len(argv):
            out_dir = argv[idx + 1]
            args = [a for a in args if a != out_dir]

    if not args:
        print(__doc__)
        return 1

    # Windows не раскрывает звёздочку сам, поэтому делаем это руками.
    paths: list[str] = []
    for pattern in args:
        found = glob.glob(pattern)
        paths.extend(found or [pattern])

    print(f"Файлов к разбору: {len(paths)}")
    for path in paths:
        if not os.path.isfile(path):
            print(f"\n  {path} — файл не найден, пропускаю")
            continue
        convert(path, out_dir)
    print("\nГотово.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
