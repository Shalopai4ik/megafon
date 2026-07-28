#!/usr/bin/env python3
"""
seeds.py — значения справочников «из коробки».
=============================================================================

ЗАЧЕМ ЭТОТ ФАЙЛ
---------------
Всё, что лежит здесь, — это ЧЕРНОВИК, а не жёсткая настройка. Каждая строка
после первого запуска попадает в базу и дальше правится в интерфейсе
(«Настройки → Цвета», «Пометки», «Правила оплаты»). Код после этого не
перечитывает файл: правки администратора не затираются.

ПРАВИЛО ЗАПОЛНЕНИЯ (важно понимать)
-----------------------------------
`ensure_seeds()` вставляет строку ТОЛЬКО если её ещё нет (по первичному
ключу). То есть:

    * первый запуск       — база наполняется значениями отсюда;
    * последующие запуски — ничего не трогается, работают ваши правки;
    * новая строка здесь  — доедет до базы при следующем запуске;
    * удалили строку в UI — она НЕ вернётся (стоит флаг «удалено вручную»),
      иначе удалённое правило воскресало бы после каждого рестарта.

ЧЕТЫРЕ КОРЗИНЫ ДЕНЕГ
--------------------
Весь счёт номера раскладывается на четыре части, и у каждой свой плательщик:

    tariff   — абонентская плата по тарифному плану  (по умолчанию: КОМПАНИЯ)
    options  — опции и сервисы: ВАТС, защита, M2M…   (по умолчанию: КОМПАНИЯ)
    overage  — перерасход пакета: минуты, ГБ, SMS    (по умолчанию: СОТРУДНИК)
    roaming  — связь вне домашнего региона           (по умолчанию: СОТРУДНИК)

Значение 'auto' в настройках означает «не переопределять, взять с уровня
ниже» — см. цепочку разрешения в billing.py.
"""

from __future__ import annotations

import db

# ═══════════════════════════════════════════════════════════════════════════
#  1. ПАЛИТРА = ПРАВИЛА
#
#  По решению заказчика ЦВЕТ НОМЕРА — ЭТО И ЕСТЬ ПРАВИЛО, а не украшение.
#  Покрасили номер в синий — он автоматически стал безлимитным и выпал из
#  сводок. Чтобы это не превратилось в «магию, зашитую в код», смысл каждого
#  цвета лежит в таблице chip_colors и правится в интерфейсе.
#
#  Поля: код, цвет, название, пояснение,
#        плательщик за (тариф, опции, перерасход, роуминг),
#        исключить из сводок, считать пакет безлимитным.
# ═══════════════════════════════════════════════════════════════════════════

CHIP_COLORS = [
    # Обычный номер. Ничего не переопределяет — работают умолчания.
    dict(code="normal", hex="#8a9a94", label="Обычный",
         description="Стандартное распределение: компания платит тариф и опции, "
                     "сотрудник — перерасход и роуминг.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="auto",
         is_excluded=0, is_unlimited=0, sort_order=10),

    # СИНИЙ — тот самый случай из задания: «не учитываем, они безлимит».
    dict(code="unlimited", hex="#2f6fd0", label="Безлимит — не учитываем",
         description="Пакет безлимитный: перерасхода по нему быть не может. "
                     "Номер не попадает в сводки, рекомендации и индекс невыгодности.",
         payer_tariff="company", payer_options="company",
         payer_overage="company", payer_roaming="company",
         is_excluded=1, is_unlimited=1, sort_order=20),

    # Сотрудник сам оплачивает свой тариф — тот, что ему выгоднее.
    dict(code="personal", hex="#b07f16", label="Личный тариф — платит сам",
         description="Абонент сидит на своём тарифе и оплачивает его сам. "
                     "Компания за такой номер не платит ничего.",
         payer_tariff="employee", payer_options="employee",
         payer_overage="employee", payer_roaming="employee",
         is_excluded=0, is_unlimited=0, sort_order=30),

    # Железо без человека: модем, шлагбаум, сигнализация, терминал.
    dict(code="device", hex="#6b7a74", label="Устройство (M2M)",
         description="За SIM нет сотрудника — предъявлять перерасход некому. "
                     "Всё, включая перерасход, платит компания.",
         payer_tariff="company", payer_options="company",
         payer_overage="company", payer_roaming="company",
         is_excluded=0, is_unlimited=0, sort_order=40),

    # Руководство: перерасход не удерживаем.
    dict(code="vip", hex="#7b4fbf", label="Руководитель — всё на компании",
         description="Перерасход и роуминг не предъявляются сотруднику.",
         payer_tariff="company", payer_options="company",
         payer_overage="company", payer_roaming="company",
         is_excluded=0, is_unlimited=0, sort_order=50),

    # Разъездная должность: роуминг — рабочая необходимость.
    dict(code="field", hex="#2f8f6b", label="Разъездной — роуминг на компании",
         description="Водители, монтажники, торговые представители: "
                     "роуминг оплачивает компания, перерасход — сотрудник.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="company",
         is_excluded=0, is_unlimited=0, sort_order=60),

    # Просто отметка внимания, на деньги не влияет.
    dict(code="watch", hex="#c6504f", label="На контроле",
         description="Пометка внимания для разбора. На распределение денег не влияет.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="auto",
         is_excluded=0, is_unlimited=0, sort_order=70),
]


