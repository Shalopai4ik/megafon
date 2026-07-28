#!/usr/bin/env python3
"""clean_chips.py — вычистить правила чипса (цвета и пометки) из базы.

ЗАЧЕМ ЭТОТ СКРИПТ ВООБЩЕ НУЖЕН

Почистить списки CHIP_COLORS/CHIP_MARKS в seeds.py — НЕ значит почистить базу.
Сеялка умеет только добавлять недостающее (seeds.py, _insert_if_absent) и
никогда ничего не удаляет. А в app_settings уже стоит seeds_version = 1, так
что на существующей базе она вообще молчит.

Хуже того, правила воскресают сами. При каждом старте db._migrate() зовёт
_migrate_chip_rules(), а тот льёт INSERT OR IGNORE в chip_rules из СТАРЫХ
таблиц chip_colors и chip_marks. Их когда-то намеренно не удалили — оставили
как путь отката. Пока в них лежат строки, удаление из одной chip_rules
бессмысленно: перезапустил сервер — всё вернулось.

Там же, ниже по коду, восстанавливаются и связи: chip_rule_links доливается
из chip_settings.color_code и из chip_mark_links.

Поэтому чистить надо ПЯТЬ мест разом, иначе толку ноль:

    chip_rule_links   связи «номер ↔ правило» (новые)
    chip_mark_links   связи с пометками (старые, источник воскрешения)
    chip_settings     поле color_code — тоже источник воскрешения
    chip_rules        собственно правила
    chip_colors       старые справочники, из которых идёт перелив
    chip_marks

ЗАПУСК

    python clean_chips.py                 показать, что есть, и спросить
    python clean_chips.py --yes           почистить без вопросов
    python clean_chips.py --keep normal   оставить правило 'normal'
    python clean_chips.py --db D:\\x.db    другая база

Путь к базе берётся как в приложении: MEGAFON_DB или megafon.db рядом.

ВАЖНО: сервер перед запуском ОСТАНОВИТЬ. База в режиме WAL, писать в неё
вдвоём — напрашиваться на «database is locked» и на половинчатую чистку.
Перед удалением скрипт сам кладёт рядом копию .backup-<дата>.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "megafon.db")

# Порядок важен: сначала связи, потом справочники. Формально chip_rule_links
# висит на chip_rules через ON DELETE CASCADE, но полагаться на каскад не
# хочется — foreign_keys в SQLite включаются прагмой и легко оказываются off.
TABLES = ["chip_rule_links", "chip_mark_links", "chip_rules", "chip_colors", "chip_marks"]


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    out: dict[str, int] = {}
    for table in TABLES:
        if table_exists(conn, table):
            out[table] = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    return out


def show(conn: sqlite3.Connection, title: str) -> dict[str, int]:
    print(f"\n{title}")
    data = counts(conn)
    for table, number in data.items():
        print(f"    {table:18} {number}")
    if not data:
        print("    таблиц чипса в базе нет вообще")
    return data


def backup(path: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = f"{path}.backup-{stamp}"
    shutil.copy2(path, target)
    # WAL-файл копируем тоже: без него в копии не будет последних записей,
    # если сервер останавливали некорректно и чекпойнт не прошёл.
    if os.path.exists(path + "-wal"):
        shutil.copy2(path + "-wal", target + "-wal")
    return target


def clean(conn: sqlite3.Connection, keep: list[str]) -> None:
    """Удалить правила чипса. В `keep` — коды, которые остаются жить."""
    # Плейсхолдеры под «кроме этих кодов». Пустой список keep = сносим всё.
    if keep:
        holes = ", ".join("?" for _ in keep)
        where_code = f" WHERE code NOT IN ({holes})"
        where_rule = f" WHERE rule_code NOT IN ({holes})"
    else:
        where_code = where_rule = ""

    conn.execute(f"DELETE FROM chip_rule_links{where_rule}", keep)

    if table_exists(conn, "chip_mark_links"):
        # У старой таблицы поле называется mark_code, а не rule_code.
        holes = ", ".join("?" for _ in keep)
        where_mark = f" WHERE mark_code NOT IN ({holes})" if keep else ""
        conn.execute(f"DELETE FROM chip_mark_links{where_mark}", keep)

    # Цвет номера живёт ещё и здесь. Не сбросить — миграция при следующем
    # старте перельёт его обратно в chip_rule_links и правило «вернётся».
    # 'normal' — значение по умолчанию, его же ставит delete_chip_rule().
    if table_exists(conn, "chip_settings"):
        if keep:
            holes = ", ".join("?" for _ in keep)
            conn.execute(
                f"UPDATE chip_settings SET color_code = 'normal' "
                f" WHERE color_code IS NOT NULL AND color_code NOT IN ({holes})", keep)
        else:
            conn.execute("UPDATE chip_settings SET color_code = 'normal'")

    for table in ("chip_rules", "chip_colors", "chip_marks"):
        if table_exists(conn, table):
            conn.execute(f"DELETE FROM {table}{where_code}", keep)


def main() -> int:
    parser = argparse.ArgumentParser(description="Вычистить правила чипса из базы.")
    parser.add_argument("--db", default=os.environ.get("MEGAFON_DB", DEFAULT_PATH),
                        help="путь к базе (по умолчанию MEGAFON_DB или megafon.db рядом)")
    parser.add_argument("--keep", nargs="*", default=[], metavar="CODE",
                        help="коды правил, которые оставить (например: normal)")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждение")
    args = parser.parse_args()

    if not os.path.isfile(args.db):
        print(f"ОШИБКА: базы нет — {args.db}")
        return 1

    print(f"База: {args.db}")

    # Подключаемся НАПРЯМУЮ через sqlite3, а не через db.connect(). Это не
    # придирка к стилю: db.connect() прогоняет миграции, а те заново льют
    # правила из старых таблиц. Чистить базу инструментом, который её по
    # дороге наполняет, — так себе идея.
    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")

    before = show(conn, "Сейчас в базе:")
    if not any(before.values()):
        print("\nЧистить нечего.")
        return 0

    if args.keep:
        print(f"\nОстанутся: {', '.join(args.keep)}")
    else:
        print("\nБудут удалены ВСЕ правила чипса — ни цветов, ни пометок не останется.")

    if not args.yes:
        answer = input("\nУдаляем? [y/N] ").strip().lower()
        if answer not in ("y", "yes", "д", "да"):
            print("Отменено, база не тронута.")
            return 0

    saved = backup(args.db)
    print(f"\nКопия базы: {saved}")

    with conn:
        clean(conn, args.keep)

    show(conn, "Стало:")

    print("\nГотово. Дальше запускай сервер как обычно.")
    print("Если правила всё-таки вернулись — значит seeds.py на этой машине")
    print("ещё не почищен ИЛИ в app_settings сбросили seeds_version.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
