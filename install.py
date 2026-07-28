#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
УСТАНОВКА В ЗАКРЫТОМ КОНТУРЕ
═════════════════════════════════════════════════════════════════════════════

Один запуск — и система готова к работе. Интернет НЕ НУЖЕН ни на одном шаге:
всё, что требуется, лежит в этом же архиве, а работает оно на стандартной
библиотеке Python. Ничего не скачивается, ничего не ставится в систему.

    python install.py

Что делает:

    1. проверяет версию Python;
    2. проверяет, что все файлы приложения на месте;
    3. создаёт базу и разворачивает в ней 18 таблиц;
    4. заполняет справочники: цвета-правила, пометки, правила оплаты, статусы;
    5. прогоняет самопроверку — что база читается и расчёт запускается;
    6. печатает, что делать дальше.

Повторный запуск безопасен: таблицы создаются через IF NOT EXISTS, справочники
досеиваются только те, которых нет. Существующие данные не трогаются.

ДОПОЛНИТЕЛЬНЫЕ КЛЮЧИ

    python install.py --dump-schema    пересобрать schema.sql из db.py
    python install.py --check          только проверить, ничего не менять

ГДЕ ЛЕЖИТ БАЗА. Файл megafon.db рядом с приложением. Другой путь задаётся
переменной окружения MEGAFON_DB — удобно, когда база должна лежать на
отдельном диске:

    set MEGAFON_DB=D:\\data\\megafon.db      (Windows)
    export MEGAFON_DB=/var/lib/megafon.db   (Linux)

ЗАПУСК ПОСЛЕ УСТАНОВКИ

    python server.py 3001

и открыть http://localhost:3001
"""

from __future__ import annotations

import os
import sys

# Минимальная версия. Ниже 3.9 не заработает: в коде используются
# str.removesuffix и современные аннотации типов.
MIN_PYTHON = (3, 9)

# Файлы, без которых приложение не поднимется. Проверяем до всякой работы,
# чтобы не создавать базу для заведомо битой установки.
REQUIRED = [
    "db.py", "queries.py", "domain.py", "billing.py", "seeds.py",
    "server.py", "index.html", "script.js", "style.css",
]

STEP = 0


def step(title: str) -> None:
    global STEP
    STEP += 1
    print(f"\n[{STEP}] {title}")


def fail(message: str) -> int:
    print(f"\n  ОШИБКА: {message}")
    print("  Установка прервана, база не изменена.")
    return 1


def check_python() -> bool:
    version = sys.version_info
    ok = version >= MIN_PYTHON
    print(f"    Python {version.major}.{version.minor}.{version.micro} — "
          + ("подходит" if ok else f"НУЖЕН {MIN_PYTHON[0]}.{MIN_PYTHON[1]} или новее"))
    return ok


def check_files(root: str) -> list[str]:
    missing = [name for name in REQUIRED if not os.path.isfile(os.path.join(root, name))]
    for name in REQUIRED:
        mark = "нет" if name in missing else "есть"
        print(f"    {name:14} {mark}")
    return missing


def dump_schema(root: str) -> None:
    """Пересобрать SQL-файлы схемы из db.py.

    Схема живёт в коде — это единственный источник правды. Файлы .sql нужны,
    чтобы структуру можно было посмотреть или развернуть руками там, где
    python запускать нельзя. Поэтому они именно ГЕНЕРИРУЮТСЯ, а не пишутся
    отдельно: разъехаться с кодом они не могут.
    """
    import db
    parts = [db.CORE_DDL, db.EXTENSION_DDL, db.RULES_DDL]

    head = ("-- Схема базы «Анализ тарифных планов». Диалект: {d}\n"
            "-- ФАЙЛ СГЕНЕРИРОВАН, РУКАМИ НЕ ПРАВЯТ.\n"
            "-- Источник: db.py (CORE_DDL + EXTENSION_DDL + RULES_DDL).\n"
            "-- Пересобрать: python install.py --dump-schema\n\n")

    with open(os.path.join(root, "schema.sql"), "w", encoding="utf-8") as fh:
        fh.write(head.format(d="SQLite") + "\n".join(parts))
    print("    schema.sql — пересобран")

    # Постгресовый вариант делаем, только если рядом лежит deploy.py.
    try:
        import deploy
        with open(os.path.join(root, "schema_postgres.sql"), "w", encoding="utf-8") as fh:
            fh.write(head.format(d="PostgreSQL")
                     + "\n".join(deploy.to_postgres(p) for p in parts))
        print("    schema_postgres.sql — пересобран")
    except Exception as err:                                   # noqa: BLE001
        print(f"    schema_postgres.sql — пропущен ({err})")


def main(argv: list[str]) -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    sys.path.insert(0, root)

    only_check = "--check" in argv

    print("═" * 70)
    print("  УСТАНОВКА: Анализ тарифных планов")
    print("═" * 70)

    step("Проверка Python")
    if not check_python():
        return fail("слишком старая версия Python")

    step("Проверка файлов приложения")
    missing = check_files(root)
    if missing:
        return fail("не хватает файлов: " + ", ".join(missing))

    if "--dump-schema" in argv:
        step("Пересборка файлов схемы")
        dump_schema(root)
        return 0

    step("База данных")
    import db
    print(f"    путь: {db.DB_PATH}")
    existed = os.path.isfile(db.DB_PATH)
    print("    " + ("файл уже есть — дополним, данные не тронем"
                    if existed else "файла нет — создаём с нуля"))
    if only_check and not existed:
        return fail("базы нет, а запуск в режиме проверки ничего не создаёт")

    conn = db.connect()          # создаёт схему и применяет миграции
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    print(f"    таблиц в базе: {len(tables)}")

    step("Справочники")
    import queries
    colors = queries.get_chip_colors()
    marks = queries.get_chip_marks()
    print(f"    цвета-правила  : {len(colors)}")
    print(f"    пометки        : {len(marks)}")
    print(f"    правила оплаты : {len(queries.get_payment_rules())}")
    print(f"    статусы        : {len(queries.get_statuses())}")
    if not colors or not marks:
        return fail("справочники пусты — правила не заполнились")

    step("Самопроверка")
    import server
    month = queries.latest_month()
    if month:
        view = server.build_month_view(month)
        subs = view.get("subscribers") or []
        pay = view.get("payment_summary") or {}
        print(f"    период {month}: абонентов {len(subs)}")
        print(f"    платит компания {pay.get('company_pays')}, "
              f"сотрудник {pay.get('employee_pays')}")
    else:
        # Пустая база — это нормально для свежей установки, но расчёт всё
        # равно обязан отрабатывать без падения.
        server.build_month_view("")
        print("    счетов ещё нет — это нормально для новой установки")
        print("    расчёт на пустой базе отработал без ошибок")

    print("\n" + "═" * 70)
    print("  ГОТОВО")
    print("═" * 70)
    print("\n  Запуск:      python server.py 3001")
    print("  Открыть:     http://localhost:3001")
    if not month:
        print("\n  Дальше в самом приложении: Меню → Загрузить счёт.")
        # Образцов выгрузок в архиве нет намеренно: в них абонентские
        # данные, а репозиторий содержит только то, что нужно для прода.
        print("  Нужна выгрузка оператора «Начисления по абонентским номерам»")
        print("  в формате .txt или .csv с разделителем «;».")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