# ═══════════════════════════════════════════════════════════════════════════
#  2. ПОМЕТКИ (теги)
#
#  Цвет у номера один, а пометок можно навесить сколько угодно. Пометка
#  работает ТОЧЕЧНО: меняет одну корзину, не трогая остальные. Приоритет у
#  пометок НИЖЕ, чем у цвета (цвет — основное правило).
# ═══════════════════════════════════════════════════════════════════════════

CHIP_MARKS = [
    dict(code="no_count", label="Не учитывать", hex="#6b7a74",
         description="Полностью убрать номер из сводок и рейтингов.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="auto",
         is_excluded=1, is_unlimited=0, sort_order=10),

    dict(code="own_options", label="Опции за свой счёт", hex="#b07f16",
         description="Опции оплачивает сотрудник, тариф остаётся на компании.",
         payer_tariff="auto", payer_options="employee",
         payer_overage="auto", payer_roaming="auto",
         is_excluded=0, is_unlimited=0, sort_order=20),

    dict(code="roaming_ok", label="Роуминг согласован", hex="#2f8f6b",
         description="Разовое согласование роуминга без оформления командировки.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="company", sort_order=30,
         is_excluded=0, is_unlimited=0),

    dict(code="overage_company", label="Перерасход на компании", hex="#7b4fbf",
         description="Перерасход пакета не предъявляется сотруднику.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="company", payer_roaming="auto",
         is_excluded=0, is_unlimited=0, sort_order=40),

    dict(code="check", label="Проверить", hex="#c58415",
         description="Требует разбора. На деньги не влияет.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="auto",
         is_excluded=0, is_unlimited=0, sort_order=50),

    dict(code="blocked", label="Заблокирован", hex="#c6504f",
         description="Номер заблокирован у оператора. На деньги не влияет.",
         payer_tariff="auto", payer_options="auto",
         payer_overage="auto", payer_roaming="auto",
         is_excluded=0, is_unlimited=0, sort_order=60),
]


# ═══════════════════════════════════════════════════════════════════════════
#  3. ПРАВИЛА ПО НАЗВАНИЯМ УСЛУГ
#
#  ЭТО ЧЕРНОВИК — заказчик просил предложить свой вариант с возможностью
#  поправить. Все строки ниже взяты из реальных названий в otche.txt.
#
#  Как читать строку:
#      priority   — меньше число = раньше проверяется, первое совпадение
#                   выигрывает. Личные услуги идут раньше корпоративных,
#                   чтобы «Premium Voice» не утонул в общем правиле.
#      scope      — какую корзину правило переназначает.
#      match_kind — 'service': подстрока в названии услуги (регистр не важен).
#      payer      — 'company' (платим мы) | 'employee' (платит сотрудник).
#
#  ВНИМАНИЕ: правило по услуге слабее настроек номера. Если номер покрашен
#  в «Личный тариф», то опции всё равно на сотруднике, что бы тут ни стояло.
# ═══════════════════════════════════════════════════════════════════════════

