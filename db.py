#!/usr/bin/env python3
"""
db.py — движок хранилища. PostgreSQL через psql.
=============================================================================

ПОЧЕМУ ЧЕРЕЗ psql, А НЕ ЧЕРЕЗ ДРАЙВЕР
-------------------------------------
База у нас одна и настоящая — PostgreSQL. Никакого SQLite, никакой «витрины
рядом с рабочей базой»: приложение читает и пишет ровно туда, где лежат
данные.

Драйвера PostgreSQL в стандартной библиотеке Python нет. Любой (psycopg,
psycopg2, asyncpg) — внешняя зависимость: колесо под конкретную связку
«версия питона + архитектура + glibc», которое в закрытом контуре надо
сначала протащить, а потом сопровождать при каждом обновлении Астры.
Мы этот путь прошли и с него сошли осознанно.

Зато `psql` на машине УЖЕ ЕСТЬ: он ставится вместе с самим PostgreSQL и
обновляется вместе с ним. Поэтому весь обмен с базой идёт через него —
запускаем процесс, отдаём SQL в stdin, забираем ответ из stdout. Ставить
и сопровождать нечего вообще.

КАК УСТРОЕН ОБМЕН
-----------------
    запрос на чтение   →  SELECT row_to_json(_q) FROM ( ваш SELECT ) _q
                          psql -t -A печатает по одной JSON-строке на строку
                          результата, Python их разбирает

    запрос на запись   →  SQL уходит в psql как есть, ответ не нужен

Формат обмена — JSON, и это не украшательство. Он сам разбирается с
кавычками, переводами строк внутри значений, NULL и русским текстом.
Разделители («;» или «|») на таких данных ломаются молча — проверено.

ПАРАМЕТРЫ ЗАПРОСОВ
------------------
psql не умеет привязанные параметры, поэтому значения подставляются в текст
запроса — но НЕ форматированием строк, а функцией `_render`, которая знает
про кавычки, комментарии и типы. Плейсхолдер остался прежним, «?», чтобы
прикладной код не переписывать (см. PLACEHOLDER).

ТРАНЗАКЦИИ
----------
`transaction()` НАКАПЛИВАЕТ команды в буфер и в конце блока отдаёт их одним
скриптом с ключом `-1` — то есть одной транзакцией: либо всё, либо ничего.
Исключение внутри блока просто выбрасывает буфер, до базы он не доезжает.

Отсюда ДВА ПРАВИЛА, которые надо знать:

  1. Внутри блока НЕТ РЕЗУЛЬТАТА у команды: `conn.execute(...)` возвращает
     заглушку. Нужен id вставленной строки — прочитайте его после выхода
     из блока (см. queries.save_report).
  2. Чтение внутри блока идёт ОТДЕЛЬНЫМ соединением и своих же
     незакоммиченных записей НЕ ВИДИТ. Так задумано: буфер ещё не отправлен.

Вложенность поддержана: внутренний `with transaction()` подливает команды в
буфер внешнего, а отправляется всё один раз, на выходе из самого внешнего.
Благодаря этому загрузка счёта на сотню абонентов — один запуск psql, а не
сотня.

НАСТРОЙКИ ПОДКЛЮЧЕНИЯ
---------------------
Берутся из файла `pg.conf` рядом с приложением, а поверх него — из
переменных окружения PG*. Значения по умолчанию:

    host=127.0.0.1  port=5432  database=megafon  user=megafon  password=megafon
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, Sequence

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# Плейсхолдер параметров запроса. Значения подставляет _render().
PLACEHOLDER = "?"

# Текущее время строкой в том же формате, в каком его писал SQLite:
# '2026-07-29 10:11:12'. Нужно потому, что колонки created_at/updated_at у
# нас текстовые, а CURRENT_TIMESTAMP в PostgreSQL — это timestamptz, и
# присвоить его текстовой колонке нельзя.
NOW_TEXT = "to_char(now(), 'YYYY-MM-DD HH24:MI:SS')"

_LOCK = threading.RLock()
_state = threading.local()          # буфер открытой транзакции этого потока


class DbError(RuntimeError):
    """Ошибка работы с базой. Текст пригоден для показа человеку."""


# ═══════════════════════════════════════════════════════════════════════════
#  НАСТРОЙКИ ПОДКЛЮЧЕНИЯ
# ═══════════════════════════════════════════════════════════════════════════

DEFAULTS = {
    "host": "127.0.0.1",
    "port": "5432",
    "database": "megafon",
    "user": "megafon",
    "password": "megafon",
}

# Переменная окружения для каждого параметра. Имена стандартные, те же, что
# понимает сам psql: кто уже настроил окружение для консоли, ничего нового
# настраивать не будет.
ENV_NAMES = {
    "host": "PGHOST",
    "port": "PGPORT",
    "database": "PGDATABASE",
    "user": "PGUSER",
    "password": "PGPASSWORD",
}

CONF_PATH = os.environ.get("MEGAFON_PGCONF", os.path.join(APP_DIR, "pg.conf"))


def _read_conf(path: str) -> dict[str, str]:
    """Прочитать pg.conf: строки вида `ключ = значение`, «#» — комментарий.

    Файл необязательный. Он нужен там, где выставить переменные окружения
    службе неудобно, — а в контуре это обычная ситуация.
    """
    out: dict[str, str] = {}
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if not line or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip().lower()
            if key in DEFAULTS:
                out[key] = value.strip()
    return out


def load_config() -> dict[str, str]:
    """Собрать настройки: умолчания → pg.conf → окружение (последнее сильнее)."""
    cfg = dict(DEFAULTS)
    cfg.update(_read_conf(CONF_PATH))
    for key, env in ENV_NAMES.items():
        value = os.environ.get(env)
        if value:
            cfg[key] = value
    return cfg


CFG = load_config()


def target() -> str:
    """Куда мы ходим — одной строкой, для логов и экрана установки."""
    return f"{CFG['user']}@{CFG['host']}:{CFG['port']}/{CFG['database']}"


# ═══════════════════════════════════════════════════════════════════════════
#  ПОИСК psql
# ═══════════════════════════════════════════════════════════════════════════

# Где искать, если psql не прописан в PATH. Установщик PostgreSQL под Windows
# по умолчанию себя в PATH НЕ добавляет, а в Debian-подобных (Astra в их
# числе) клиент лежит в каталоге своей версии.
SEARCH_DIRS = [
    r"C:\Program Files\PostgreSQL",
    r"C:\Program Files (x86)\PostgreSQL",
    "/usr/lib/postgresql",
    "/opt/pgpro",
    "/opt/postgresql",
]

_psql_path: str | None = None


def _version_key(name: str) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"\D+", name) if p != "")


def find_psql() -> str | None:
    """Найти psql: сначала в PATH, потом в стандартных местах установки."""
    override = os.environ.get("MEGAFON_PSQL")
    if override and os.path.isfile(override):
        return override
    found = shutil.which("psql")
    if found:
        return found
    for root in SEARCH_DIRS:
        if not os.path.isdir(root):
            continue
        # Более свежая версия первой: 17 раньше 16, 16 раньше 9.
        for ver in sorted(os.listdir(root), key=_version_key, reverse=True):
            for name in ("psql", "psql.exe"):
                candidate = os.path.join(root, ver, "bin", name)
                if os.path.isfile(candidate):
                    return candidate
    return None


def psql_path() -> str:
    """Путь к psql. Без него работать нельзя, поэтому сразу и по-русски."""
    global _psql_path
    if _psql_path is None:
        _psql_path = find_psql()
    if not _psql_path:
        raise DbError(
            "Не найден psql — клиент PostgreSQL.\n"
            "Он ставится вместе с сервером PostgreSQL. Проверьте, что сервер\n"
            "установлен, или укажите путь к psql переменной MEGAFON_PSQL.")
    return _psql_path


# ═══════════════════════════════════════════════════════════════════════════
#  ЗАПУСК psql
# ═══════════════════════════════════════════════════════════════════════════

# Шапка каждого скрипта.
#   standard_conforming_strings — обратный слэш внутри строки остаётся самим
#       собой. На этом держится экранирование в _literal(): удваиваем только
#       апостроф и больше ничего.
#   client_min_messages — чтобы NOTICE не сыпался в вывод.
PROLOGUE = ("SET standard_conforming_strings = on;\n"
            "SET client_min_messages = warning;\n")


def _env(password: str | None = None) -> dict[str, str]:
    env = dict(os.environ)
    # Кодировку клиента задаём ЯВНО. Иначе psql берёт её из локали системы,
    # и на машине с cp1251 русский текст доезжает до базы покорёженным.
    env["PGCLIENTENCODING"] = "UTF8"
    value = CFG["password"] if password is None else password
    if value:
        env["PGPASSWORD"] = value
    return env


def _decode(data: bytes) -> str:
    """Разобрать вывод psql: сначала UTF-8, если не вышло — cp1251.

    Данные psql отдаёт в UTF-8 (мы сами так попросили), а вот СВОИ сообщения
    об ошибках он печатает в кодировке системы. На русской Windows это
    cp1251, и слепая вера в UTF-8 роняет разбор ровно на тексте ошибки —
    то есть именно тогда, когда он нужнее всего.
    """
    if not data:
        return ""
    for enc in ("utf-8", "cp1251"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("cp1251", errors="replace")


def _run(sql: str, *, database: str | None = None, tuples: bool = False,
         one_transaction: bool = False, stop_on_error: bool = True,
         quiet: bool = True, user: str | None = None,
         password: str | None = None) -> tuple[int, str, str]:
    """Выполнить SQL и вернуть (код возврата, stdout, stderr).

    stdout и stderr разделены НАМЕРЕННО: в режиме `tuples` в stdout должны
    лежать только строки результата. Смешай их — и текст ошибки поедет в
    разбор JSON вместо данных.

    `quiet` (ключ -q) убирает служебные отметки вроде «SET» и «INSERT 0 1».
    Для чтения он ОБЯЗАТЕЛЕН: две строки «SET» из шапки скрипта иначе
    приедут в stdout вместе с данными и сломают разбор JSON. Снимаем его
    только там, где эти отметки и нужны, — чтобы узнать число строк.
    """
    cmd = [psql_path(),
           "-h", CFG["host"], "-p", CFG["port"],
           "-U", user or CFG["user"],
           "-d", database or CFG["database"],
           "-X",                      # не читать ~/.psqlrc: чужие настройки
           "-f", "-"]                 #   формата ломают разбор вывода
    if quiet:
        cmd += ["-q"]
    if stop_on_error:
        cmd += ["-v", "ON_ERROR_STOP=1"]
    if tuples:
        cmd += ["-t", "-A"]           # без заголовка, без рамки, без выравнивания
    if one_transaction:
        cmd += ["-1"]                 # весь скрипт — одна транзакция
    proc = subprocess.run(cmd, input=(PROLOGUE + sql).encode("utf-8"),
                          capture_output=True, env=_env(password))
    return proc.returncode, _decode(proc.stdout), _decode(proc.stderr)


# Метки, которыми psql помечает суть ошибки. Русские — потому что свои
# сообщения он печатает на языке системы, а сервер у нас русский.
_ERROR_MARKS = ("ERROR:", "FATAL:", "DETAIL:", "HINT:", "CONTEXT:",
                "ОШИБКА:", "ВАЖНО:", "ПОДРОБНОСТИ:", "ПОДСКАЗКА:", "КОНТЕКСТ:")


def last_line(text: str, limit: int = 400) -> str:
    """Достать из вывода psql суть ошибки.

    Просто «последняя строка» не годится: psql печатает под ошибкой сам
    запрос и строку с «^», и именно она оказывается последней. Поэтому
    сначала ищем помеченные строки, и только если их нет — берём последнюю.
    """
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    marked = [ln for ln in lines if ln.startswith(_ERROR_MARKS)]
    if marked:
        return " ".join(marked)[:limit]
    return lines[-1][:limit] if lines else "(вывод пуст)"


def _fail(sql: str, err: str) -> None:
    raise DbError(f"{last_line(err)}\n--- запрос ---\n{sql.strip()[:800]}")


# ═══════════════════════════════════════════════════════════════════════════
#  ПОДСТАНОВКА ПАРАМЕТРОВ
# ═══════════════════════════════════════════════════════════════════════════

def _literal(value: Any) -> str:
    """Значение Python → литерал SQL.

    Строки берём в апострофы, апостроф внутри удваиваем. Обратный слэш не
    трогаем: standard_conforming_strings=on выставлен в шапке скрипта, и
    слэш в строке значит сам себя.

    Логическое значение превращаем в 0/1, а НЕ в TRUE/FALSE. Причина в схеме:
    все «галочки» у нас хранятся целым числом, а приведения boolean→integer
    PostgreSQL сам не делает — вставка TRUE в такую колонку падает.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return repr(value)
    if isinstance(value, float):
        # NaN и бесконечность в базе не нужны, и просто так их туда не
        # вставить. Считаем это «значения нет».
        return repr(value) if value == value and abs(value) != float("inf") else "NULL"
    if isinstance(value, (bytes, bytearray)):
        value = _decode(bytes(value))
    text = str(value)
    # \x00 текстовая колонка PostgreSQL не принимает вообще ни в каком виде.
    text = text.replace("\x00", "")
    return "'" + text.replace("'", "''") + "'"


