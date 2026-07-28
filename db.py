#!/usr/bin/env python3
"""
db.py — движок хранилища.
=============================================================================

ПОЧЕМУ SQLITE, А НЕ POSTGRES
----------------------------
Схема ниже — один в один из выгрузки боевой базы (database.txt.txt): те же
имена таблиц, колонок, уникальных ключей и индексов. Отличается только
драйвер: любой клиент PostgreSQL (psycopg) — внешняя зависимость, а проект
работает в закрытом контуре и ставится копированием файлов.

Поэтому движок — `sqlite3` из стандартной библиотеки, а весь SQL написан на
общем подмножестве диалектов. Переезд на живой Postgres — это замена
`_connect()` и плейсхолдеров (см. `PLACEHOLDER`), прикладной код не меняется.

Отличия, которые пришлось заложить осознанно:

    serial / nextval(...)      → INTEGER PRIMARY KEY AUTOINCREMENT
    numeric(18,4)              → REAL (в SQLite нет фиксированной точности)
    timestamp DEFAULT now()    → TEXT DEFAULT CURRENT_TIMESTAMP
    boolean                    → INTEGER 0/1

ЧТО ДОБАВЛЕНО СВЕРХ ВЫГРУЗКИ
----------------------------
Выгрузка описывает хранение счетов. Для разделения «кто платит» и настроек
чипсов нужны свои таблицы — они собраны в блоке EXTENSION_DDL и помечены
комментарием. В боевой базе их надо будет создать теми же DDL.

ПОТОКОБЕЗОПАСНОСТЬ
------------------
HTTP-сервер многопоточный, поэтому соединение открывается с
`check_same_thread=False`, а все записи идут под одним RLock. SQLite сериализует
запись сам, но блокировка избавляет от `database is locked` на конкурентных
транзакциях и делает `executescript` атомарным относительно чтений.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, Sequence

# Плейсхолдер параметров. sqlite3 — «?», psycopg — «%s». Запросы собираются
# через этот символ, чтобы при переезде не переписывать каждую строку.
PLACEHOLDER = "?"

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "megafon.db")
DB_PATH = os.environ.get("MEGAFON_DB", DEFAULT_PATH)

_LOCK = threading.RLock()
_conn: sqlite3.Connection | None = None


# ═══════════════════════════════════════════════════════════════════════════
#  Схема из боевой выгрузки (database.txt.txt)
# ═══════════════════════════════════════════════════════════════════════════

CORE_DDL = """
-- Справочник услуг оператора.
CREATE TABLE IF NOT EXISTS pname (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    description   TEXT NOT NULL UNIQUE,
    category      TEXT,
    service_type  TEXT
);

-- Каталог тарифных планов.
CREATE TABLE IF NOT EXISTS tariff_plans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_name      TEXT NOT NULL UNIQUE,
    internet_limit REAL,
    voice_limit    INTEGER,
    sms_limit      INTEGER,
    base_cost      REAL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    is_flex        INTEGER NOT NULL DEFAULT 0,
    -- Ниже — поля, которых нет в выгрузке: каталог хранит ещё и тарифы
    -- сверх пакета, иначе подбор тарифа считать нечем.
    kind           TEXT DEFAULT 'voice',
    unlimited_net  INTEGER NOT NULL DEFAULT 0,
    rate_min       REAL DEFAULT 0,
    rate_sms       REAL DEFAULT 0,
    rate_mb        REAL DEFAULT 0,
    note           TEXT DEFAULT '',
    sort_order     INTEGER DEFAULT 0
);

-- Шапка месячного счёта одного абонента.
CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    report_month  TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    report_date   TEXT,
    tariff_id     INTEGER,
    check_abon    INTEGER DEFAULT 0,
    -- Сверх выгрузки: название тарифа строкой из счёта (в счёте оно есть
    -- всегда, а сопоставление с tariff_plans может не найтись) и итоги.
    tariff_name   TEXT DEFAULT '',
    total_charged REAL DEFAULT 0,
    vat           REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reports_month ON reports (report_month);
