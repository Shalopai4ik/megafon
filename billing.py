#!/usr/bin/env python3
"""
billing.py — КТО ЗА ЧТО ПЛАТИТ и НАСКОЛЬКО ЭТО ВЫГОДНО.
=============================================================================

ЗАЧЕМ ЭТОТ МОДУЛЬ
-----------------
Счёт оператора приходит одной суммой на номер. Но платят по нему двое:
компания и сотрудник. Модуль отвечает на два вопроса:

    1. Сколько из этой суммы наши деньги, а сколько — сотрудника?
    2. За что мы платим ВПУСТУЮ: где куплен большой пакет, которым не пользуются?

ЧЕТЫРЕ КОРЗИНЫ
--------------
Каждая строка счёта попадает ровно в одну корзину. Порядок проверки важен,
первое совпадение выигрывает:

    1) tariff   — «Абонентская плата по тарифному плану». База тарифа.
    2) roaming  — связь вне домашнего региона (проверяем ДО опций, потому что
                  роуминг — единственная корзина, на которую влияет командировка).
    3) options  — опции и сервисы: ВАТС, Защита, M2M, Офис в кармане…
    4) overage  — всё остальное: минуты, гигабайты и SMS сверх пакета.

ЦЕПОЧКА «КТО ПЛАТИТ» (сверху вниз, первое НЕ-'auto' выигрывает)
---------------------------------------------------------------
    1. Ручное указание в карточке номера   (chip_settings.payer_*)
    2. ЦВЕТ номера                          (chip_colors — цвет и есть правило)
    3. Пометки номера                       (chip_marks, по порядку сортировки)
    4. Командировка                         (только корзина roaming)
    5. Правило по названию услуги           (payment_rules, только options/overage)
    6. Умолчание самой услуги               (поле `pays` в includes.INCLUDES)

Настройки НОМЕРА сильнее правил по УСЛУГЕ: если номер помечен «Личный тариф»,
то опции на сотруднике, что бы ни говорило правило про «Офис в кармане».

Каждое решение сопровождается объяснением (`explain`), чтобы в интерфейсе
было видно не только «компания», но и ПОЧЕМУ.
"""

from __future__ import annotations

from typing import Any

import domain
import includes

COMPANY = includes.COMPANY
EMPLOYEE = includes.EMPLOYEE
AUTO = "auto"

# Порядок корзин фиксирован — в этом же порядке они показываются в интерфейсе.
BUCKETS = ("tariff", "options", "overage", "roaming")

BUCKET_LABELS = {
    "tariff": "Абонентская плата",
    "options": "Опции и сервисы",
    # НЕ «Перерасход пакета». В корзину попадает и настоящий перерасход, и
    # связь, которую пакет не покрывает в принципе (межгород, международка).
    # Пока подпись врала, номер с 368 минутами из 4000 показывал «перерасход
    # 230 ₽» — и человек не понимал, за что платит.
    "overage": "Связь сверх пакета",
    "roaming": "Роуминг",
}

# Умолчание плательщика теперь у КАЖДОЙ УСЛУГИ, а не у корзины целиком:
# в одной корзине лежат и перерасход пакета (человек), и межгород (общество).
# Смотри поле `pays` в includes.INCLUDES — там же объяснение по каждой строке.
# Это самый слабый уровень, его перебивает любое правило.
#
# Здесь остался ТОЛЬКО ярлык для ПУСТОЙ корзины: когда денег в ней нет,
# показать «кто платил бы» всё равно надо, а спрашивать не у кого — строк нет.
EMPTY_BUCKET_PAYER = {
    "tariff": COMPANY,
    "options": COMPANY,
    "overage": EMPLOYEE,
    "roaming": EMPLOYEE,
}


# ═══════════════════════════════════════════════════════════════════════════
#  Раскладка строк счёта по корзинам
# ═══════════════════════════════════════════════════════════════════════════

def bucket_of(service: str) -> str:
    """В какую корзину попадает строка счёта.

    Решает таблица includes.INCLUDES — там же порядок проверок и объяснение
    по каждому правилу. Здесь лесенки `if` больше нет: именно её молчаливое
    «всё остальное — перерасход» и отправляло международные звонки на
    сотрудника.
    """
    return domain.include_of(service).bucket


