#!/usr/bin/env python3
"""
Сервер анализа расходов МегаФон — чистый Python, zero зависимостей.
Хранение: in-memory (словари), структура таблиц:
  - parameters          — справочник услуг (85 позиций)
  - users_numbers       — абоненты (номер, лимит, имя)
  - reports_2           — отчёты (дата, месяц, абонент)
  - parameter_values_2  — значения услуг по каждому отчёту
"""

import http.server
import json
import os
import re
import urllib.parse
from datetime import datetime, date

# ── Настройки ───────────────────────────────────────────────────
PORT = int(os.environ.get("PORT", 3001))
HOST = "0.0.0.0"
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# ── MIME-типы для раздачи статики ──────────────────────────────
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".csv": "text/csv; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".ico": "image/x-icon",
}


# ═══════════════════════════════════════════════════════════════
#  In-memory хранилище (структура как в PostgreSQL)
# ═══════════════════════════════════════════════════════════════

_db = {
    "parameters": [],           # справочник услуг
    "users_numbers": [],        # абоненты
    "reports_2": [],            # отчёты
    "parameter_values_2": [],   # значения параметров
    "_seq": {
        "parameters": 1,
        "users_numbers": 1,
        "reports_2": 1,
        "parameter_values_2": 1,
    },
}


def _next_id(table):
    """Генерация следующего ID для таблицы."""
    _db["_seq"][table] += 1
    return _db["_seq"][table] - 1


# ── Справочник услуг (85 позиций из tablica.txt) ──────────────
PARAMETERS_LIST = [
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
    ("Массовые вызовы", "services"),
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

# Заполняем справочник parameters
for i, (name, cat) in enumerate(PARAMETERS_LIST, 1):
    _db["parameters"].append({
        "id": i,
        "name": name,
        "description": "",
        "category": cat,
    })
_db["_seq"]["parameters"] = len(PARAMETERS_LIST) + 1


# ═══════════════════════════════════════════════════════════════
#  Парсер CSV — выгружает ВСЁ, потом фильтрует
# ═══════════════════════════════════════════════════════════════

# Маппинг: имя услуги из CSV → ключ в SERVICE_MAP (для фронтенда)
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
    "входящие sms в международном роуминге": "incoming_sms_intl_roaming",
    "вызовы в международном роуминге": "calls_intl_roaming",
    "услуги национального роуминга": "national_roaming_services",
    "услуги международного роуминга": "intl_roaming_services",
    "начисления за голосовые услуги в национальном роуминге": "national_roaming_voice",
    "абонентская плата m2m": "m2m_fee",
    "абонентская плата m2m флекс": "m2m_flex_fee",
}


def _is_garbage_line(line):
    """Проверяет, является ли строка мусором (от мессенджера, страницы и т.д.)."""
    if not line:
        return True
    # Сообщения из чата: [15.07.2026 6:45] Anikey: ...
    if re.match(r"^\[\d{2}\.\d{2}\.\d{4}", line):
        return True
    # Номера страниц: "138  из  1356"
    if re.match(r"^\d+\s+из\s+\d+", line):
        return True
    # Имена сотрудников (строки без точек с запятой)
    if re.match(r"^Хлебопашев\s", line):
        return True
    # HTML-фрагменты
    if line.startswith("<") or line.startswith("</"):
        return True
    # Звёздные примечания
    if line.startswith("* "):
        return True
    # Строка "Сумма по номерам;..."
    if line.lower().startswith("сумма по номерам"):
        return True
    # Строка "Абонент: ..."
    lower = line.lower()
    if lower.startswith("абонент:") or lower.startswith("абонент ;"):
        return True
    # "Все суммы приведены..."
    if "все суммы приведены" in lower:
        return True
    # "Начисления приведены..."
    if "начисления приведены" in lower:
        return True
    return False


def _parse_float(s):
    """Парсинг числа из строки: '12,50' → 12.5, ' 400.00 ' → 400.0."""
    try:
        return float(s.strip().replace(",", ".").replace(" ", ""))
    except (ValueError, AttributeError):
        return 0


