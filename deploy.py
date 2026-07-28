#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
РАЗВЁРТЫВАНИЕ БАЗЫ НА POSTGRESQL
═════════════════════════════════════════════════════════════════════════════

ЧТО ДЕЛАЕТ. Один запуск — и на машине готова рабочая база:

  1. находит установленный PostgreSQL (в PATH или в Program Files);
  2. проверяет, что служба поднята и пускает внутрь;
  3. создаёт базу и пользователя приложения, если их ещё нет;
  4. разворачивает ВСЕ таблицы — те же, что у приложения, 18 штук;
  5. переносит данные из рабочей SQLite-базы, если она есть;
  6. проверяет, что перенеслось столько же строк, сколько было.

Скрипт МОЖНО ЗАПУСКАТЬ ПОВТОРНО. Всё, что он делает, идемпотентно: таблицы
создаются через IF NOT EXISTS, данные — через ON CONFLICT DO NOTHING.
Второй прогон ничего не задвоит и ничего не сотрёт.

ЗАПУСК.

    python deploy.py                      посмотреть, что будет сделано
    python deploy.py --run                сделать
    python deploy.py --run --with-data    сделать и перенести данные из SQLite
    python deploy.py --run --with-data --fresh   то же, но очистить цель перед
                                          переносом. Нужен, если в базе уже
                                          лежат данные прошлого прогона:
                                          иначе строки молча не доедут.

Настройки берутся из переменных окружения, у всех есть разумные значения:

    PGHOST     localhost      PGPORT   5432
    PGSUPERUSER postgres      PGPASSWORD  пароль суперпользователя
    APP_DB     megafon        APP_USER megafon    APP_PASSWORD  megafon

───────────────────────────────────────────────────────────────────────────
РЕШЕНИЕ ПРИНЯТО: ПРИЛОЖЕНИЕ ОСТАЁТСЯ НА SQLITE. Вайбик, но по делу.
───────────────────────────────────────────────────────────────────────────
Этот скрипт ГОТОВИТ базу на PostgreSQL, но САМО ПРИЛОЖЕНИЕ на неё НЕ
переключается — и это осознанный выбор владельца, а не недоделка.

Почему так. В стандартной библиотеке Python драйвера PostgreSQL нет и не
будет. Чтобы приложение заговорило с постгресом, нужен пакет psycopg —
то есть внешняя зависимость. А правило проекта простое, черемша: внешних
зависимостей не тащим, закрытый контур этого не любит.

Отсюда расклад, который у нас и работает:

    SQLite     ← рабочая база приложения, вся логика и расчёты здесь
    PostgreSQL ← витрина для отчётности и выгрузок, наполняется этим
                 скриптом теми же самыми данными

Если однажды решите переехать целиком — понадобится `pip install
"psycopg[binary]"` и правка db.py строк на сорок. Не раньше.

