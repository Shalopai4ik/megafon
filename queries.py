#!/usr/bin/env python3
"""
queries.py — ВЕСЬ доступ к данным в одном месте.
=============================================================================

ЧТО ИЗМЕНИЛОСЬ (важно понимать при чтении кода)
-----------------------------------------------
Раньше «база» была списками словарей в памяти: всё терялось при перезапуске
сервера. Теперь под этим файлом лежит настоящая база (db.py, SQLite по схеме
из database.txt.txt), и каждая функция ниже — это реальный SQL-запрос.

Что это даёт на практике:
    * настройки чипсов, пометки, правила и командировки переживают рестарт;
    * данные видны снаружи обычным SQL-клиентом;
    * переезд на боевой PostgreSQL — это замена драйвера в db.py.

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


def init() -> None:
    """Создать схему, залить справочники. Безопасно вызывать повторно."""
    db.connect()
    seeds.ensure_seeds()
    _seed_parameters()
    _seed_tariffs()
    _reload_param_index()


def _seed_parameters() -> None:
    """Залить справочник услуг в pname (только отсутствующие строки)."""
    have = {r["description"] for r in db.query("SELECT description FROM pname")}
    new = [(name, cat) for name, cat in PARAMETERS_LIST if name not in have]
    if new:
        db.execute_many(
            "INSERT INTO pname (description, category, service_type) VALUES (?, ?, '')",
            new,
        )


def _seed_tariffs() -> None:
    """Залить каталог тарифов, если он пуст."""
    if db.scalar("SELECT COUNT(*) AS n FROM tariff_plans", default=0):
        return
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


def all_parameters() -> list[dict[str, Any]]:
    rows = db.query("SELECT id, description, category, service_type FROM pname ORDER BY id")
    # Ключ "name" оставлен для совместимости с прежним кодом.
    return [{**r, "name": r["description"]} for r in rows]


# ═══════════════════════════════════════════════════════════════════════════
#  Абоненты (users_numbers)
# ═══════════════════════════════════════════════════════════════════════════

def upsert_user(number: str, *, username: str = "", limit: int | None = None,
                position: str = "", personnel_no: str = "", note: str = "") -> dict[str, Any]:
    """Создать или обновить карточку абонента.

    Пустые поля НЕ затирают старые: повторная загрузка списка без колонки
    «Должность» не должна стирать уже проставленные должности. А вот статус и
    командировка сюда не приходят — их выставляют вручную через настройки,
    и загрузка файла их не трогает.
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
    return get_user(number) or {}


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
        upsert_user(number)

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
    if user and user.get("is_business_trip"):
        start = str(user.get("trip_start_date") or "")
        end = str(user.get("trip_end_date") or "")
        if not month or (not start and not end):
            return True
        if not (start and start[:7] > month) and not (end and end[:7] < month):
            return True

    if user and month and trip_for_month(str(user.get("number") or ""), month):
        return True
    return False


def get_profile(number: str, month: str = "") -> dict[str, Any]:
    """Профиль абонента для domain.build_record."""
    user = get_user(number)
    if not user:
        return {}
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
        "on_trip": on_business_trip(user, month),
    }


def all_users() -> list[dict[str, Any]]:
    return db.query("SELECT * FROM users_numbers ORDER BY number")


def users_count() -> int:
    return int(db.scalar("SELECT COUNT(*) AS n FROM users_numbers", default=0) or 0)


# ═══════════════════════════════════════════════════════════════════════════
#  Справочник статусов
# ═══════════════════════════════════════════════════════════════════════════

def get_statuses() -> list[dict[str, Any]]:
    rows = db.query("SELECT id, label, color, builtin FROM app_statuses ORDER BY sort_order, id")
    return [{**r, "builtin": bool(r["builtin"])} for r in rows]


# Идентификатор статуса участвует в data-атрибутах и селекторах на фронтенде,
# поэтому кириллицу транслитерируем: «Декрет» → «dekret».
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
    return slug or "status"


def save_status(status: dict[str, Any], previous_id: str = "") -> list[dict[str, Any]]:
    """Создать статус или переименовать/перекрасить существующий."""
    label = str(status.get("label") or "").strip()
    color = str(status.get("color") or "#6b7a74")
    if not label:
        raise ValueError("Название статуса не может быть пустым")

    with _LOCK:
        if previous_id:
            existing = db.query_one("SELECT * FROM app_statuses WHERE id = ?", (previous_id,))
            if existing:
                # Идентификатор не меняем даже при переименовании: на него
                # ссылаются карточки абонентов (users_numbers.status).
                db.execute("UPDATE app_statuses SET label = ?, color = ? WHERE id = ?",
                           (label, color, previous_id))
                return get_statuses()

        base = _slug(label)
        new_id = base
        n = 2
        while db.query_one("SELECT id FROM app_statuses WHERE id = ?", (new_id,)):
            new_id = f"{base}_{n}"
            n += 1
        order = int(db.scalar("SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM app_statuses",
                              default=10) or 10)
        db.execute(
            "INSERT INTO app_statuses (id, label, color, builtin, sort_order) VALUES (?, ?, ?, 0, ?)",
            (new_id, label, color, order),
        )
    return get_statuses()