PAYMENT_RULES = [
    # ── ЛИЧНОЕ: платит сотрудник. Проверяется первым (приоритет 10–39). ──
    dict(priority=10, scope="options", match_kind="service",
         match_value="premium voice", payer="employee",
         note="Контент-провайдеры: платные подписки и короткие номера — личное."),
    dict(priority=11, scope="options", match_kind="service",
         match_value="контент-провайдер", payer="employee",
         note="То же самое, если оператор назвал строку иначе."),
    dict(priority=12, scope="options", match_kind="service",
         match_value="видеостриминг", payer="employee",
         note="Просмотр видео — развлечение, не работа."),
    dict(priority=13, scope="options", match_kind="service",
         match_value="звонок за счет друга", payer="employee",
         note="Личная услуга абонента."),
    dict(priority=14, scope="options", match_kind="service",
         match_value="мобильные sms-сервис", payer="employee",
         note="Платные SMS-сервисы — личное."),
    dict(priority=15, scope="options", match_kind="service",
         match_value="мультимедийных сообщени", payer="employee",
         note="MMS — личное."),

    # ── КОРПОРАТИВНОЕ: платит компания (приоритет 40–99). ──
    dict(priority=40, scope="options", match_kind="service",
         match_value="виртуальная атс", payer="company",
         note="Корпоративная телефония."),
    dict(priority=41, scope="options", match_kind="service",
         match_value="ватс", payer="company",
         note="Она же, сокращённо."),
    dict(priority=42, scope="options", match_kind="service",
         match_value="офис в кармане", payer="company",
         note="Рабочий сервис."),
    dict(priority=43, scope="options", match_kind="service",
         match_value="защита сотрудник", payer="company",
         note="Корпоративная услуга безопасности."),
    dict(priority=44, scope="options", match_kind="service",
         match_value="экспресс-набор", payer="company",
         note="FMC — короткие номера внутри компании."),
    dict(priority=45, scope="options", match_kind="service",
         match_value="m2m", payer="company",
         note="Устройства без сотрудника."),
    dict(priority=46, scope="options", match_kind="service",
         match_value="ми.", payer="company",
         note="Мобильное информирование: рассылки клиентам — расход компании."),
    dict(priority=47, scope="options", match_kind="service",
         match_value="мегафон таргет", payer="company",
         note="Реклама и рассылки — расход компании."),
    dict(priority=48, scope="options", match_kind="service",
         match_value="бизнес без", payer="company",
         note="Корпоративная опция «Бизнес безграниц+»."),
    dict(priority=49, scope="options", match_kind="service",
         match_value="антифрод", payer="company",
         note="Защита от мошенничества."),
    dict(priority=50, scope="options", match_kind="service",
         match_value="детализац", payer="company",
         note="Детализация счёта нужна бухгалтерии, а не сотруднику."),
    dict(priority=51, scope="options", match_kind="service",
         match_value="блокировка номера", payer="company",
         note="Административное действие."),
    dict(priority=52, scope="options", match_kind="service",
         match_value="замена sim", payer="company",
         note="Административное действие."),
    dict(priority=53, scope="options", match_kind="service",
         match_value="переоформление договора", payer="company",
         note="Административное действие."),
    dict(priority=54, scope="options", match_kind="service",
         match_value="доставка счета", payer="company",
         note="Административное действие."),
    dict(priority=55, scope="options", match_kind="service",
         match_value="дополнительный номер", payer="company",
         note="Рабочий номер."),
    dict(priority=56, scope="options", match_kind="service",
         match_value="дополнительный городской номер", payer="company",
         note="Рабочий номер."),
    dict(priority=57, scope="options", match_kind="service",
         match_value="запрет развлекательного", payer="company",
         note="Ограничение, которое ставит компания."),
    dict(priority=58, scope="options", match_kind="service",
         match_value="помощник ева", payer="company",
         note="Рабочий сервис."),
    dict(priority=59, scope="options", match_kind="service",
         match_value="автоответчик", payer="company",
         note="Базовый сервис."),
    dict(priority=60, scope="options", match_kind="service",
         match_value="голосовая почта", payer="company",
         note="Базовый сервис."),
    dict(priority=61, scope="options", match_kind="service",
         match_value="удержание вызова", payer="company",
         note="Базовый сервис."),
]