def _parse_volume(raw):
    """Парсинг объёма: '84 мин' → (84.0, 'мин'), '15.61 Мбайт' → (15.61, 'мбайт')."""
    raw = raw.strip()
    if not raw:
        return 0, ""
    m = re.match(r"([\d.,]+)\s*(шт|мин|Мбайт|Мб|Гб|Гбайт|б)?", raw, re.I)
    if m:
        val = _parse_float(m.group(1))
        unit = (m.group(2) or "").lower()
        return val, unit
    try:
        return _parse_float(raw), ""
    except ValueError:
        return 0, ""


def _match_service_key(name):
    """Поиск ключа услуги по имени из CSV. Возвращает ключ или None."""
    lower = name.lower().strip()
    for pattern, key in SERVICE_KEYS.items():
        if pattern in lower:
            return key
    return None


def _find_param_id(name):
    """Поиск ID параметра в справочке по части названия."""
    lower = name.lower().strip()
    for p in _db["parameters"]:
        if lower in p["name"].lower():
            return p["id"]
    return None


def parse_csv_full(text):
    """
    Полный парсинг CSV-счёта МегаФон.
    Сначала извлекает ВСЕ строки со всеми столбцами,
    потом фильтрует и группирует по абонентам.
    """
    subscribers = {}
    current_number = None
    all_raw_rows = []  # все строки файла (включая мусор) для отладки
    parsed_rows = []   # только обработанные строки данных

    for line in text.split("\n"):
        raw = line.replace("\r", "").strip()

        # Сохраняем все строки для отладки
        all_raw_rows.append(raw)

        # Пропускаем мусор
        if _is_garbage_line(raw):
            continue

        lower = raw.lower()

        # ── Определяем номер абонента ──
        if "абонентский номер" in lower:
            m = re.search(r"(\d{10,})", raw)
            if m:
                current_number = m.group(1)[-10:]
                if current_number not in subscribers:
                    subscribers[current_number] = {
                        "items": [],
                        "planFee": 0,
                        "planName": "",
                        "totalCharged": 0,
                        "vat": 0,
                    }
            continue

        # ── Определяем тарифный план ──
        if "тарифный план" in lower:
            q = re.search(r"«(.+?)»", raw)
            if q and current_number:
                subscribers[current_number]["planName"] = q.group(1)
            continue

        # ── Пропускаем заголовок таблицы ──
        if lower.startswith("название услуги"):
            continue

        # ── Итого начислено ──
        if "итого" in lower and "начислено" in lower:
            if current_number and ";" in raw:
                parts = [p.strip() for p in raw.split(";")]
                for p in parts[1:]:
                    val = _parse_float(p)
                    if val > 0:
                        subscribers[current_number]["totalCharged"] = val
                        break
            continue

        # ── НДС ──
        if "ндс" in lower:
            if current_number and ";" in raw:
                parts = [p.strip() for p in raw.split(";")]
                for p in parts:
                    val = _parse_float(p)
                    if val > 0:
                        subscribers[current_number]["vat"] = val
                        break
            continue

        # ── Заголовки категорий (без точек с запятой) ──
        # "Услуги голосовой связи в домашнем регионе", "Прочие" и т.д.
        if ";" not in raw:
            continue

        # ── Строка с данными услуги (с точками с запятой) ──
        if current_number and current_number in subscribers:
            parts = [p.strip() for p in raw.split(";")]
            if len(parts) < 2:
                continue

            service_name = parts[0]
            raw_volume = parts[1] if len(parts) >= 2 else ""
            no_discount = _parse_float(parts[2]) if len(parts) >= 3 else 0
            discount = _parse_float(parts[3]) if len(parts) >= 4 else 0
            with_discount = _parse_float(parts[4]) if len(parts) >= 5 else 0

            volume, unit = _parse_volume(raw_volume)

            # Сохраняем ВСЕ столбцы как есть
            all_columns = {}
            for i, p in enumerate(parts):
                all_columns[f"col{i}"] = p

            item = {
                "serviceName": service_name,
                "rawVolume": raw_volume,
                "volume": volume,
                "unit": unit,
                "noDiscount": no_discount,
                "discount": discount,
                "withDiscount": with_discount,
                "allColumns": all_columns,
                "columnCount": len(parts),
            }

            subscribers[current_number]["items"].append(item)

            # Считаем абонплату
            sn = service_name.lower()
            if "абонентская плата по тарифному плану" in sn:
                subscribers[current_number]["planFee"] += with_discount

            parsed_rows.append({
                "subscriber": current_number,
                "serviceName": service_name,
                "rawVolume": raw_volume,
                "noDiscount": no_discount,
                "discount": discount,
                "withDiscount": with_discount,
                "allColumns": all_columns,
            })

    return subscribers, parsed_rows, all_raw_rows


