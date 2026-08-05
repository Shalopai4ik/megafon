#!/usr/bin/env python3
"""
queries.py — ВЕСЬ доступ к данным в одном месте.
=============================================================================

ЧТО ИЗМЕНИЛОСЬ (важно понимать при чтении кода)
-----------------------------------------------
Раньше «база» была списками словарей в памяти: всё терялось при перезапуске
сервера. Теперь под этим файлом лежит настоящая база — PostgreSQL по схеме
из database.txt.txt (см. db.py), и каждая функция ниже — это реальный
SQL-запрос.

Что это даёт на практике:
    * настройки чипсов, пометки, правила и командировки переживают рестарт;
    * данные видны снаружи обычным psql — это та же самая база, а не копия.

ЧЕГО ЗДЕСЬ НЕЛЬЗЯ ДЕЛАТЬ. Внутри `with db.transaction()` команды копятся и
уходят в базу одним куском на выходе из блока. Значит, посреди блока нет ни
результата команды, ни свежепрочитанных своих же записей. Нужно прочитать —
читайте до блока или после него.

ИМЕНА ТАБЛИЦ
------------
В коде исторически говорили «reports_2» и «parameter_values_2». В боевой
схеме они называются `reports` и `pvalues`, а справочник услуг — `pname`
(а не `parameters`). Здесь используются БОЕВЫЕ имена. Старые названия
остались только в ключах диагностики `stats()`, чтобы не ломать интерфейс.

ВАЖНО ПРО «СТРОКИ-ИТОГИ»
------------------------
В счёте есть служебные строки «Итого начислено» и «в том числе НДС». Это НЕ
услуги, а суммы. Если сложить их вместе с обычными начислениями — получим
двойной счёт. Поэтому они отфильтровываются на входе (domain.is_meta) и в
`pvalues` не попадают.
"""

from __future__ import annotations

import json
import threading
from collections import defaultdict
from typing import Any

import db
import domain
import seeds

# Блокировка нужна только для операций «прочитал → посчитал → записал»
# (например, генерация уникального кода статуса). Обычные чтения и записи
# сериализует сам db.py.
_LOCK = threading.RLock()


# ═══════════════════════════════════════════════════════════════════════════
#  Справочник услуг (85 позиций из счёта оператора)
#  Заливается в таблицу pname при первом запуске.
# ═══════════════════════════════════════════════════════════════════════════