def _render(sql: str, params: Sequence[Any] = ()) -> str:
    """Подставить параметры вместо «?».

    Разбираем текст запроса, а не заменяем вслепую: «?» внутри строкового
    литерала, внутри кавычек-идентификаторов и внутри комментария — это
    просто символ, а не место для параметра.
    """
    params = list(params or ())
    out: list[str] = []
    used = 0
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch == "'" or ch == '"':
            # Строковый литерал или идентификатор в кавычках: копируем целиком.
            j = i + 1
            while j < n:
                if sql[j] == ch:
                    if j + 1 < n and sql[j + 1] == ch:   # удвоенная кавычка
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(sql[i:j])
            i = j
            continue
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j < 0 else j
            out.append(sql[i:j])
            i = j
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i)
            j = n if j < 0 else j + 2
            out.append(sql[i:j])
            i = j
            continue
        if ch == "?":
            if used >= len(params):
                raise DbError(f"Параметров меньше, чем «?» в запросе:\n{sql[:300]}")
            out.append(_literal(params[used]))
            used += 1
            i += 1
            continue
        out.append(ch)
        i += 1
    if used != len(params):
        raise DbError(f"Передано {len(params)} параметров, а «?» в запросе {used}:\n{sql[:300]}")
    return "".join(out)