def delete_status(status_id: str) -> list[dict[str, Any]]:
    """Удалить пользовательский статус. Абоненты с ним переходят в «Норма»."""
    row = db.query_one("SELECT * FROM app_statuses WHERE id = ?", (status_id,))
    if not row:
        raise ValueError("Статус не найден")
    if row["builtin"]:
        raise ValueError("Встроенный статус удалить нельзя")
    with db.transaction() as conn:
        conn.execute("UPDATE users_numbers SET status = 'normal' WHERE status = ?", (status_id,))
        conn.execute("DELETE FROM app_statuses WHERE id = ?", (status_id,))
    return get_statuses()


# ═══════════════════════════════════════════════════════════════════════════
#  Счета (reports + pvalues)
# ═══════════════════════════════════════════════════════════════════════════

def save_report(number: str, month: str, items: list[dict[str, Any]], *,
                report_date: str = "", plan_name: str = "",
                total_charged: float = 0.0, vat: float = 0.0) -> int:
    """Сохранить счёт абонента за месяц.

    Повторная загрузка того же месяца полностью заменяет прежние строки — так
    двойной загрузкой файла нельзя задвоить расходы. За это отвечает
    уникальный индекс (subscriber_id, report_month) плюс удаление старых
    строк pvalues внутри одной транзакции.
    """
    number, month = str(number), str(month)
    upsert_user(number)

    with db.transaction() as conn:
        row = conn.execute(
            "SELECT id FROM reports WHERE subscriber_id = ? AND report_month = ?",
            (number, month),
        ).fetchone()

        if row:
            rid = row["id"]
            conn.execute("DELETE FROM pvalues WHERE report_id = ?", (rid,))
            conn.execute(
                "UPDATE reports SET report_date = ?, tariff_name = ?, "
                "       total_charged = ?, vat = ? WHERE id = ?",
                (report_date or month, plan_name, float(total_charged), float(vat), rid),
            )
        else:
            cur = conn.execute(
                "INSERT INTO reports (report_month, subscriber_id, report_date, "
                "                     tariff_name, total_charged, vat) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (month, number, report_date or month, plan_name,
                 float(total_charged), float(vat)),
            )
            rid = cur.lastrowid

        conn.executemany(
            "INSERT INTO pvalues (report_id, parameter_id, service_name, volume, "
            "                     no_discount, discount, with_discount) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(rid, find_parameter_id(it["service"]), it["service"],
              it.get("raw_volume", ""), float(it.get("no_discount", 0.0)),
              float(it.get("discount", 0.0)), float(it.get("cost", 0.0)))
             for it in items],
        )
    return rid


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
    out = []
    for bundle in bundles_for_number(number):
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
    merged: dict[str, dict[str, Any]] = {}
    for month, amount in get_roster_history(number).items():
        merged[month] = {"month": month, "total": round(amount, 2), "source": "roster"}
    for row in db.query(
        "SELECT r.report_month AS month, "
        "       COALESCE(NULLIF(r.total_charged, 0), "
        "         (SELECT COALESCE(SUM(with_discount), 0) FROM pvalues WHERE report_id = r.id)) AS total "
        "  FROM reports r WHERE r.subscriber_id = ?",
        (str(number),),
    ):
        merged[row["month"]] = {"month": row["month"],
                                "total": round(float(row["total"] or 0.0), 2),
                                "source": "bill"}
    return [merged[m] for m in sorted(merged)]


# ═══════════════════════════════════════════════════════════════════════════
#  Каталог тарифов
# ═══════════════════════════════════════════════════════════════════════════

def get_tariffs() -> list[dict[str, Any]]:
    """Каталог в том виде, в каком его ждут domain и фронтенд."""
    rows = db.query("SELECT * FROM tariff_plans ORDER BY sort_order, id")
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
        "business_trips": int(db.scalar("SELECT COUNT(*) AS n FROM business_trips", default=0) or 0),
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

def get_chip_colors() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM chip_colors ORDER BY sort_order, code")
    return [_bools(r, "is_excluded", "is_unlimited", "builtin") for r in rows]


