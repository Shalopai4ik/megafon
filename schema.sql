-- Схема базы «Анализ тарифных планов». PostgreSQL.
-- ФАЙЛ СГЕНЕРИРОВАН, РУКАМИ НЕ ПРАВЯТ.
-- Источник: db.py (CORE_DDL + EXTENSION_DDL + RULES_DDL).
-- Пересобрать: python install.py --dump-schema

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
    created_at     TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
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
    created_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
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
    created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

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
    updated_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
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
    created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
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