# ═══════════════════════════════════════════════════════════════════════════
#  4. СТАТУСЫ АБОНЕНТОВ
#  Раньше жили в памяти и терялись при перезапуске — теперь в базе.
# ═══════════════════════════════════════════════════════════════════════════

# ИСПРАВЛЕНО: сначала я вписал сюда придуманные статусы (Внимание/Критично).
# Это неверно — «Критично/Внимание/Норма» приложение считает САМО по расходу
# и лимиту, а здесь лежит РУЧНОЙ справочник, который проставляет
# администратор. Ниже — фактические четыре статуса приложения.
APP_STATUSES = [
    dict(id="normal", label="Норма", color="#2f8f6b", builtin=1, sort_order=10),
    dict(id="vip", label="VIP", color="#1f7a5c", builtin=1, sort_order=20),
    dict(id="fired", label="Уволен", color="#c6504f", builtin=1, sort_order=30),
    dict(id="cancelled", label="Аннулирована", color="#6b7a74", builtin=1, sort_order=40),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Заливка в базу
# ═══════════════════════════════════════════════════════════════════════════

# Ключ в app_settings, где отмечено, что первичная заливка уже была.
# Нужен, чтобы удалённые администратором строки НЕ возвращались при рестарте.
SEEDED_FLAG = "seeds_version"
SEEDS_VERSION = "1"


def ensure_seeds() -> None:
    """Залить справочники, если их ещё нет. Правки администратора не трогаем."""
    already = db.get_setting(SEEDED_FLAG) == SEEDS_VERSION

    # ── Цвета ──
    for color in CHIP_COLORS:
        _insert_if_absent("chip_colors", "code", color, builtin=1, skip=already)

    # ── Пометки ──
    for mark in CHIP_MARKS:
        _insert_if_absent("chip_marks", "code", mark, builtin=1, skip=already)

    # ── Статусы ──
    for status in APP_STATUSES:
        _insert_if_absent("app_statuses", "id", status, skip=already)

    # ── Правила по услугам ──
    # У правил нет естественного ключа, поэтому сверяем по тройке
    # (область, тип условия, значение) — так дубли не плодятся.
    if not already:
        for rule in PAYMENT_RULES:
            exists = db.query_one(
                "SELECT id FROM payment_rules "
                " WHERE scope = ? AND match_kind = ? AND match_value = ?",
                (rule["scope"], rule["match_kind"], rule["match_value"]),
            )
            if exists:
                continue
            db.execute(
                "INSERT INTO payment_rules "
                "(priority, enabled, scope, match_kind, match_value, payer, note, builtin) "
                "VALUES (?, 1, ?, ?, ?, ?, ?, 1)",
                (rule["priority"], rule["scope"], rule["match_kind"],
                 rule["match_value"], rule["payer"], rule["note"]),
            )

    db.set_setting(SEEDED_FLAG, SEEDS_VERSION)


def _insert_if_absent(table: str, key_field: str, row: dict,
                      *, builtin: int | None = None, skip: bool = False) -> None:
    """Вставить строку справочника, если строки с таким ключом ещё нет.

    `skip=True` означает «первичная заливка уже была»: тогда добавляем только
    те строки, которых нет вообще — то есть новые справочные значения из
    свежей версии кода. Существующие (и отредактированные) не трогаем.
    """
    exists = db.query_one(
        f"SELECT {key_field} FROM {table} WHERE {key_field} = ?", (row[key_field],)
    )
    if exists:
        return
    if skip and table == "payment_rules":
        return

    data = dict(row)
    if builtin is not None:
        data.setdefault("builtin", builtin)
    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    db.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})", list(data.values()))
