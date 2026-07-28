#!/usr/bin/env python3
"""
domain.py — прикладная логика («что означают данные»).
=============================================================================

Здесь нет ни SQL, ни HTTP — только чистые функции, которые превращают сырые
строки счёта в осмысленный отчёт: разбирают объём услуги, относят услугу к
категории (минуты / интернет / SMS), считают суммы, сравнивают потребление с
пакетами тарифа и формируют рекомендацию «оставить / повысить / понизить /
сменить тариф».

Почему это вынесено отдельно:
  * такие функции легко читать и тестировать — они не зависят от базы и сети;
  * если завтра данные придут из другого места, эта логика не изменится.

ДВЕ РАЗНЫЕ ВЕЛИЧИНЫ, КОТОРЫЕ ЛЕГКО СПУТАТЬ:
  * `limit`  — месячный ЛИМИТ РАСХОДА В РУБЛЯХ на номер. Приходит из списка
               сотрудников (колонка «Лимит» в tablespisok), а не из счёта.
               С ним сравнивается фактический расход → статус «перерасход».
  * `tariff` — тарифный план с пакетами минут / SMS / интернета. С ним
               сравнивается фактическое ПОТРЕБЛЕНИЕ → рекомендация о смене.

Обе величины считаются независимо и обе показываются в карточке абонента.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

# ═══════════════════════════════════════════════════════════════════════════
#  Единицы измерения и категории
# ═══════════════════════════════════════════════════════════════════════════

MB_IN_GB = 1024.0

CATEGORY_META: dict[str, dict[str, str]] = {
    # ИЗМЕНЕНО: эмодзи-иконки убраны. На панели из десятков карточек они
    # рябят и выглядят несерьёзно в корпоративном отчёте. Смысл категории
    # несут название и цвет полосы. Поле оставлено пустым, а не удалено,
    # чтобы не ломать формат ответа для уже написанного кода.
    "voice": {"label": "Минуты", "unit": "мин", "icon": "", "quota": "minutes"},
    "internet": {"label": "Интернет", "unit": "ГБ", "icon": "", "quota": "internet_mb"},
    "sms": {"label": "SMS", "unit": "шт", "icon": "", "quota": "sms"},
}

CATEGORY_ORDER = ("voice", "internet", "sms")


# ═══════════════════════════════════════════════════════════════════════════
#  Мелкие безопасные конвертеры
#  Значения из CSV приходят строками и иногда пустыми. Эти функции превращают
#  их в числа, никогда не падая (на мусоре возвращают значение по умолчанию).
# ═══════════════════════════════════════════════════════════════════════════

_NUM_CLEAN_RE = re.compile(r"[^\d,.\-]")


def to_float(value: Any, default: float = 0.0) -> float:
    """Строку в число. Понимает запятую и точку, пробелы-разделители разрядов."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    s = _NUM_CLEAN_RE.sub("", str(value).replace(" ", " ")).strip()
    if not s or s in {"-", ".", ","}:
        return default
    # «1 086 101,86» → «1086101.86»; «1,234.56» → «1234.56»
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        return default


def to_int(value: Any, default: int = 0) -> int:
    """Строку в целое (например «Лимит» из списка сотрудников)."""
    try:
        return int(round(to_float(value, float(default))))
    except (ValueError, TypeError, OverflowError):
        return default


def round2(value: float) -> float:
    return round(float(value) + 0.0, 2)


# ═══════════════════════════════════════════════════════════════════════════
#  Разбор объёма услуги
#  В счёте объём записан текстом: «320 мин», «3800 Мбайт», «31 шт», иногда
#  просто число или пусто. Достаём численный объём и нормализованную единицу.
# ═══════════════════════════════════════════════════════════════════════════

VOLUME_RE = re.compile(
    r"^\s*(-?[\d\s ]*[\d](?:[.,]\d+)?)\s*(шт|мин|сек|мбайт|мб|гбайт|гб|кбайт|кб|байт|б)?\s*$",
    re.IGNORECASE,
)

_UNIT_ALIASES = {
    "мб": "мбайт", "мбайт": "мбайт",
    "гб": "гбайт", "гбайт": "гбайт",
    "кб": "кбайт", "кбайт": "кбайт",
    "б": "байт", "байт": "байт",
}


def parse_volume(text: Any) -> tuple[float, str]:
    """Вернуть (объём, единица). Единицы приводим к: 'мин', 'шт', 'мбайт', …"""
    s = "" if text is None else str(text).strip()
    if not s:
        return 0.0, ""
    m = VOLUME_RE.match(s)
    if not m:
        return to_float(s), ""
    amount = to_float(m.group(1))
    unit = (m.group(2) or "").lower()
    return amount, _UNIT_ALIASES.get(unit, unit)


def volume_to_mb(amount: float, unit: str) -> float:
    """Любой объём трафика → мегабайты."""
    if unit == "гбайт":
        return amount * MB_IN_GB
    if unit == "кбайт":
        return amount / 1024.0
    if unit == "байт":
        return amount / (1024.0 * 1024.0)
    return amount  # 'мбайт' или единица не указана


def mb_to_gb(mb: float) -> float:
    return mb / MB_IN_GB


# ═══════════════════════════════════════════════════════════════════════════
#  Классификатор услуг
#  Относим строку счёта к корзине voice / internet / sms / other и определяем,
#  исходящая она или входящая (входящие не тратят пакет).
#
#  Порядок проверок важен: интернет проверяем ДО голоса, потому что «мобильный
#  интернет в роуминге» содержит слова, пересекающиеся с голосовыми услугами.
# ═══════════════════════════════════════════════════════════════════════════

INTERNET_KW = ("интернет", "трафик", "передача данных", "gprs", "data")
SMS_KW = ("sms", "смс", "сообщени", "mms", "ммс")
VOICE_KW = ("вызов", "минут", "звон", "голос", "разговор", "телефон")