PARAMETERS_LIST: list[tuple[str, str]] = [
    ("Premium Voice - услуги контент-провайдеров", "calls"),
    ("Абонентская плата", "fee"),
    ("Абонентская плата M2M", "fee"),
    ("Абонентская плата M2M Флекс", "fee"),
    ("Абонентская плата за пользование услугой Экспресс-набор (FMC)", "fee"),
    ("Абонентская плата за услугу Защита сотрудников", "fee"),
    ("Абонентская плата и начисления по опции «Бизнес без границ+»", "fee"),
    ("Абонентская плата и начисления по опции «Бизнес без границ»", "fee"),
    ("Абонентская плата и разовые начисления за голосовые опции", "fee"),
    ("Абонентская плата по тарифному плану", "fee"),
    ("Абонентская плата по тарифному плану (посуточное списание)", "fee"),
    ("Автоответчик", "services"),
    ("Блокировка номера", "services"),
    ("ВАТС МультиФон", "services"),
    ("Видеостриминг", "services"),
    ("Виртуальная АТС, SMS: абон. плата. за тех. поддержку, sms", "services"),
    ("Виртуальная АТС: абонентская плата за тариф (не облагается НДС)", "services"),
    ("Виртуальная АТС: дополнительные опции (не облагается НДС)", "services"),
    ("Входящие SMS в международном роуминге", "sms"),
    ("Входящие вызовы в домашнем регионе", "calls"),
    ("Входящие вызовы в международном роуминге", "calls"),
    ("Входящие вызовы в путешествиях по России", "calls"),
    ("Входящие сообщения в домашнем регионе", "sms"),
    ("Входящие сообщения в путешествиях по России", "sms"),
    ("Вызовы в международном роуминге", "calls"),
    ("Голосовая почта", "calls"),
    ("Голосовое SMS", "sms"),
    ("Дополнительные услуги", "services"),
    ("Дополнительный городской номер", "services"),
    ("Дополнительный номер", "services"),
    ("Доставка счета на e-mail", "services"),
    ("Ежемесячная абонентская плата", "fee"),
    ("Замена SIM-карты", "services"),
    ("Запрет развлекательного контента", "services"),
    ("Звонок за счет друга", "services"),
    ("Исходящие SMS в международном роуминге", "sms"),
    ("Исходящие SMS на банковские номера", "sms"),
    ("Исходящие вызовы в домашнем регионе", "calls"),
    ("Исходящие вызовы в путешествиях по России", "calls"),
    ("Исходящие вызовы внутри сети в домашнем регионе", "calls"),
    ("Исходящие вызовы внутри сети в путешествиях по России", "calls"),
    ("Исходящие вызовы на номера других операторов в домашнем регионе", "calls"),
    ("Исходящие вызовы на номера других операторов региона пребывания в путешествиях по России", "calls"),
    ("Исходящие вызовы на номера России в международном роуминге", "calls"),
    ("Исходящие вызовы на номера страны пребывания в международном роуминге", "calls"),
    ("Исходящие междугородные вызовы в домашнем регионе", "calls"),
    ("Исходящие междугородные вызовы в путешествиях по России", "calls"),
    ("Исходящие международные вызовы в домашнем регионе", "calls"),
    ("Исходящие международные вызовы в путешествиях по России", "calls"),
    ("Исходящие сообщения в домашнем регионе", "sms"),
    ("Исходящие сообщения в путешествиях по России", "sms"),
    ("Массовые вызовы", "services"),
    ("МИ.Детализация счета", "services"),
    ("МИ.Индивидуальная подпись отправителя ПАО МегаФон", "services"),
    ("МИ.Индивидуальная подпись отправителя ПАО МТС", "services"),
    ("МИ.Мобильное информирование", "services"),
    ("МИ.Нешаблонированные SMS-cообщения Мегафон", "services"),
    ("МИ.SMS на абонентов оператора К-Телеком", "services"),
    ("МИ.SMS на абонентов оператора КТК-Телеком", "services"),
    ("МИ.SMS на абонентов оператора ПАО ВымпелКом", "services"),
    ("МИ.SMS на абонентов оператора ПАО МТС", "services"),
    ("МИ.SMS на абонентов оператора ПАО Теле2", "services"),
    ("МИ.SMS на других операторов РФ", "services"),
    ("МИ.SMS на зарубежных операторов стран из группы 3", "services"),
    ("Мобильные SMS-сервисы", "sms"),
    ("Мобильный интернет в домашнем регионе", "internet"),
    ("Мобильный интернет в международном роуминге", "internet"),
    ("Мобильный интернет в национальном роуминге", "internet"),
    ("Мобильный интернет в путешествиях по России", "internet"),
    ("Начисления за голосовые услуги в национальном роуминге", "calls"),
    ("Начисления за передачу мультимедийных сообщений", "sms"),
    ("Начисления за услуги передачи сообщений в национальном роуминге", "sms"),
    ("Офис в кармане", "services"),
    ("Прочие исходящие вызовы в международном роуминге", "calls"),
    ("Прочие начисления", "fee"),
    ("Разовые услуги", "fee"),
    ("Тарифный план «Интернет. Без Переплат 04.23»", "tariff"),
    ("Тарифный план «Мобильные SMS-сервисы»", "tariff"),
    ("Тарифный план «Управляй! Специалист +»", "tariff"),
    ("Тарифный план «Федеральный Специальный B2B»", "tariff"),
    ("Тарифный план «Федеральный Специальный»", "tariff"),
    ("Удержание вызова", "services"),
    ("Услуги международного роуминга", "services"),
    ("Услуги национального роуминга", "services"),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Инициализация
# ═══════════════════════════════════════════════════════════════════════════

# Кэш справочника услуг: {нормализованное имя: id}. Справочник статичный и
# маленький, поэтому держим его в памяти — иначе на каждую строку счёта
# уходил бы отдельный SELECT с перебором подстрок.
_param_index: dict[str, int] = {}


def _norm(text: str) -> str:
    """Нормализация названия услуги для сопоставления со справочником."""
    return " ".join(str(text or "").lower().replace("ё", "е").split())


# ensure_reference_data() уже отработал в этом процессе — второй раз не ходим.
_reference_ready = False

# Кэш ответа на вопрос «эту базу когда-нибудь наполняли». None — не спрашивали.
_ever_seeded: bool | None = None


def init() -> None:
    """Поднять схему. РОВНО ЭТО И НИЧЕГО БОЛЬШЕ.

    Раньше здесь же заливались справочники, и старт сервера сам по себе
    писал в базу сотню строк: цвета, пометки, 28 правил оплаты, 53 тарифа,
    85 названий услуг. Пустая база переставала быть пустой без единой
    загрузки файла, и по её содержимому нельзя было отличить «загружено»
    от «приложение придумало само».

    Теперь старт только создаёт таблицы (строк это не пишет) и читает
    справочник услуг в память. Наполнение — в ensure_reference_data(),
    и вызывается оно перед ЗАПИСЬЮ, а не при запуске.
    """
    db.connect()
    _reload_param_index()


def ensure_reference_data() -> None:
    """Материализовать справочники в базе. Вызывать ПЕРЕД записью данных.

    Точки вызова ровно две по смыслу:

      * загрузка файла — счёт, список сотрудников, командировки. Расчёт без
        правил чипса и правил оплаты посчитает не то, поэтому справочники
        обязаны лечь в базу одновременно с первыми данными;
      * правка справочника в настройках — администратор редактирует строку,
        которую до этого видел из памяти, и она должна стать настоящей.

    Повторный вызов бесплатен: в процессе стоит флаг, в базе — отметка
    seeds_version.
    """
    global _reference_ready, _ever_seeded
    if _reference_ready:
        return
    db.connect()
    seeds.ensure_seeds()
    _seed_parameters()
    _seed_tariffs()
    _reload_param_index()
    _reference_ready = True
    _ever_seeded = True


def reference_materialized() -> bool:
    """Наполняли ли справочники ЭТОЙ базы хоть раз.

    От ответа зависит, что вернёт чтение пустого справочника:

        нет  — умолчания из памяти (seeds.default_*). Установка свежая,
               загрузок ещё не было, показывать пустой экран настроек нельзя;
        да   — ровно то, что в базе, даже если это ноль строк. Иначе
               администратор, удаливший все правила, увидел бы их снова —
               ту же яму мы уже проходили с посевом на каждом старте.

    Ответ кэшируется: он меняется ровно один раз за жизнь базы.
    """
    global _ever_seeded
    if _ever_seeded is None:
        _ever_seeded = db.get_setting(seeds.SEEDED_FLAG) == seeds.SEEDS_VERSION
    return _ever_seeded


def _seed_parameters() -> None:
    """Залить справочник услуг в pname (только отсутствующие строки)."""
    have = {r["description"] for r in db.query("SELECT description FROM pname")}
    new = [(name, cat) for name, cat in PARAMETERS_LIST if name not in have]
    if new:
        db.execute_many(
            "INSERT INTO pname (description, category, service_type) VALUES (?, ?, '')",
            new,
        )


# Каталог, который приложение ставило по умолчанию РАНЬШЕ: девять «чистых»
# тарифов, без комбинаций с FMC и интернет-пакетами. Список нужен, чтобы
# отличить нетронутый старый каталог от того, который правил администратор.
LEGACY_TARIFFS: set[tuple[str, float]] = {
    ("Федеральный Специальный", 0.0),
    ("Пакет 140 ₽", 140.0), ("Пакет 230 ₽", 230.0), ("Пакет 400 ₽", 400.0),
    ("Интернет 30 ₽", 30.0), ("Интернет 100 ₽", 100.0),
    ("Интернет 220 ₽", 220.0), ("Интернет 310 ₽", 310.0),
    ("Интернет 400 ₽", 400.0),
}


def _seed_tariffs() -> None:
    """Залить каталог тарифов: если он пуст или всё ещё старый по умолчанию.

    ЗАЧЕМ ВТОРОЕ УСЛОВИЕ. Каталог вырос с девяти тарифов до полусотни: в нём
    появились комбинации «пакет + FMC + интернет-пакет», без которых номер с
    абонплатой 186,95 ₽ опознавался как «Пакет 140» и считался по чужому
    пакету. На пустой базе новый каталог заливается сам, а вот на уже
    работающей так и остались бы девять строк.

    Поэтому подменяем каталог ТОЛЬКО если он дословно совпадает со старым
    набором по умолчанию — то есть его никто не трогал. Стоит администратору
    поправить хоть одну цену или название, и мы не лезем: его работа дороже
    нашего обновления. Обновить руками в этом случае — «Настройки → Тарифы →
    Сбросить к заводским».
    """
    rows = db.query("SELECT plan_name, base_cost FROM tariff_plans")
    if not rows:
        set_tariffs(domain.DEFAULT_TARIFFS)
        return
    current = {(str(r["plan_name"]), round(float(r["base_cost"] or 0.0), 2))
               for r in rows}
    if current == LEGACY_TARIFFS:
        set_tariffs(domain.DEFAULT_TARIFFS)


def _reload_param_index() -> None:
    global _param_index
    rows = db.query("SELECT id, description FROM pname")
    _param_index = {_norm(r["description"]): r["id"] for r in rows}


def reset() -> None:
    """Очистить загруженные счета. Настройки чипсов и правила сохраняются.

    ИЗМЕНЕНИЕ ПОВЕДЕНИЯ: раньше сброс стирал вообще всё. Теперь ручная работа
    администратора (цвета, пометки, правила, командировки) переживает очистку
    — иначе после каждой перезагрузки счёта её пришлось бы делать заново.
    """
    db.wipe_data(keep_settings=True)
    invalidate_bill_cache()


# ═══════════════════════════════════════════════════════════════════════════
#  Справочник услуг
# ═══════════════════════════════════════════════════════════════════════════

def find_parameter_id(service_name: str) -> int | None:
    """Найти id услуги в справочнике.

    Сопоставление двустороннее: в счёте название бывает и длиннее справочного
    («…(за абонентский номер)»), и короче (обрезано по ширине колонки).
    Берём самое длинное совпадение — оно наиболее специфично.
    """
    key = _norm(service_name)
    if not key:
        return None
    exact = _param_index.get(key)
    if exact:
        return exact
    best_id, best_len = None, 0
    for name, pid in _param_index.items():
        if (name in key or key in name) and len(name) > best_len:
            best_id, best_len = pid, len(name)
    return best_id


# ═══════════════════════════════════════════════════════════════════════════
#  Абоненты (users_numbers)
# ═══════════════════════════════════════════════════════════════════════════

def upsert_user(number: str, *, username: str = "", limit: int | None = None,
                position: str = "", personnel_no: str = "", note: str = "",
                fetch: bool = True) -> dict[str, Any]:
    """Создать или обновить карточку абонента.

    Пустые поля НЕ затирают старые: повторная загрузка списка без колонки
    «Должность» не должна стирать уже проставленные должности. А вот статус и
    командировка сюда не приходят — их выставляют вручную через настройки,
    и загрузка файла их не трогает.

    `fetch=False` — не перечитывать карточку после записи. Массовой загрузке
    результат не нужен, а это лишний поход в базу на КАЖДЫЙ номер списка.
    """
    number = str(number)
    db.execute(
        "INSERT INTO users_numbers (number, username, limit_numbr, position, personnel_no, note) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (number) DO UPDATE SET "
        # NULLIF(...,'') превращает пустую строку в NULL, а COALESCE тогда
        # оставляет прежнее значение. Так пустое поле не затирает данные.
        "  username     = COALESCE(NULLIF(excluded.username, ''), users_numbers.username), "
        "  limit_numbr  = COALESCE(excluded.limit_numbr, users_numbers.limit_numbr), "
        "  position     = COALESCE(NULLIF(excluded.position, ''), users_numbers.position), "
        "  personnel_no = COALESCE(NULLIF(excluded.personnel_no, ''), users_numbers.personnel_no), "
        "  note         = COALESCE(NULLIF(excluded.note, ''), users_numbers.note)",
        (number, username, limit, position, personnel_no, note),
    )
    return (get_user(number) or {}) if fetch else {}


_USER_SETTING_FIELDS = ("status", "status_color", "is_business_trip",
                        "trip_start_date", "trip_end_date")


def update_user_settings(number: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Обновить ручные настройки абонента: статус, командировку, лимит.

    Меняются только переданные поля — фронтенд шлёт по одному изменению
    (переключили статус / поставили галочку командировки), и остальные
    настройки при этом не должны сбрасываться.
    """
    number = str(number)
    if not get_user(number):
        upsert_user(number, fetch=False)

    sets: list[str] = []
    params: list[Any] = []
    for field in _USER_SETTING_FIELDS:
        if field not in changes:
            continue
        value = changes[field]
        sets.append(f"{field} = ?")
        if field == "is_business_trip":
            params.append(1 if value else 0)
        else:
            params.append("" if value is None else str(value))

    if "limit" in changes or "limit_numbr" in changes:
        raw = changes.get("limit", changes.get("limit_numbr"))
        sets.append("limit_numbr = ?")
        params.append(max(0, domain.to_int(raw)))
    if "username" in changes:
        sets.append("username = ?")
        params.append(str(changes["username"] or ""))
    if "note" in changes:
        sets.append("note = ?")
        params.append(str(changes["note"] or ""))

    if sets:
        params.append(number)
        db.execute(f"UPDATE users_numbers SET {', '.join(sets)} WHERE number = ?", params)
    return get_user(number) or {}


def get_user(number: str) -> dict[str, Any] | None:
    return db.query_one("SELECT * FROM users_numbers WHERE number = ?", (str(number),))


def on_business_trip(user: dict[str, Any], month: str) -> bool:
    """Пересекается ли командировка абонента с расчётным месяцем.

    Источников два, и достаточно любого:
      1) ручная галочка в настройках (поля is_business_trip + даты);
      2) НОВОЕ: строка из загруженного файла командировок (business_trips).

    Без дат галочка считается действующей всегда — так удобнее: отметил и не
    следишь за датами.
    """
    if _on_trip(user, month):
        return True
    if user and month and trip_for_month(str(user.get("number") or ""), month):
        return True
    return False


def _on_trip(user: dict[str, Any], month: str) -> bool:
    """Только ручная галочка: действует ли она в этом месяце."""
    if not (user and user.get("is_business_trip")):
        return False
    start = str(user.get("trip_start_date") or "")
    end = str(user.get("trip_end_date") or "")
    if not month or (not start and not end):
        return True
    return not (start and start[:7] > month) and not (end and end[:7] < month)


def _profile_fields(user: dict[str, Any]) -> dict[str, Any]:
    """Карточка абонента в том виде, в каком её ждёт domain.build_record."""
    return {
        "username": user["username"] or "",
        "limit": user["limit_numbr"] or 0,
        "position": user["position"] or "",
        "personnel_no": user["personnel_no"] or "",
        "note": user["note"] or "",
        "status": user["status"] or "normal",
        "status_color": user["status_color"] or "",
        "is_business_trip": bool(user["is_business_trip"]),
        "trip_start_date": user["trip_start_date"] or "",
        "trip_end_date": user["trip_end_date"] or "",
    }


def get_profile(number: str, month: str = "") -> dict[str, Any]:
    """Профиль абонента для domain.build_record."""
    user = get_user(number)
    if not user:
        return {}
    return {**_profile_fields(user), "on_trip": on_business_trip(user, month)}


def all_users() -> list[dict[str, Any]]:
    return db.query("SELECT * FROM users_numbers ORDER BY number")


def users_count() -> int:
    return int(db.scalar("SELECT COUNT(*) AS n FROM users_numbers", default=0) or 0)


# ═══════════════════════════════════════════════════════════════════════════
#  СМЕНА НОМЕРА: ДВА ЛИЦЕВЫХ СЧЁТА, А ЧЕЛОВЕК ОДИН
#
#      Черемша по весне одна, а зовут её кто как:
#      Тут колба, там медвежий лук, а дальше — дикий чеснок.
#      Свесил три мешка порознь, записал в три строки,
#      А куст-то был один. И корень у него один.
#
#  ЧТО ПРОИСХОДИТ БЕЗ ЭТОГО. Сотруднику меняют номер. Оператор заводит новый
#  лицевой счёт, и в выгрузке появляются ДВА абонента: старый с начислениями
#  до смены, новый — после. Дальше всё разъезжается:
#
#      * расход человека делится пополам между двумя карточками, и ни одна
#        не показывает правду;
#      * лимит сравнивается с половиной расхода — превышения не видно;
#      * в списке работников остался ОДИН из номеров, поэтому у второго нет
#        ни ФИО, ни должности, ни лимита. Он и есть тот самый «не
#        подгрузившийся» абонент: голые цифры в списке;
#      * история обрывается — у нового номера её нет вовсе, у старого она
#        заканчивается месяцем смены, и рекомендация по тарифу считается по
#        огрызку;
#      * парк раздувается: двести человек показываются как двести двадцать.
#
#  ЧТО ДЕЛАЕМ. Держим связь «старый номер → новый». Расчёт по ней складывает
#  счета обоих в одну запись (см. merge_changed_numbers): один человек — одна
#  карточка, полный расход, целая история.
# ═══════════════════════════════════════════════════════════════════════════

def get_number_changes() -> list[dict[str, Any]]:
    """Все связи «номер сменился», новые сверху."""
    return db.query("SELECT * FROM number_changes ORDER BY changed_at DESC, old_number")


def save_number_change(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Записать смену номера. Оба номера обязательны и должны различаться."""
    old = domain.normalize_number(data.get("old_number"))
    new = domain.normalize_number(data.get("new_number"))
    if not old or not new:
        raise ValueError("Нужны оба номера: и старый, и новый")
    if old == new:
        raise ValueError("Старый и новый номер совпадают")

    # ЦЕПОЧКУ ЗАМКНУТЬ НЕЛЬЗЯ. Если новый номер уже ведёт (пусть и через
    # несколько шагов) обратно к старому, получится кольцо, и любой обход по
    # ссылкам зациклится. Ловим это здесь, на записи, а не потом на расчёте.
    chain, guard = new, 0
    links = {r["old_number"]: r["new_number"] for r in get_number_changes()}
    while chain in links and guard < 50:
        if chain == old:
            raise ValueError("Так получится кольцо: этот номер уже ведёт к старому")
        chain = links[chain]
        guard += 1
    if chain == old:
        raise ValueError("Так получится кольцо: этот номер уже ведёт к старому")

    db.execute(
        "INSERT INTO number_changes (old_number, new_number, changed_at, note) "
        "VALUES (?, ?, ?, ?) ON CONFLICT (old_number) DO UPDATE SET "
        "  new_number = excluded.new_number, changed_at = excluded.changed_at, "
        "  note = excluded.note",
        (old, new, str(data.get("changed_at") or ""), str(data.get("note") or "")),
    )
    return get_number_changes()


