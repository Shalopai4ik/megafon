"""MegaFon Analysis Server — Python/Flask backend."""

import os
import csv
import io
import re
import random
from datetime import datetime, date
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# ── In-memory storage (no PostgreSQL dependency) ──────────────
_db = {
    "parameters": [],
    "reports": [],
    "parameter_values": [],
    "users_numbers": [],
    "_next_id": {"parameters": 1, "reports": 1, "parameter_values": 1, "users_numbers": 1},
}


def _gen_id(table):
    _db["_next_id"][table] += 1
    return _db["_next_id"][table] - 1


# ── Parameters (85 services from tablica.txt) ─────────────────
PARAMETERS = [
    ("Premium Voice - услуги контент-провайдеров", "calls"),
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
    ("в том числе НДС (22%)", "tax"),
    ("Входящие SMS в международном роуминге", "sms"),
    ("Входящие вызовы в домашнем регионе", "calls"),
    ("Входящие вызовы в международном роуминге", "calls"),
    ("Входящие вызовы в путешествиях по России", "calls"),
    ("Входящие сообщения в домашнем регионе", "sms"),
    ("Входящие сообщения в путешествиях по России", "sms"),
    ("Вызовы в международном роуминге", "calls"),
    ("Голосовая почта", "calls"),
    ("Голосовое SMS", "sms"),
    ("Дополнительный городской номер", "services"),
    ("Дополнительный номер", "services"),
    ("Доставка счета на e-mail", "services"),
    ("Ежемесячная абонентская плата", "tax"),
    ("Замена SIM-карты", "services"),
    ("Запрет развлекательного контента", "services"),
    ("Звонок за счет друга", "services"),
    ("Исходящие SMS в международном роуминге", "sms"),
    ("Исходящие SMS на банковские номера", "sms"),
    ("Исходящие вызовы в домашнем регионе", "calls"),
    ("Исходящие вызовы внутри сети в домашнем регионе", "calls"),
    ("Исходящие вызовы внутри сети в путешествиях по России", "calls"),
    ("Исходящие вызовы в путешествиях по России", "calls"),
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
    ("Итого начислено", "tax"),
    ("Итого по услугам, облагаемым НДС", "tax"),
    ("Массовые вызовы", "calls"),
    ("МИ.SMS на абонентов оператора К-Телеком", "services"),
    ("МИ.SMS на абонентов оператора КТК-Телеком", "services"),
    ("МИ.SMS на абонентов оператора ПАО ВымпелКом", "services"),
    ("МИ.SMS на абонентов оператора ПАО МТС", "services"),
    ("МИ.SMS на абонентов оператора ПАО Теле2", "services"),
    ("МИ.SMS на других операторов РФ", "services"),
    ("МИ.SMS на зарубежных операторов стран из группы 3", "services"),
    ("МИ.Детализация счета", "services"),
    ("МИ.Индивидуальная подпись отправителя ПАО МегаФон", "services"),
    ("МИ.Индивидуальная подпись отправителя ПАО МТС", "services"),
    ("МИ.Мобильное информирование", "services"),
    ("МИ.Нешаблонированные SMS-cообщения Мегафон", "services"),
    ("Мобильные SMS-сервисы", "sms"),
    ("Мобильный интернет в домашнем регионе", "internet"),
    ("Мобильный интернет в международном роуминге", "internet"),
    ("Мобильный интернет в национальном роуминге", "internet"),
    ("Мобильный интернет в путешествиях по России", "internet"),
    ("Начисления за голосовые услуги в национальном роуминге", "fee"),
    ("Начисления за передачу мультимедийных сообщений", "fee"),
    ("Начисления за услуги передачи сообщений в национальном роуминге", "fee"),
    ("Офис в кармане", "services"),
    ("Прочие исходящие вызовы в международном роуминге", "calls"),
    ("Прочие начисления", "fee"),
    ("Разовые услуги", "fee"),
    ("Тарифный план «Интернет. Без Переплат 04.23»", "tariff"),
    ("Тарифный план «Мобильные SMS-сервисы»", "tariff"),
    ("Тарифный план «Управляй! Специалист +»", "tariff"),
    ("Тарифный план «Федеральный Специальный»", "tariff"),
    ("Тарифный план «Федеральный Специальный B2B»", "tariff"),
    ("Удержание вызова", "services"),
    ("Услуги международного роуминга", "services"),
    ("Услуги национального роуминга", "services"),
]