# Абонентская плата по тарифному плану — «база» тарифа, а не потребление.
PLAN_FEE_KW = ("абонентская плата по тарифному плану",)

# Служебные строки-итоги: это НЕ услуги, а суммы. Если сложить их вместе с
# обычными начислениями — получим двойной счёт.
META_KW = ("итого начислено", "итого по услугам", "в том числе ндс", "в т.ч. ндс", "в т.ч ндс")

# Услуги, которые не зависят от выбора тарифного плана (опции, ВАТС, антифрод,
# массовые рассылки). Их стоимость не участвует в сравнении тарифов.
ADDON_KW = (
    "виртуальная атс", "ватс", "офис в кармане", "защита сотрудников",
    "ми.", "мобильное информирование", "детализация", "видеостриминг",
    "premium voice", "замена sim", "блокировка номера", "доставка счета",
    "дополнительный номер", "дополнительный городской номер", "автоответчик",
    "голосовая почта", "удержание вызова", "запрет развлекательного",
    "бизнес без границ", "экспресс-набор", "разовые услуги", "прочие начисления",
    "m2m",
)


def is_meta(service: str) -> bool:
    """Служебная строка-итог, которую нельзя суммировать в расход."""
    s = (service or "").lower()
    return any(k in s for k in META_KW)


def is_plan_fee(service: str) -> bool:
    """Является ли строка абонентской платой по тарифу (базой тарифа)."""
    s = (service or "").lower()
    return any(k in s for k in PLAN_FEE_KW)


def is_addon(service: str) -> bool:
    """Опция/сервис, не зависящий от тарифного плана."""
    s = (service or "").lower()
    return any(k in s for k in ADDON_KW)


def is_outgoing(service: str) -> bool:
    """Исходящая ли услуга. Входящие вызовы и SMS пакет не расходуют."""
    s = (service or "").lower()
    if "входящ" in s:
        return False
    return True


# Признаки того, что связь была ВНЕ домашнего региона.
#
# ИСПРАВЛЕНО. Раньше в списке стояло просто «международ», и под него попадала
# строка «Исходящие МЕЖДУНАРОДНЫЕ вызовы В ДОМАШНЕМ РЕГИОНЕ» — это звонок за
# границу со своего города, никакой не роуминг. Ошибка была не косметической:
# после разделения оплаты такие звонки списывались бы на компанию как
# «роуминг в командировке», хотя сотрудник никуда не уезжал.
#
# Теперь роуминг определяется только по признакам нахождения в другом месте.
ROAMING_KW = (
    "роуминг",                      # «в международном/национальном роуминге»
    "путешеств",                    # «в путешествиях по России»
    "страны пребывания",            # «на номера страны пребывания»
    "региона пребывания",           # «на номера региона пребывания»
    "за пределами домашнего региона",
)


def is_roaming(service: str) -> bool:
    """Связь вне домашнего региона (роуминг), а не просто «международная»."""
    s = (service or "").lower()
    return any(k in s for k in ROAMING_KW)


def categorize(service: str, category: str = "", service_type: str = "", unit: str = "") -> str:
    """Отнести услугу к корзине voice / internet / sms / other."""
    text = " ".join(x for x in (service, category, service_type) if x).lower()
    if is_plan_fee(text) or is_meta(text):
        return "other"
    if any(k in text for k in INTERNET_KW) or unit in ("мбайт", "гбайт", "кбайт", "байт"):
        return "internet"
    if any(k in text for k in SMS_KW):
        return "sms"
    if any(k in text for k in VOICE_KW) or unit == "мин":
        return "voice"
    return "other"


# ═══════════════════════════════════════════════════════════════════════════
#  Каталог тарифных планов
#
#  Значения взяты из тарифных сеток оператора:
#    * «Федеральный Специальный» — без абонентской платы, поминутная оплата:
#      0,18 ₽/мин на других операторов, 0,50 ₽/мин межгород, 0,05 ₽/SMS,
#      0,05 ₽/МБ.
#    * Пакетные тарифы 140 / 230 / 400 ₽ — включают минуты, SMS и интернет;
#      всё сверх пакета тарифицируется по тем же поминутным ставкам.
#    * Интернет-тарифы 30 / 100 / 220 / 310 / 400 ₽ — только для номеров,
#      где нет голоса и SMS (модемы, M2M, планшеты).
#
#  Каталог редактируется в интерфейсе (вкладка «Тарифы» в настройках) и
#  приходит сюда параметром, поэтому здесь он — только значение по умолчанию.
# ═══════════════════════════════════════════════════════════════════════════

RATE_MIN = 0.18       # ₽ за минуту сверх пакета
RATE_SMS = 0.05       # ₽ за SMS сверх пакета
RATE_MB = 0.05        # ₽ за МБ сверх пакета