def delete_number_change(old_number: str) -> list[dict[str, Any]]:
    db.execute("DELETE FROM number_changes WHERE old_number = ?",
               (domain.normalize_number(old_number),))
    return get_number_changes()


def successor_map() -> dict[str, str]:
    """Куда в итоге ведёт каждый старый номер: {старый: КОНЕЧНЫЙ новый}.

    Связи разворачиваются ДО КОНЦА. Номер могли менять дважды: A→B, B→C. В
    таблице это две строки, а склеивать надо все три счёта в один, поэтому и
    A, и B обязаны указывать на C.

    Кольца отсекаются при записи (см. save_number_change), но счётчик шагов
    оставлен и здесь: строку могли завести напрямую через SQL, а зацикливаться
    посреди отчёта — худшее, что тут может случиться.
    """
    links = {str(r["old_number"]): str(r["new_number"]) for r in get_number_changes()}
    out: dict[str, str] = {}
    for old in links:
        seen = {old}
        node = links[old]
        while node in links and node not in seen and len(seen) < 50:
            seen.add(node)
            node = links[node]
        out[old] = node
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  Код справочной строки из её названия
#
#  Код участвует в data-атрибутах и селекторах на фронтенде, поэтому кириллицу
#  транслитерируем: «Личный тариф» → «lichnyy_tarif».
# ═══════════════════════════════════════════════════════════════════════════

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _slug(label: str) -> str:
    text = "".join(_TRANSLIT.get(ch, ch) for ch in str(label or "").strip().lower())
    slug = "".join(ch if ch.isalnum() else "_" for ch in text).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug or "rule"


def _free_code(table: str, base: str) -> str:
    """Свободный код на основе base: base, base_2, base_3…

    ЗАЧЕМ. Код правила выводится из названия, а кнопка «+ Цвет» заводит
    правило с одним и тем же названием «Новый цвет». Слаг от него получался
    один и тот же, запись находила саму себя и уходила в UPDATE — кнопка
    добавляла ровно одно правило за всю жизнь базы, а дальше молча
    перезаписывала его. Со стороны это и есть «кнопка не работает».
    """
    taken = {str(r["code"]) for r in db.query(f"SELECT code FROM {table}")}
    if base not in taken:
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    return f"{base}_{n}"


# ═══════════════════════════════════════════════════════════════════════════
#  Счета (reports + pvalues)
# ═══════════════════════════════════════════════════════════════════════════

def save_report(number: str, month: str, items: list[dict[str, Any]], *,
                report_date: str = "", plan_name: str = "",
                total_charged: float = 0.0, vat: float = 0.0) -> None:
    """Сохранить счёт абонента за месяц.

    Повторная загрузка того же месяца полностью заменяет прежние строки — так
    двойной загрузкой файла нельзя задвоить расходы. За это отвечает
    уникальный индекс (subscriber_id, report_month) плюс удаление старых
    строк pvalues внутри одной транзакции.

    ПОЧЕМУ ЗДЕСЬ НЕТ «SELECT id, ПОТОМ INSERT ИЛИ UPDATE». Транзакция копит
    команды и уходит в базу одним куском (см. db.transaction), поэтому
    прочитать id прямо посреди блока нельзя. Да и не нужно: то же самое
    делает ON CONFLICT DO UPDATE, а строки счёта привязываются к отчёту
    подзапросом по паре (номер, месяц) — она уникальна.
    """
    number, month = str(number), str(month)

    with db.transaction() as conn:
        # Карточка абонента должна существовать: на неё ссылается интерфейс.
        conn.execute(
            "INSERT INTO users_numbers (number) VALUES (?) "
            "ON CONFLICT (number) DO NOTHING", (number,))

        conn.execute(
            "INSERT INTO reports (report_month, subscriber_id, report_date, "
            "                     tariff_name, total_charged, vat) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (subscriber_id, report_month) DO UPDATE SET "
            "  report_date   = excluded.report_date, "
            "  tariff_name   = excluded.tariff_name, "
            "  total_charged = excluded.total_charged, "
            "  vat           = excluded.vat",
            (month, number, report_date or month, plan_name,
             float(total_charged), float(vat)),
        )

        # Старые строки убираем ПОСЛЕ вставки шапки: к этому моменту отчёт
        # точно есть, и подзапрос ниже всегда что-то находит.
        conn.execute(
            "DELETE FROM pvalues WHERE report_id = "
            "  (SELECT id FROM reports WHERE subscriber_id = ? AND report_month = ?)",
            (number, month))

        conn.executemany(
            "INSERT INTO pvalues (report_id, parameter_id, service_name, volume, "
            "                     no_discount, discount, with_discount) "
            "VALUES ((SELECT id FROM reports "
            "          WHERE subscriber_id = ? AND report_month = ?), ?, ?, ?, ?, ?, ?)",
            [(number, month, find_parameter_id(it["service"]), it["service"],
              it.get("raw_volume", ""), float(it.get("no_discount", 0.0)),
              float(it.get("discount", 0.0)), float(it.get("cost", 0.0)))
             for it in items],
        )

    # Счета изменились — прочитанное больше не годится.
    invalidate_bill_cache()


def months() -> list[dict[str, Any]]:
    """Список доступных периодов — для выпадающего списка на фронтенде."""
    return db.query(
        "SELECT report_month AS month, COUNT(*) AS report_count "
        "  FROM reports GROUP BY report_month ORDER BY report_month DESC"
    )


def latest_month() -> str:
    return str(db.scalar("SELECT MAX(report_month) AS m FROM reports", default="") or "")


def _row_to_item(row: dict[str, Any]) -> dict[str, Any]:
    """Строка pvalues → позиция для domain (с категорией и разобранным объёмом)."""
    service = row["service_name"] or ""
    volume, unit = domain.parse_volume(row["volume"])
    return {
        "service": service,
        "cat": domain.categorize(service, unit=unit),
        "unit": unit,
        "volume": volume,
        "raw_volume": row["volume"] or "",
        "outgoing": domain.is_outgoing(service),
        "cost": row["with_discount"] or 0.0,
        "no_discount": row["no_discount"] or 0.0,
        "discount": row["discount"] or 0.0,
        "parameter_id": row["parameter_id"],
    }


def _bundles(where: str, params: tuple) -> list[dict[str, Any]]:
    """Собрать счета со строками ОДНИМ запросом.

    ОПТИМИЗАЦИЯ: раньше строки счёта доставались по одному счёту за раз. На
    сотне абонентов это сотня обращений к хранилищу. Здесь один JOIN на весь
    период, а группировка делается в Python.
    """
    reports = db.query(
        f"SELECT id, subscriber_id, report_month, report_date, tariff_name, "
        f"       total_charged, vat FROM reports {where} ORDER BY report_month, subscriber_id",
        params,
    )
    if not reports:
        return []

    ids = [r["id"] for r in reports]
    marks = ", ".join("?" for _ in ids)
    rows = db.query(
        f"SELECT report_id, parameter_id, service_name, volume, no_discount, "
        f"       discount, with_discount FROM pvalues "
        f" WHERE report_id IN ({marks}) ORDER BY with_discount DESC",
        ids,
    )
    by_report: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_report[row["report_id"]].append(_row_to_item(row))

    out = []
    for r in reports:
        items = by_report.get(r["id"], [])
        # «Итого начислено» оператора точнее суммы строк (в счёте бывают
        # скидки и корректировки), поэтому берём его, а сумму строк — запасным.
        total = r["total_charged"] or sum(i["cost"] for i in items)
        out.append({
            "id": r["id"],
            "number": r["subscriber_id"],
            "month": r["report_month"],
            "plan_name": r["tariff_name"] or "",
            "total_charged": float(total),
            "vat": r["vat"] or 0.0,
            "items": items,
        })
    return out


def bundles_for_month(month: str) -> list[dict[str, Any]]:
    return _bundles("WHERE report_month = ?", (str(month),))


def bundles_for_number(number: str) -> list[dict[str, Any]]:
    return _bundles("WHERE subscriber_id = ?", (str(number),))


# ═══════════════════════════════════════════════════════════════════════════
#  ВСЁ ДЛЯ РАСЧЁТА МЕСЯЦА — ОДНИМ НАБОРОМ ЗАПРОСОВ
#
#  ЗАЧЕМ. Расчёт месяца собирает карточку по каждому абоненту: история,
#  потребление по категориям, профиль, командировка, настройки чипса. Пока
#  каждый кусок читался «по номеру», на сотне абонентов выходило больше
#  тысячи обращений к базе. Каждое обращение — отдельный запуск psql, и
#  главный экран открывался ЧЕТЫРЕ МИНУТЫ.
#
#  Здесь всё то же самое читается семью запросами на весь парк, а разбор по
#  номерам делается в памяти. Формулы при этом не продублированы: и разбор
#  по номерам, и одиночные функции зовут одни и те же history_rows,
#  category_rows и pick_trip.
# ═══════════════════════════════════════════════════════════════════════════