# ═══════════════════════════════════════════════════════════════
#  Сохранение в БД (in-memory, структура reports_2 и т.д.)
# ═══════════════════════════════════════════════════════════════

def save_report(subscribers, parsed_rows):
    """
    Сохранение отчёта в хранилище.
    Таблицы: reports_2, parameter_values_2, users_numbers.
    Возвращает ID созданного отчёта.
    """
    today = date.today()
    month_str = today.strftime("%Y-%m")

    # Группируем строки по абоненту
    by_subscriber = {}
    for row in parsed_rows:
        num = row["subscriber"]
        if num not in by_subscriber:
            by_subscriber[num] = []
        by_subscriber[num].append(row)

    report_ids = []

    for number, data in subscribers.items():
        # ── Проверяем/создаём абонента в users_numbers ──
        user_id = None
        for u in _db["users_numbers"]:
            if str(u["number"]) == number:
                user_id = u["id"]
                break
        if user_id is None:
            user_id = _next_id("users_numbers")
            _db["users_numbers"].append({
                "id": user_id,
                "number": int(number),
                "limit_numbr": 0,
                "username": "",
            })

        # ── Создаём отчёт в reports_2 ──
        report_id = _next_id("reports_2")
        report = {
            "id": report_id,
            "report_date": today.isoformat(),
            "report_month": month_str,
            "subscriber_id": number,
            "user_id": user_id,
            "created_at": datetime.now().isoformat(),
        }
        _db["reports_2"].append(report)
        report_ids.append(report_id)

        # ── Сохраняем все значения в parameter_values_2 ──
        for item in data["items"]:
            param_id = _find_param_id(item["serviceName"])
            if param_id is None:
                # Если параметра нет в справочке — пропускаем
                continue

            # Проверяем, нет ли уже такого значения (upsert)
            existing = None
            for pv in _db["parameter_values_2"]:
                if pv["report_id"] == report_id and pv["parameter_id"] == param_id:
                    existing = pv
                    break

            if existing:
                existing["volume"] = item["rawVolume"]
                existing["no_discount"] = item["noDiscount"]
                existing["discount"] = item["discount"]
                existing["with_discount"] = item["withDiscount"]
            else:
                pvid = _next_id("parameter_values_2")
                _db["parameter_values_2"].append({
                    "id": pvid,
                    "report_id": report_id,
                    "parameter_id": param_id,
                    "volume": item["rawVolume"],
                    "no_discount": item["noDiscount"],
                    "discount": item["discount"],
                    "with_discount": item["withDiscount"],
                    "created_at": datetime.now().isoformat(),
                })

    return report_ids


# ═══════════════════════════════════════════════════════════════
#  HTTP-сервер
# ═══════════════════════════════════════════════════════════════