DEFAULT_TARIFFS: list[dict[str, Any]] = [
    {
        "id": "fed_special", "name": "Федеральный Специальный",
        "kind": "voice", "fee": 0.0,
        "minutes": 0, "sms": 0, "internet_mb": 0, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "Без абонентской платы, всё по факту потребления",
    },
    {
        "id": "pack_140", "name": "Пакет 140 ₽",
        "kind": "voice", "fee": 140.0,
        "minutes": 700, "sms": 300, "internet_mb": 15000, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "700 мин · 300 SMS · 15 ГБ",
    },
    {
        "id": "pack_230", "name": "Пакет 230 ₽",
        "kind": "voice", "fee": 230.0,
        "minutes": 1500, "sms": 500, "internet_mb": 25000, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "1 500 мин · 500 SMS · 25 ГБ",
    },
    {
        "id": "pack_400", "name": "Пакет 400 ₽",
        "kind": "voice", "fee": 400.0,
        "minutes": 4000, "sms": 1000, "internet_mb": 70000, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "4 000 мин · 1 000 SMS · 70 ГБ",
    },
    {
        "id": "int_30", "name": "Интернет 30 ₽", "kind": "internet", "fee": 30.0,
        "minutes": 0, "sms": 0, "internet_mb": 1536, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "1,5 ГБ",
    },
    {
        "id": "int_100", "name": "Интернет 100 ₽", "kind": "internet", "fee": 100.0,
        "minutes": 0, "sms": 0, "internet_mb": 8192, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "8 ГБ",
    },
    {
        "id": "int_220", "name": "Интернет 220 ₽", "kind": "internet", "fee": 220.0,
        "minutes": 0, "sms": 0, "internet_mb": 15360, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "15 ГБ",
    },
    {
        "id": "int_310", "name": "Интернет 310 ₽", "kind": "internet", "fee": 310.0,
        "minutes": 0, "sms": 0, "internet_mb": 30720, "unlimited_internet": False,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "30 ГБ",
    },
    {
        "id": "int_400", "name": "Интернет 400 ₽", "kind": "internet", "fee": 400.0,
        "minutes": 0, "sms": 0, "internet_mb": 0, "unlimited_internet": True,
        "rate_min": RATE_MIN, "rate_sms": RATE_SMS, "rate_mb": RATE_MB,
        "note": "Безлимит",
    },
]


def normalize_tariff(raw: dict[str, Any]) -> dict[str, Any]:
    """Привести пришедший с фронтенда тариф к полному набору полей."""
    return {
        "id": str(raw.get("id") or raw.get("name") or "tariff"),
        "name": str(raw.get("name") or raw.get("id") or "Без названия"),
        "kind": "internet" if str(raw.get("kind", "")).lower() == "internet" else "voice",
        "fee": max(0.0, to_float(raw.get("fee"))),
        "minutes": max(0, to_int(raw.get("minutes"))),
        "sms": max(0, to_int(raw.get("sms"))),
        "internet_mb": max(0, to_int(raw.get("internet_mb"))),
        "unlimited_internet": bool(raw.get("unlimited_internet")),
        "rate_min": to_float(raw.get("rate_min"), RATE_MIN),
        "rate_sms": to_float(raw.get("rate_sms"), RATE_SMS),
        "rate_mb": to_float(raw.get("rate_mb"), RATE_MB),
        "note": str(raw.get("note") or ""),
    }


def normalize_catalog(raw: Iterable[dict[str, Any]] | None) -> list[dict[str, Any]]:
    items = [normalize_tariff(t) for t in (raw or []) if isinstance(t, dict)]
    return items or [normalize_tariff(t) for t in DEFAULT_TARIFFS]


# --- Сопоставление названия тарифа из счёта с каталогом ---------------------
# В счёте тариф записан как «Федеральный Специальный B2B», «Управляй!
# Специалист +» и т. п. Точного совпадения названия с каталогом может не быть.
#
# ПОЧЕМУ ГЛАВНЫЙ ПРИЗНАК — АБОНЕНТСКАЯ ПЛАТА, А НЕ НАЗВАНИЕ.
# Название в счёте — это маркетинговая подпись, оператор меняет её и добавляет
# суффиксы («B2B», «+», дату версии). А списанная абонплата — твёрдый факт из
# того же счёта. Поэтому сначала ищем тариф с такой же ценой, и уже среди них
# уточняем по названию. Если абонплаты нет вовсе — это тариф без абонплаты.

def _norm_name(text: str) -> str:
    return " ".join(str(text or "").lower().replace("ё", "е").split())