Скрипт работает через psql.exe, который идёт вместе с самим PostgreSQL,
поэтому НИЧЕГО СКАЧИВАТЬ И СТАВИТЬ ему не требуется. Гойда.
"""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import subprocess
import sys

import db as appdb

# ═══════════════════════════════════════════════════════════════════════════
#  НАСТРОЙКИ
# ═══════════════════════════════════════════════════════════════════════════

CFG = {
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5432"),
    "superuser": os.environ.get("PGSUPERUSER", "postgres"),
    "superpass": os.environ.get("PGPASSWORD", ""),
    "db": os.environ.get("APP_DB", "megafon"),
    "user": os.environ.get("APP_USER", "megafon"),
    "password": os.environ.get("APP_PASSWORD", "megafon"),
}


def find_psql() -> str | None:
    """Найти psql. Сначала в PATH, потом в стандартных местах установки.

    В Windows установщик PostgreSQL по умолчанию НЕ прописывает себя в PATH,
    поэтому «psql не найден» почти никогда не значит «postgres не стоит».
    """
    found = shutil.which("psql")
    if found:
        return found
    for root in (r"C:\Program Files\PostgreSQL", r"C:\Program Files (x86)\PostgreSQL"):
        if not os.path.isdir(root):
            continue
        # Более свежая версия первой: 17 раньше 16, 16 раньше 9.
        for ver in sorted(os.listdir(root), key=_version_key, reverse=True):
            candidate = os.path.join(root, ver, "bin", "psql.exe")
            if os.path.isfile(candidate):
                return candidate
    return None


def _version_key(name: str) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"\D+", name) if p != "")


# ═══════════════════════════════════════════════════════════════════════════
#  ПЕРЕВОД СХЕМЫ ИЗ SQLITE В POSTGRESQL
#
#  Схема живёт в одном месте — в db.py. Здесь мы её НЕ переписываем руками,
#  а переводим на диалект PostgreSQL. Так две схемы не разъедутся: поправили
#  таблицу в приложении — она автоматически поправится и на проде.
# ═══════════════════════════════════════════════════════════════════════════

# Чем отличаются диалекты. Слева — как пишет SQLite, справа — как понимает
# PostgreSQL. Порядок важен: длинные образцы должны идти раньше коротких,
# иначе INTEGER PRIMARY KEY AUTOINCREMENT превратится в мусор.
DIALECT = [
    (r"INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY"),
    (r"INTEGER PRIMARY KEY", "BIGSERIAL PRIMARY KEY"),
    (r"\bAUTOINCREMENT\b", ""),
    # В SQLite логическое значение хранится числом. В PostgreSQL есть
    # настоящий boolean, но менять тип рискованно: приложение читает 0 и 1.
    # Поэтому оставляем целое число — так поведение совпадает точно.
    (r"\bDATETIME\b", "TIMESTAMP"),
    # DATE → TEXT, и это НЕ небрежность, а точное повторение поведения.
    # SQLite к типам относится вольно и спокойно хранит в колонке DATE
    # строку '2026-06' — расчётный МЕСЯЦ, а не дату. Приложение именно так
    # её и пишет, и именно так читает. PostgreSQL строгий: он отвергает
    # '2026-06' как некорректную дату, и перенос reports падал целиком, а
    # следом обнулялся pvalues, который на reports ссылается.
    # Менять формат в приложении ради красоты типа — значит трогать логику
    # расчётов. Дешевле и честнее хранить то же самое и той же строкой.
    (r"\bDATE\b", "TEXT"),
]


def to_postgres(ddl: str) -> str:
    """Перевести DDL из диалекта SQLite в диалект PostgreSQL."""
    out = ddl
    for pattern, replacement in DIALECT:
        out = re.sub(pattern, replacement, out)
    return out


def schema_sql() -> str:
    """Собрать полную схему приложения в виде одного SQL-скрипта."""
    # RULES_DDL обязателен: без него не создадутся chip_rules и
    # chip_rule_links, а на них держатся все правила номеров.
    parts = [appdb.CORE_DDL, appdb.EXTENSION_DDL, appdb.RULES_DDL]
    body = "\n".join(to_postgres(p) for p in parts)
    return body


def table_names(ddl: str) -> list[str]:
    return re.findall(r"CREATE TABLE IF NOT EXISTS\s+(\w+)", ddl)


def split_ddl(ddl: str) -> tuple[str, list[str]]:
    """Разделить схему на «таблицы» и «индексы».

    ПОЧЕМУ ОДНИМ КУСКОМ НЕЛЬЗЯ. Порядок здесь принципиален:

        1. таблицы   — создать те, которых нет;
        2. колонки   — достроить те, что появились позже (см. upgrade_sql);
        3. индексы   — и только теперь, когда все колонки на месте.

    Именно на этом развёртывание и спотыкалось: в схеме индекс по колонке
    is_business_trip шёл сразу за таблицей, а в старой базе такой колонки
    ещё не было. Индекс падал, и весь скрипт обрывался, не дойдя до шага,
    который эту колонку добавляет.
    """
    indexes = re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;", ddl, re.I)
    tables = re.sub(r"CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;", "", ddl, flags=re.I)
    return tables, [i.strip() for i in indexes]


def upgrade_sql(ddl: str) -> str:
    """Достроить колонки, которых не хватает в уже существующих таблицах.

    ЗАЧЕМ ЭТО НУЖНО. CREATE TABLE IF NOT EXISTS спасает от повторного
    создания, но НИЧЕГО не делает с таблицей, которая была создана раньше
    и с тех пор отстала. Именно на это скрипт и напоролся: база megafon
    на сервере уже существовала со старой схемой, в users_numbers не было
    колонки is_business_trip — и развёртывание падало.

    Поэтому для каждой колонки из схемы выпускаем отдельный
    ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Для новой базы это пустая
    работа, для отставшей — ровно то, что нужно. Данные не трогаются:
    существующие колонки остаются как есть.

    Ограничения строкового разбора известны и приняты: составные ключи и
    внешние ссылки пропускаем, их создаёт сам CREATE TABLE.
    """
    lines: list[str] = []
    for block in re.finditer(
            r"CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\n\s*\);", ddl, re.S):
        table, body = block.group(1), block.group(2)
        for raw in body.split("\n"):
            piece = raw.split("--")[0].strip().rstrip(",").strip()
            if not piece:
                continue
            head = piece.split()[0].upper()
            # Это не колонка, а описание ключа или ссылки — пропускаем.
            if head in ("PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"):
                continue
            name, _, definition = piece.partition(" ")
            if not definition.strip():
                continue
            # PRIMARY KEY в определении колонки при ALTER не разрешён.
            definition = re.sub(r"\bPRIMARY KEY\b", "", definition, flags=re.I).strip()
            if not definition:
                continue
            lines.append(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {definition};")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
#  ЗАПУСК КОМАНД
# ═══════════════════════════════════════════════════════════════════════════

def run_psql(psql: str, database: str, sql: str, *, user: str | None = None) -> tuple[int, str]:
    """Выполнить SQL. Возвращает код возврата и вывод."""
    env = dict(os.environ)
    if CFG["superpass"]:
        env["PGPASSWORD"] = CFG["superpass"]
    cmd = [psql, "-h", CFG["host"], "-p", CFG["port"],
           "-U", user or CFG["superuser"], "-d", database,
           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"]
    # РАБОТАЕМ С БАЙТАМИ, А НЕ С ТЕКСТОМ.
    # psql в русской Windows печатает свои сообщения в cp1251, а данные
    # отдаёт в UTF-8. Если довериться text=True, Python пытается разобрать
    # всё как UTF-8 и падает на первой же русской ошибке — причём падает
    # в фоновом потоке, из-за чего настоящая причина сбоя теряется.
    # Поэтому забираем байты и разбираем их сами, с запасным вариантом.
    proc = subprocess.run(cmd, input=sql.encode("utf-8"),
                          capture_output=True, env=env)
    return proc.returncode, _decode(proc.stdout) + _decode(proc.stderr)


def _decode(data: bytes) -> str:
    """Разобрать вывод psql: сначала UTF-8, если не вышло — cp1251."""
    if not data:
        return ""
    for enc in ("utf-8", "cp1251"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("cp1251", errors="replace")


def last_line(text: str, limit: int = 200) -> str:
    """Последняя содержательная строка вывода — обычно там и есть причина."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    return lines[-1][:limit] if lines else "(вывод пуст)"


