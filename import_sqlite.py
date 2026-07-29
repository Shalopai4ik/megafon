#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ПЕРЕНОС СТАРОЙ БАЗЫ megafon.db В POSTGRESQL
═════════════════════════════════════════════════════════════════════════════

ЭТО РАЗОВЫЙ СКРИПТ. Приложение работает на PostgreSQL и про SQLite ничего не
знает. Файл megafon.db остался от прежней версии, и в нём лежат живые данные:
счета, номера, настройки чипсов, командировки. Скрипт переливает их в
PostgreSQL — и после этого больше не нужен.

    python import_sqlite.py                     посмотреть, что будет
    python import_sqlite.py --run               перенести
    python import_sqlite.py --run --fresh       очистить цель и перенести
    python import_sqlite.py --run путь/к/файл.db    другой файл

Куда переносим — берётся из тех же настроек, что и у приложения: pg.conf
рядом с ним либо переменные PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.
Схема в цели должна быть уже развёрнута: `python install.py`.

ПОВТОРНЫЙ ЗАПУСК БЕЗОПАСЕН: строки вставляются через ON CONFLICT DO NOTHING,
задвоить ничего нельзя. Но и НЕДОЛИТЬ можно незаметно — если в цели уже
лежат строки с теми же ключами, новые просто пропускаются. Ровно для этого
случая есть `--fresh`: он очищает целевые таблицы перед переносом. Сверка
количества строк печатается в конце, смотреть на неё обязательно.
"""

from __future__ import annotations

import os
import sqlite3
import sys

import db

# Порядок важен: сначала то, на что ссылаются, потом ссылающиеся.
ORDER = [
    "pname", "tariff_plans", "users_numbers", "app_statuses", "app_settings",
    "chip_colors", "chip_marks", "chip_rules", "payment_rules",
    "chip_settings", "chip_mark_links", "chip_rule_links",
    "reports", "pvalues", "invoice_meta", "roster_history",
    "business_trips", "blacklisted_persons",
]

CHUNK = 500          # строк в одной команде INSERT


def sqlite_tables(src: sqlite3.Connection) -> set[str]:
    return {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def count_pg(table: str) -> int:
    """Сколько строк РЕАЛЬНО лежит в таблице PostgreSQL.

    Считаем отдельным запросом, а не верим коду возврата INSERT: перенос
    без независимой сверки доверия не заслуживает — он уже один раз соврал.
    """
    return int(db.scalar(f"SELECT COUNT(*) AS n FROM {table}", default=0) or 0)


def fix_sequences() -> None:
    """Подвинуть счётчики id за максимальный перенесённый id.

    БЕЗ ЭТОГО ПЕРЕНОС ТИХО ЛОМАЕТ БАЗУ. Строки вставляются вместе с их id из
    старой базы, а счётчик BIGSERIAL при этом не двигается — он так и стоит
    на единице. Первая же вставка из приложения возьмёт id=1, наткнётся на
    занятый ключ и упадёт. И так до тех пор, пока счётчик не догонит.

    Сама операция живёт в db.sync_sequences: здесь она нужна после переноса,
    а в db.ensure_schema — как страховка для баз, которые перенесли раньше,
    когда этого шага ещё не было. Две копии одного DO-блока разошлись бы.
    """
    db.sync_sequences()


def copy_table(src: sqlite3.Connection, table: str) -> int:
    """Перелить одну таблицу. Возвращает, сколько строк было в источнике."""
    rows = src.execute(f"SELECT * FROM {table}").fetchall()
    if not rows:
        return 0
    cols = list(rows[0].keys())
    # Значения превращаем в литералы тем же кодом, которым это делает само
    # приложение, — кавычки и NULL обрабатываются одинаково.
    values = [f'({", ".join(db._literal(row[c]) for c in cols)})' for row in rows]
    for start in range(0, len(values), CHUNK):
        db.run_script(
            f'INSERT INTO {table} ({", ".join(cols)}) VALUES\n'
            + ",\n".join(values[start:start + CHUNK])
            + "\nON CONFLICT DO NOTHING;")
    return len(rows)


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:                                          # noqa: BLE001
        pass

    do_run = "--run" in argv
    fresh = "--fresh" in argv
    paths = [a for a in argv if not a.startswith("--")]
    path = paths[0] if paths else os.path.join(db.APP_DIR, "megafon.db")

    print("═" * 70)
    print("  ПЕРЕНОС SQLITE → POSTGRESQL")
    print("═" * 70)

    if not os.path.isfile(path):
        print(f"\n  Файла {path} нет — переносить нечего.")
        return 1
    print(f"\n  откуда : {path}")
    print(f"  куда   : {db.target()}")

    src = sqlite3.connect(path)
    src.row_factory = sqlite3.Row
    have = sqlite_tables(src)
    tables = [t for t in ORDER if t in have]

    print("\n  Что лежит в старой базе:")
    total = 0
    for table in tables:
        n = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        total += n
        if n:
            print(f"    {table:22} {n:6}")
    print(f"    {'ИТОГО':22} {total:6}")

    if not do_run:
        print("\n  Это предварительный просмотр, НИЧЕГО НЕ ИЗМЕНЕНО.")
        print("  Выполнить:            python import_sqlite.py --run")
        print("  Очистить и выполнить: python import_sqlite.py --run --fresh")
        return 0

    db.connect()

    if fresh:
        # Без очистки перенос молча теряет строки: ON CONFLICT DO NOTHING
        # пропускает всё, что конфликтует с остатками прошлого прогона, и
        # делает это БЕЗ ОШИБКИ.
        db.run_script(f'TRUNCATE {", ".join(tables)} RESTART IDENTITY CASCADE;')
        print("\n  цель очищена")

    print("\n  Перенос:")
    result: dict[str, tuple[int, int]] = {}
    for table in tables:
        try:
            was = copy_table(src, table)
        except db.DbError as err:
            print(f"    {table:22} ОШИБКА: {str(err).splitlines()[0]}")
            result[table] = (10 ** 9, count_pg(table))
            continue
        got = count_pg(table)
        result[table] = (was, got)
        if was:
            mark = "ок" if got >= was else f"РАСХОЖДЕНИЕ, доехало {got}"
            print(f"    {table:22} {was:6}  {mark}")
    src.close()

    fix_sequences()
    print("\n  счётчики id подвинуты за максимальный перенесённый")

    bad = {t: v for t, v in result.items() if v[0] > v[1]}
    if bad:
        print("\n  РАСХОЖДЕНИЯ — данные доехали НЕ ПОЛНОСТЬЮ:")
        for t, (was, got) in bad.items():
            print(f"    {t:22} было {was}, доехало {got}")
        print("    Повторите с ключом --fresh: он очистит цель перед переносом.")
        return 1

    print("\n  сверка: все таблицы совпали")
    print("  Дальше: python server.py 3001")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