def match_tariff(plan_name: str, plan_fee: float,
                 catalog: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Найти в каталоге тариф абонента. Возвращает копию с полем `matched_by`."""
    if not catalog:
        return None
    name = _norm_name(plan_name)
    fee = to_float(plan_fee)

    def by_name(pool: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not name:
            return None
        for t in pool:
            if _norm_name(t["name"]) == name:
                return t
        for t in pool:
            tn = _norm_name(t["name"])
            if tn and (tn in name or name in tn):
                return t
        return None

    same_fee = [t for t in catalog if abs(t["fee"] - fee) <= 0.51]
    if same_fee:
        hit = by_name(same_fee) or same_fee[0]
        return {**hit, "matched_by": "fee+name" if by_name(same_fee) else "fee"}

    hit = by_name(catalog)
    if hit:
        # Название нашлось, но цена в счёте другая — доверяем счёту.
        return {**hit, "fee": round2(fee), "matched_by": "name"}

    nearest = min(catalog, key=lambda t: abs(t["fee"] - fee))
    return {**nearest, "fee": round2(fee), "matched_by": "nearest-fee"}


# ═══════════════════════════════════════════════════════════════════════════
#  Стоимость потребления на конкретном тарифе
# ═══════════════════════════════════════════════════════════════════════════

def estimate_cost(tariff: dict[str, Any], usage: dict[str, float]) -> dict[str, Any]:
    """Во сколько обошёлся бы ЭТОТ месяц на ЭТОМ тарифе.

    Считаем только тарифозависимую часть: абонплата + перерасход по минутам,
    SMS и интернету. Опции (ВАТС, антифрод, роуминговые пакеты) не зависят от
    тарифа и в сравнение не входят — иначе тарифы сравнивались бы нечестно.
    """
    minutes = max(0.0, usage.get("voice_min", 0.0))
    sms = max(0.0, usage.get("sms_cnt", 0.0))
    mb = max(0.0, usage.get("internet_mb", 0.0))

    over_min = max(0.0, minutes - tariff["minutes"])
    over_sms = max(0.0, sms - tariff["sms"])
    over_mb = 0.0 if tariff["unlimited_internet"] else max(0.0, mb - tariff["internet_mb"])

    cost_min = over_min * tariff["rate_min"]
    cost_sms = over_sms * tariff["rate_sms"]
    cost_mb = over_mb * tariff["rate_mb"]
    total = tariff["fee"] + cost_min + cost_sms + cost_mb

    return {
        "tariff_id": tariff["id"],
        "tariff_name": tariff["name"],
        "kind": tariff["kind"],
        "fee": round2(tariff["fee"]),
        "total": round2(total),
        "over_min": round2(over_min),
        "over_sms": round2(over_sms),
        "over_mb": round2(over_mb),
        "cost_min": round2(cost_min),
        "cost_sms": round2(cost_sms),
        "cost_mb": round2(cost_mb),
        "overuse": sum(1 for x in (over_min, over_sms, over_mb) if x > 0),
        "note": tariff["note"],
    }


def _fits_internet_only(usage: dict[str, float]) -> bool:
    """Похож ли номер на модем/M2M: интернет есть, голоса и SMS практически нет."""
    return (usage.get("voice_min", 0.0) <= 5.0
            and usage.get("sms_cnt", 0.0) <= 5.0
            and usage.get("internet_mb", 0.0) > 0.0)


def compare_tariffs(usage: dict[str, float], catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Оценка месяца на каждом подходящем тарифе, от дешёвого к дорогому."""
    kind = "internet" if _fits_internet_only(usage) else "voice"
    candidates = [t for t in catalog if t["kind"] == kind] or catalog
    estimates = [estimate_cost(t, usage) for t in candidates]
    estimates.sort(key=lambda e: (e["total"], e["fee"]))
    return estimates


# ═══════════════════════════════════════════════════════════════════════════
#  Рекомендация по тарифу
# ═══════════════════════════════════════════════════════════════════════════

def category_verdict(used: float, quota: float, cost: float, *,
                     has_tariff: bool, pay_per_use: bool = False,
                     key: str = "voice") -> dict[str, Any]:
    """Вердикт по одной категории: перерасход / недоиспользование / норма.

    ГЛАВНЫЙ ПРИЗНАК ПЕРЕРАСХОДА — ДЕНЬГИ В СЧЁТЕ, А НЕ НАШ РАСЧЁТ.
    Размеры пакетов в каталоге — это наше предположение, оператор мог
    подключить опцию или акцию. А начисление по категории — факт: если за
    интернет списано 0 ₽, то сколько бы гигабайт ни было использовано,
    перерасхода не было — они покрыты пакетом. И наоборот: любое начисление
    сверх абонплаты означает, что пакета не хватило.
    """
    ratio = (used / quota) if quota > 0 else 0.0

    if pay_per_use:
        return {"type": "payg", "ratio": 0.0, "label": "по факту",
                "text": f"Тариф без пакета: оплачивается фактическое потребление "
                        f"({fmt_amount(used, key)} на {cost:.2f} ₽)."}

    if not has_tariff or quota <= 0:
        label, kind = ("вне пакета", "extra") if cost > 0 else ("в пакете", "ok")
        return {"type": kind, "ratio": 0.0, "label": label,
                "text": f"{fmt_amount(used, key)}, начислено {cost:.2f} ₽. "
                        f"Пакет по этой категории не подключён."}

    if used > quota and cost > 0:
        return {"type": "over", "ratio": round(ratio, 3), "label": "перерасход",
                "text": f"Пакет {fmt_amount(quota, key)} исчерпан: использовано "
                        f"{fmt_amount(used, key)}, сверх пакета начислено {cost:.2f} ₽."}

    if used > quota:
        # Пакет по каталогу исчерпан, но начислений нет: реальный пакет больше,
        # чем мы предполагаем (подключена опция, акция или безлимит).
        return {"type": "ok", "ratio": round(ratio, 3), "label": "в пакете",
                "text": f"Использовано {fmt_amount(used, key)} при пакете "
                        f"{fmt_amount(quota, key)}, но начислений нет — фактический "
                        f"пакет больше указанного в каталоге."}

    if cost > 0:
        # Потребление внутри пакета, а деньги списаны: это услуги, которые
        # пакет не покрывает (межгород, роуминг, спецномера).
        return {"type": "extra", "ratio": round(ratio, 3), "label": "вне пакета",
                "text": f"Пакет использован на {ratio * 100:.0f}%, но {cost:.2f} ₽ "
                        f"начислено отдельно — это услуги вне пакета "
                        f"(межгород, роуминг, короткие номера)."}

    if used <= 0:
        return {"type": "under", "ratio": 0.0, "label": "не используется",
                "text": f"Пакет {fmt_amount(quota, key)} не используется совсем."}

    if ratio < 0.4:
        return {"type": "under", "ratio": round(ratio, 3), "label": "недоиспользование",
                "text": f"Использовано всего {ratio * 100:.0f}% пакета — пакет избыточен."}

    return {"type": "ok", "ratio": round(ratio, 3), "label": "норма",
            "text": f"Использовано {ratio * 100:.0f}% пакета — объём подобран верно."}


# Меньшую выгоду считаем шумом: ради 30 ₽ переводить сотрудника на другой
# тариф нет смысла, а расхождение такого порядка легко даёт сама модель.
MIN_SAVING_RUB = 30.0
MIN_SAVING_SHARE = 0.10


def _covers_usage(estimate: dict[str, Any], usage: dict[str, float],
                  catalog: list[dict[str, Any]]) -> bool:
    """Вмещает ли пакет предлагаемого тарифа фактическое потребление.

    Нужна, чтобы не советовать понижение тому, кто уже не помещается в свой
    пакет. Логика по категориям:

      * пакет = 0  — у тарифа нет пакета по этой категории, всё оплачивается
        по факту. Ограничивать нечего, считаем что «вмещает»;
      * безлимитный интернет — вмещает всегда;
      * иначе пакет должен покрывать фактический объём.
    """
    tariff = next((t for t in catalog if t["id"] == estimate["tariff_id"]), None)
    if tariff is None:
        return False

    if tariff["minutes"] > 0 and usage.get("voice_min", 0.0) > tariff["minutes"]:
        return False
    if tariff["sms"] > 0 and usage.get("sms_cnt", 0.0) > tariff["sms"]:
        return False
    if (not tariff["unlimited_internet"] and tariff["internet_mb"] > 0
            and usage.get("internet_mb", 0.0) > tariff["internet_mb"]):
        return False
    return True


def build_recommendation(
    usage: dict[str, float],
    catalog: list[dict[str, Any]],
    current: dict[str, Any] | None,
    actual_tariff_cost: float,
    avg_tariff_cost: float | None = None,
    categories: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Сформировать рекомендацию «оставить / повысить / понизить / сменить».

    ЧТО С ЧЕМ СРАВНИВАЕТСЯ.
    Слева — ФАКТ: тарифозависимая часть счёта (абонплата + начисления за
    минуты, SMS и интернет). Это точная сумма, которую компания уже заплатила.
    Справа — МОДЕЛЬ: во сколько обошлось бы то же потребление на каждом тарифе
    каталога. Модель применяется только к альтернативам, потому что для них
    факта не существует.

    Отсюда важное следствие: рекомендация выдаётся только если модель
    ПОБЕЖДАЕТ факт с запасом. Если наш каталог неточен (у абонента подключена
    опция, о которой мы не знаем), модель будет дороже факта — и мы честно
    оставим тариф как есть, а не придумаем несуществующую экономию.

    Опираемся на среднее по истории (avg_tariff_cost), если она есть: один
    аномальный месяц не должен менять тариф.
    """
    estimates = compare_tariffs(usage, catalog)
    basis = avg_tariff_cost if (avg_tariff_cost and avg_tariff_cost > 0) else actual_tariff_cost
    basis = round2(max(0.0, basis))

    current_est = None
    if current is not None:
        current_est = next((e for e in estimates if e["tariff_id"] == current["id"]), None)
        if current_est is None:
            current_est = estimate_cost(current, usage)

    if not estimates:
        return {"action": "keep", "best": None, "current": current_est, "saving": 0.0,
                "basis": basis, "threshold": 0.0, "alternatives": [],
                "lines": ["Каталог тарифов пуст — сравнивать не с чем."]}

    best = estimates[0]
    current_fee = round2(current["fee"]) if current else 0.0
    saving = round2(basis - best["total"])
    threshold = round2(max(MIN_SAVING_RUB, basis * MIN_SAVING_SHARE))

    lines: list[str] = []
    over = [c for c in (categories or []) if c["verdict"]["type"] == "over"]
    under = [c for c in (categories or []) if c["verdict"]["type"] == "under"]

    # ═══════════════════════════════════════════════════════════════════════
    # ТРИ ЗАЩИТЫ ОТ НЕВЕРНОЙ РЕКОМЕНДАЦИИ
    #
    # Симптом, из-за которого они появились: у абонента перерасход пакета в
    # несколько раз, а система советовала ПОНИЗИТЬ тариф — причём «понизить»
    # на тот же самый тариф, где он уже сидит.
    # ═══════════════════════════════════════════════════════════════════════

    # ЗАЩИТА 1. Лучший вариант — ЭТОТ ЖЕ тариф.
    # Раньше это уходило в ветку «понизить»: абонплата одинаковая, значит
    # best.fee <= current.fee, значит «пакет избыточен». Получалось
    # «перейдите с Пакета 230 ₽ на Пакет 230 ₽ и сэкономьте 1700 ₽».
    # Разница бралась из того, что ФАКТ (реальные списания сверх пакета) выше
    # МОДЕЛИ (расчёт по ставкам каталога). Это ошибка модели, а не экономия.
    if current is not None and best["tariff_id"] == current["id"]:
        saving = 0.0

    # ЗАЩИТА 2. Каталог не описывает реальные ставки этого номера.
    # Если модель текущего тарифа сильно дешевле факта, значит оператор
    # тарифицирует перерасход не по нашим ставкам (своя опция, акция,
    # спецусловие). Тогда любая «экономия» — артефакт расчёта.
    if current_est is not None and basis > 0 and current_est["total"] < basis * 0.6:
        saving = 0.0
        lines.append(
            "Фактические списания сверх пакета заметно выше расчётных по "
            "каталогу — у номера свои тарифные условия. Рекомендация по смене "
            "тарифа не выдаётся, пока каталог не уточнён."
        )

    # ЗАЩИТА 3. Пакет предлагаемого тарифа не покрывает фактическое потребление.
    # «Понизить» имеет смысл, только если новый пакет реально вмещает то, что
    # человек тратит. Иначе мы предлагаем понижение тому, кто уже не влезает.
    if (saving >= threshold and current is not None
            and best["fee"] <= current_fee and not _covers_usage(best, usage, catalog)):
        saving = 0.0
        lines.append(
            f"Более дешёвый тариф каталога не вмещает фактическое потребление "
            f"({fmt_usage_line(usage)}) — понижение только увеличит перерасход."
        )

    if saving < threshold:
        action = "keep"
        saving = 0.0
        if lines:
            # Одна из защит уже объяснила, почему рекомендации нет.
            # Второе, бодрое «тариф оптимален» тут только запутает.
            pass
        elif current is not None and best["tariff_id"] == current["id"]:
            lines.append(
                f"Тариф «{current['name']}» — оптимальный вариант каталога при "
                f"потреблении {fmt_usage_line(usage)}. Тарифная часть счёта "
                f"{basis:.0f} ₽/мес."
            )
        elif current is not None:
            lines.append(
                f"Тариф «{current['name']}» менять не нужно: тарифная часть счёта "
                f"{basis:.0f} ₽/мес, а более дешёвого варианта при потреблении "
                f"{fmt_usage_line(usage)} в каталоге нет."
            )
        else:
            lines.append(
                f"Тариф номера по счёту не определён, но при потреблении "
                f"{fmt_usage_line(usage)} текущие {basis:.0f} ₽/мес — "
                f"это разумная сумма."
            )
    elif current is None:
        action = "switch"
        lines.append(
            f"Тариф номера не определён по счёту. При потреблении "
            f"{fmt_usage_line(usage)} выгоднее всего «{best['tariff_name']}» "
            f"({best['note']}) — около {best['total']:.0f} ₽/мес вместо "
            f"{basis:.0f} ₽, экономия {saving:.0f} ₽/мес."
        )
    elif best["fee"] > current_fee:
        action = "raise"
        lines.append(
            f"Потребление не помещается в тариф «{current['name']}»: месяц "
            f"обходится в {basis:.0f} ₽ при абонплате {current_fee:.0f} ₽. "
            f"Пакет «{best['tariff_name']}» ({best['note']}) закрыл бы "
            f"{fmt_usage_line(usage)} за {best['total']:.0f} ₽ — повышение тарифа "
            f"экономит {saving:.0f} ₽/мес."
        )
    else:
        action = "lower"
        lines.append(
            f"Пакет избыточен: тариф «{current['name']}» обходится в {basis:.0f} ₽/мес, "
            f"а фактического потребления ({fmt_usage_line(usage)}) хватает на "
            f"«{best['tariff_name']}» ({best['note']}) за {best['total']:.0f} ₽ — "
            f"экономия {saving:.0f} ₽/мес."
        )

    # Что именно уходит в перерасход — по фактическим начислениям.
    if over:
        lines.append("Сверх пакета начислено: " + ", ".join(
            f"{c['label'].lower()} — {c['cost']:.2f} ₽ ({c['used_text']})" for c in over) + ".")

    # ДОБАВЛЕНО. Без этой строки отчёт выглядит противоречиво: «тарифная часть
    # 357 ₽», а рядом «сверх пакета 1666 ₽». Разница — роуминг: он не входит
    # в сравнение тарифов, потому что стоит одинаково на любом из них.
    roaming = round2(usage.get("roaming_cost", 0.0))
    if roaming > 0:
        lines.append(
            f"Из них {roaming:.2f} ₽ — связь вне домашнего региона. Эта сумма "
            f"не зависит от тарифа и в сравнение выше не входит: сменой тарифа "
            f"её не убрать, нужен роуминговый пакет или ограничение."
        )
    if under:
        lines.append("Почти не используется: " + ", ".join(
            f"{c['label'].lower()} ({c['used_text']} из {c['quota_text']})" for c in under) + ".")

    return {
        "action": action,
        "best": best,
        "current": current_est,
        "saving": max(0.0, saving),
        "basis": basis,
        "threshold": threshold,
        "alternatives": estimates[:5],
        "lines": lines,
    }


def _used_for(usage: dict[str, float], key: str) -> float:
    return {
        "voice": usage.get("voice_min", 0.0),
        "internet": usage.get("internet_mb", 0.0),
        "sms": usage.get("sms_cnt", 0.0),
    }[key]


def fmt_amount(value: float, key: str) -> str:
    """Человекочитаемый объём: минуты, ГБ/МБ, штуки."""
    if key == "internet":
        gb = mb_to_gb(value)
        if gb >= 1:
            return f"{gb:.1f} ГБ".replace(".", ",")
        return f"{value:.0f} МБ"
    if key == "voice":
        return f"{value:.0f} мин"
    return f"{value:.0f} шт"


def money_ru(value: float) -> str:
    """Сумма в рублях с разделителем разрядов: 1 234 ₽."""
    return f"{value:,.0f} ₽".replace(",", " ")


def fmt_usage_line(usage: dict[str, float]) -> str:
    return (f"{fmt_amount(usage.get('voice_min', 0.0), 'voice')}, "
            f"{fmt_amount(usage.get('internet_mb', 0.0), 'internet')}, "
            f"{fmt_amount(usage.get('sms_cnt', 0.0), 'sms')}")


# ═══════════════════════════════════════════════════════════════════════════
#  Статус и риск относительно ДЕНЕЖНОГО лимита
# ═══════════════════════════════════════════════════════════════════════════

# «9999999» и подобные значения в списке сотрудников означают «лимит не задан».
LIMIT_SENTINEL = 1_000_000


def status_and_risk(total: float, limit: int, overuse: int = 0,
                    saving: float = 0.0) -> tuple[str, float, int]:
    """Определить критичность абонента.

    Возвращает (статус, отношение расхода к лимиту, индекс риска 0..100).

    * лимит задан → сравниваем расход с лимитом:
        >= 125 % — 'danger', >= 100 % — 'warning', иначе 'normal';
    * лимит не задан → опираемся на долю счёта, которую можно сэкономить
      сменой тарифа, и на число категорий в перерасходе.
    """
    if limit <= 0 or limit >= LIMIT_SENTINEL:
        # Лимита нет — сравнивать расход не с чем. Тогда критичность
        # определяет потенциал экономии: чем большую долю счёта можно убрать
        # сменой тарифа, тем хуже подобран тариф.
        share = (saving / total) if total > 0 else 0.0
        if share >= 0.30:
            return "danger", 0.0, min(100, round(share * 100))
        if share >= 0.10 or overuse >= 2:
            return "warning", 0.0, max(40, min(100, round(share * 100)))
        return "normal", 0.0, max(5, round(share * 100))
    ratio = total / limit
    if ratio >= 1.25:
        status = "danger"
    elif ratio >= 1.0:
        status = "warning"
    else:
        status = "normal"
    risk = max(0, min(100, round(ratio * 100)))
    return status, round(ratio, 3), risk


# ═══════════════════════════════════════════════════════════════════════════
#  Сборка записи абонента
# ═══════════════════════════════════════════════════════════════════════════

def aggregate_usage(items: list[dict[str, Any]]) -> dict[str, float]:
    """Суммарное ИСХОДЯЩЕЕ потребление по категориям за месяц.

    Входящие вызовы и SMS пакет не расходуют, поэтому в потребление не идут —
    но их объём мы сохраняем отдельно, он полезен в карточке.
    """
    usage = {
        "voice_min": 0.0, "voice_in_min": 0.0,
        "sms_cnt": 0.0, "sms_in_cnt": 0.0,
        "internet_mb": 0.0, "roaming_cost": 0.0,
    }
    for it in items:
        cat, unit, vol = it["cat"], it["unit"], it["volume"]
        outgoing = it["outgoing"]
        if is_roaming(it["service"]):
            usage["roaming_cost"] += it["cost"]
        if cat == "voice" and unit == "мин":
            usage["voice_min" if outgoing else "voice_in_min"] += vol
        elif cat == "sms" and unit in ("шт", ""):
            usage["sms_cnt" if outgoing else "sms_in_cnt"] += vol
        elif cat == "internet":
            usage["internet_mb"] += volume_to_mb(vol, unit)
    return {k: round2(v) for k, v in usage.items()}


def category_breakdown(items: list[dict[str, Any]], usage: dict[str, float],
                       tariff: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Разбивка по категориям: сколько потрачено, использовано и вердикт.

    В стоимость категории идут только услуги связи — опции (ВАТС, антифрод,
    информирование) считаются отдельно, иначе абонентская плата за опцию
    выглядела бы как перерасход по минутам.
    """
    cost = {c: 0.0 for c in CATEGORY_ORDER}
    for it in items:
        if it["cat"] in cost and not is_addon(it["service"]):
            cost[it["cat"]] += it["cost"]

    # Тариф без единого пакета (например «Федеральный Специальный») —
    # там любое начисление это норма работы тарифа, а не перерасход.
    pay_per_use = bool(tariff and not tariff["unlimited_internet"]
                       and tariff["minutes"] == 0 and tariff["sms"] == 0
                       and tariff["internet_mb"] == 0)

    result = []
    for key in CATEGORY_ORDER:
        meta = CATEGORY_META[key]
        used = _used_for(usage, key)
        unlimited = bool(tariff and key == "internet" and tariff["unlimited_internet"])
        quota = float(tariff[meta["quota"]]) if tariff else 0.0
        verdict = ({"type": "ok", "ratio": 0.0, "label": "безлимит",
                    "text": "Безлимитный интернет — перерасход невозможен."}
                   if unlimited else
                   category_verdict(used, quota, round2(cost[key]),
                                    has_tariff=tariff is not None,
                                    pay_per_use=pay_per_use, key=key))
        result.append({
            "key": key,
            "label": meta["label"],
            "unit": meta["unit"],
            "icon": meta["icon"],
            "used": round2(used),
            "used_text": fmt_amount(used, key),
            "quota": round2(quota),
            "quota_text": "безлимит" if unlimited else (fmt_amount(quota, key) if quota else "—"),
            "unlimited": unlimited,
            "cost": round2(cost[key]),
            "ratio": verdict["ratio"],
            "verdict": verdict,
        })
    return result


def build_record(
    number: str,
    items: list[dict[str, Any]],
    *,
    month: str = "",
    profile: dict[str, Any] | None = None,
    catalog: list[dict[str, Any]] | None = None,
    plan_name: str = "",
    total_charged: float | None = None,
    avg_total: float | None = None,
    avg_tariff_cost: float | None = None,
) -> dict[str, Any]:
    """Собрать итоговую запись абонента за один месяц.

    `items` — позиции счёта (уже без строк-итогов).
    `profile` — данные из списка сотрудников: ФИО, лимит, должность, …
    `total_charged` — «Итого начислено» из счёта: если оператор его прислал,
    это авторитетная сумма, а не наша сумма строк.
    """
    catalog = catalog or normalize_catalog(None)
    profile = profile or {}

    items_sum = round2(sum(it["cost"] for it in items))
    plan_fee = round2(sum(it["cost"] for it in items if is_plan_fee(it["service"])))
    addons_cost = round2(sum(it["cost"] for it in items
                             if is_addon(it["service"]) and not is_plan_fee(it["service"])))

    total = round2(total_charged) if (total_charged is not None and total_charged > 0) else items_sum
    discrepancy = round2(total - items_sum)

    usage = aggregate_usage(items)

    # Тарифозависимая часть: абонплата + начисления по минутам/SMS/интернету.
    #
    # ИСПРАВЛЕНО: из этой суммы ИСКЛЮЧЁН РОУМИНГ.
    # Почему это была ошибка. Роуминг не покрывается пакетом и стоит одинаково
    # на любом тарифе — сменой тарифа его не убрать. Но раньше он попадал в
    # «тарифозависимую часть», то есть в ФАКТ, с которым сравниваются модели
    # альтернативных тарифов. Модель роуминг посчитать не может, поэтому у
    # любого номера с роумингом факт оказывался завышен на сумму роуминга —
    # и система показывала несуществующую экономию и предлагала менять тариф
    # там, где менять нечего. Роуминг считается отдельно (roaming_cost).
    usage_cost = round2(sum(it["cost"] for it in items
                            if it["cat"] in CATEGORY_ORDER
                            and not is_addon(it["service"])
                            and not is_roaming(it["service"])))
    tariff_cost = round2(plan_fee + usage_cost)

    tariff = match_tariff(plan_name, plan_fee, catalog)
    categories = category_breakdown(items, usage, tariff)
    recommendation = build_recommendation(usage, catalog, tariff, tariff_cost,
                                          avg_tariff_cost, categories)

    overuse = sum(1 for c in categories if c["verdict"]["type"] == "over")
    underuse = sum(1 for c in categories if c["verdict"]["type"] == "under")

    # ЛИМИТ СРАВНИВАЕТСЯ С ФАКТОМ МЕСЯЦА, А НЕ СО СРЕДНИМ.
    # Лимит — это месячный потолок расхода. Если в январе потрачено больше —
    # это свершившийся факт, и усреднение по истории его бы спрятало. Среднее
    # мы считаем отдельно и используем только чтобы отличить разовый всплеск
    # от систематического превышения (`chronic`).
    limit = to_int(profile.get("limit"))
    has_limit = 0 < limit < LIMIT_SENTINEL
    status, ratio, risk = status_and_risk(total, limit, overuse,
                                          recommendation["saving"])
    overpayment = round2(max(0.0, total - limit)) if has_limit else 0.0
    avg_overpayment = (round2(max(0.0, avg_total - limit))
                       if has_limit and avg_total else 0.0)

    # КОМАНДИРОВКА — ОБЪЯСНЁННЫЙ ПЕРЕРАСХОД, А НЕ НАРУШЕНИЕ.
    # В поездке роуминг и межгород неизбежны, и если превышение лимита
    # объясняется именно ими, отмечать номер как критичный неправильно —
    # иначе список «требуют внимания» забьётся командированными.
    on_trip = bool(profile.get("on_trip"))
    roaming_cost = usage.get("roaming_cost", 0.0)
    trip_explained = bool(on_trip and overpayment > 0 and roaming_cost >= overpayment * 0.5)
    if trip_explained and status == "danger":
        status = "warning"
        risk = min(risk, 60)
    if trip_explained:
        recommendation["lines"].append(
            f"Абонент в командировке: {money_ru(roaming_cost)} из превышения "
            f"{money_ru(overpayment)} — роуминг и связь вне домашнего региона."
        )

    return {
        "number": number,
        "username": profile.get("username", ""),
        "position": profile.get("position", ""),
        "personnel_no": profile.get("personnel_no", ""),
        "note": profile.get("note", ""),
        "user_status": profile.get("status", "normal"),
        "is_business_trip": bool(profile.get("is_business_trip")),
        "on_trip": on_trip,
        "trip_start_date": profile.get("trip_start_date", ""),
        "trip_end_date": profile.get("trip_end_date", ""),
        "trip_explained": trip_explained,
        "roaming_cost": round2(roaming_cost),
        "limit": limit if limit < LIMIT_SENTINEL else 0,
        "limit_set": 0 < limit < LIMIT_SENTINEL,
        "month": month,
        "plan_name": plan_name or (tariff["name"] if tariff else ""),
        "plan_fee": plan_fee,
        "tariff": tariff,
        "total": total,
        "items_sum": items_sum,
        "discrepancy": discrepancy if abs(discrepancy) > 1.0 else 0.0,
        "tariff_cost": tariff_cost,
        "addons_cost": addons_cost,
        "usage": usage,
        "categories": categories,
        "overuse": overuse,
        "underuse": underuse,
        "overpayment": overpayment,
        "avg_total": round2(avg_total) if avg_total else 0.0,
        "avg_overpayment": avg_overpayment,
        # Превышение не разовое, а из месяца в месяц — такой номер важнее.
        "chronic": bool(has_limit and avg_overpayment > 0),
        "ratio": ratio,
        "status": status,
        "risk": risk,
        "saving": recommendation["saving"],
        "recommendation": recommendation,
        "services": [
            {"service": it["service"], "cat": it["cat"], "unit": it["unit"],
             "volume": round2(it["volume"]), "raw_volume": it.get("raw_volume", ""),
             "cost": round2(it["cost"]), "no_discount": round2(it.get("no_discount", 0.0)),
             "discount": round2(it.get("discount", 0.0))}
            for it in sorted(items, key=lambda x: x["cost"], reverse=True)
        ],
    }


# ═══════════════════════════════════════════════════════════════════════════
#  Сводка (KPI верхней панели)
# ═══════════════════════════════════════════════════════════════════════════

def build_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    """KPI для верхней панели: считаются из уже собранного списка записей."""
    count = len(records)
    total_cost = round2(sum(r["total"] for r in records))
    total_overpay = round2(sum(r["overpayment"] for r in records))
    total_saving = round2(sum(r["saving"] for r in records))
    critical = sum(1 for r in records if r["status"] == "danger")
    warning = sum(1 for r in records if r["status"] == "warning")
    overuse = sum(1 for r in records if r["overuse"] > 0)
    underuse = sum(1 for r in records if r["underuse"] > 0 and r["overuse"] == 0)

    by_action: dict[str, int] = {}
    for r in records:
        action = r["recommendation"]["action"]
        by_action[action] = by_action.get(action, 0) + 1

    return {
        "subscribers": count,
        "total_cost": total_cost,
        "total_overpay": total_overpay,
        "economy_potential": total_saving,
        "critical": critical,
        "warning": warning,
        "overuse": overuse,
        "underuse": underuse,
        "avg_cost": round2(total_cost / count) if count else 0.0,
        "risk_index": round(critical / count * 100) if count else 0,
        "by_action": by_action,
    }


def build_tariff_stats(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Сводка по тарифам: сколько абонентов, средний расход, потенциал экономии."""
    stats: dict[str, dict[str, Any]] = {}
    for r in records:
        name = r["plan_name"] or "Тариф не определён"
        st = stats.setdefault(name, {
            "name": name, "count": 0, "total_cost": 0.0, "saving": 0.0,
            "overuse": 0, "underuse": 0, "fee": r["plan_fee"],
        })
        st["count"] += 1
        st["total_cost"] += r["total"]
        st["saving"] += r["saving"]
        st["overuse"] += 1 if r["overuse"] else 0
        st["underuse"] += 1 if (r["underuse"] and not r["overuse"]) else 0

    out = []
    for st in stats.values():
        n = st["count"] or 1
        out.append({
            "name": st["name"],
            "count": st["count"],
            "fee": round2(st["fee"]),
            "total_cost": round2(st["total_cost"]),
            "avg_cost": round2(st["total_cost"] / n),
            "saving": round2(st["saving"]),
            "avg_saving": round2(st["saving"] / n),
            "overuse": st["overuse"],
            "underuse": st["underuse"],
        })
    out.sort(key=lambda x: x["count"], reverse=True)
    return out