def save_chip_color(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Создать или изменить цвет-правило."""
    code = str(data.get("code") or "").strip() or _slug(str(data.get("label") or "color"))
    fields = {
        "hex": str(data.get("hex") or "#8a9a94"),
        "label": str(data.get("label") or code),
        "description": str(data.get("description") or ""),
        "payer_tariff": _payer(data.get("payer_tariff")),
        "payer_options": _payer(data.get("payer_options")),
        "payer_overage": _payer(data.get("payer_overage")),
        "payer_roaming": _payer(data.get("payer_roaming")),
        "is_excluded": 1 if data.get("is_excluded") else 0,
        "is_unlimited": 1 if data.get("is_unlimited") else 0,
        "sort_order": domain.to_int(data.get("sort_order"), 100),
    }
    if db.query_one("SELECT code FROM chip_colors WHERE code = ?", (code,)):
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE chip_colors SET {sets} WHERE code = ?",
                   [*fields.values(), code])
    else:
        columns = ", ".join(["code", *fields])
        marks = ", ".join("?" for _ in range(len(fields) + 1))
        db.execute(f"INSERT INTO chip_colors ({columns}) VALUES ({marks})",
                   [code, *fields.values()])
    return get_chip_colors()


def delete_chip_color(code: str) -> list[dict[str, Any]]:
    row = db.query_one("SELECT builtin FROM chip_colors WHERE code = ?", (code,))
    if not row:
        raise ValueError("Цвет не найден")
    if row["builtin"]:
        raise ValueError("Встроенный цвет удалить нельзя — его можно переименовать и перекрасить")
    with db.transaction() as conn:
        # Номера с этим цветом возвращаем к обычному, иначе повиснет
        # ссылка на несуществующее правило.
        conn.execute("UPDATE chip_settings SET color_code = 'normal' WHERE color_code = ?", (code,))
        conn.execute("DELETE FROM chip_colors WHERE code = ?", (code,))
    return get_chip_colors()


def get_chip_marks() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM chip_marks ORDER BY sort_order, code")
    return [_bools(r, "is_excluded", "is_unlimited", "builtin") for r in rows]


def save_chip_mark(data: dict[str, Any]) -> list[dict[str, Any]]:
    code = str(data.get("code") or "").strip() or _slug(str(data.get("label") or "mark"))
    fields = {
        "label": str(data.get("label") or code),
        "hex": str(data.get("hex") or ""),
        "description": str(data.get("description") or ""),
        "payer_tariff": _payer(data.get("payer_tariff")),
        "payer_options": _payer(data.get("payer_options")),
        "payer_overage": _payer(data.get("payer_overage")),
        "payer_roaming": _payer(data.get("payer_roaming")),
        "is_excluded": 1 if data.get("is_excluded") else 0,
        "is_unlimited": 1 if data.get("is_unlimited") else 0,
        "sort_order": domain.to_int(data.get("sort_order"), 100),
    }
    if db.query_one("SELECT code FROM chip_marks WHERE code = ?", (code,)):
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE chip_marks SET {sets} WHERE code = ?", [*fields.values(), code])
    else:
        columns = ", ".join(["code", *fields])
        marks = ", ".join("?" for _ in range(len(fields) + 1))
        db.execute(f"INSERT INTO chip_marks ({columns}) VALUES ({marks})",
                   [code, *fields.values()])
    return get_chip_marks()


def delete_chip_mark(code: str) -> list[dict[str, Any]]:
    row = db.query_one("SELECT builtin FROM chip_marks WHERE code = ?", (code,))
    if not row:
        raise ValueError("Пометка не найдена")
    if row["builtin"]:
        raise ValueError("Встроенную пометку удалить нельзя")
    # Связи снимутся сами: у chip_mark_links стоит ON DELETE CASCADE.
    db.execute("DELETE FROM chip_marks WHERE code = ?", (code,))
    return get_chip_marks()


def get_chip(number: str) -> dict[str, Any]:
    """Настройки одного чипса. Для ненастроенного номера — значения по умолчанию."""
    number = str(number)
    row = db.query_one("SELECT * FROM chip_settings WHERE number = ?", (number,))
    marks = [r["mark_code"] for r in db.query(
        "SELECT mark_code FROM chip_mark_links WHERE number = ? ORDER BY mark_code", (number,))]
    if not row:
        return {"number": number, "color_code": "normal", "note": "",
                "payer_tariff": "auto", "payer_options": "auto",
                "payer_overage": "auto", "payer_roaming": "auto", "marks": marks}
    return {**row, "color_code": row["color_code"] or "normal", "marks": marks}


def all_chips() -> dict[str, dict[str, Any]]:
    """Все настройки чипсов разом — чтобы не дёргать базу на каждый номер."""
    rows = db.query("SELECT * FROM chip_settings")
    links: dict[str, list[str]] = defaultdict(list)
    for link in db.query("SELECT number, mark_code FROM chip_mark_links ORDER BY mark_code"):
        links[link["number"]].append(link["mark_code"])

    out = {r["number"]: {**r, "color_code": r["color_code"] or "normal",
                         "marks": links.get(r["number"], [])} for r in rows}
    # Номера без своей строки тоже должны иметь пометки, если их успели навесить.
    for number, mark_list in links.items():
        if number not in out:
            out[number] = {"number": number, "color_code": "normal", "note": "",
                           "payer_tariff": "auto", "payer_options": "auto",
                           "payer_overage": "auto", "payer_roaming": "auto",
                           "marks": mark_list}
    return out


def save_chip(number: str, data: dict[str, Any]) -> dict[str, Any]:
    """Сохранить настройки чипса. Меняются только переданные поля."""
    number = str(number)
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
            sets.append("updated_at = CURRENT_TIMESTAMP")
            params.append(number)
            conn.execute(f"UPDATE chip_settings SET {', '.join(sets)} WHERE number = ?", params)

        # Пометки приходят полным списком — заменяем целиком.
        if "marks" in data:
            conn.execute("DELETE FROM chip_mark_links WHERE number = ?", (number,))
            for code in data["marks"] or []:
                conn.execute(
                    "INSERT INTO chip_mark_links (number, mark_code) VALUES (?, ?) "
                    "ON CONFLICT DO NOTHING", (number, str(code)))
    return get_chip(number)


def _payer(value: Any) -> str:
    """Нормализовать плательщика. Всё непонятное считаем 'auto'."""
    text = str(value or "auto").strip().lower()
    return text if text in ("company", "employee", "auto") else "auto"


def _bools(row: dict[str, Any], *fields: str) -> dict[str, Any]:
    """Превратить 0/1 из SQLite в True/False — фронтенду так удобнее."""
    return {**row, **{f: bool(row.get(f)) for f in fields}}


# ═══════════════════════════════════════════════════════════════════════════
#  ПРАВИЛА ОПЛАТЫ ПО УСЛУГАМ
# ═══════════════════════════════════════════════════════════════════════════

def get_payment_rules(only_enabled: bool = False) -> list[dict[str, Any]]:
    where = "WHERE enabled = 1" if only_enabled else ""
    rows = db.query(f"SELECT * FROM payment_rules {where} ORDER BY priority, id")
    return [_bools(r, "enabled", "builtin") for r in rows]


def save_payment_rule(data: dict[str, Any]) -> list[dict[str, Any]]:
    fields = {
        "priority": domain.to_int(data.get("priority"), 100),
        "enabled": 1 if data.get("enabled", True) else 0,
        "scope": str(data.get("scope") or "options"),
        "match_kind": str(data.get("match_kind") or "service"),
        "match_value": str(data.get("match_value") or "").strip().lower(),
        "payer": "employee" if str(data.get("payer")) == "employee" else "company",
        "note": str(data.get("note") or ""),
    }
    rule_id = domain.to_int(data.get("id"), 0)
    if rule_id and db.query_one("SELECT id FROM payment_rules WHERE id = ?", (rule_id,)):
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE payment_rules SET {sets} WHERE id = ?", [*fields.values(), rule_id])
    else:
        columns = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        db.execute(f"INSERT INTO payment_rules ({columns}) VALUES ({marks})",
                   list(fields.values()))
    return get_payment_rules()


def delete_payment_rule(rule_id: int) -> list[dict[str, Any]]:
    db.execute("DELETE FROM payment_rules WHERE id = ?", (domain.to_int(rule_id),))
    return get_payment_rules()


# ═══════════════════════════════════════════════════════════════════════════
#  КОМАНДИРОВКИ
# ═══════════════════════════════════════════════════════════════════════════

def save_trips(rows: list[dict[str, Any]]) -> int:
    """Сохранить строки командировок. Повторная загрузка не плодит дубли:
    ключ — (номер, дата начала, дата конца)."""
    if not rows:
        return 0
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
        rows = db.query("SELECT * FROM business_trips WHERE number = ? ORDER BY date_start",
                        (str(number),))
    else:
        rows = db.query("SELECT * FROM business_trips ORDER BY date_start DESC, number")
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
        "SELECT * FROM business_trips "
        " WHERE number = ? "
        "   AND (date_start IS NULL OR date_start = '' OR substr(date_start, 1, 7) <= ?) "
        "   AND (date_end   IS NULL OR date_end   = '' OR substr(date_end,   1, 7) >= ?) "
        " ORDER BY approved DESC, date_start",
        (str(number), month, month),
    )
    return _bools(rows[0], "approved") if rows else None


def delete_trips() -> None:
    db.execute("DELETE FROM business_trips")


# Схема и справочники должны существовать до первого запроса.
init()