# ── КЭШ СЧЕТОВ ──────────────────────────────────────────────────────────────
#
#     Черемша по весне из-под снега прёт,
#     Раз сорвал — и год её не тревожь.
#     Не топчи полянку туда-обратно:
#     Что нарвал однажды — то и в кузов сложь.
#
# ЧТО ЗДЕСЬ ЛЕЖИТ. Счета со всеми строками начислений и помесячные суммы из
# списка сотрудников. Это САМАЯ ТЯЖЁЛАЯ часть чтения: на боевой выгрузке —
# десятки мегабайт, которые едут из psql через канал и разбираются из JSON.
#
# ЗАЧЕМ КЭШ. Отчёт пересобирался на КАЖДУЮ правку настройки: покрасил чипс —
# перечитали всю базу, поставил галку — перечитали всю базу. А счета от этих
# правок не меняются вообще: их пишет только загрузка файла. Двадцать секунд
# на снятие одной галочки уходили ровно сюда.
#
# КОГДА СБРАСЫВАТЬ. Ровно там, где счета и список сотрудников меняются:
# apply_bill, apply_roster, reset. За это отвечает invalidate_bill_cache(), и
# зовётся она из самих функций записи — не из вызывающего кода, иначе рано или
# поздно кто-нибудь забудет.
_bill_cache: dict[str, Any] | None = None


def invalidate_bill_cache() -> None:
    """Забыть прочитанные счета. Звать после любой записи в reports/pvalues/roster."""
    global _bill_cache
    _bill_cache = None


def _bill_data() -> dict[str, Any]:
    """Счета и помесячные суммы — из кэша, а если его нет, то из базы."""
    global _bill_cache
    if _bill_cache is not None:
        return _bill_cache

    by_number: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for bundle in _bundles("", ()):
        by_number[str(bundle["number"])].append(bundle)

    roster: dict[str, dict[str, float]] = defaultdict(dict)
    for row in db.query("SELECT number, month, total FROM roster_history"):
        roster[str(row["number"])][row["month"]] = float(row["total"] or 0.0)

    _bill_cache = {"bundles": by_number, "roster": roster}
    return _bill_cache


def month_dataset(month: str) -> dict[str, Any]:
    """Прочитать всё, что нужно расчёту месяца.

    ДЕЛИТСЯ НА ДВЕ ПОЛОВИНЫ, и это главное, что о ней надо знать.

    Тяжёлая — счета и суммы по месяцам — берётся из кэша: её меняет только
    загрузка файла (см. _bill_data).

    Лёгкая — командировки, карточки абонентов, настройки чипсов — читается
    каждый раз. Именно её и правят в настройках, поэтому кэшировать её нельзя;
    зато это три коротких запроса по небольшим таблицам, а не десятки
    мегабайт строк начислений.
    """
    bills = _bill_data()

    trips: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in db.query(f"SELECT * FROM business_trips WHERE {_REAL_TRIP} "
                        " ORDER BY approved DESC, date_start"):
        trips[str(row["number"])].append(row)

    data = {
        "month": str(month),
        "bundles": bills["bundles"],
        "roster": bills["roster"],
        "trips": trips,
        "users": {str(u["number"]): u for u in all_users()},
        "chips": all_chips(),
        "changes": {},
    }

    # СКЛЕЙКА СМЕНЁННЫХ НОМЕРОВ — последним шагом, поверх всего прочитанного.
    #
    # Делается ЗДЕСЬ, а не в кэше счетов: связи правят в настройках, а счета
    # в кэше лежат месяцами. Склей мы их один раз при чтении — правка связи
    # ничего бы не изменила до перезагрузки файла.
    links = successor_map()
    if links:
        merge_changed_numbers(data, links)
    return data


def merge_changed_numbers(data: dict[str, Any], links: dict[str, str]) -> None:
    """Свести счета сменённых номеров на новый номер. Правит data на месте.

    Что переносится и почему именно так:

      * СЧЕТА. За месяц смены их два — половина на старом номере, половина на
        новом. Строки начислений складываются в один счёт, итоги суммируются.
        За прочие месяцы счёт просто переезжает под новый номер.
      * ПОМЕСЯЧНЫЕ СУММЫ из списка работников — так же: месяц смены
        складываем, остальные переносим.
      * КОМАНДИРОВКИ старого номера остаются командировками человека.
      * КАРТОЧКА (ФИО, должность, лимит). Здесь и была та самая дыра «один
        номер не подгружается»: в списке работников остаётся ОДИН из двух
        номеров, у второго нет ни ФИО, ни лимита. Берём карточку нового
        номера, а всё, чего в ней нет, добираем из старой.
      * НАСТРОЙКИ ЧИПСА достаются новому номеру, если своих у него нет: цвет
        и пометки вешали на человека, а не на симку.

    В data["changes"] остаётся след: {новый номер: [старые]}. По нему
    интерфейс говорит на карточке, из чего она склеена, — иначе человек
    увидит у абонента вдвое больший расход и не поймёт, откуда он взялся.
    """
    changes: dict[str, list[str]] = defaultdict(list)
    for old, new in links.items():
        if old != new:
            changes[new].append(old)
    data["changes"] = {}
    if not changes:
        return

    # ПРАВИТЬ ПРОЧИТАННОЕ НАПРЯМУЮ НЕЛЬЗЯ: счета и помесячные суммы приезжают
    # из кэша (_bill_data) и живут между запросами. Склей мы их на месте —
    # склейка осталась бы в кэше навсегда, а снятая в настройках связь уже
    # ничего бы не расклеила. Поэтому копируем — но только то, что трогаем:
    # отображение целиком (оно дешёвое, это ссылки) и списки счетов
    # затронутых номеров. Остальные списки остаются общими с кэшем.
    data["bundles"] = dict(data["bundles"])
    data["roster"] = dict(data["roster"])
    # users, chips и trips читаются из базы на каждый вызов — их можно править
    # как есть, копий не надо.

    for new, olds in changes.items():
        for old in olds:
            _merge_bundles(data["bundles"], old, new)
            _merge_roster(data["roster"], old, new)
            moved_trips = data["trips"].pop(old, [])
            if moved_trips:
                data["trips"][new] = list(data["trips"].get(new, [])) + moved_trips
            _merge_user(data["users"], old, new)
            was_chip = data["chips"].pop(old, None)
            if was_chip and new not in data["chips"]:
                data["chips"][new] = {**was_chip, "number": new}

    data["changes"] = {new: sorted(olds) for new, olds in changes.items()}


def _merge_bundles(bundles: dict[str, list[dict[str, Any]]], old: str, new: str) -> None:
    """Счета старого номера — на новый. За общий месяц счета складываются.

    Копирование по необходимости: и список, и каждый правленый счёт заменяются
    копией. Сами счета лежат в кэше и принадлежат не нам.
    """
    moving = bundles.pop(old, None)
    if not moving:
        return

    target = list(bundles.get(new, []))
    by_month = {b["month"]: i for i, b in enumerate(target)}
    for bundle in moving:
        at = by_month.get(bundle["month"])
        if at is None:
            # Месяца у нового номера нет — счёт просто переезжает. Номер в нём
            # переписываем: дальше по нему ищут профиль, чипс и командировки.
            by_month[bundle["month"]] = len(target)
            target.append({**bundle, "number": new, "merged_from": [old]})
            continue
        # МЕСЯЦ СМЕНЫ. Два неполных счёта — один полный: строки начислений
        # складываются, итоги суммируются. Название тарифа берём то, что уже
        # стоит у нового номера: человек на нём и остался.
        same = target[at]
        target[at] = {
            **same,
            "number": new,
            "items": list(same["items"]) + list(bundle["items"]),
            "total_charged": round(float(same.get("total_charged") or 0.0)
                                   + float(bundle.get("total_charged") or 0.0), 2),
            "vat": round(float(same.get("vat") or 0.0)
                         + float(bundle.get("vat") or 0.0), 2),
            "plan_name": same.get("plan_name") or bundle.get("plan_name", ""),
            "merged_from": list(same.get("merged_from") or []) + [old],
        }
    target.sort(key=lambda b: b["month"])
    bundles[new] = target


def _merge_roster(roster: dict[str, dict[str, float]], old: str, new: str) -> None:
    """Помесячные суммы из списка работников — туда же, к новому номеру."""
    moving = roster.pop(old, None)
    if not moving:
        return
    target = dict(roster.get(new, {}))
    for month, amount in moving.items():
        target[month] = round(target.get(month, 0.0) + float(amount or 0.0), 2)
    roster[new] = target


def _merge_user(users: dict[str, dict[str, Any]], old: str, new: str) -> None:
    """Карточка человека: за основу новая, пустые поля добираем из старой.

    Из-за этого «не подгружался» один из двух номеров: список работников
    ведут по действующему номеру, и у старого не остаётся ни ФИО, ни
    должности, ни лимита — в отчёте он выглядит голыми цифрами. Бывает и
    наоборот: список не успели обновить, и пустым оказывается новый.
    """
    was = users.pop(old, None)
    if not was:
        return
    now = users.get(new)
    if not now:
        users[new] = {**was, "number": new}
        return
    for field, value in was.items():
        if field == "number":
            continue
        if now.get(field) in (None, "", 0) and value not in (None, ""):
            now[field] = value


def dataset_profile(data: dict[str, Any], number: str) -> dict[str, Any]:
    """Профиль абонента из прочитанного набора — без похода в базу."""
    user = data["users"].get(str(number))
    if not user:
        return {}
    month = data["month"]
    on_trip = _on_trip(user, month) or bool(
        pick_trip(data["trips"].get(str(number), []), month))
    return {**_profile_fields(user), "on_trip": on_trip}