# ═══════════════════════════════════════════════════════════════════════════
#  ПЕРЕНОС ДАННЫХ
# ═══════════════════════════════════════════════════════════════════════════

def copy_data(psql: str, tables: list[str], fresh: bool) -> dict[str, tuple[int, int]]:
    """Перенести содержимое SQLite в PostgreSQL.

    ON CONFLICT DO NOTHING — чтобы повторный запуск не ругался на уже
    перенесённые строки и не задваивал их.
    """
    path = appdb.DB_PATH
    if not os.path.isfile(path):
        print(f"  SQLite-базы нет ({path}) — переносить нечего")
        return {}

    src = sqlite3.connect(path)
    src.row_factory = sqlite3.Row
    have = {r[0] for r in src.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}

    # ОЧИСТКА ЦЕЛИ.
    # Без неё перенос молча теряет строки: ON CONFLICT DO NOTHING пропускает
    # всё, что конфликтует с остатками прошлого прогона, и делает это БЕЗ
    # ОШИБКИ. Именно так reports приехал на 62 строки вместо 100, а pvalues
    # следом обнулился — он ссылается на reports, и внешний ключ отменил
    # весь пакет целиком.
    if fresh:
        present = [t for t in tables if t in have]
        rc, out = run_psql(psql, CFG["db"],
                           f'TRUNCATE {", ".join(present)} RESTART IDENTITY CASCADE;')
        print("  очистка цели: " + ("выполнена" if rc == 0 else "ОШИБКА " + last_line(out, 120)))

    result: dict[str, tuple[int, int]] = {}
    for table in tables:
        if table not in have:
            continue
        rows = src.execute(f"SELECT * FROM {table}").fetchall()
        if not rows:
            result[table] = (0, count_pg(psql, table))
            print(f"  {table:22} пусто")
            continue
        cols = rows[0].keys()
        chunks = [f'({", ".join(_lit(row[c]) for c in cols)})' for row in rows]
        # Режем на пачки по 800 строк: одна команда не упирается в память,
        # а сбой затрагивает только свою пачку, а не весь перенос.
        ok = True
        for start in range(0, len(chunks), 800):
            sql = (f'INSERT INTO {table} ({", ".join(cols)}) VALUES\n'
                   + ",\n".join(chunks[start:start + 800]) + "\nON CONFLICT DO NOTHING;")
            code, out = run_psql(psql, CFG["db"], sql)
            if code != 0:
                ok = False
                print(f"  {table:22} ОШИБКА: {last_line(out, 140)}")
                break
        got = count_pg(psql, table)
        result[table] = (len(rows), got)
        if ok:
            mark = "ок" if got == len(rows) else f"РАСХОЖДЕНИЕ, доехало {got}"
            print(f"  {table:22} {len(rows):5} строк  {mark}")
    src.close()
    return result


