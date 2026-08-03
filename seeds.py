#!/usr/bin/env python3
"""
seeds.py — значения справочников «из коробки».
=============================================================================

ЗАЧЕМ ЭТОТ ФАЙЛ
---------------
Всё, что лежит здесь, — это ЧЕРНОВИК, а не жёсткая настройка. Каждая строка
рано или поздно попадает в базу и дальше правится в интерфейсе
(«Настройки → Цвета», «Пометки», «Правила оплаты»). Код после этого не
перечитывает файл: правки администратора не затираются.

КОГДА ЭТО ПОПАДАЕТ В БАЗУ (изменено, читать внимательно)
--------------------------------------------------------
РАНЬШЕ справочники заливались НА СТАРТЕ ПРИЛОЖЕНИЯ: сервер поднимался — и в
базе сразу лежала сотня строк, которых туда никто не загружал. На свежей
установке пустая база превращалась в непустую сама по себе, ещё до того как
человек открыл сайт. Понять по содержимому базы, что уже загружено, а что
приложение придумало за вас, было нельзя.

ТЕПЕРЬ база остаётся пустой, пока в неё не загрузили файл. Справочники
материализуются `ensure_seeds()` в момент ПЕРВОЙ ЗАПИСИ данных — загрузки
счёта, списка сотрудников, командировок — или когда администратор сам
правит справочник в настройках. До этого момента приложение показывает
значения отсюда ПРЯМО ИЗ ПАМЯТИ (см. `default_*` ниже): экраны настроек не
пустуют, а в базе при этом по-прежнему ноль строк.

ПРАВИЛО ЗАПОЛНЕНИЯ (важно понимать)
-----------------------------------
`ensure_seeds()` вставляет строку ТОЛЬКО если её ещё нет (по первичному
ключу). То есть:

    * первая загрузка     — база наполняется значениями отсюда;
    * последующие         — ничего не трогается, работают ваши правки;
    * новая строка здесь  — доедет до базы при следующей загрузке;
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
    #
    # ЛИМИТЫ-ПРИЗНАКИ. Такие номера видно по лимиту из списка работников:
    # компания ставит человеку не бюджет на связь, а сумму, которую он вносит
    # за себя сам. Совпал лимит с одним из чисел ниже — правило навешивается
    # автоматически, руками отмечать сотню номеров не нужно.
    #
    # Числа правятся в интерфейсе (Настройки → Правила номеров), здесь только
    # значение по умолчанию.
    dict(code="personal", hex="#b07f16", label="Личный тариф — платит сам",
         description="Абонент сидит на своём тарифе и оплачивает его сам. "
                     "Компания за такой номер не платит ничего.",
         payer_tariff="employee", payer_options="employee",
         payer_overage="employee", payer_roaming="employee",
         is_excluded=0, is_unlimited=0, is_self_paid=1,
         match_limits="490, 90, 690, 1070", sort_order=30),

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
#  5. РОУМИНГ: СТАВКИ ПО ЗОНАМ
#
#  Из тарифных сеток оператора (снимки tarifs2.jpg и tarifs3.jpg). Все страны
#  мира, где работает международный роуминг, разбиты на ЧЕТЫРЕ зоны с едиными
#  ценами внутри зоны; Крым идёт отдельной строкой со своими ставками.
#
#  ЭТО СПРАВОЧНИК, А НЕ КАЛЬКУЛЯТОР. Роуминг в отчёте как считался по факту
#  из счёта, так и считается: пересчитывать его по этим ставкам мы не беремся
#  — в счёте бывают пакеты «Вокруг света», акции и посекундные округления,
#  и наш пересчёт спорил бы с оператором на ровном месте. Таблица нужна для
#  другого: когда за поездку прилетело 8 000 ₽, надо иметь под рукой цену
#  минуты и мегабайта, чтобы понять, много это или норма.
#
#  Цены с НДС, в рублях. Входящие вызовы бесплатны во всех зонах.
#  Тарификация соединений — поминутная.
# ═══════════════════════════════════════════════════════════════════════════

ROAMING_ZONES = [
    dict(code="europe", label="Европа",
         incoming=0, call_home=5, call_local=5, call_other=129,
         sms=5, mb=5, satellite=313, sort_order=10,
         note="Страны Европы"),
    dict(code="cis", label="СНГ",
         incoming=0, call_home=5, call_local=5, call_other=129,
         sms=5, mb=5, satellite=313, sort_order=20,
         note="Страны СНГ"),
    dict(code="popular", label="Популярные страны",
         incoming=0, call_home=10, call_local=10, call_other=129,
         sms=5, mb=5, satellite=313, sort_order=30,
         note="Популярные направления вне Европы и СНГ"),
    dict(code="other", label="Остальные страны",
         incoming=0, call_home=10, call_local=10, call_other=129,
         sms=5, mb=20, satellite=313, sort_order=40,
         note="Всё, что не вошло в первые три зоны. Интернет вчетверо дороже"),
    dict(code="crimea", label="Республика Крым",
         incoming=0, call_home=1, call_local=1, call_other=0,
         sms=1, mb=1, satellite=0, sort_order=50,
         note="Отдельные ставки, в международные зоны не входит. "
              "Исходящие — включая переадресацию"),
]


# ═══════════════════════════════════════════════════════════════════════════
#  ЗНАЧЕНИЯ ИЗ ПАМЯТИ — ДЛЯ ЭКРАНОВ НАСТРОЕК ДО ПЕРВОЙ ЗАГРУЗКИ
#
#  База пустая, пока в неё не загрузили файл. Но «Настройки → Правила чипсов»
#  открыть можно и до этого, и показывать там пустоту нельзя: человек решит,
#  что установка сломана, и пойдёт заводить правила руками поверх тех, что
#  всё равно появятся.
#
#  Поэтому чтение справочника, у которого в базе ещё ноль строк, отдаёт эти
#  же значения ИЗ ПАМЯТИ. Формат совпадает с тем, что вернул бы SELECT, —
#  фронтенд разницы не видит. В базу они лягут при первой же записи:
#  загрузке счёта или правке справочника (см. queries.ensure_reference_data).
# ═══════════════════════════════════════════════════════════════════════════

def default_chip_rules(kind: str = "") -> list[dict]:
    """Правила чипса так, как их вернул бы SELECT из chip_rules."""
    rules = ([{**c, "kind": "color", "builtin": True} for c in CHIP_COLORS]
             + [{**m, "kind": "mark", "builtin": True} for m in CHIP_MARKS])
    rows = [{**r,
             "is_excluded": bool(r["is_excluded"]),
             "is_unlimited": bool(r["is_unlimited"]),
             "is_self_paid": bool(r.get("is_self_paid")),
             "match_limits": r.get("match_limits", ""),
             "description": r.get("description", ""),
             "hex": r.get("hex", "")}
            for r in rules if not kind or r["kind"] == kind]
    # Тот же порядок, что в get_chip_rules: цвета раньше пометок.
    rows.sort(key=lambda r: (r["kind"] != "color", r["sort_order"], r["code"]))
    return rows


def default_payment_rules() -> list[dict]:
    """Правила оплаты так, как их вернул бы SELECT из payment_rules.

    Поле `id` здесь ОТРИЦАТЕЛЬНОЕ и намеренно: это не ключ строки в базе,
    строки в базе ещё нет. Фронтенду id нужен как признак «правило уже
    существует», а сохранение ищет правило по тройке (область, тип, значение)
    — см. queries.save_payment_rule. Положительный id из памяти выглядел бы
    как настоящий и однажды совпал бы с чужой строкой.
    """
    return [{**r, "id": -(n + 1), "enabled": True, "builtin": True}
            for n, r in enumerate(PAYMENT_RULES)]


def default_roaming_zones() -> list[dict]:
    return [{**z, "builtin": True} for z in ROAMING_ZONES]


# ═══════════════════════════════════════════════════════════════════════════
#  Заливка в базу
# ═══════════════════════════════════════════════════════════════════════════

# Ключ в app_settings, где отмечено, что первичная заливка уже была.
# Нужен, чтобы удалённые администратором строки НЕ возвращались при рестарте.
SEEDED_FLAG = "seeds_version"
SEEDS_VERSION = "1"


def ensure_seeds() -> None:
    """Залить справочники, если их ещё нет. Правки администратора не трогаем.

    ВЫЗЫВАЕТСЯ НЕ НА СТАРТЕ, а перед первой записью данных — см. шапку файла
    и queries.ensure_reference_data. Сам по себе старт сервера базу не
    наполняет.

    ЧИТАЕМ ОДНИМ ЗАПРОСОМ НА ТАБЛИЦУ, а не по строке на каждое значение.
    Раньше на каждый цвет, пометку и статус уходил отдельный SELECT — три
    десятка обращений к базе. С postgres каждое такое обращение — запуск
    psql, и заливка из-за этого заметно тормозила.
    """
    already = db.get_setting(SEEDED_FLAG) == SEEDS_VERSION

    # Что уже лежит в справочниках. Дальше сверяемся только с этими
    # множествами, в базу за проверками не ходим.
    have = {
        "chip_rules": {str(r["code"]) for r in db.query("SELECT code FROM chip_rules")},
        "roaming_zones": {str(r["code"]) for r in db.query(
            "SELECT code FROM roaming_zones")},
    }

    # ── ПРАВИЛА ЧИПСА: цвета и пометки ──
    #
    # СЕЕМ В chip_rules, А НЕ В СТАРЫЕ ТАБЛИЦЫ. Здесь была неприятная яма,
    # брад, и провалиться в неё можно было только на чистой машине.
    #
    # Раньше посев лил цвета в chip_colors, а пометки в chip_marks. Пока
    # приложение читало оттуда же — всё сходилось. Потом чтение переехало
    # в объединённую chip_rules, а посев остался на старом месте.
    #
    # На РАБОЧЕЙ базе беды не случилось: миграция скопировала старые
    # таблицы в новую, там уже лежали данные. А вот на ЧИСТОЙ порядок
    # оказался смертельным, черемша:
    #
    #     1. создали таблицы          — все пустые
    #     2. миграция скопировала     — из пустого в пустое, ноль строк
    #     3. посев залил старые       — а chip_rules так и осталась пустой
    #
    # Итог: свежая установка поднималась ВООБЩЕ БЕЗ ПРАВИЛ. Ни цветов, ни
    # пометок, красить нечем, деньги делить нечем. Гойда.
    #
    # Поэтому сеем прямо в chip_rules — туда, откуда приложение читает.
    # Поле kind различает вид: 'color' красит карточку и у номера один,
    # 'mark' навешивается сколько угодно.
    # Всё, чего не хватает, доливается ОДНОЙ транзакцией.
    with db.transaction() as conn:
        for color in CHIP_COLORS:
            _insert_if_absent(conn, have, "chip_rules", "code",
                              {**color, "kind": "color"}, builtin=1)

        for mark in CHIP_MARKS:
            _insert_if_absent(conn, have, "chip_rules", "code",
                              {**mark, "kind": "mark"}, builtin=1)

        # ── Ставки роуминга по зонам ──
        for zone in ROAMING_ZONES:
            _insert_if_absent(conn, have, "roaming_zones", "code", zone, builtin=1)

        # ── Правила по услугам ──
        # У правил нет естественного ключа, поэтому сверяем по тройке
        # (область, тип условия, значение) — так дубли не плодятся.
        if not already:
            known = {(r["scope"], r["match_kind"], r["match_value"]) for r in db.query(
                "SELECT scope, match_kind, match_value FROM payment_rules")}
            for rule in PAYMENT_RULES:
                key = (rule["scope"], rule["match_kind"], rule["match_value"])
                if key in known:
                    continue
                known.add(key)
                conn.execute(
                    "INSERT INTO payment_rules "
                    "(priority, enabled, scope, match_kind, match_value, payer, note, builtin) "
                    "VALUES (?, 1, ?, ?, ?, ?, ?, 1)",
                    (rule["priority"], rule["scope"], rule["match_kind"],
                     rule["match_value"], rule["payer"], rule["note"]),
                )

        # Отметку о заливке пишем ТОЛЬКО когда её ещё нет. Раньше она
        # обновлялась на каждом запуске — и каждый старт приложения тащил за
        # собой запись в базу, то есть лишний запуск psql на ровном месте.
        if not already:
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (SEEDED_FLAG, SEEDS_VERSION),
            )


def _insert_if_absent(conn, have: dict[str, set], table: str, key_field: str,
                      row: dict, *, builtin: int | None = None) -> None:
    """Вставить строку справочника, если строки с таким ключом ещё нет.

    Наличие проверяем по заранее прочитанному множеству ключей: удалённое
    администратором значение обратно не воскресает, а новое из свежей версии
    кода — доезжает.
    """
    key = str(row[key_field])
    if key in have[table]:
        return
    have[table].add(key)

    data = dict(row)
    if builtin is not None:
        data.setdefault("builtin", builtin)
    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})", list(data.values()))