class MegaFonHandler(http.server.BaseHTTPRequestHandler):
    """Обработчик HTTP-запросов: раздача статики + API."""

    def do_OPTIONS(self):
        """Обработка CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """GET-запросы: раздача статических файлов + API."""
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        # ── API: список абонентов ──
        if path == "/api/subscribers":
            self._handle_get_subscribers()
            return

        # ── API: отчёты ──
        if path == "/api/reports":
            self._handle_get_reports()
            return

        # ── API: параметры отчёта ──
        if path.startswith("/api/parameter_values/"):
            report_id = path.split("/")[-1]
            self._handle_get_parameter_values(report_id)
            return

        # ── Статика ──
        if path == "/":
            path = "/index.html"

        safe = os.path.normpath(path).lstrip(os.sep).lstrip("/")
        fp = os.path.join(STATIC_DIR, safe)

        if not os.path.isfile(fp):
            self.send_error(404, "Файл не найден")
            return

        ext = os.path.splitext(fp)[1].lower()
        ct = MIME.get(ext, "application/octet-stream")

        with open(fp, "rb") as f:
            data = f.read()

        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        """POST-запросы: загрузка CSV."""
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/api/upload-csv":
            self._handle_upload_csv()
        else:
            self.send_error(404, "API не найден")

    # ── Обработчики API ──────────────────────────────────────

    def _handle_upload_csv(self):
        """Загрузка и парсинг CSV-файла."""
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", 0))

        if "multipart/form-data" not in content_type:
            self._send_json(400, {"error": "Ожидается multipart/form-data"})
            return

        # Извлекаем boundary из Content-Type
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[len("boundary="):]
                break

        if not boundary:
            self._send_json(400, {"error": "Не найден boundary"})
            return

        # Читаем тело запроса
        body = self.rfile.read(content_length)
        file_data = self._extract_file_from_multipart(body, boundary)

        if not file_data:
            self._send_json(400, {"error": "Файл не найден в запросе"})
            return

        # Пробуем декодировать: сначала utf-8, потом windows-1251
        try:
            text = file_data.decode("utf-8")
        except UnicodeDecodeError:
            text = file_data.decode("windows-1251", errors="replace")

        # Парсим ВСЕ строки из CSV
        subscribers, parsed_rows, all_raw_rows = parse_csv_full(text)

        if not subscribers:
            self._send_json(400, {"error": "Не удалось распознать абонентов из файла"})
            return

        # Сохраняем отчёт в хранилище (reports_2, parameter_values_2)
        report_ids = save_report(subscribers, parsed_rows)

        # Формируем ответ для фронтенда
        result = {
            "subscribers": {},
            "totalCount": len(subscribers),
            "allRowsCount": len(parsed_rows),
            "totalRawLines": len(all_raw_rows),
            "reportIds": report_ids,
        }

        for num, data in subscribers.items():
            result["subscribers"][num] = {
                "items": data["items"],
                "planFee": data["planFee"],
                "planName": data["planName"],
                "totalCharged": data.get("totalCharged", 0),
                "vat": data.get("vat", 0),
                "itemCount": len(data["items"]),
            }

        self._send_json(200, result)

    def _handle_get_subscribers(self):
        """Получение списка абонентов с лимитами."""
        self._send_json(200, _db["users_numbers"])

    def _handle_get_reports(self):
        """Получение списка отчётов."""
        self._send_json(200, _db["reports_2"][-100:])

    def _handle_get_parameter_values(self, report_id):
        """Получение значений параметров для отчёта."""
        try:
            rid = int(report_id)
        except ValueError:
            self._send_json(400, {"error": "Неверный ID отчёта"})
            return
        values = [pv for pv in _db["parameter_values_2"] if pv["report_id"] == rid]
        self._send_json(200, values)

    # ── Утилиты ─────────────────────────────────────────────

    def _extract_file_from_multipart(self, body, boundary):
        """Извлечение содержимого файла из multipart-тела."""
        boundary_bytes = boundary.encode()
        parts = body.split(b"--" + boundary_bytes)

        for part in parts:
            if b"filename=" not in part:
                continue
            # Ищем конец заголовков (двойной \r\n)
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            file_content = part[header_end + 4:]
            # Убираем завершающий \r\n
            if file_content.endswith(b"\r\n"):
                file_content = file_content[:-2]
            return file_content
        return None

    def _send_json(self, code, data):
        """Отправка JSON-ответа."""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        """Логирование запросов."""
        print(f"[{self.log_date_time_string()}] {fmt % args}")


# ═══════════════════════════════════════════════════════════════
#  Точка входа
# ═══════════════════════════════════════════════════════════════

def main():
    """Запуск сервера."""
    server = http.server.HTTPServer((HOST, PORT), MegaFonHandler)
    print(f"\n{'=' * 50}")
    print(f"  Сервер анализа расходов МегаФон")
    print(f"  http://localhost:{PORT}")
    print(f"  Pure Python — zero зависимостей")
    print(f"  Хранение: in-memory (reports_2, parameters, parameter_values_2)")
    print(f"{'=' * 50}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановка сервера...")
        server.server_close()


if __name__ == "__main__":
    main()