def _statement(sql: str, params: Sequence[Any] = ()) -> str:
    """Готовая команда со своей точкой с запятой."""
    return _render(sql, params).strip().rstrip(";") + ";"


# ═══════════════════════════════════════════════════════════════════════════
#  ЧТЕНИЕ
# ═══════════════════════════════════════════════════════════════════════════

def query(sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    """Выполнить SELECT и вернуть список словарей.

    Запрос заворачивается в row_to_json — тогда psql печатает по одной
    самодостаточной JSON-строке на каждую строку результата, и разбирать её
    можно без догадок про разделители и кавычки. Порядок строк сохраняется:
    ORDER BY внутри подзапроса PostgreSQL не переставляет.
    """
    connect()
    body = _render(sql, params).strip().rstrip(";")
    wrapped = f"SELECT row_to_json(_q) FROM (\n{body}\n) AS _q;"
    rc, out, err = _run(wrapped, tuples=True)
    if rc != 0:
        _fail(body, err or out)
    rows: list[dict[str, Any]] = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def query_one(sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def scalar(sql: str, params: Sequence[Any] = (), default: Any = None) -> Any:
    row = query_one(sql, params)
    if not row:
        return default
    value = next(iter(row.values()), default)
    return default if value is None else value


# ═══════════════════════════════════════════════════════════════════════════
#  ЗАПИСЬ
# ═══════════════════════════════════════════════════════════════════════════

# Сколько строк затронула команда: psql печатает «INSERT 0 5», «UPDATE 3».
_TAG = re.compile(r"^(INSERT|UPDATE|DELETE|SELECT|COPY)\s+(?:\d+\s+)?(\d+)\s*$")


def _affected(out: str) -> int:
    total = 0
    for line in out.splitlines():
        m = _TAG.match(line.strip())
        if m:
            total += int(m.group(2))
    return total


def run_script(sql: str, *, one_transaction: bool = True) -> None:
    """Выполнить готовый SQL-скрипт. По умолчанию — одной транзакцией."""
    connect()
    with _LOCK:
        rc, out, err = _run(sql, one_transaction=one_transaction)
    if rc != 0:
        _fail(sql, err or out)


def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """Выполнить одну команду записи. Возвращает число затронутых строк.

    Если открыта транзакция этого потока — команда уходит в её буфер и
    выполнится на выходе из блока, а вернётся 0: результата ещё нет.
    """
    statement = _statement(sql, params)
    buffer = getattr(_state, "buffer", None)
    if buffer is not None:
        buffer.append(statement)
        return 0
    connect()
    with _LOCK:
        rc, out, err = _run(statement, quiet=False)
    if rc != 0:
        _fail(statement, err or out)
    return _affected(out)


# Сколько команд отправляем за один запуск psql. Ограничение чисто
# практическое: скрипт на миллион строк незачем держать в памяти целиком.
BATCH = 500


def execute_many(sql: str, rows: Iterable[Sequence[Any]]) -> None:
    """Выполнить одну и ту же команду для каждого набора параметров.

    Команды отправляются ОТДЕЛЬНЫМИ строками скрипта, а не склеиваются в
    один многострочный INSERT. Это важно для `ON CONFLICT ... DO UPDATE`:
    внутри одной команды PostgreSQL не даёт задеть одну и ту же строку
    дважды, и повтор ключа в загружаемом файле ронял бы весь пакет.
    """
    statements = [_statement(sql, row) for row in rows]
    if not statements:
        return
    buffer = getattr(_state, "buffer", None)
    if buffer is not None:
        buffer.extend(statements)
        return
    for start in range(0, len(statements), BATCH):
        run_script("\n".join(statements[start:start + BATCH]))


# ═══════════════════════════════════════════════════════════════════════════
#  ТРАНЗАКЦИИ
# ═══════════════════════════════════════════════════════════════════════════

class _NoResult:
    """Заглушка вместо курсора внутри транзакции.

    Внутри блока команды только накапливаются, поэтому результата у них
    физически нет. Молча возвращать None нельзя — получим загадочную ошибку
    страницей позже. Поэтому объясняем прямо здесь, что делать.
    """

    _HINT = ("Внутри transaction() у команды нет результата: команды копятся "
             "и уходят в базу одним куском на выходе из блока. Прочитайте "
             "нужное ПОСЛЕ блока — или обычным db.query() до него.")

    def fetchone(self) -> Any:
        raise DbError(self._HINT)

    def fetchall(self) -> Any:
        raise DbError(self._HINT)

    @property
    def lastrowid(self) -> int:
        raise DbError(self._HINT)

    @property
    def rowcount(self) -> int:
        raise DbError(self._HINT)


class _Tx:
    """То, что отдаётся в `with db.transaction() as conn`."""

    def __init__(self, buffer: list[str]):
        self._buffer = buffer

    def execute(self, sql: str, params: Sequence[Any] = ()) -> _NoResult:
        self._buffer.append(_statement(sql, params))
        return _NoResult()

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> _NoResult:
        self._buffer.extend(_statement(sql, row) for row in rows)
        return _NoResult()

    def executescript(self, sql: str) -> _NoResult:
        self._buffer.append(sql)
        return _NoResult()


@contextmanager
def transaction() -> Iterator[_Tx]:
    """Пишущая транзакция: либо всё, либо ничего.

    Вложенный вызов подливает команды в буфер внешнего блока и сам ничего не
    отправляет — отправка одна, на выходе из самого внешнего блока.
    """
    outer = getattr(_state, "buffer", None)
    if outer is not None:
        yield _Tx(outer)
        return

    buffer: list[str] = []
    _state.buffer = buffer
    try:
        yield _Tx(buffer)
    except Exception:
        # Буфер просто выбрасываем: до базы он не доехал, откатывать нечего.
        _state.buffer = None
        raise
    _state.buffer = None
    if buffer:
        run_script("\n".join(buffer))


# ═══════════════════════════════════════════════════════════════════════════
#  СХЕМА. Один в один из выгрузки боевой базы (database.txt.txt): те же имена
#  таблиц, колонок, уникальных ключей и индексов.
#
#  Типы:
#      BIGSERIAL          — вместо serial/nextval из выгрузки;
#      DOUBLE PRECISION   — деньги и объёмы. Не REAL: REAL в PostgreSQL это
#                           4 байта, семь значащих цифр, и на суммах счёта
#                           это уже видно;
#      INTEGER 0/1        — «галочки». Не boolean: так их читает всё
#                           приложение, а менять тип ради красоты — значит
#                           трогать логику расчётов;
#      TEXT для дат       — в счёте период приходит как '2026-06', это МЕСЯЦ,
#                           а не дата. PostgreSQL такое значение в колонку
#                           типа date не пустит.
# ═══════════════════════════════════════════════════════════════════════════

CORE_DDL = f"""
-- Справочник услуг оператора.
CREATE TABLE IF NOT EXISTS pname (
    id            BIGSERIAL PRIMARY KEY,
    description   TEXT NOT NULL UNIQUE,
    category      TEXT,
    service_type  TEXT
);

-- Каталог тарифных планов.
CREATE TABLE IF NOT EXISTS tariff_plans (
    id             BIGSERIAL PRIMARY KEY,
    plan_name      TEXT NOT NULL UNIQUE,
    internet_limit DOUBLE PRECISION,
    voice_limit    INTEGER,
    sms_limit      INTEGER,
    base_cost      DOUBLE PRECISION,
    created_at     TEXT DEFAULT {NOW_TEXT},
    is_flex        INTEGER NOT NULL DEFAULT 0,
    -- Ниже — поля, которых нет в выгрузке: каталог хранит ещё и тарифы
    -- сверх пакета, иначе подбор тарифа считать нечем.
    kind           TEXT DEFAULT 'voice',
    unlimited_net  INTEGER NOT NULL DEFAULT 0,
    rate_min       DOUBLE PRECISION DEFAULT 0,
    rate_sms       DOUBLE PRECISION DEFAULT 0,
    rate_mb        DOUBLE PRECISION DEFAULT 0,
    note           TEXT DEFAULT '',
    sort_order     INTEGER DEFAULT 0
);

-- Шапка месячного счёта одного абонента.
CREATE TABLE IF NOT EXISTS reports (
    id            BIGSERIAL PRIMARY KEY,
    report_month  TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    created_at    TEXT DEFAULT {NOW_TEXT},
    report_date   TEXT,
    tariff_id     INTEGER,
    check_abon    INTEGER DEFAULT 0,
    -- Сверх выгрузки: название тарифа строкой из счёта (в счёте оно есть
    -- всегда, а сопоставление с tariff_plans может не найтись) и итоги.
    tariff_name   TEXT DEFAULT '',
    total_charged DOUBLE PRECISION DEFAULT 0,
    vat           DOUBLE PRECISION DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reports_month ON reports (report_month);
CREATE INDEX IF NOT EXISTS idx_reports_subscriber ON reports (subscriber_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_subscriber_month
    ON reports (subscriber_id, report_month);

-- Строки начислений счёта.
CREATE TABLE IF NOT EXISTS pvalues (
    id               BIGSERIAL PRIMARY KEY,
    report_id        BIGINT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    parameter_id     BIGINT REFERENCES pname (id),
    volume           TEXT,
    no_discount      DOUBLE PRECISION,
    discount         DOUBLE PRECISION,
    with_discount    DOUBLE PRECISION,
    report_idt       INTEGER,
    volume_numeric   DOUBLE PRECISION,
    calculated_price DOUBLE PRECISION,
    -- Сверх выгрузки: имя услуги как в счёте. Нужно, когда услуга ещё не
    -- заведена в pname — иначе строка теряет смысл.
    service_name     TEXT DEFAULT '',
    unit             TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pvalues_report ON pvalues (report_id);

-- Реквизиты счёта за период.
CREATE TABLE IF NOT EXISTS invoice_meta (
    id                    BIGSERIAL PRIMARY KEY,
    report_month          TEXT UNIQUE,
    subscriber_id         TEXT,
    invoice_number        TEXT,
    invoice_date          TEXT,
    period_start          TEXT,
    period_end            TEXT,
    invoice_factura_list  TEXT,
    qr_text               TEXT,
    operator_name         TEXT,
    operator_address      TEXT,
    subscriber_name       TEXT,
    subscriber_address    TEXT,
    account_number        TEXT,
    contract_number       TEXT,
    payment_form          TEXT,
    inn_kpp               TEXT,
    receiver_name         TEXT,
    bank_name             TEXT,
    rs_number             TEXT,
    ks_number             TEXT,
    bik                   TEXT,
    balance_start         DOUBLE PRECISION,
    balance_end           DOUBLE PRECISION,
    total_charged         DOUBLE PRECISION,
    total_paid            DOUBLE PRECISION,
    penies_start          DOUBLE PRECISION,
    penies_accrued        DOUBLE PRECISION,
    penies_end            DOUBLE PRECISION,
    total_due_no_penies   DOUBLE PRECISION,
    total_due_with_penies DOUBLE PRECISION,
    days_to_pay           INTEGER,
    unpaid_previous       DOUBLE PRECISION,
    vat_amount            DOUBLE PRECISION,
    director_name         TEXT,
    -- ДОБАВЛЕНО сверх выгрузки. Причина: парсер счёта достаёт больше полей,
    -- чем есть колонок в боевой схеме, и часть данных иначе просто терялась
    -- бы при сохранении. `raw_json` хранит разобранный счёт целиком — это
    -- страховка от потерь; типизированные колонки нужны для SQL-отчётов.
    charged               DOUBLE PRECISION,
    total_vatable         DOUBLE PRECISION,
    period_label          TEXT,
    raw_json              TEXT
);

-- Абоненты: номер, лимит, ФИО, статус, командировка.
CREATE TABLE IF NOT EXISTS users_numbers (
    id               BIGSERIAL PRIMARY KEY,
    number           TEXT NOT NULL UNIQUE,
    limit_numbr      INTEGER,
    username         TEXT,
    status           TEXT DEFAULT 'normal',
    status_color     TEXT,
    is_business_trip INTEGER NOT NULL DEFAULT 0,
    trip_start_date  TEXT,
    trip_end_date    TEXT,
    -- Сверх выгрузки: приходят из списка сотрудников.
    position         TEXT DEFAULT '',
    personnel_no     TEXT DEFAULT '',
    note             TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_users_business_trip ON users_numbers (is_business_trip);
CREATE INDEX IF NOT EXISTS idx_users_status ON users_numbers (status);

-- Абоненты, исключённые из расчёта. status 0..9 — код причины.
CREATE TABLE IF NOT EXISTS blacklisted_persons (
    id         BIGSERIAL PRIMARY KEY,
    person_id  INTEGER UNIQUE,
    status     INTEGER CHECK (status >= 0 AND status <= 9),
    created_at TEXT DEFAULT {NOW_TEXT}
);
"""

# ═══════════════════════════════════════════════════════════════════════════
#  Расширение схемы: чипсы, правила оплаты, командировки
# ═══════════════════════════════════════════════════════════════════════════

EXTENSION_DDL = f"""
-- Семантическая палитра. Цвет — это правило: администратор красит номер, и
-- вместе с цветом на него применяется набор эффектов. Смысл цвета правится
-- здесь же, поэтому «синий = безлимит» не зашит в код.
CREATE TABLE IF NOT EXISTS chip_colors (
    code          TEXT PRIMARY KEY,
    hex           TEXT NOT NULL,
    label         TEXT NOT NULL,
    description   TEXT DEFAULT '',
    -- 'company' | 'employee' | 'auto' — кто платит за корзину.
    payer_tariff  TEXT DEFAULT 'auto',
    payer_options TEXT DEFAULT 'auto',
    payer_overage TEXT DEFAULT 'auto',
    payer_roaming TEXT DEFAULT 'auto',
    -- Полностью убрать номер из сводок и рекомендаций.
    is_excluded   INTEGER NOT NULL DEFAULT 0,
    -- Пакет безлимитный: перерасход по нему не считается и не лечится тарифом.
    is_unlimited  INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER DEFAULT 0,
    builtin       INTEGER NOT NULL DEFAULT 0
);

-- Постоянные настройки номера. Не зависят от месяца и периода счёта.
CREATE TABLE IF NOT EXISTS chip_settings (
    number        TEXT PRIMARY KEY,
    -- Ссылки на chip_colors здесь БОЛЬШЕ НЕТ, и это исправление, а не
    -- недосмотр. Цвета давно живут в chip_rules, а chip_colors осталась
    -- пустой заготовкой для отката. На свежей установке она пустая всегда —
    -- и внешний ключ отвергал ЛЮБУЮ покраску номера: «ключ (color_code)
    -- отсутствует в таблице chip_colors». А проверять и так есть чему:
    -- связь «номер ↔ правило» лежит в chip_rule_links, и вот там внешний
    -- ключ на chip_rules настоящий и работающий.
    color_code    TEXT,
    note          TEXT DEFAULT '',
    -- Ручная тонкая настройка поверх цвета. 'auto' — брать из цвета/правил.
    payer_tariff  TEXT DEFAULT 'auto',
    payer_options TEXT DEFAULT 'auto',
    payer_overage TEXT DEFAULT 'auto',
    payer_roaming TEXT DEFAULT 'auto',
    updated_at    TEXT DEFAULT {NOW_TEXT}
);

-- Дополнительные пометки-теги. На номер их можно навесить несколько.
CREATE TABLE IF NOT EXISTS chip_marks (
    code          TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    hex           TEXT DEFAULT '',
    description   TEXT DEFAULT '',
    payer_tariff  TEXT DEFAULT 'auto',
    payer_options TEXT DEFAULT 'auto',
    payer_overage TEXT DEFAULT 'auto',
    payer_roaming TEXT DEFAULT 'auto',
    is_excluded   INTEGER NOT NULL DEFAULT 0,
    is_unlimited  INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER DEFAULT 0,
    builtin       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chip_mark_links (
    number    TEXT NOT NULL,
    mark_code TEXT NOT NULL REFERENCES chip_marks (code) ON DELETE CASCADE,
    PRIMARY KEY (number, mark_code)
);

-- Правила по названию услуги: что считать корпоративной опцией, а что личной.
CREATE TABLE IF NOT EXISTS payment_rules (
    id         BIGSERIAL PRIMARY KEY,
    priority   INTEGER NOT NULL DEFAULT 100,
    enabled    INTEGER NOT NULL DEFAULT 1,
    -- 'tariff' | 'options' | 'overage' | 'roaming'
    scope      TEXT NOT NULL DEFAULT 'options',
    -- 'service' (подстрока названия) | 'category' (категория из pname)
    match_kind TEXT NOT NULL DEFAULT 'service',
    match_value TEXT NOT NULL DEFAULT '',
    payer      TEXT NOT NULL DEFAULT 'company',
    note       TEXT DEFAULT '',
    builtin    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payment_rules_scope ON payment_rules (scope, priority);

-- Командировки из выгрузки (komandirovki).
CREATE TABLE IF NOT EXISTS business_trips (
    id         BIGSERIAL PRIMARY KEY,
    number     TEXT NOT NULL,
    username   TEXT DEFAULT '',
    date_start TEXT,
    date_end   TEXT,
    country    TEXT DEFAULT '',
    order_no   TEXT DEFAULT '',
    order_date TEXT DEFAULT '',
    approved   INTEGER NOT NULL DEFAULT 0,
    memo_no    TEXT DEFAULT '',
    created_at TEXT DEFAULT {NOW_TEXT},
    UNIQUE (number, date_start, date_end)
);
CREATE INDEX IF NOT EXISTS idx_trips_number ON business_trips (number);

-- Пользовательские статусы абонентов.
CREATE TABLE IF NOT EXISTS app_statuses (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    color      TEXT NOT NULL,
    builtin    INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER DEFAULT 0
);

-- Помесячные расходы из списка сотрудников: история есть даже тогда,
-- когда счёт загружен за один месяц.
CREATE TABLE IF NOT EXISTS roster_history (
    number TEXT NOT NULL,
    month  TEXT NOT NULL,
    total  DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (number, month)
);

-- Настройки приложения одной строкой ключ-значение.
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Ставки роуминга по тарифным зонам оператора. Справочник: приложение по
-- нему ничего не пересчитывает, роуминг как считался по факту из счёта, так
-- и считается. Нужен, чтобы было куда посмотреть, когда в счёте прилетела
-- неожиданная сумма за поездку, — иначе сверять не с чем.
-- Все цены с НДС, в рублях. Входящие вызовы во всех зонах бесплатны.
CREATE TABLE IF NOT EXISTS roaming_zones (
    code        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    incoming    DOUBLE PRECISION DEFAULT 0,   -- входящие вызовы, ₽/мин
    call_home   DOUBLE PRECISION DEFAULT 0,   -- звонок в Россию, ₽/мин
    call_local  DOUBLE PRECISION DEFAULT 0,   -- звонок по стране пребывания
    call_other  DOUBLE PRECISION DEFAULT 0,   -- звонок в другие страны
    sms         DOUBLE PRECISION DEFAULT 0,   -- исходящее SMS, ₽/шт
    mb          DOUBLE PRECISION DEFAULT 0,   -- интернет, ₽/МБ
    satellite   DOUBLE PRECISION DEFAULT 0,   -- спутниковые сети, ₽/мин
    note        TEXT DEFAULT '',
    sort_order  INTEGER DEFAULT 100,
    builtin     INTEGER NOT NULL DEFAULT 0
);
"""

# Объединённые правила чипса: цвета и пометки в одной таблице.
RULES_DDL = """
CREATE TABLE IF NOT EXISTS chip_rules (
    code          TEXT PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'mark',   -- 'color' | 'mark'
    label         TEXT NOT NULL,
    hex           TEXT DEFAULT '',
    description   TEXT DEFAULT '',
    payer_tariff  TEXT DEFAULT 'auto',
    payer_options TEXT DEFAULT 'auto',
    payer_overage TEXT DEFAULT 'auto',
    payer_roaming TEXT DEFAULT 'auto',
    is_excluded   INTEGER NOT NULL DEFAULT 0,
    is_unlimited  INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER DEFAULT 100,
    builtin       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chip_rule_links (
    number    TEXT NOT NULL,
    rule_code TEXT NOT NULL REFERENCES chip_rules (code) ON DELETE CASCADE,
    PRIMARY KEY (number, rule_code)
);
CREATE INDEX IF NOT EXISTS idx_chip_rule_links_number ON chip_rule_links (number);
"""

SCHEMA_PARTS = (CORE_DDL, EXTENSION_DDL, RULES_DDL)

# Отменённые ограничения. CREATE TABLE IF NOT EXISTS не снимает того, что
# уже создано, поэтому лишнее убираем отдельно и по имени.
DROP_OBSOLETE_SQL = """
ALTER TABLE chip_settings DROP CONSTRAINT IF EXISTS chip_settings_color_code_fkey;
"""

# Версия схемы. Меняется, когда правится DDL выше. Пока номер в базе совпадает
# с этим, старт приложения не трогает схему вообще — а это единственное
# обращение к базе на старте вместо четырёх.
SCHEMA_VERSION = "pg-3"


# ═══════════════════════════════════════════════════════════════════════════
#  РАЗВЁРТЫВАНИЕ СХЕМЫ
# ═══════════════════════════════════════════════════════════════════════════

def schema_sql() -> str:
    """Полная схема одним скриптом — для файла schema.sql и ручной заливки."""
    return "\n".join(part.strip() + "\n" for part in SCHEMA_PARTS)


def table_names() -> list[str]:
    return re.findall(r"CREATE TABLE IF NOT EXISTS\s+(\w+)", schema_sql())


def _split_ddl(ddl: str) -> tuple[str, list[str]]:
    """Разделить схему на «таблицы» и «индексы».

    Порядок здесь принципиален:
        1. таблицы — создать те, которых нет;
        2. колонки — достроить те, что появились в схеме позже;
        3. индексы — и только теперь, когда все колонки на месте.

    Именно на этом развёртывание и спотыкалось: индекс по колонке
    is_business_trip шёл сразу за таблицей, а в старой базе такой колонки
    ещё не было. Индекс падал и обрывал весь скрипт, не дойдя до шага,
    который эту колонку добавляет.
    """
    indexes = re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;", ddl, re.I)
    tables = re.sub(r"CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;", "", ddl, flags=re.I)
    return tables, [i.strip() for i in indexes]


def _upgrade_sql(ddl: str) -> str:
    """Достроить колонки, которых не хватает в уже существующих таблицах.

    CREATE TABLE IF NOT EXISTS спасает от повторного создания, но НИЧЕГО не
    делает с таблицей, которая была создана раньше и с тех пор отстала.
    Поэтому для каждой колонки из схемы выпускаем отдельный
    ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Для новой базы это пустая
    работа, для отставшей — ровно то, что нужно. Данные не трогаются.

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
            # BIGSERIAL и PRIMARY KEY при ALTER не разрешены.
            if "SERIAL" in definition.upper():
                continue
            definition = re.sub(r"\bPRIMARY KEY\b", "", definition, flags=re.I).strip()
            if not definition:
                continue
            lines.append(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {definition};")
    return "\n".join(lines)


# Перелив старых справочников в объединённую таблицу правил.
#
# chip_colors и chip_marks имели одинаковый набор полей и одинаковую логику,
# различались ровно одним: цвет у номера один, пометок много. Для
# администратора это деление искусственное — он думает «навесить правило».
#
#     chip_colors ──┐
#                   ├──►  chip_rules       (поле kind: 'color' | 'mark')
#     chip_marks  ──┘
#
#     chip_settings.color_code ──┐
#                                ├──►  chip_rule_links (номер ↔ правило)
#     chip_mark_links          ──┘
#
# Старые таблицы НЕ удаляются: это путь отката. ON CONFLICT DO NOTHING —
# уже перенесённое не трогаем, правки администратора не затираются.
MIGRATE_RULES_SQL = """
INSERT INTO chip_rules (code, kind, label, hex, description, payer_tariff,
                        payer_options, payer_overage, payer_roaming,
                        is_excluded, is_unlimited, sort_order, builtin)
SELECT code, 'color', label, COALESCE(hex, ''), COALESCE(description, ''),
       payer_tariff, payer_options, payer_overage, payer_roaming,
       is_excluded, is_unlimited,
       -- Цвета идут раньше пометок: первый по порядку красит карточку.
       COALESCE(sort_order, 100), builtin
  FROM chip_colors
ON CONFLICT (code) DO NOTHING;

INSERT INTO chip_rules (code, kind, label, hex, description, payer_tariff,
                        payer_options, payer_overage, payer_roaming,
                        is_excluded, is_unlimited, sort_order, builtin)
SELECT code, 'mark', label, COALESCE(hex, ''), COALESCE(description, ''),
       payer_tariff, payer_options, payer_overage, payer_roaming,
       is_excluded, is_unlimited,
       COALESCE(sort_order, 100) + 1000, builtin
  FROM chip_marks
ON CONFLICT (code) DO NOTHING;

INSERT INTO chip_rule_links (number, rule_code)
SELECT number, color_code FROM chip_settings
 WHERE color_code IS NOT NULL AND color_code <> '' AND color_code <> 'normal'
ON CONFLICT DO NOTHING;

INSERT INTO chip_rule_links (number, rule_code)
SELECT number, mark_code FROM chip_mark_links
ON CONFLICT DO NOTHING;
"""


def ensure_schema() -> None:
    """Создать/донастроить схему. Безопасно вызывать сколько угодно раз."""
    ddl = schema_sql()
    tables_sql, indexes = _split_ddl(ddl)

    # 1. Таблицы. Одной транзакцией: половина схемы никому не нужна.
    rc, out, err = _run(tables_sql, one_transaction=True)
    if rc != 0:
        _fail("создание таблиц", err or out)

    # 2. Колонки и 3. индексы — без ON_ERROR_STOP. Здесь всё через
    # IF NOT EXISTS, и осечка на одной строке не должна отменять остальные.
    _run(_upgrade_sql(ddl), stop_on_error=False, one_transaction=False)
    _run("\n".join(indexes), stop_on_error=False, one_transaction=False)
    _run(DROP_OBSOLETE_SQL, stop_on_error=False, one_transaction=False)

    # 4. Перелив старых правил чипса. Идёт последним: опирается на то, что
    # все таблицы уже созданы.
    rc, out, err = _run(MIGRATE_RULES_SQL, one_transaction=True)
    if rc != 0:
        _fail("перенос правил чипса", err or out)

    rc, out, err = _run(_statement(
        "INSERT INTO app_settings (key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (SCHEMA_VERSION,)))
    if rc != 0:
        _fail("отметка версии схемы", err or out)


# ═══════════════════════════════════════════════════════════════════════════
#  СОЕДИНЕНИЕ
# ═══════════════════════════════════════════════════════════════════════════

_ready = False


def connect() -> None:
    """Убедиться, что база на месте и схема развёрнута.

    Постоянного соединения у нас нет: каждый запрос — свой запуск psql.
    Поэтому «подключиться» здесь означает «проверить и подготовить».
    Проверка делается ОДИН раз за жизнь процесса, и если версия схемы в базе
    совпадает с ожидаемой, вся раскатка DDL пропускается — на старте это
    один запрос вместо четырёх.
    """
    global _ready
    if _ready:
        return
    with _LOCK:
        if _ready:
            return
        rc, out, err = _run("SELECT value FROM app_settings WHERE key = 'schema_version';",
                            tuples=True)
        if rc != 0 or out.strip() != SCHEMA_VERSION:
            # Ошибка бывает двух родов, и путать их нельзя: «таблицы ещё нет»
            # лечится развёртыванием, «сервер не отвечает» — нет.
            if rc != 0 and not _server_alive():
                raise DbError(
                    f"Нет связи с базой {target()}.\n"
                    f"{last_line(err or out)}\n"
                    "Проверьте, что сервер PostgreSQL запущен, а логин и пароль\n"
                    "заданы в pg.conf или в переменных PGUSER/PGPASSWORD.")
            # ensure_schema ходит в базу напрямую через _run, а не через
            # query/execute, — рекурсии здесь нет.
            ensure_schema()
        _ready = True


def _server_alive() -> bool:
    """Отличить «схемы нет» от «сервера нет» — сообщения должны быть разные."""
    rc, _, _ = _run("SELECT 1;", tuples=True)
    return rc == 0


def close() -> None:
    """Совместимость. Закрывать нечего: соединение не живёт между запросами."""
    global _ready
    with _LOCK:
        _ready = False


def ping() -> str:
    """Проверка связи. Возвращает версию сервера или бросает DbError."""
    rc, out, err = _run("SELECT version();", tuples=True)
    if rc != 0:
        raise DbError(f"Нет связи с базой {target()}: {last_line(err or out)}")
    return out.strip()


# ═══════════════════════════════════════════════════════════════════════════
#  СОЗДАНИЕ БАЗЫ И ПОЛЬЗОВАТЕЛЯ (нужен доступ суперпользователя)
# ═══════════════════════════════════════════════════════════════════════════

def ensure_database(superuser: str = "", superpass: str = "") -> list[str]:
    """Создать роль приложения и его базу, если их ещё нет.

    Вызывается только установщиком: приложение в рабочем режиме таких прав
    не имеет и не должно. Возвращает список того, что было сделано.
    """
    superuser = superuser or os.environ.get("PGSUPERUSER", "postgres")
    superpass = superpass or os.environ.get("PGSUPERPASS", CFG["password"])
    done: list[str] = []

    rc, out, err = _run("SELECT 1;", database="postgres", tuples=True,
                        user=superuser, password=superpass)
    if rc != 0:
        raise DbError(
            f"Не удалось войти суперпользователем {superuser}: {last_line(err or out)}\n"
            "Задайте PGSUPERUSER и PGSUPERPASS.")

    # CREATE ROLE в блоке DO: обычного IF NOT EXISTS для ролей в PostgreSQL нет.
    role = _render("""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ?) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ?, ?);
  END IF;