def trend() -> list[dict[str, Any]]:
    """Суммарный расход по месяцам — реальная история, без моделирования.

    Источников два, и они дополняют друг друга:
      * счета (reports) — детальные данные загруженных периодов;
      * список сотрудников (roster_history) — помесячные суммы из выгрузки.

    За месяц, где есть счёт, берём счёт: он точнее и проверяем построчно.
    Благодаря списку график осмысленный даже когда загружен один счёт.
    """
    totals: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    sources: dict[str, str] = {}

    for row in db.query(
        "SELECT month, SUM(total) AS total, COUNT(DISTINCT number) AS subscribers "
        "  FROM roster_history GROUP BY month"
    ):
        totals[row["month"]] = float(row["total"] or 0.0)
        counts[row["month"]] = int(row["subscribers"] or 0)
        sources[row["month"]] = "roster"

    # Месяцы со счётом перекрывают данные из списка целиком.
    for row in db.query(
        "SELECT r.report_month AS month, "
        "       SUM(COALESCE(NULLIF(r.total_charged, 0), "
        "           (SELECT COALESCE(SUM(with_discount), 0) FROM pvalues WHERE report_id = r.id))) AS total, "
        "       COUNT(DISTINCT r.subscriber_id) AS subscribers "
        "  FROM reports r GROUP BY r.report_month"
    ):
        totals[row["month"]] = float(row["total"] or 0.0)
        counts[row["month"]] = int(row["subscribers"] or 0)
        sources[row["month"]] = "bill"

    return [{"month": m, "total": round(totals[m], 2),
             "subscribers": counts[m], "source": sources.get(m, "bill")}
            for m in sorted(totals)]


# ═══════════════════════════════════════════════════════════════════════════
#  История из списка сотрудников
#  В выгрузке есть колонки помесячных расходов — это реальная история, даже
#  если счёт загружен только за один месяц.
# ═══════════════════════════════════════════════════════════════════════════

def set_roster_history(number: str, history: dict[str, float]) -> None:
    if not history:
        return
    db.execute_many(
        "INSERT INTO roster_history (number, month, total) VALUES (?, ?, ?) "
        "ON CONFLICT (number, month) DO UPDATE SET total = excluded.total",
        [(str(number), month, float(amount)) for month, amount in history.items()],
    )
    # Помесячные суммы лежат в том же кэше, что и счета.
    invalidate_bill_cache()


def get_roster_history(number: str) -> dict[str, float]:
    rows = db.query("SELECT month, total FROM roster_history WHERE number = ?", (str(number),))
    return {r["month"]: float(r["total"]) for r in rows}



def roster_rows_count() -> int:
    return int(db.scalar("SELECT COUNT(DISTINCT number) AS n FROM roster_history", default=0) or 0)


def services_summary(month: str = "") -> list[dict[str, Any]]:
    """Свод «начислено по услугам» за период — для окна «Общая статистика»."""
    where, params = ("WHERE r.report_month = ?", (str(month),)) if month else ("", ())
    rows = db.query(
        f"SELECT pv.service_name, pv.volume, pv.no_discount, pv.discount, pv.with_discount "
        f"  FROM pvalues pv JOIN reports r ON r.id = pv.report_id {where}",
        params,
    )

    agg: dict[str, dict[str, Any]] = {}
    for row in rows:
        volume, unit = domain.parse_volume(row["volume"])
        name = row["service_name"] or ""
        acc = agg.setdefault(name, {
            "name": name, "volume": 0.0, "unit": unit,
            "no_discount": 0.0, "discount": 0.0, "amount": 0.0, "count": 0,
        })
        acc["volume"] += volume
        acc["unit"] = acc["unit"] or unit
        acc["no_discount"] += row["no_discount"] or 0.0
        acc["discount"] += row["discount"] or 0.0
        acc["amount"] += row["with_discount"] or 0.0
        acc["count"] += 1

    return [
        {"name": r["name"],
         "volume": f"{r['volume']:.2f} {r['unit']}".strip() if r["unit"] else "",
         "no_discount": round(r["no_discount"], 2),
         "discount": round(r["discount"], 2),
         "amount": round(r["amount"], 2),
         "count": r["count"]}
        for r in sorted(agg.values(), key=lambda x: x["amount"], reverse=True)
    ]


def category_history(number: str) -> list[dict[str, Any]]:
    """Помесячное потребление по категориям — для графиков минут, ГБ и SMS."""
    return category_rows(bundles_for_number(number))