def count_pg(psql: str, table: str) -> int:
    """Сколько строк РЕАЛЬНО лежит в таблице PostgreSQL.

    Считаем отдельным запросом, а не верим коду возврата INSERT: перенос
    без независимой сверки доверия не заслуживает — он уже один раз соврал.
    """
    out = _decode(subprocess.run(
        [psql, "-h", CFG["host"], "-p", CFG["port"], "-U", CFG["superuser"],
         "-d", CFG["db"], "-t", "-A", "-c", f"SELECT COUNT(*) FROM {table}"],
        capture_output=True,
        env={**os.environ, **({"PGPASSWORD": CFG["superpass"]} if CFG["superpass"] else {})},
    ).stdout).strip()
    return int(out) if out.isdigit() else -1
    src.close()


def _lit(value) -> str:
    """Превратить значение Python в литерал SQL. Кавычки экранируем удвоением."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


# ═══════════════════════════════════════════════════════════════════════════
#  ГЛАВНОЕ
# ═══════════════════════════════════════════════════════════════════════════

def main(argv: list[str]) -> int:
    do_run = "--run" in argv
    with_data = "--with-data" in argv
    fresh = "--fresh" in argv

    print("═" * 70)
    print("  РАЗВЁРТЫВАНИЕ БАЗЫ MEGAFON НА POSTGRESQL")
    print("═" * 70)

    psql = find_psql()
    if not psql:
        print("\n  PostgreSQL не найден.")
        print("  Установите его с https://www.postgresql.org/download/windows/")
        print("  и запустите скрипт снова — качать он ничего не умеет и не должен.")
        return 1
    print(f"\n  psql: {psql}")

    ddl = schema_sql()
    tables = table_names(ddl)
    print(f"  таблиц в схеме: {len(tables)}")
    print("  " + ", ".join(tables))

    print(f"\n  сервер : {CFG['host']}:{CFG['port']}")
    print(f"  база   : {CFG['db']}")
    print(f"  польз. : {CFG['user']}")

    if not do_run:
        print("\n  Это предварительный просмотр, НИЧЕГО НЕ ИЗМЕНЕНО.")
        print("  Чтобы выполнить:            python deploy.py --run")
        print("  Выполнить и перенести данные: python deploy.py --run --with-data")
        return 0

    # ── 1. Связь с сервером ──────────────────────────────────────────────
    code, out = run_psql(psql, "postgres", "SELECT version();")
    if code != 0:
        print("\n  Не удалось подключиться к серверу:")
        print("  " + last_line(out))
        print("\n  Проверьте, что служба запущена и что задан PGPASSWORD.")
        return 1
    print("\n  связь с сервером: есть")

    # ── 2. Пользователь и база ───────────────────────────────────────────
    # CREATE DATABASE нельзя выполнить внутри транзакции и нельзя обернуть
    # в IF NOT EXISTS, поэтому наличие проверяем заранее и создаём отдельно.
    setup = f"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{CFG["user"]}') THEN
    CREATE ROLE {CFG["user"]} LOGIN PASSWORD '{CFG["password"]}';
  END IF;
END $$;
"""
    code, out = run_psql(psql, "postgres", setup)
    print(f"  пользователь {CFG['user']}: " + ("готов" if code == 0 else "ОШИБКА " + out[:120]))

    # -t -A убирают заголовок и рамку, поэтому в выводе остаётся ровно
    # «1» или пустота. Раньше здесь искалась подстрока «1 row», которой при
    # ключе -q вообще не бывает, и скрипт каждый раз пытался создать базу
    # заново, получая ошибку «база уже существует».
    exists_out = _decode(subprocess.run(
        [psql, "-h", CFG["host"], "-p", CFG["port"], "-U", CFG["superuser"],
         "-d", "postgres", "-t", "-A", "-c",
         f"SELECT 1 FROM pg_database WHERE datname = '{CFG['db']}'"],
        capture_output=True,
        env={**os.environ, **({"PGPASSWORD": CFG["superpass"]} if CFG["superpass"] else {})},
    ).stdout).strip()
    if exists_out != "1":
        code, out = run_psql(psql, "postgres",
                             f"CREATE DATABASE {CFG['db']} OWNER {CFG['user']};")
        print(f"  база {CFG['db']}: " + ("создана" if code == 0 else "ОШИБКА " + out[:120]))
    else:
        print(f"  база {CFG['db']}: уже была")

    # ── 3. Схема ─────────────────────────────────────────────────────────
    # Шаг 1 — таблицы. Индексы отложены: они могут ссылаться на колонки,
    # которых в старой базе ещё нет.
    tables_sql, indexes = split_ddl(ddl)
    code, out = run_psql(psql, CFG["db"], tables_sql)
    if code != 0:
        print("\n  Таблицы не развернулись:")
        for line in out.strip().splitlines()[-6:]:
            print("    " + line[:160])
        return 1
    print("  таблицы: развёрнуты")

    # Шаг 2 — колонки. Достраиваем то, что появилось в схеме позже, чем была
    # создана база. Каждая команда идёт отдельным вызовом: сбой на одной
    # колонке не должен отменять остальные.
    upgrades = [ln for ln in upgrade_sql(ddl).splitlines() if ln.strip()]
    bad_cols = 0
    for statement in upgrades:
        rc, _ = run_psql(psql, CFG["db"], statement)
        bad_cols += (rc != 0)
    print(f"  колонки: проверено {len(upgrades)}"
          + (f", не применилось {bad_cols}" if bad_cols else ", все на месте"))

    # Шаг 3 — индексы. Теперь все колонки точно существуют.
    bad_idx = 0
    for statement in indexes:
        rc, _ = run_psql(psql, CFG["db"], statement)
        bad_idx += (rc != 0)
    print(f"  индексы: проверено {len(indexes)}"
          + (f", не создалось {bad_idx}" if bad_idx else ", все на месте"))

    code, out = run_psql(psql, CFG["db"], f"""
GRANT ALL ON ALL TABLES IN SCHEMA public TO {CFG["user"]};
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO {CFG["user"]};
""")
    print("  права: выданы" if code == 0 else "  права: ОШИБКА")

    # ── 4. Данные ────────────────────────────────────────────────────────
    if with_data:
        print("\n  Перенос данных из SQLite:")
        moved = copy_data(psql, tables, fresh)
        # СВЕРКА. Ради неё всё и затевалось: расхождение должно бросаться
        # в глаза, а не прятаться в простыне вывода.
        bad = {t: v for t, v in moved.items() if v[0] != v[1]}
        if bad:
            print("\n  РАСХОЖДЕНИЯ — данные доехали НЕ ПОЛНОСТЬЮ:")
            for t, (was, got) in bad.items():
                print(f"    {t:22} в SQLite {was}, в PostgreSQL {got}")
            print("    Повторите с ключом --fresh: он очистит цель перед переносом.")
        else:
            print("\n  сверка: все таблицы совпали строка в строку")

    # ── 5. Сверка ────────────────────────────────────────────────────────
    print("\n  Что получилось в базе:")
    check = " UNION ALL ".join(
        f"SELECT '{t}' AS t, COUNT(*) AS n FROM {t}" for t in tables)
    code, out = run_psql(psql, CFG["db"], f"SELECT * FROM ({check}) x ORDER BY t;")
    for line in out.strip().splitlines():
        print("    " + line)

    print("\n  Готово. Приложение при этом продолжает работать на SQLite —")
    print("  переключение требует драйвера psycopg, см. заголовок файла.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