CREATE INDEX IF NOT EXISTS idx_reports_subscriber ON reports (subscriber_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_subscriber_month
    ON reports (subscriber_id, report_month);

-- Строки начислений счёта.
CREATE TABLE IF NOT EXISTS pvalues (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id        INTEGER NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    parameter_id     INTEGER REFERENCES pname (id),
    volume           TEXT,
    no_discount      REAL,
    discount         REAL,
    with_discount    REAL,
    report_idt       INTEGER,
    volume_numeric   REAL,
    calculated_price REAL,
    -- Сверх выгрузки: имя услуги как в счёте. Нужно, когда услуга ещё не
    -- заведена в pname — иначе строка теряет смысл.
    service_name     TEXT DEFAULT '',
    unit             TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pvalues_report ON pvalues (report_id);

-- Реквизиты счёта за период.
CREATE TABLE IF NOT EXISTS invoice_meta (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
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
    balance_start         REAL,
    balance_end           REAL,
    total_charged         REAL,
    total_paid            REAL,
    penies_start          REAL,
    penies_accrued        REAL,
    penies_end            REAL,
    total_due_no_penies   REAL,
    total_due_with_penies REAL,
    days_to_pay           INTEGER,
    unpaid_previous       REAL,
    vat_amount            REAL,
    director_name         TEXT,
    -- ДОБАВЛЕНО сверх выгрузки. Причина: парсер счёта достаёт больше полей,
    -- чем есть колонок в боевой схеме, и часть данных иначе просто терялась
    -- бы при сохранении. `raw_json` хранит разобранный счёт целиком — это
    -- страховка от потерь; типизированные колонки нужны для SQL-отчётов.
    charged               REAL,
    total_vatable         REAL,
    period_label          TEXT,
    raw_json              TEXT
);

-- Абоненты: номер, лимит, ФИО, статус, командировка.
CREATE TABLE IF NOT EXISTS users_numbers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id  INTEGER UNIQUE,
    status     INTEGER CHECK (status >= 0 AND status <= 9),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

# ═══════════════════════════════════════════════════════════════════════════
#  Расширение схемы: чипсы, правила оплаты, командировки
#  В боевой базе эти таблицы надо создать такими же DDL.
# ═══════════════════════════════════════════════════════════════════════════

EXTENSION_DDL = """
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
    color_code    TEXT REFERENCES chip_colors (code),
    note          TEXT DEFAULT '',
    -- Ручная тонкая настройка поверх цвета. 'auto' — брать из цвета/правил.
    payer_tariff  TEXT DEFAULT 'auto',
    payer_options TEXT DEFAULT 'auto',
    payer_overage TEXT DEFAULT 'auto',
    payer_roaming TEXT DEFAULT 'auto',
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
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
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    number     TEXT NOT NULL,
    username   TEXT DEFAULT '',
    date_start TEXT,
    date_end   TEXT,
    country    TEXT DEFAULT '',
    order_no   TEXT DEFAULT '',
    order_date TEXT DEFAULT '',
    approved   INTEGER NOT NULL DEFAULT 0,
    memo_no    TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (number, date_start, date_end)
);
CREATE INDEX IF NOT EXISTS idx_trips_number ON business_trips (number);

-- Пользовательские статусы абонентов (были в памяти).
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
    total  REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (number, month)
);

-- Настройки приложения одной строкой ключ-значение.
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


# ═══════════════════════════════════════════════════════════════════════════
#  Соединение
# ═══════════════════════════════════════════════════════════════════════════

def _connect() -> sqlite3.Connection:
    """Единственное место, знающее про конкретный драйвер."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL: читатели не блокируют писателя. На многопоточном сервере это
    # убирает почти все «database is locked».
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def connect() -> sqlite3.Connection:
    global _conn
    with _LOCK:
        if _conn is None:
            _conn = _connect()
            _conn.executescript(CORE_DDL)
            _conn.executescript(EXTENSION_DDL)
            _migrate(_conn)
            _conn.commit()
        return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Донастроить схему уже существующей базы.

    `CREATE TABLE IF NOT EXISTS` не добавляет колонки в таблицу, которая уже
    создана. Поэтому при выходе новой версии недостающие колонки добавляются
    здесь — иначе на старой базе приложение падало бы с «no such column».
    Список только пополняется, ничего не удаляем.
    """
    wanted = {
        "invoice_meta": {
            "charged": "REAL",
            "total_vatable": "REAL",
            "period_label": "TEXT",
            "raw_json": "TEXT",
        },
    }
    for table, columns in wanted.items():
        have = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, sql_type in columns.items():
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}")


def close() -> None:
    global _conn
    with _LOCK:
        if _conn is not None:
            _conn.close()
            _conn = None


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Пишущая транзакция: либо всё, либо ничего."""
    conn = connect()
    with _LOCK:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


# ═══════════════════════════════════════════════════════════════════════════
#  Запросы
# ═══════════════════════════════════════════════════════════════════════════

def query(sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    conn = connect()
    with _LOCK:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [dict(row) for row in rows]


def query_one(sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    conn = connect()
    with _LOCK:
        row = conn.execute(sql, tuple(params)).fetchone()
    return dict(row) if row is not None else None


def scalar(sql: str, params: Sequence[Any] = (), default: Any = None) -> Any:
    row = query_one(sql, params)
    if not row:
        return default
    value = next(iter(row.values()), default)
    return default if value is None else value


def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """Выполнить запись. Возвращает lastrowid (или число затронутых строк)."""
    conn = connect()
    with _LOCK:
        cur = conn.execute(sql, tuple(params))
        conn.commit()
        return cur.lastrowid if cur.lastrowid else cur.rowcount


def execute_many(sql: str, rows: Iterable[Sequence[Any]]) -> None:
    conn = connect()
    with _LOCK:
        conn.executemany(sql, [tuple(r) for r in rows])
        conn.commit()


# ═══════════════════════════════════════════════════════════════════════════
#  Обслуживание
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
    """Сколько строк в каждой таблице — для панели «что загружено»."""
    tables = query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    out: dict[str, int] = {}
    for row in tables:
        name = row["name"]
        out[name] = int(scalar(f"SELECT COUNT(*) AS n FROM {name}", default=0) or 0)
    return out


def get_setting(key: str, default: str = "") -> str:
    value = scalar("SELECT value FROM app_settings WHERE key = ?", (key,))
    return default if value is None else str(value)


def set_setting(key: str, value: str) -> None:
    execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