def category_rows(bundles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """То же самое, но из уже прочитанных счетов.

    Вынесено отдельно, чтобы расчёт целого месяца не ходил в базу за счетами
    каждого номера по отдельности: он читает их все разом и зовёт эту
    функцию. Логика при этом одна на оба пути, разъехаться ей негде.
    """
    out = []
    for bundle in bundles:
        items = bundle["items"]
        usage = domain.aggregate_usage(items)
        cost = {c: 0.0 for c in domain.CATEGORY_ORDER}
        for it in items:
            if it["cat"] in cost and not domain.is_addon(it["service"]):
                cost[it["cat"]] += it["cost"]
        out.append({
            "month": bundle["month"],
            "voice_min": usage["voice_min"],
            "internet_mb": usage["internet_mb"],
            "sms_cnt": usage["sms_cnt"],
            "voice_cost": round(cost["voice"], 2),
            "internet_cost": round(cost["internet"], 2),
            "sms_cost": round(cost["sms"], 2),
        })
    return out


def history_for_number(number: str) -> list[dict[str, Any]]:
    """Объединённая история: помесячные суммы из счетов + из списка сотрудников.

    Данные счёта приоритетнее — они детальные и проверяемые.
    """
    return history_rows(bundles_for_number(number), get_roster_history(number))


def history_rows(bundles: list[dict[str, Any]],
                 roster: dict[str, float]) -> list[dict[str, Any]]:
    """То же самое из уже прочитанных данных — см. `category_rows`.

    Сумма месяца берётся из счёта той же формулой, что и в `_bundles`:
    «итого начислено» оператора, а если его нет — сумма строк.
    """
    merged: dict[str, dict[str, Any]] = {}
    for month, amount in roster.items():
        merged[month] = {"month": month, "total": round(float(amount), 2),
                         "source": "roster"}
    for bundle in bundles:
        merged[bundle["month"]] = {"month": bundle["month"],
                                   "total": round(float(bundle["total_charged"] or 0.0), 2),
                                   "source": "bill"}
    return [merged[m] for m in sorted(merged)]


# ═══════════════════════════════════════════════════════════════════════════
#  Каталог тарифов
# ═══════════════════════════════════════════════════════════════════════════

def get_tariffs() -> list[dict[str, Any]]:
    """Каталог в том виде, в каком его ждут domain и фронтенд.

    Пока в базу ничего не загружали, таблица пуста — отдаём каталог из
    памяти. Он же ляжет в базу при первой загрузке счёта. Расчёт на это не
    завязан: domain.normalize_catalog подставляет тот же набор сам.
    """
    rows = db.query("SELECT * FROM tariff_plans ORDER BY sort_order, id")
    if not rows and not reference_materialized():
        return [{**t, "is_flex": False}
                for t in domain.normalize_catalog(domain.DEFAULT_TARIFFS)]
    return [{
        "id": r["plan_name"],           # исторически id == имя тарифа
        "name": r["plan_name"],
        "kind": r["kind"] or "voice",
        "fee": float(r["base_cost"] or 0.0),
        "minutes": int(r["voice_limit"] or 0),
        "sms": int(r["sms_limit"] or 0),
        "internet_mb": int(r["internet_limit"] or 0),
        "unlimited_internet": bool(r["unlimited_net"]),
        "rate_min": float(r["rate_min"] or 0.0),
        "rate_sms": float(r["rate_sms"] or 0.0),
        "rate_mb": float(r["rate_mb"] or 0.0),
        "note": r["note"] or "",
        "is_flex": bool(r["is_flex"]),
    } for r in rows]


def set_tariffs(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Перезаписать каталог целиком — так же, как его правят в интерфейсе."""
    catalog = domain.normalize_catalog(raw)
    with db.transaction() as conn:
        conn.execute("DELETE FROM tariff_plans")
        for order, t in enumerate(catalog, start=1):
            conn.execute(
                "INSERT INTO tariff_plans (plan_name, internet_limit, voice_limit, sms_limit, "
                "  base_cost, is_flex, kind, unlimited_net, rate_min, rate_sms, rate_mb, note, sort_order) "
                "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)",
                (t["name"], t["internet_mb"], t["minutes"], t["sms"], t["fee"],
                 t["kind"], 1 if t["unlimited_internet"] else 0,
                 t["rate_min"], t["rate_sms"], t["rate_mb"], t["note"], order * 10),
            )
    return get_tariffs()


def reset_tariffs() -> list[dict[str, Any]]:
    return set_tariffs(domain.DEFAULT_TARIFFS)


# ═══════════════════════════════════════════════════════════════════════════
#  Реквизиты счёта
# ═══════════════════════════════════════════════════════════════════════════

# ИСПРАВЛЕНО. Парсер счёта и таблица invoice_meta называют одни и те же вещи
# по-разному: у парсера «factura», «rs», «bank», а суммы вообще лежат во
# вложенном словаре `amounts`. Без явного соответствия половина реквизитов
# просто не доезжала до базы (в первой версии total_charged оставался пустым).
#
# Слева — ключ парсера, справа — колонка в базе.
_INVOICE_FLAT_MAP = {
    "invoice_number": "invoice_number",
    "invoice_date": "invoice_date",
    "period_start": "period_start",
    "period_end": "period_end",
    "period": "period_label",
    "factura": "invoice_factura_list",
    "operator_name": "operator_name",
    "operator_address": "operator_address",
    "subscriber_name": "subscriber_name",
    "subscriber_address": "subscriber_address",
    "account_number": "account_number",
    "contract": "contract_number",
    "payment_form": "payment_form",
    "inn_kpp": "inn_kpp",
    "recipient": "receiver_name",
    "bank": "bank_name",
    "rs": "rs_number",
    "ks": "ks_number",
    "bik": "bik",
    "director": "director_name",
    "qr_text": "qr_text",
}

# Суммы: ключ внутри invoice["amounts"] → колонка в базе.
_INVOICE_AMOUNT_MAP = {
    "balance_start": "balance_start",
    "balance_end": "balance_end",
    "charged": "charged",
    "paid": "total_paid",
    "penalty_start": "penies_start",
    "penalty_accrued": "penies_accrued",
    "penalty_end": "penies_end",
    "due_period": "total_due_no_penies",
    "due_total": "total_due_with_penies",
    "days_to_pay": "days_to_pay",
    "unpaid_previous": "unpaid_previous",
    "vat_total": "vat_amount",
    "total_charged": "total_charged",
    "total_vatable": "total_vatable",
}


def set_invoice(info: dict[str, Any]) -> None:
    """Сохранить реквизиты счёта за период (одна строка на месяц).

    Пишем дважды: в типизированные колонки (чтобы по ним можно было строить
    SQL-отчёты) и целиком в raw_json (чтобы ничего не потерять — набор полей
    в разных выгрузках оператора отличается).
    """
    month = info.get("report_month") or info.get("month") or latest_month()
    if not month:
        return

    data: dict[str, Any] = {"report_month": month}
    for src, column in _INVOICE_FLAT_MAP.items():
        if info.get(src) not in (None, ""):
            data[column] = info[src]

    amounts = info.get("amounts") or {}
    for src, column in _INVOICE_AMOUNT_MAP.items():
        if amounts.get(src) is not None:
            data[column] = amounts[src]

    # «Итого начислено» в счёте бывает не всегда — тогда берём «Сумму начислений».
    if data.get("total_charged") is None and amounts.get("charged") is not None:
        data["total_charged"] = amounts["charged"]

    data["raw_json"] = json.dumps(info, ensure_ascii=False)

    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    updates = ", ".join(f"{k} = excluded.{k}" for k in data if k != "report_month")
    db.execute(
        f"INSERT INTO invoice_meta ({columns}) VALUES ({marks}) "
        f"ON CONFLICT (report_month) DO UPDATE SET {updates}",
        list(data.values()),
    )


def get_invoice(month: str = "") -> dict[str, Any]:
    """Реквизиты за период в том виде, в каком их ждёт интерфейс.

    Приоритет у raw_json: там разобранный счёт целиком. Типизированные
    колонки используются как запасной вариант — например, если строку в
    invoice_meta завели напрямую через SQL, без загрузки файла.
    """
    month = month or latest_month()
    row = db.query_one("SELECT * FROM invoice_meta WHERE report_month = ?", (month,))
    if not row:
        return {}

    if row.get("raw_json"):
        try:
            restored = json.loads(row["raw_json"])
            restored.setdefault("month", month)
            return restored
        except (ValueError, TypeError):
            pass  # битый JSON — собираем из колонок ниже

    # Обратное преобразование: колонки → структура парсера.
    out: dict[str, Any] = {"month": month}
    reverse_flat = {v: k for k, v in _INVOICE_FLAT_MAP.items()}
    for column, value in row.items():
        if column in reverse_flat and value not in (None, ""):
            out[reverse_flat[column]] = value
    amounts = {}
    for src, column in _INVOICE_AMOUNT_MAP.items():
        if row.get(column) is not None:
            amounts[src] = row[column]
    if amounts:
        out["amounts"] = amounts
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  СЫРЫЕ СТРОКИ СЧЁТА
#
#  ЗАЧЕМ. Витрина на PostgreSQL в закрытом контуре смотреть не даёт: на Астре
#  нет ни pgAdmin, ни привычного клиента, а тащить туда нечего. При этом
#  сверить «что реально легло в базу» с тем, что нарисовано на главном экране,
#  нужно регулярно — иначе спор про сумму упирается в веру на слово.
#
#  ЧТО ОТДАЁТ. Ровно содержимое reports + pvalues, без единого пересчёта:
#  ни разделения компания/сотрудник, ни правил чипса, ни классификации услуг.
#  Это сознательно: если тут применять хоть одно правило, экран перестанет
#  быть точкой отсчёта и сверять станет не с чем.
# ═══════════════════════════════════════════════════════════════════════════

# Порядок колонок и подписи. Один список на JSON, CSV и таблицу в браузере —
# иначе выгрузка и экран разъедутся, и сверять придётся ещё и их между собой.
RAW_COLUMNS: list[tuple[str, str]] = [
    ("report_month",  "Период"),
    ("number",        "Номер"),
    ("report_date",   "Дата отчёта"),
    ("tariff_name",   "Тариф"),
    ("service_name",  "Услуга"),
    ("volume",        "Объём"),
    ("unit",          "Ед."),
    ("no_discount",   "Без скидки"),
    ("discount",      "Скидка"),
    ("with_discount", "Со скидкой"),
    ("total_charged", "Начислено за номер"),
    ("vat",           "НДС"),
    ("parameter_id",  "ID услуги"),
    ("report_id",     "ID отчёта"),
    ("value_id",      "ID строки"),
]

RAW_LIMIT_MAX = 5000


def raw_rows(*, month: str = "", number: str = "", service: str = "",
             limit: int = 200, offset: int = 0) -> dict[str, Any]:
    """Сырые строки счёта из reports + pvalues, как они лежат в базе.

    Фильтры необязательные: период — точным совпадением, номер и услуга —
    подстрокой без учёта регистра. `total` считается по тем же условиям, что
    и выборка, чтобы постраничный обход не врал про остаток.
    """
    where: list[str] = []
    params: list[Any] = []
    if month:
        where.append("r.report_month = ?")
        params.append(month)
    if number:
        where.append("r.subscriber_id LIKE ?")
        params.append(f"%{number}%")
    if service:
        # lower() с обеих сторон: в счетах одна и та же услуга приходит то
        # «Автоответчик», то «АВТООТВЕТЧИК», искать это глазами невозможно.
        where.append("lower(pv.service_name) LIKE lower(?)")
        params.append(f"%{service}%")
    condition = (" WHERE " + " AND ".join(where)) if where else ""

    # Границы: limit защищает от «отдай мне всё» на сотнях тысяч строк,
    # offset не должен уезжать в минус — такой запрос база не выполнит.
    limit = max(1, min(int(limit or 200), RAW_LIMIT_MAX))
    offset = max(0, int(offset or 0))

    total = int(db.scalar(
        "SELECT COUNT(*) AS n FROM pvalues pv "
        "  JOIN reports r ON r.id = pv.report_id" + condition,
        params, default=0) or 0)

    rows = db.query(
        "SELECT r.report_month, r.subscriber_id AS number, r.report_date, "
        "       r.tariff_name, r.total_charged, r.vat, "
        "       pv.service_name, pv.volume, pv.unit, "
        "       pv.no_discount, pv.discount, pv.with_discount, "
        "       pv.parameter_id, r.id AS report_id, pv.id AS value_id "
        "  FROM pvalues pv "
        "  JOIN reports r ON r.id = pv.report_id" + condition +
        " ORDER BY r.report_month DESC, r.subscriber_id, pv.id "
        " LIMIT ? OFFSET ?",
        [*params, limit, offset])

    return {
        "columns": [{"key": key, "title": title} for key, title in RAW_COLUMNS],
        "rows": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "filters": {"month": month, "number": number, "service": service},
    }


def stats() -> dict[str, Any]:
    """Диагностика: «сходятся» ли данные между таблицами."""
    return {
        "parameters": int(db.scalar("SELECT COUNT(*) AS n FROM pname", default=0) or 0),
        "users_numbers": users_count(),
        "reports_2": int(db.scalar("SELECT COUNT(*) AS n FROM reports", default=0) or 0),
        "parameter_values_2": int(db.scalar("SELECT COUNT(*) AS n FROM pvalues", default=0) or 0),
        "unmatched_services": int(db.scalar(
            "SELECT COUNT(*) AS n FROM pvalues WHERE parameter_id IS NULL", default=0) or 0),
        "months": len(months()),
        "roster_rows": roster_rows_count(),
        "linked_values": int(db.scalar(
            "SELECT COUNT(*) AS n FROM pvalues pv "
            "  JOIN reports r ON r.id = pv.report_id", default=0) or 0),
        "chip_settings": int(db.scalar("SELECT COUNT(*) AS n FROM chip_settings", default=0) or 0),
        # Считаем только строки с периодом — то же, что видно в таблице
        # командировок (см. _REAL_TRIP). Иначе сводка обещала бы записи,
        # которых на экране нет.
        "business_trips": int(db.scalar(
            f"SELECT COUNT(*) AS n FROM business_trips WHERE {_REAL_TRIP}", default=0) or 0),
        "payment_rules": int(db.scalar(
            "SELECT COUNT(*) AS n FROM payment_rules WHERE enabled = 1", default=0) or 0),
    }


# ═══════════════════════════════════════════════════════════════════════════
#  ЧИПСЫ: цвета-правила, настройки номера, пометки
#
#  «Чипс» — это карточка абонента на главной странице. У неё есть постоянные
#  настройки, которые не зависят от месяца и от того, какой счёт загружен:
#  цвет (он же правило), заметка, пометки и ручное указание плательщика.
# ═══════════════════════════════════════════════════════════════════════════

#  ЕДИНОЕ ХРАНИЛИЩЕ ПРАВИЛ.
#  Раньше было две таблицы-близнеца: chip_colors и chip_marks. Поля у них
#  совпадали полностью, различие было ровно одно: цвет у номера один, пометок
#  много. Миграцией _migrate_chip_rules (db.py) обе слиты в chip_rules, а
#  привязка номеров — в chip_rule_links. Различает их поле kind:
#      kind='color' — красит карточку, у номера действует ОДИН;
#      kind='mark'  — их можно навесить сколько угодно.
#  Старые таблицы намеренно не удалены: пока не проверим на боевых данных,
#  они наш путь отката.

def get_chip_rules(kind: str = "") -> list[dict[str, Any]]:
    """Правила чипса из chip_rules. Без аргумента — все, цвета первыми.

    Порядок: сначала цвета, потом пометки, внутри — по sort_order. Именно в
    этом порядке правила применяются в billing, поэтому сортировка задана
    здесь, а не на фронтенде.
    """
    sql = "SELECT * FROM chip_rules"
    params: list[Any] = []
    if kind:
        sql += " WHERE kind = ?"
        params.append(kind)
    sql += " ORDER BY (kind <> 'color'), sort_order, code"
    rows = db.query(sql, params)
    if not rows and not reference_materialized():
        return seeds.default_chip_rules(kind)     # база ещё пуста — см. seeds.py
    return [_bools(r, "is_excluded", "is_unlimited", "is_self_paid", "builtin")
            for r in rows]


# Разбор лимитов-признаков живёт в domain: это чистая арифметика над текстом,
# базы она не касается, а нужна и здесь (при записи правила), и в billing
# (при раскладке денег). Смотри шапку раздела в domain.py.
parse_match_limits = domain.parse_match_limits
rules_by_limit = domain.rules_by_limit


def save_chip_rule(data: dict[str, Any], kind: str = "") -> list[dict[str, Any]]:
    """Создать или изменить правило чипса (цвет или пометку).

    Одна функция на оба вида — поля у них совпадают, различает только kind.
    Если kind не передан, а правило уже есть, вид НЕ меняем: администратор
    редактирует существующее правило, а не превращает пометку в цвет.

    ПУСТОЙ code — ЭТО ЗАПРОС НА СОЗДАНИЕ, а не «найди по названию». Правку
    существующей строки интерфейс всегда шлёт с кодом, так что различить их
    можно надёжно; выводить код из названия и надеяться, что он не совпадёт
    с уже занятым, — нельзя (см. _free_code).
    """
    # Правило могли показать из памяти — до правки его надо сделать настоящим,
    # иначе сохранение одного правила оставило бы в базе ровно его одно.
    ensure_reference_data()
    asked = str(data.get("code") or "").strip()
    if asked:
        code = asked
        existing = db.query_one("SELECT kind FROM chip_rules WHERE code = ?", (code,))
    else:
        code = _free_code("chip_rules", _slug(str(data.get("label") or "rule")))
        existing = None
    kind = kind or str(data.get("kind") or "") or (existing["kind"] if existing else "mark")
    if kind not in ("color", "mark"):
        kind = "mark"

    fields = {
        "kind": kind,
        # У цвета кисть обязана быть, у пометки цвет необязателен.
        "hex": str(data.get("hex") or ("#8a9a94" if kind == "color" else "")),
        "label": str(data.get("label") or code),
        "description": str(data.get("description") or ""),
        "payer_tariff": _payer(data.get("payer_tariff")),
        "payer_options": _payer(data.get("payer_options")),
        "payer_overage": _payer(data.get("payer_overage")),
        "payer_roaming": _payer(data.get("payer_roaming")),
        "is_excluded": 1 if data.get("is_excluded") else 0,
        "is_unlimited": 1 if data.get("is_unlimited") else 0,
        "is_self_paid": 1 if data.get("is_self_paid") else 0,
        # Список нормализуем при записи, а не при чтении: в базе должно
        # лежать то, что человек увидит в поле, иначе он поправит «490,,90»
        # на «490, 90» и не поймёт, почему поле само переписалось.
        "match_limits": domain.limits_text(
            parse_match_limits(data.get("match_limits"))),
        "sort_order": domain.to_int(data.get("sort_order"), 100),
    }
    if existing:
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE chip_rules SET {sets} WHERE code = ?", [*fields.values(), code])
    else:
        columns = ", ".join(["code", *fields])
        holders = ", ".join("?" for _ in range(len(fields) + 1))
        db.execute(f"INSERT INTO chip_rules ({columns}) VALUES ({holders})",
                   [code, *fields.values()])
    return get_chip_rules()


# Код-заглушка «цвета нет». Не правило, а признак «карточка обычная»: его
# подставляет chip_settings.color_code и на него же опирается billing, когда
# цветового правила у номера не нашлось. Удалить его — оставить в базе висячие
# ссылки, поэтому он и только он защищён от удаления.
FALLBACK_COLOR = "normal"


def delete_chip_rule(code: str) -> list[dict[str, Any]]:
    """Удалить правило.

    УДАЛЯЮТСЯ И ВСТРОЕННЫЕ ТОЖЕ. Раньше запрет стоял на всех строках с
    builtin=1 — а это весь список, который человек видит: свежая база состоит
    из встроенных правил целиком. Кнопки удаления у них просто не было, и
    вкладка выглядела как справочник, прибитый гвоздями.

    Посев одноразовый (см. reference_materialized), так что удалённое
    встроенное правило обратно не вернётся.
    """
    ensure_reference_data()
    if str(code) == FALLBACK_COLOR:
        raise ValueError(
            "«Обычный» — не правило, а признак «цвета нет». Его можно "
            "переименовать и перекрасить, но не удалить")
    row = db.query_one("SELECT kind, builtin FROM chip_rules WHERE code = ?", (code,))
    if not row:
        raise ValueError("Правило не найдено")
    with db.transaction() as conn:
        # Связи с номерами уйдут сами: у chip_rule_links стоит ON DELETE CASCADE.
        # А вот старую колонку chip_settings.color_code каскад не чистит, её
        # приходится возвращать к 'normal' руками, иначе повиснет ссылка
        # на несуществующее правило.
        conn.execute("UPDATE chip_settings SET color_code = 'normal' WHERE color_code = ?", (code,))
        conn.execute("DELETE FROM chip_rules WHERE code = ?", (code,))
    return get_chip_rules()


#  ПРИВЯЗКА ПРАВИЛ К НОМЕРУ.
#  Единственный источник правды — chip_rule_links. Там лежат ВСЕ правила
#  номера: и цвет, и пометки, вперемешку. Разделяет их kind в chip_rules.
#
#  Наружу отдаём три поля, чтобы ничего не переписывать в billing:
#      rules      — полный список кодов по порядку применения;
#      color_code — первый цветовой код (им красится карточка), иначе 'normal';
#      marks      — коды пометок.
#
#  Колонка chip_settings.color_code ещё пишется, но уже НЕ читается. Это
#  зеркало для отката на предыдущий коммит. Удалим вместе со старыми таблицами.

_CHIP_DEFAULTS = {"note": "", "payer_tariff": "auto", "payer_options": "auto",
                  "payer_overage": "auto", "payer_roaming": "auto"}


def _split_rules(codes: list[str], kinds: dict[str, str]) -> dict[str, Any]:
    """Разложить коды правил номера на цвет и пометки."""
    colors = [c for c in codes if kinds.get(c) == "color"]
    return {"rules": codes,
            "color_code": colors[0] if colors else "normal",
            "marks": [c for c in codes if kinds.get(c) == "mark"]}


def _rule_kinds() -> dict[str, str]:
    return {r["code"]: r["kind"] for r in db.query("SELECT code, kind FROM chip_rules")}


def get_chip(number: str) -> dict[str, Any]:
    """Настройки одного чипса. Для ненастроенного номера — значения по умолчанию."""
    number = str(number)
    row = db.query_one("SELECT * FROM chip_settings WHERE number = ?", (number,))
    codes = [r["rule_code"] for r in db.query(
        "SELECT l.rule_code FROM chip_rule_links l "
        "  JOIN chip_rules r ON r.code = l.rule_code "
        " WHERE l.number = ? ORDER BY (r.kind <> 'color'), r.sort_order, r.code",
        (number,))]
    base = {"number": number, **_CHIP_DEFAULTS}
    if row:
        base = {**base, **{k: v for k, v in row.items() if k != "color_code"}}
    return {**base, **_split_rules(codes, _rule_kinds())}


def blank_chip(number: str) -> dict[str, Any]:
    """Чипс номера, которого никто не настраивал.

    Без обращения к базе: правил у такого номера нет по определению, а
    значит и сверять не с чем. Нужен расчёту месяца — там ненастроенных
    номеров большинство, и поход в базу за каждым стоил дороже всего
    остального расчёта вместе взятого.
    """
    return {"number": str(number), **_CHIP_DEFAULTS, **_split_rules([], {})}


def all_chips() -> dict[str, dict[str, Any]]:
    """Все настройки чипсов разом — чтобы не дёргать базу на каждый номер."""
    kinds = _rule_kinds()
    links: dict[str, list[str]] = defaultdict(list)
    for link in db.query(
            "SELECT l.number, l.rule_code FROM chip_rule_links l "
            "  JOIN chip_rules r ON r.code = l.rule_code "
            " ORDER BY (r.kind <> 'color'), r.sort_order, r.code"):
        links[link["number"]].append(link["rule_code"])

    out: dict[str, dict[str, Any]] = {}
    for r in db.query("SELECT * FROM chip_settings"):
        number = r["number"]
        row = {k: v for k, v in r.items() if k != "color_code"}
        out[number] = {**_CHIP_DEFAULTS, **row, **_split_rules(links.get(number, []), kinds)}
    # Номер мог получить правила, но не иметь своей строки настроек — он тоже нужен.
    for number, codes in links.items():
        if number not in out:
            out[number] = {"number": number, **_CHIP_DEFAULTS, **_split_rules(codes, kinds)}
    return out


def save_chip(number: str, data: dict[str, Any]) -> dict[str, Any]:
    """Сохранить настройки чипса. Меняются только переданные поля."""
    number = str(number)
    # Покраска номера — это ссылка на строку chip_rules, и внешний ключ у
    # chip_rule_links настоящий. Если правила ещё не материализованы, вставка
    # связи упадёт: «ключ (rule_code) отсутствует в таблице chip_rules».
    ensure_reference_data()
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO chip_settings (number) VALUES (?) ON CONFLICT (number) DO NOTHING",
            (number,),
        )
        sets: list[str] = []
        params: list[Any] = []
        if "color_code" in data:
            sets.append("color_code = ?")
            params.append(str(data["color_code"] or "normal"))
        if "note" in data:
            sets.append("note = ?")
            params.append(str(data["note"] or ""))
        for field in ("payer_tariff", "payer_options", "payer_overage", "payer_roaming"):
            if field in data:
                sets.append(f"{field} = ?")
                params.append(_payer(data[field]))
        if sets:
            # Не CURRENT_TIMESTAMP: колонка текстовая, а CURRENT_TIMESTAMP в
            # PostgreSQL — это timestamptz, и присвоить его тексту нельзя.
            sets.append(f"updated_at = {db.NOW_TEXT}")
            params.append(number)
            conn.execute(f"UPDATE chip_settings SET {', '.join(sets)} WHERE number = ?", params)

        # ПРАВИЛА НОМЕРА.
        # Принимаем три формы запроса, чтобы старый фронтенд не сломался:
        #   rules      — полный список кодов, заменяет всё разом (новый способ);
        #   color_code — меняет только цветовое правило, пометки не трогает;
        #   marks      — меняет только пометки, цвет не трогает.
        kinds = _rule_kinds()

        def link(codes: list[str]) -> None:
            for code in codes:
                conn.execute("INSERT INTO chip_rule_links (number, rule_code) "
                             "VALUES (?, ?) ON CONFLICT DO NOTHING", (number, str(code)))

        if "rules" in data:
            conn.execute("DELETE FROM chip_rule_links WHERE number = ?", (number,))
            link([str(c) for c in (data["rules"] or []) if str(c) in kinds])

        if "color_code" in data:
            # Цвет у номера один: снимаем все цветовые связи и ставим новую.
            conn.execute(
                "DELETE FROM chip_rule_links WHERE number = ? AND rule_code IN "
                "  (SELECT code FROM chip_rules WHERE kind = 'color')", (number,))
            code = str(data["color_code"] or "normal")
            if code and code != "normal" and kinds.get(code) == "color":
                link([code])

        if "marks" in data:
            conn.execute(
                "DELETE FROM chip_rule_links WHERE number = ? AND rule_code IN "
                "  (SELECT code FROM chip_rules WHERE kind = 'mark')", (number,))
            link([str(c) for c in (data["marks"] or []) if kinds.get(str(c)) == "mark"])
    return get_chip(number)


def _payer(value: Any) -> str:
    """Нормализовать плательщика. Всё непонятное считаем 'auto'."""
    text = str(value or "auto").strip().lower()
    return text if text in ("company", "employee", "auto") else "auto"


def _bools(row: dict[str, Any], *fields: str) -> dict[str, Any]:
    """Превратить 0/1 из базы в True/False — фронтенду так удобнее."""
    return {**row, **{f: bool(row.get(f)) for f in fields}}


# ═══════════════════════════════════════════════════════════════════════════
#  ПРАВИЛА ОПЛАТЫ ПО УСЛУГАМ
# ═══════════════════════════════════════════════════════════════════════════

def get_payment_rules(only_enabled: bool = False) -> list[dict[str, Any]]:
    where = "WHERE enabled = 1" if only_enabled else ""
    rows = db.query(f"SELECT * FROM payment_rules {where} ORDER BY priority, id")
    if not rows and not reference_materialized():
        return seeds.default_payment_rules()      # база ещё пуста — см. seeds.py
    return [_bools(r, "enabled", "builtin") for r in rows]


def _payment_rule_id(raw_id: Any) -> int | None:
    """Настоящий id правила по тому, что прислал фронтенд. None — правила нет.

    У правил, в отличие от цветов и статусов, нет естественного ключа: их
    различает только числовой id, который выдаёт база. А список правил могли
    показать ещё до первой загрузки, когда строк в базе не было вовсе, — тогда
    id пришёл ОТРИЦАТЕЛЬНЫЙ, из seeds.default_payment_rules.

    Такой id — это номер строки в seeds.PAYMENT_RULES. По ней и находим
    настоящую строку, которая к этому моменту уже лежит в базе. Искать по
    тому, что пришло из формы, нельзя: в форме условие могли как раз и
    поменять, и правка ушла бы мимо, создав дубликат.
    """
    n = domain.to_int(raw_id, 0)
    if n > 0:
        row = db.query_one("SELECT id FROM payment_rules WHERE id = ?", (n,))
    elif n < 0 and -n <= len(seeds.PAYMENT_RULES):
        seed = seeds.PAYMENT_RULES[-n - 1]
        row = db.query_one(
            "SELECT id FROM payment_rules "
            " WHERE scope = ? AND match_kind = ? AND match_value = ?",
            (seed["scope"], seed["match_kind"], seed["match_value"]))
    else:
        return None
    return int(row["id"]) if row else None


def save_payment_rule(data: dict[str, Any]) -> list[dict[str, Any]]:
    # Правило могли увидеть в списке ещё до первой загрузки — тогда оно
    # пришло из памяти и в базе его нет. Материализуем справочник целиком,
    # иначе правка одной строки стёрла бы остальные 27.
    ensure_reference_data()
    fields = {
        "priority": domain.to_int(data.get("priority"), 100),
        "enabled": 1 if data.get("enabled", True) else 0,
        "scope": str(data.get("scope") or "options"),
        "match_kind": str(data.get("match_kind") or "service"),
        "match_value": str(data.get("match_value") or "").strip().lower(),
        "payer": "employee" if str(data.get("payer")) == "employee" else "company",
        "note": str(data.get("note") or ""),
    }
    target = _payment_rule_id(data.get("id"))
    if target is not None:
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE payment_rules SET {sets} WHERE id = ?",
                   [*fields.values(), target])
    else:
        columns = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        db.execute(f"INSERT INTO payment_rules ({columns}) VALUES ({marks})",
                   list(fields.values()))
    return get_payment_rules()


def delete_payment_rule(rule_id: int) -> list[dict[str, Any]]:
    # Удалить можно и правило, которое ещё не лежит в базе, — его сначала
    # надо туда положить, иначе оставшиеся 27 так и останутся «из памяти»
    # и вернутся на экран все вместе с удалённым.
    ensure_reference_data()
    target = _payment_rule_id(rule_id)
    if target is not None:
        db.execute("DELETE FROM payment_rules WHERE id = ?", (target,))
    return get_payment_rules()


# ═══════════════════════════════════════════════════════════════════════════
#  РОУМИНГ: СТАВКИ ПО ЗОНАМ
#
#  Справочник, и только справочник. Расчёт роуминга в отчёте по этим ставкам
#  НЕ идёт: там сумма берётся из счёта как есть. Таблица нужна, чтобы было
#  с чем сверить неожиданное начисление за поездку.
# ═══════════════════════════════════════════════════════════════════════════

# Денежные поля зоны — их же правит интерфейс.
_ROAMING_RATES = ("incoming", "call_home", "call_local", "call_other",
                  "sms", "mb", "satellite")


def get_roaming_zones() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM roaming_zones ORDER BY sort_order, code")
    if not rows and not reference_materialized():
        rows = seeds.default_roaming_zones()      # база ещё пуста — см. seeds.py
    return [{**r, **{k: float(r.get(k) or 0.0) for k in _ROAMING_RATES},
             "builtin": bool(r.get("builtin"))} for r in rows]


def save_roaming_zone(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Сохранить зону. Меняются только переданные поля.

    ПОЧЕМУ НЕ «ЗАПИСАТЬ ВСЁ, ЧТО ПРИШЛО». Экран правки шлёт название и семь
    ставок — пояснения и порядка сортировки в форме нет. Пиши мы всё подряд,
    первая же поправка цены за мегабайт стирала бы пояснение зоны и роняла
    её в конец списка.
    """
    code = str(data.get("code") or "").strip().lower()
    if not code:
        raise ValueError("У зоны роуминга должен быть код")
    ensure_reference_data()
    old = db.query_one("SELECT * FROM roaming_zones WHERE code = ?", (code,)) or {}

    def keep(field: str, default: Any) -> Any:
        return old.get(field, default) if field not in data else data[field]

    fields = {
        "label": str(keep("label", code) or code),
        **{k: max(0.0, domain.to_float(keep(k, 0.0))) for k in _ROAMING_RATES},
        "note": str(keep("note", "") or ""),
        "sort_order": domain.to_int(keep("sort_order", 100), 100),
    }
    updates = ", ".join(f"{k} = excluded.{k}" for k in fields)
    columns = ", ".join(["code", *fields])
    marks = ", ".join("?" for _ in range(len(fields) + 1))
    db.execute(
        f"INSERT INTO roaming_zones ({columns}) VALUES ({marks}) "
        f"ON CONFLICT (code) DO UPDATE SET {updates}",
        [code, *fields.values()],
    )
    return get_roaming_zones()


def delete_roaming_zone(code: str) -> list[dict[str, Any]]:
    """Удалить зону. Встроенные не трогаем: это данные из тарифной сетки."""
    code = str(code or "").strip().lower()
    ensure_reference_data()
    row = db.query_one("SELECT builtin FROM roaming_zones WHERE code = ?", (code,))
    if not row:
        raise ValueError("Зона роуминга не найдена")
    if row["builtin"]:
        raise ValueError("Зона из тарифной сетки оператора — удалить нельзя, "
                         "можно только поправить ставки")
    db.execute("DELETE FROM roaming_zones WHERE code = ?", (code,))
    return get_roaming_zones()


# ═══════════════════════════════════════════════════════════════════════════
#  КОМАНДИРОВКИ
# ═══════════════════════════════════════════════════════════════════════════

# КОМАНДИРОВКОЙ СЧИТАЕТСЯ ТОЛЬКО СТРОКА С ПЕРИОДОМ.
#
# Пустая дата в pick_trip означает «границы нет» — то есть командировку без
# конца, действующую в любом месяце. Для ручной галочки это удобно и сделано
# намеренно, а вот в загруженном файле строка без периода — просто мусор:
# один раз загруженный не тем файлом список сотрудников превращал в вечно
# командированный весь парк. Условие стоит во всех местах чтения, поэтому уже
# попавший в базу мусор перестаёт влиять на расчёт и исчезает из таблицы;
# вычищается он кнопкой «Очистить все».
_REAL_TRIP = "date_start <> '' AND date_end <> '' " \
             "AND date_start IS NOT NULL AND date_end IS NOT NULL"


def save_trips(rows: list[dict[str, Any]]) -> int:
    """Сохранить строки командировок. Повторная загрузка не плодит дубли:
    ключ — (номер, дата начала, дата конца)."""
    if not rows:
        return 0
    ensure_reference_data()      # первая загрузка наполняет и справочники
    db.execute_many(
        "INSERT INTO business_trips (number, username, date_start, date_end, country, "
        "  order_no, order_date, approved, memo_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (number, date_start, date_end) DO UPDATE SET "
        "  username = excluded.username, country = excluded.country, "
        "  order_no = excluded.order_no, order_date = excluded.order_date, "
        "  approved = excluded.approved, memo_no = excluded.memo_no",
        [(str(r["number"]), r.get("username", ""), r.get("date_start", ""),
          r.get("date_end", ""), r.get("country", ""), r.get("order_no", ""),
          r.get("order_date", ""), 1 if r.get("approved") else 0, r.get("memo_no", ""))
         for r in rows],
    )
    return len(rows)


def get_trips(number: str = "") -> list[dict[str, Any]]:
    if number:
        rows = db.query(f"SELECT * FROM business_trips WHERE number = ? AND {_REAL_TRIP} "
                        " ORDER BY date_start", (str(number),))
    else:
        rows = db.query(f"SELECT * FROM business_trips WHERE {_REAL_TRIP} "
                        " ORDER BY date_start DESC, number")
    return [_bools(r, "approved") for r in rows]


def trip_for_month(number: str, month: str) -> dict[str, Any] | None:
    """Командировка этого номера, пересекающаяся с расчётным месяцем.

    Даты хранятся строками ГГГГ-ММ-ДД, поэтому сравнение первых семи символов
    и есть сравнение по месяцу. Пересечение: начало не позже конца месяца
    И конец не раньше начала месяца.
    """
    if not number or not month:
        return None
    rows = db.query(
        f"SELECT * FROM business_trips WHERE number = ? AND {_REAL_TRIP} "
        " ORDER BY approved DESC, date_start",
        (str(number),),
    )
    return pick_trip(rows, month)


def pick_trip(rows: list[dict[str, Any]], month: str) -> dict[str, Any] | None:
    """Выбрать из командировок номера ту, что попадает в расчётный месяц.

    Отбор здесь, а не в SQL, по той же причине, что и у `category_rows`:
    расчёт месяца читает командировки всего парка одним запросом. Список
    должен быть уже отсортирован «сначала утверждённые, потом по дате
    начала» — берём первую подходящую.
    """
    if not month:
        return None
    for row in rows:
        start = str(row.get("date_start") or "")
        end = str(row.get("date_end") or "")
        # Строка без периода — не командировка (см. _REAL_TRIP). Проверка
        # дублирует SQL: сюда список может прийти и не из базы.
        if not (start and end):
            continue
        if start[:7] <= month and end[:7] >= month:
            return _bools(row, "approved")
    return None


def delete_trips() -> None:
    db.execute("DELETE FROM business_trips")


# Схема должна существовать до первого запроса — таблицы, и только таблицы.
# Справочники здесь НЕ заливаются: база наполняется при первой загрузке файла
# (см. ensure_reference_data). Импорт модуля в базу ничего не пишет.
init()