for i, (name, cat) in enumerate(PARAMETERS, 1):
    _db["parameters"].append({"id": i, "name": name, "category": cat})
_db["_next_id"]["parameters"] = len(PARAMETERS) + 1


def _get_param_id(name_part):
    lower = name_part.lower()
    for p in _db["parameters"]:
        if lower in p["name"].lower():
            return p["id"]
    return None


def _rows_to_dicts(rows):
    return [dict(r) for r in rows]


def _jsonify_rows(rows):
    return jsonify(_rows_to_dicts(rows))


# ── Static files ──────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def static_files(path):
    if os.path.isfile(path):
        return send_from_directory(".", path)
    return "Not found", 404


# ── API: CSV upload ───────────────────────────────────────────

@app.route("/api/upload-csv", methods=["POST"])
def upload_csv():
    """Upload a CSV bill file, parse it, return structured data."""
    if "file" not in request.files:
        return jsonify({"error": "Файл не загружен"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Имя файла пустое"}), 400

    text = file.read().decode("windows-1251", errors="replace")
    report_data = _parse_csv_text(text)

    if not report_data:
        return jsonify({"error": "Не удалось распознать данные из файла"}), 400

    return jsonify(report_data)


def _parse_csv_text(text):
    """Parse CSV text and return structured subscriber data."""
    subscribers = {}
    current_number = None

    for line in text.split("\n"):
        cleaned = line.replace("\r", "").strip()
        if not cleaned:
            continue

        lower = cleaned.lower()

        if "абонентский номер" in lower:
            match = re.search(r"(\d{10,})", cleaned)
            if match:
                current_number = match.group(1)[-10:]
                if current_number not in subscribers:
                    subscribers[current_number] = {"items": [], "planFee": 0, "planName": ""}
            continue

        if "тарифный план" in lower:
            quote = re.search(r'\u00ab"([^"]+)\u00bb', cleaned)
            if quote and current_number:
                subscribers[current_number]["planName"] = quote.group(1)
            continue

        if current_number and ";" in cleaned:
            parts = [p.strip() for p in cleaned.split(";") if p.strip()]
            if len(parts) < 2:
                continue

            service_name = parts[0].strip().lower()
            raw_volume = parts[1] if len(parts) >= 2 else ""
            no_disc = float(parts[2].replace(",", ".")) if len(parts) >= 3 else 0
            disc = float(parts[3].replace(",", ".")) if len(parts) >= 4 else 0
            with_disc = float(parts[4].replace(",", ".")) if len(parts) >= 5 else 0

            vol_match = re.match(r"([\d.,]+)\s*(шт|мин|Мбайт|Мб|Гб|Гбайт|б)?", raw_volume, re.I)
            volume = float(vol_match.group(1).replace(",", ".")) if vol_match else 0
            unit = (vol_match.group(2) or "").lower() if vol_match else ""

            key = _service_key(service_name)
            if not key:
                continue

            if key == "plan_fee":
                subscribers[current_number]["planFee"] += with_disc
                continue

            if key in ("subscriber_number", "tariff_plan", "total_charged", "vat_included"):
                continue

            subscribers[current_number]["items"].append({
                "key": key,
                "rawVolume": raw_volume,
                "volume": volume,
                "unit": unit,
                "noDiscount": no_disc,
                "discount": disc,
                "withDiscount": with_disc,
            })

    return subscribers


SERVICE_KEYS = {
    "абонентский номер": "subscriber_number",
    "тарифный план": "tariff_plan",
    "абонентская плата по тарифному плану (посуточное списание)": "plan_fee",
    "абонентская плата по тарифному плану": "plan_fee",
    "удержание вызова": "call_hold",
    "абонентская плата за услугу защита сотрудников": "employee_protection_fee",
    "исходящие вызовы в домашнем регионе": "home_outgoing_calls",
    "исходящие вызовы на номера других операторов в домашнем регионе": "home_other_operators",
    "исходящие вызовы внутри сети в домашнем регионе": "home_onnet_calls",
    "исходящие междугородние вызовы в домашнем регионе": "home_intercity_calls",
    "мобильный интернет в домашнем регионе": "home_mobile_internet",
    "исходящие сообщения в домашнем регионе": "home_sms",
    "входящие вызовы в домашнем регионе": "home_incoming_calls",
    "входящие сообщения в домашнем регионе": "home_incoming_sms",
    "входящие вызовы в путешествиях по россии": "travel_incoming_calls",
    "входящие сообщения в путешествиях по россии": "travel_incoming_sms",
    "исходящие вызовы в путешествиях по России": "travel_outgoing_calls",
    "исходящие междугородние вызовы в путешествиях по России": "travel_intercity_calls",
    "исходящие сообщения в путешествиях по России": "travel_sms",
    "мобильный интернет в путешествиях по России": "travel_mobile_internet",
    "итого начислено": "total_charged",
    "в т.ч. ндс": "vat_included",
    "в том числе ндс (22%)": "vat_included",
    "начисления за передачу мультимедийных сообщений": "multimedia_messages",
    "исходящие вызовы внутри сети в путешествиях по россии": "travel_onnet_russia_calls",
    "исходящие вызовы на номера других операторов региона пребывания в путешествиях по россии": "travel_other_operators",
    "массовые вызовы": "mass_calls",
    "голосовая почта": "voicemail",
    "автоответчик": "auto_answer",
    "звонок за счёт друга": "friend_call",
    "доставка счёта на email": "email_invoice",
    "мобильный интернет в национальном роуминге": "national_roaming_internet",
    "блокировка номера": "number_blocking",
    "начисления за услуги передачи сообщений в национальном роуминге": "national_roaming_messages",
    "офис в кармане": "office_in_pocket",
    "голосовые sms": "voice_sms",
    "исходящие международные вызовы": "international_calls",
    "исходящие sms в международном роуминге": "international_roaming_sms",
    "исходящие вызовы на номера россии в международном роуминге": "international_roaming_russia_calls",
    "исходящие вызовы на номера страны пребывания в международном роуминге": "international_roaming_local_calls",
    "прочие начисления": "misc_charges",
    "ми.детализация счета": "mi_detailing",
}


def _service_key(name_lower):
    for k, v in SERVICE_KEYS.items():
        if k in name_lower:
            return v
    return None


# ── API: reports ──────────────────────────────────────────────

@app.route("/api/reports", methods=["GET"])
def get_reports():
    return jsonify(_db["reports"][-100:])


@app.route("/api/reports", methods=["POST"])
def create_report():
    data = request.get_json(force=True)
    rid = _gen_id("reports")
    report = {
        "id": rid,
        "report_date": data.get("report_date", date.today().isoformat()),
        "report_month": data.get("report_month", ""),
        "subscriber_id": data.get("subscriber_id", ""),
        "created_at": datetime.now().isoformat(),
    }
    _db["reports"].append(report)
    return jsonify(report), 201


# ── API: parameter_values ─────────────────────────────────────

@app.route("/api/parameter_values", methods=["POST"])
def upsert_parameter_value():
    data = request.get_json(force=True)
    report_id = int(data["report_id"])
    parameter_id = int(data["parameter_id"])
    volume = data.get("volume", "")
    no_discount = float(data.get("no_discount", 0))
    discount = float(data.get("discount", 0))
    with_discount = float(data.get("with_discount", 0))

    for pv in _db["parameter_values"]:
        if pv["report_id"] == report_id and pv["parameter_id"] == parameter_id:
            pv.update({
                "volume": volume,
                "no_discount": no_discount,
                "discount": discount,
                "with_discount": with_discount,
            })
            return jsonify(pv)

    pvid = _gen_id("parameter_values")
    pv = {
        "id": pvid,
        "report_id": report_id,
        "parameter_id": parameter_id,
        "volume": volume,
        "no_discount": no_discount,
        "discount": discount,
        "with_discount": with_discount,
        "created_at": datetime.now().isoformat(),
    }
    _db["parameter_values"].append(pv)
    return jsonify(pv), 201


@app.route("/api/parameter_values/<int:report_id>")
def get_parameter_values(report_id):
    return jsonify([pv for pv in _db["parameter_values"] if pv["report_id"] == report_id])


# ── API: user-by-number ───────────────────────────────────────

@app.route("/api/user-by-number/<phone_number>")
def user_by_number(phone_number):
    for u in _db["users_numbers"]:
        if str(u["number"]) == phone_number:
            return jsonify({"user_id": u["id"]})
    return jsonify({"error": "Пользователь не найден"}), 404


# ── API: execute-sql (stub) ──────────────────────────────────

@app.route("/api/execute-sql", methods=["POST"])
def execute_sql():
    return jsonify({"error": "SQL execution not available in in-memory mode"}), 400


# ── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    print(f"Сервер запущен: http://localhost:{port}")
    print("Режим: Python/Flask (in-memory)")
    print("Нажмите Ctrl+C для остановки")
    app.run(host="0.0.0.0", port=port, debug=True)