END $$;
""", (CFG["user"], CFG["user"], CFG["password"]))
    rc, out, err = _run(role, database="postgres", user=superuser, password=superpass)
    if rc != 0:
        _fail("создание пользователя", err or out)
    done.append(f"пользователь {CFG['user']}")

    # CREATE DATABASE нельзя ни обернуть в IF NOT EXISTS, ни выполнить внутри
    # транзакции — поэтому наличие проверяем заранее, отдельным запросом.
    rc, out, _ = _run(_render("SELECT 1 FROM pg_database WHERE datname = ?;",
                              (CFG["database"],)),
                      database="postgres", tuples=True,
                      user=superuser, password=superpass)
    if out.strip() != "1":
        rc, out, err = _run(f'CREATE DATABASE "{CFG["database"]}" OWNER "{CFG["user"]}";',
                            database="postgres", user=superuser, password=superpass)
        if rc != 0:
            _fail("создание базы", err or out)
        done.append(f"база {CFG['database']}")
    return done


def grant_all(superuser: str = "", superpass: str = "") -> None:
    """Выдать приложению права на всё, что есть в его базе."""
    superuser = superuser or os.environ.get("PGSUPERUSER", "postgres")
    superpass = superpass or os.environ.get("PGSUPERPASS", CFG["password"])
    user = CFG["user"]
    _run(f'GRANT ALL ON SCHEMA public TO "{user}";\n'
         f'GRANT ALL ON ALL TABLES IN SCHEMA public TO "{user}";\n'
         f'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "{user}";',
         user=superuser, password=superpass, stop_on_error=False)


# ═══════════════════════════════════════════════════════════════════════════
#  ОБСЛУЖИВАНИЕ
# ═══════════════════════════════════════════════════════════════════════════

# Таблицы с загруженными данными счёта — их чистит «Очистить все данные».
DATA_TABLES = ("pvalues", "reports", "invoice_meta", "roster_history")

# Справочники и настройки: переживают очистку данных, потому что это
# ручная работа администратора, а не выгрузка оператора.
SETTINGS_TABLES = ("chip_settings", "chip_mark_links", "business_trips")


def wipe_data(*, keep_settings: bool = True) -> None:
    """Удалить загруженные счета. Настройки чипсов по умолчанию сохраняются."""
    with transaction() as conn:
        for table in DATA_TABLES:
            conn.execute(f"DELETE FROM {table}")
        conn.execute("UPDATE users_numbers SET limit_numbr = NULL")
        if not keep_settings:
            for table in SETTINGS_TABLES:
                conn.execute(f"DELETE FROM {table}")


def table_counts() -> dict[str, int]:
    """Сколько строк в каждой таблице — для панели «что загружено».

    Считаем ОДНИМ запросом через UNION ALL. По запросу на таблицу — это
    восемнадцать запусков psql на каждое открытие панели.
    """
    tables = [r["name"] for r in query(
        "SELECT table_name AS name FROM information_schema.tables "
        " WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' "
        " ORDER BY table_name")]
    if not tables:
        return {}
    union = " UNION ALL ".join(
        f"SELECT '{t}' AS name, COUNT(*) AS n FROM {t}" for t in tables)
    return {r["name"]: int(r["n"] or 0) for r in query(union)}


def get_setting(key: str, default: str = "") -> str:
    value = scalar("SELECT value FROM app_settings WHERE key = ?", (key,))
    return default if value is None else str(value)


def set_setting(key: str, value: str) -> None:
    execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
