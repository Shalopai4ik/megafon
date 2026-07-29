#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
УСТАНОВКА В ЗАКРЫТОМ КОНТУРЕ
═════════════════════════════════════════════════════════════════════════════

Один запуск — и система готова к работе. Интернет НЕ НУЖЕН ни на одном шаге,
скачивать и доустанавливать нечего: приложение работает на стандартной
библиотеке Python, а с базой разговаривает через `psql`, который уже стоит
вместе с самим PostgreSQL.

    python install.py

Что делает:

    1. проверяет версию Python;
    2. проверяет, что все файлы приложения на месте;
    3. находит psql и проверяет связь с сервером PostgreSQL;
    4. создаёт базу и пользователя приложения, если их ещё нет;
    5. разворачивает 19 таблиц и индексы;
    6. заполняет справочники: цвета-правила, пометки, правила оплаты, статусы;
    7. прогоняет самопроверку — что база читается и расчёт запускается.

Повторный запуск безопасен: таблицы создаются через IF NOT EXISTS, колонки
через ADD COLUMN IF NOT EXISTS, справочники досеиваются только те, которых
нет. Существующие данные не трогаются.

ДОПОЛНИТЕЛЬНЫЕ КЛЮЧИ

    python install.py --dump-schema    пересобрать schema.sql из db.py
    python install.py --check          только проверить, ничего не менять

КУДА ПОДКЛЮЧАЕМСЯ. Настройки берутся из файла `pg.conf` рядом с приложением,
а поверх него — из переменных окружения. По умолчанию:

    host=127.0.0.1  port=5432  database=megafon  user=megafon  password=megafon

Пример pg.conf:

    host     = 127.0.0.1
    port     = 5434
    database = megafon
    user     = megafon
    password = megafon

СОЗДАНИЕ БАЗЫ И ПОЛЬЗОВАТЕЛЯ требует прав суперпользователя — их установщик
берёт из PGSUPERUSER (по умолчанию `postgres`) и PGSUPERPASS. Если база и
пользователь уже созданы руками, эти переменные не нужны вообще.

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
# чтобы не лезть в базу для заведомо битой установки.
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
    print("  Установка прервана.")
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
    """Пересобрать schema.sql из db.py.

    Схема живёт в коде — это единственный источник правды. Файл .sql нужен,
    чтобы структуру можно было посмотреть или развернуть руками там, где
    python запускать нельзя:

        psql -U megafon -d megafon -f schema.sql

    Поэтому он именно ГЕНЕРИРУЕТСЯ, а не пишется отдельно: разъехаться с
    кодом он не может.
    """
    import db
    head = ("-- Схема базы «Анализ тарифных планов». PostgreSQL.\n"
            "-- ФАЙЛ СГЕНЕРИРОВАН, РУКАМИ НЕ ПРАВЯТ.\n"
            "-- Источник: db.py (CORE_DDL + EXTENSION_DDL + RULES_DDL).\n"
            "-- Пересобрать: python install.py --dump-schema\n\n")
    with open(os.path.join(root, "schema.sql"), "w", encoding="utf-8") as fh:
        fh.write(head + db.schema_sql())
    print(f"    schema.sql — пересобран, таблиц {len(db.table_names())}")


def main(argv: list[str]) -> int:
    # Консоль Windows по умолчанию не в UTF-8, и первая же рамка из «═»
    # роняет установку целиком. Переключаем поток, а не убираем рамки.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:                                          # noqa: BLE001
        pass

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

    import db

    if "--dump-schema" in argv:
        step("Пересборка файла схемы")
        dump_schema(root)
        return 0

    step("Клиент PostgreSQL")
    psql = db.find_psql()
    if not psql:
        return fail("не найден psql — клиент PostgreSQL.\n"
                    "  Он ставится вместе с сервером. Если сервер стоит, а psql\n"
                    "  не в PATH — укажите путь переменной MEGAFON_PSQL.")
    print(f"    psql: {psql}")
    print(f"    подключение: {db.target()}")
    if db.CONF_PATH and os.path.isfile(db.CONF_PATH):
        print(f"    настройки из: {db.CONF_PATH}")

    step("База и пользователь")
    try:
        db.ping()
        print("    связь есть, база и пользователь уже готовы")
    except db.DbError as err:
        print(f"    войти не удалось: {str(err).splitlines()[0]}")
        if only_check:
            return fail("проверка не создаёт базу; уберите --check")
        print(f"    пробуем создать под суперпользователем "
              f"{os.environ.get('PGSUPERUSER', 'postgres')}")
        try:
            for done in db.ensure_database():
                print(f"    создано: {done}")
            db.ping()
        except db.DbError as err2:
            return fail(f"{err2}\n\n"
                        "  Если базу и пользователя заводит администратор, попросите его\n"
                        "  выполнить:\n"
                        f"    CREATE ROLE {db.CFG['user']} LOGIN PASSWORD '…';\n"
                        f"    CREATE DATABASE {db.CFG['database']} OWNER {db.CFG['user']};")

    step("Схема")
    if only_check:
        print("    режим проверки: схема не трогается")
    else:
        db.ensure_schema()
        db.grant_all()
    counts = db.table_counts()
    print(f"    таблиц в базе: {len(counts)} (в схеме {len(db.table_names())})")
    absent = [t for t in db.table_names() if t not in counts]
    if absent:
        return fail("не развернулись таблицы: " + ", ".join(absent))

    step("Справочники")
    # Импорт queries сам поднимает схему и досеивает справочники — так же,
    # как это происходит при старте сервера. Отдельный вызов init() не нужен.
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