def split_by_bucket(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Разложить строки счёта по четырём корзинам.

    Корзина `skip` наружу не выходит: это строки-итоги («Итого начислено»),
    они суммы, а не услуги, и если их посчитать — счёт задвоится.
    """
    out: dict[str, list[dict[str, Any]]] = {b: [] for b in BUCKETS}
    for item in items:
        bucket = bucket_of(item.get("service", ""))
        if bucket not in out:          # skip и любая будущая нежилая корзина
            continue
        out[bucket].append(item)
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  Разрешение плательщика
# ═══════════════════════════════════════════════════════════════════════════

class PayerResolver:
    """Знает справочники (цвета, пометки, правила) и умеет отвечать на вопрос
    «кто платит за эту корзину у этого номера».

    Справочники читаются из базы ОДИН раз на построение отчёта и передаются
    сюда — иначе на каждый номер уходили бы отдельные запросы.
    """

    def __init__(self, colors: list[dict[str, Any]], marks: list[dict[str, Any]],
                 rules: list[dict[str, Any]]) -> None:
        self.colors = {c["code"]: c for c in colors}
        self.marks = {m["code"]: m for m in marks}
        # Правила отсортированы по приоритету: меньше число — раньше проверка.
        self.rules = sorted(
            (r for r in rules if r.get("enabled", True)),
            key=lambda r: (domain.to_int(r.get("priority"), 100), r.get("id") or 0),
        )

    # ── Уровень номера ────────────────────────────────────────────────────
    def chip_effects(self, chip: dict[str, Any]) -> dict[str, Any]:
        """Собрать эффекты номера: цвет + пометки + ручные переключатели.

        Возвращает готовый ответ по каждой корзине и список объяснений.
        """
        color = self.colors.get(chip.get("color_code") or "normal") or {}
        mark_codes = chip.get("marks") or []
        marks = [self.marks[c] for c in mark_codes if c in self.marks]
        marks.sort(key=lambda m: domain.to_int(m.get("sort_order"), 100))

        payers: dict[str, str] = {}
        why: dict[str, str] = {}

        for bucket in BUCKETS:
            field = f"payer_{bucket}"

            # 1. Ручное указание в карточке — самое сильное.
            manual = _norm_payer(chip.get(field))
            if manual != AUTO:
                payers[bucket] = manual
                why[bucket] = "указано вручную в карточке номера"
                continue

            # 2. Цвет номера. По решению заказчика цвет — это и есть правило.
            from_color = _norm_payer(color.get(field))
            if from_color != AUTO:
                payers[bucket] = from_color
                why[bucket] = f"цвет «{color.get('label', '—')}»"
                continue

            # 3. Пометки. Их может быть несколько; берём первую сработавшую.
            for mark in marks:
                from_mark = _norm_payer(mark.get(field))
                if from_mark != AUTO:
                    payers[bucket] = from_mark
                    why[bucket] = f"пометка «{mark.get('label', '—')}»"
                    break

        excluded = bool(color.get("is_excluded")) or any(m.get("is_excluded") for m in marks)
        unlimited = bool(color.get("is_unlimited")) or any(m.get("is_unlimited") for m in marks)

        return {
            "payers": payers,
            "why": why,
            "excluded": excluded,
            "unlimited": unlimited,
            "color": color,
            "marks": marks,
        }

    # ── Уровень услуги ────────────────────────────────────────────────────
    def rule_for_service(self, service: str, bucket: str) -> dict[str, Any] | None:
        """Первое подходящее правило по названию услуги."""
        text = (service or "").lower()
        for rule in self.rules:
            if rule.get("scope") != bucket:
                continue
            if rule.get("match_kind") != "service":
                continue
            value = str(rule.get("match_value") or "").lower()
            if value and value in text:
                return rule
        return None


def _norm_payer(value: Any) -> str:
    text = str(value or AUTO).strip().lower()
    return text if text in (COMPANY, EMPLOYEE, AUTO) else AUTO


# ═══════════════════════════════════════════════════════════════════════════
#  Главный расчёт по одному номеру
# ═══════════════════════════════════════════════════════════════════════════

def split_payment(items: list[dict[str, Any]], *, chip: dict[str, Any],
                  resolver: PayerResolver, on_trip: bool = False,
                  trip: dict[str, Any] | None = None) -> dict[str, Any]:
    """Разделить счёт номера между компанией и сотрудником.

    Возвращает: суммы по корзинам, кто за что платит, итоги и объяснения.
    """
    buckets = split_by_bucket(items)
    effects = resolver.chip_effects(chip)

    result_buckets: list[dict[str, Any]] = []
    company_total = 0.0
    employee_total = 0.0

    for bucket in BUCKETS:
        lines = buckets[bucket]
        amount = round(sum(float(i.get("cost") or 0.0) for i in lines), 2)

        # Плательщик, заданный на уровне номера (цвет / пометка / вручную).
        forced = effects["payers"].get(bucket)
        reason = effects["why"].get(bucket, "")

        if forced:
            payer = forced
            company_part = amount if payer == COMPANY else 0.0
            employee_part = amount - company_part
            detail: list[dict[str, Any]] = []

        elif bucket == "roaming" and on_trip:
            # 4. Командировка. Действует только на роуминг.
            # ПО УМОЛЧАНИЮ: утверждённая командировка переводит роуминг на
            # компанию. Граница ответственности ещё не согласована с
            # заказчиком — поведение вынесено в правило и меняется в UI.
            payer = COMPANY
            company_part, employee_part = amount, 0.0
            where = f" ({trip.get('country')})" if trip and trip.get("country") else ""
            reason = f"командировка{where}"
            detail = []

        else:
            # 5. Правила по названию услуги — построчно, потому что в одной
            #    корзине могут оказаться и корпоративные, и личные услуги.
            company_part = 0.0
            employee_part = 0.0
            detail = []
            matched_rules: list[str] = []
            for line in lines:
                cost = float(line.get("cost") or 0.0)
                if cost <= 0:
                    continue
                service = line.get("service", "")
                rule = resolver.rule_for_service(service, bucket)
                # Нет правила — берём умолчание САМОЙ УСЛУГИ, а не корзины:
                # в «Связи сверх пакета» лежат и перерасход (человек), и
                # межгород с международкой (общество).
                line_payer = rule["payer"] if rule else includes.pays_by_default(
                    domain.squash(service))
                if line_payer == COMPANY:
                    company_part += cost
                else:
                    employee_part += cost
                if rule and rule.get("note"):
                    matched_rules.append(str(rule["note"]))
                detail.append({
                    "service": line.get("service", ""),
                    "cost": round(cost, 2),
                    "payer": line_payer,
                    "rule": rule.get("match_value") if rule else "",
                })

            company_part = round(company_part, 2)
            employee_part = round(employee_part, 2)
            # Плательщик корзины целиком — только если все строки согласны.
            if company_part > 0 and employee_part > 0:
                payer = "mixed"
                reason = reason or "разные услуги — разные плательщики"
            else:
                payer = COMPANY if company_part > 0 else (
                    EMPLOYEE if employee_part > 0 else EMPTY_BUCKET_PAYER[bucket])
                reason = reason or ("правило по услуге" if matched_rules else "по умолчанию")

        company_total += company_part
        employee_total += employee_part
        result_buckets.append({
            "key": bucket,
            "label": BUCKET_LABELS[bucket],
            "amount": amount,
            "payer": payer,
            "company": round(company_part, 2),
            "employee": round(employee_part, 2),
            "reason": reason,
            "lines": detail,
        })

    return {
        "buckets": result_buckets,
        "company_pays": round(company_total, 2),
        "employee_pays": round(employee_total, 2),
        "excluded": effects["excluded"],
        "unlimited": effects["unlimited"],
        "color": {
            "code": effects["color"].get("code", "normal"),
            "hex": effects["color"].get("hex", ""),
            "label": effects["color"].get("label", ""),
        },
        "marks": [{"code": m["code"], "label": m["label"], "hex": m.get("hex", "")}
                  for m in effects["marks"]],
    }


# ═══════════════════════════════════════════════════════════════════════════
#  «ПЛАТИМ ВПУСТУЮ» и ИНДЕКС НЕВЫГОДНОСТИ
# ═══════════════════════════════════════════════════════════════════════════

def package_use(categories: list[dict[str, Any]]) -> float:
    """Насколько израсходован оплаченный пакет: 0 — не тронут, 1 — выбран.

    Считаем среднее по категориям, где пакет вообще есть. Категории без
    пакета (тариф без включённых минут) в среднее не входят — там нечего
    недоиспользовать, всё оплачивается по факту.
    """
    ratios = []
    for cat in categories or []:
        quota = float(cat.get("quota") or 0.0)
        if quota <= 0:
            continue
        used = float(cat.get("used") or 0.0)
        ratios.append(min(1.0, used / quota))
    if not ratios:
        return 1.0     # пакета нет → впустую ничего не платим
    return sum(ratios) / len(ratios)


def waste_of(record: dict[str, Any], payment: dict[str, Any]) -> dict[str, Any]:
    """Сколько денег компании уходит впустую на этот номер.

    Две составляющие:

      1. НЕИСПОЛЬЗОВАННЫЙ ПАКЕТ. Мы купили абонплату с пакетом минут/ГБ/SMS.
         Если пакет выбран на 20%, то 80% абонплаты — деньги на ветер.
         Считается только та часть абонплаты, которую платим МЫ.

      2. НЕИСПОЛЬЗОВАННЫЙ ЛИМИТ. Рублёвый лимит — это зарезервированный
         бюджет. Он не потрачен, поэтому весит меньше (коэффициент 0,25):
         это не убыток, а замороженный резерв, который можно перераспределить.
    """
    # Часть абонплаты, которую платит компания.
    tariff_bucket = next((b for b in payment["buckets"] if b["key"] == "tariff"), None)
    company_fee = float(tariff_bucket["company"]) if tariff_bucket else 0.0

    use = package_use(record.get("categories") or [])
    idle_package = round(company_fee * (1.0 - use), 2)

    limit = float(record.get("limit") or 0.0)
    total = float(record.get("total") or 0.0)
    reserve = round(max(0.0, limit - total), 2) if record.get("limit_set") else 0.0

    # Безлимитный или исключённый номер впустую не тратит по определению.
    if payment.get("excluded") or payment.get("unlimited"):
        idle_package, reserve = 0.0, 0.0

    return {
        "package_use": round(use, 3),
        "idle_package": idle_package,
        "limit_reserve": reserve,
        # Итоговые «замороженные» деньги. Резерв с понижающим весом.
        "waste_money": round(idle_package + 0.25 * reserve, 2),
    }


def assign_waste_index(records: list[dict[str, Any]]) -> None:
    """Проставить индекс невыгодности 0–100 по всему парку номеров.

    ПОЧЕМУ ИНДЕКС СЧИТАЕТСЯ ПО ПАРКУ, А НЕ ПО ОДНОМУ НОМЕРУ.
    Абсолютная сумма «впустую 300 ₽» ничего не говорит: для парка из
    сотни дешёвых номеров это много, для парка с тарифами по 2000 ₽ — мелочь.
    Поэтому за 100 берём 90-й перцентиль по парку: индекс отвечает на вопрос
    «насколько этот номер невыгоден ОТНОСИТЕЛЬНО ОСТАЛЬНЫХ».

    90-й перцентиль, а не максимум, — чтобы один аномальный номер не
    придавил всю шкалу к нулю.
    """
    values = sorted(float(r.get("waste", {}).get("waste_money") or 0.0) for r in records)
    if not values:
        return

    idx = (len(values) - 1) * 0.9
    lo, hi = int(idx), min(int(idx) + 1, len(values) - 1)
    reference = values[lo] + (values[hi] - values[lo]) * (idx - lo)
    # Защита от деления на ноль и от шкалы «всё красное» на копеечных суммах.
    reference = max(reference, 1.0)

    for record in records:
        waste = record.setdefault("waste", {})
        money = float(waste.get("waste_money") or 0.0)
        waste["index"] = int(round(100 * min(1.0, money / reference)))
        waste["reference"] = round(reference, 2)


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Сводка по разделению оплаты — для верхних показателей.

    Исключённые номера (синий цвет, пометка «не учитывать») в сводку не
    входят: заказчик просил их не считать вовсе.
    """
    counted = [r for r in records if not r.get("payment", {}).get("excluded")]
    excluded = len(records) - len(counted)

    company = sum(float(r["payment"]["company_pays"]) for r in counted)
    employee = sum(float(r["payment"]["employee_pays"]) for r in counted)
    waste = sum(float(r.get("waste", {}).get("waste_money") or 0.0) for r in counted)
    idle = sum(float(r.get("waste", {}).get("idle_package") or 0.0) for r in counted)
    reserve = sum(float(r.get("waste", {}).get("limit_reserve") or 0.0) for r in counted)

    # Разбивка расходов компании по корзинам — видно, на что уходят наши деньги.
    by_bucket = {b: 0.0 for b in BUCKETS}
    for record in counted:
        for bucket in record["payment"]["buckets"]:
            by_bucket[bucket["key"]] += float(bucket["company"])

    return {
        "company_pays": round(company, 2),
        "employee_pays": round(employee, 2),
        "company_share": round(100 * company / (company + employee), 1) if (company + employee) else 0.0,
        "waste_money": round(waste, 2),
        "idle_package": round(idle, 2),
        "limit_reserve": round(reserve, 2),
        "company_by_bucket": {k: round(v, 2) for k, v in by_bucket.items()},
        "excluded_count": excluded,
        "counted": len(counted),
    }
