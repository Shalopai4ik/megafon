#!/usr/bin/env python3
"""
Сервер анализа расходов МегаФон — чистый Python, zero зависимостей.
Таблицы: parameters, users_numbers, reports_2, parameter_values_2.
Хранение: in-memory (словари, структура как в PostgreSQL).
"""

import http.server
import json
import os
import re
import urllib.parse
from datetime import datetime, date
from collections import defaultdict

PORT = int(os.environ.get("PORT", 3001))
HOST = "0.0.0.0"
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

MIME = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".csv": "text/csv; charset=utf-8",
    ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
}

# ═══════════════════════════════════════════════════════════════
#  In-memory хранилище
# ═══════════════════════════════════════════════════════════════
_db = {
    "parameters": [], "users_numbers": [], "reports_2": [], "parameter_values_2": [],
    "_seq": {"parameters": 1, "users_numbers": 1, "reports_2": 1, "parameter_values_2": 1},
}

def _next_id(table):
    _db["_seq"][table] += 1
    return _db["_seq"][table] - 1

# Справочник 85 услуг
PARAMETERS_LIST = [
    ("Premium Voice - услуги контент-провайдеров", "calls"),
    ("Абонентская плата M2M", "fee"), ("Абонентская плата M2M Флекс", "fee"),
    ("Абонентская плата за пользование услугой Экспресс-набор (FMC)", "fee"),
    ("Абонентская плата за услугу Защита сотрудников", "fee"),
    ("Абонентская плата и начисления по опции «Бизнес без границ+»", "fee"),
    ("Абонентская плата и начисления по опции «Бизнес без границ»", "fee"),
    ("Абонентская плата и разовые начисления за голосовые опции", "fee"),
    ("Абонентская плата по тарифному плану", "fee"),
    ("Абонентская плата по тарифному плану (посуточное списание)", "fee"),
    ("Автоответчик", "services"), ("Блокировка номера", "services"),
    ("ВАТС МультиФон", "services"), ("Видеостриминг", "services"),
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
    ("Голосовая почта", "calls"), ("Голосовое SMS", "sms"),
    ("Дополнительный городской номер", "services"), ("Дополнительный номер", "services"),
    ("Доставка счета на e-mail", "services"), ("Ежемесячная абонентская плата", "tax"),
    ("Замена SIM-карты", "services"), ("Запрет развлекательного контента", "services"),
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
    ("Итого начислено", "tax"), ("Итого по услугам, облагаемым НДС", "tax"),
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
    ("Прочие начисления", "fee"), ("Разовые услуги", "fee"),
    ("Тарифный план «Интернет. Без Переплат 04.23»", "tariff"),
    ("Тарифный план «Мобильные SMS-сервисы»", "tariff"),
    ("Тарифный план «Управляй! Специалист +»", "tariff"),
    ("Тарифный план «Федеральный Специальный»", "tariff"),
    ("Тарифный план «Федеральный Специальный B2B»", "tariff"),
    ("Удержание вызова", "services"),
    ("Услуги международного роуминга", "services"),
    ("Услуги национального роуминга", "services"),
]

for i, (name, cat) in enumerate(PARAMETERS_LIST, 1):
    _db["parameters"].append({"id": i, "name": name, "description": "", "category": cat})
_db["_seq"]["parameters"] = len(PARAMETERS_LIST) + 1

# ═══════════════════════════════════════════════════════════════
#  Парсер CSV
# ═══════════════════════════════════════════════════════════════
SERVICE_KEYS = {
    "абонентский номер": "subscriber_number", "тарифный план": "tariff_plan",
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
    "итого начислено": "total_charged", "в т.ч. ндс": "vat_included",
    "в том числе ндс (22%)": "vat_included",
    "начисления за передачу мультимедийных сообщений": "multimedia_messages",
    "исходящие вызовы внутри сети в путешествиях по россии": "travel_onnet_russia_calls",
    "исходящие вызовы на номера других операторов региона пребывания в путешествиях по россии": "travel_other_operators",
    "массовые вызовы": "mass_calls", "голосовая почта": "voicemail",
    "автоответчик": "auto_answer", "звонок за счёт друга": "friend_call",
    "доставка счёта на email": "email_invoice",
    "мобильный интернет в национальном роуминге": "national_roaming_internet",
    "блокировка номера": "number_blocking",
    "начисления за услуги передачи сообщений в национальном роуминге": "national_roaming_messages",
    "офис в кармане": "office_in_pocket", "голосовые sms": "voice_sms",
    "исходящие международные вызовы": "international_calls",
    "исходящие sms в международном роуминге": "international_roaming_sms",
    "исходящие вызовы на номера россии в международном роуминге": "international_roaming_russia_calls",
    "исходящие вызовы на номера страны пребывания в международном роуминге": "international_roaming_local_calls",
    "прочие начисления": "misc_charges", "ми.детализация счета": "mi_detailing",
    "входящие sms в международном роуминге": "incoming_sms_intl_roaming",
    "вызовы в международном роуминге": "calls_intl_roaming",
    "услуги национального роуминга": "national_roaming_services",
    "услуги международного роуминга": "intl_roaming_services",
    "начисления за голосовые услуги в национальном роуминге": "national_roaming_voice",
    "абонентская плата m2m": "m2m_fee", "абонентская плата m2m флекс": "m2m_flex_fee",
}

def _is_garbage(line):
    if not line: return True
    if re.match(r"^\[\d{2}\.\d{2}\.\d{4}", line): return True
    if re.match(r"^\d+\s+из\s+\d+", line): return True
    if re.match(r"^Хлебопашев\s", line): return True
    if line.startswith("<") or line.startswith("</"): return True
    if line.startswith("* "): return True
    lo = line.lower()
    if lo.startswith("сумма по номерам") or lo.startswith("абонент:") or lo.startswith("абонент ;"): return True
    if "все суммы приведены" in lo or "начисления приведены" in lo: return True
    return False

def _pf(s):
    try: return float(s.strip().replace(",", ".").replace(" ", ""))
    except: return 0

def _pv(raw):
    raw = raw.strip()
    if not raw: return 0, ""
    m = re.match(r"([\d.,]+)\s*(шт|мин|Мбайт|Мб|Гб|Гбайт|б)?", raw, re.I)
    if m: return _pf(m.group(1)), (m.group(2) or "").lower()
    try: return _pf(raw), ""
    except: return 0, ""

def _mkey(name):
    lo = name.lower().strip()
    for p, k in SERVICE_KEYS.items():
        if p in lo: return k
    return None

def _fpid(name):
    lo = name.lower().strip()
    for p in _db["parameters"]:
        if lo in p["name"].lower(): return p["id"]
    return None

def parse_csv(text):
    subs = {}; cur = None; rows = []; raw_all = []
    for line in text.split("\n"):
        raw = line.replace("\r", "").strip(); raw_all.append(raw)
        if _is_garbage(raw): continue
        lo = raw.lower()
        if "абонентский номер" in lo:
            m = re.search(r"(\d{10,})", raw)
            if m:
                cur = m.group(1)[-10:]
                if cur not in subs: subs[cur] = {"items": [], "planFee": 0, "planName": "", "totalCharged": 0, "vat": 0}
            continue
        if "тарифный план" in lo:
            q = re.search(r"«(.+?)»", raw)
            if q and cur: subs[cur]["planName"] = q.group(1)
            continue
        if lo.startswith("название услуги"): continue
        if "итого" in lo and "начислено" in lo:
            if cur and ";" in raw:
                for p in raw.split(";")[1:]:
                    v = _pf(p)
                    if v > 0: subs[cur]["totalCharged"] = v; break
            continue
        if "ндс" in lo:
            if cur and ";" in raw:
                for p in raw.split(";"):
                    v = _pf(p)
                    if v > 0: subs[cur]["vat"] = v; break
            continue
        if ";" not in raw: continue
        if cur and cur in subs:
            parts = [p.strip() for p in raw.split(";")]
            if len(parts) < 2: continue
            sn = parts[0]; rv = parts[1] if len(parts) >= 2 else ""
            nd = _pf(parts[2]) if len(parts) >= 3 else 0
            dc = _pf(parts[3]) if len(parts) >= 4 else 0
            wd = _pf(parts[4]) if len(parts) >= 5 else 0
            vol, unit = _pv(rv)
            ac = {f"col{i}": p for i, p in enumerate(parts)}
            item = {"serviceName": sn, "rawVolume": rv, "volume": vol, "unit": unit,
                    "noDiscount": nd, "discount": dc, "withDiscount": wd, "allColumns": ac, "columnCount": len(parts)}
            subs[cur]["items"].append(item)
            if "абонентская плата по тарифному плану" in sn.lower(): subs[cur]["planFee"] += wd
            rows.append({"subscriber": cur, "serviceName": sn, "rawVolume": rv,
                         "noDiscount": nd, "discount": dc, "withDiscount": wd, "allColumns": ac})
    return subs, rows, raw_all

# ═══════════════════════════════════════════════════════════════
#  Сохранение + история
# ═══════════════════════════════════════════════════════════════
def save_report(subs, rows):
    today = date.today(); month = today.strftime("%Y-%m"); ids = []
    for number, data in subs.items():
        uid = None
        for u in _db["users_numbers"]:
            if str(u["number"]) == number: uid = u["id"]; break
        if uid is None:
            uid = _next_id("users_numbers")
            _db["users_numbers"].append({"id": uid, "number": int(number), "limit_numbr": 0, "username": ""})
        # Проверяем, есть ли уже отчёт за этот месяц для этого абонента
        existing_report = None
        for r in _db["reports_2"]:
            if r["subscriber_id"] == number and r["report_month"] == month:
                existing_report = r; break
        if existing_report:
            report_id = existing_report["id"]
            # Удаляем старые parameter_values для этого отчёта
            _db["parameter_values_2"] = [pv for pv in _db["parameter_values_2"] if pv["report_id"] != report_id]
        else:
            report_id = _next_id("reports_2")
            _db["reports_2"].append({"id": report_id, "report_date": today.isoformat(),
                                     "report_month": month, "subscriber_id": number, "user_id": uid,
                                     "created_at": datetime.now().isoformat()})
        ids.append(report_id)
        for item in data["items"]:
            pid = _fpid(item["serviceName"])
            if pid is None: continue
            _db["parameter_values_2"].append({
                "id": _next_id("parameter_values_2"), "report_id": report_id,
                "parameter_id": pid, "volume": item["rawVolume"],
                "no_discount": item["noDiscount"], "discount": item["discount"],
                "with_discount": item["withDiscount"], "created_at": datetime.now().isoformat()})
    return ids

def get_history(phone):
    """Получить историю абонента за 6 месяцев."""
    reports = [r for r in _db["reports_2"] if r["subscriber_id"] == phone]
    reports.sort(key=lambda r: r["report_month"], reverse=True)
    history = []
    for r in reports[:6]:
        pvs = [pv for pv in _db["parameter_values_2"] if pv["report_id"] == r["id"]]
        history.append({"month": r["report_month"], "report_id": r["id"],
                        "values": pvs, "created_at": r["created_at"]})
    return history

def get_monthly_aggregates():
    """Агрегация по месяцам для графика."""
    monthly = defaultdict(lambda: {"total": 0, "count": 0})
    for r in _db["reports_2"]:
        m = r["report_month"]
        pvs = [pv for pv in _db["parameter_values_2"] if pv["report_id"] == r["id"]]
        total = sum(pv["with_discount"] for pv in pvs)
        monthly[m]["total"] += total
        monthly[m]["count"] += 1
    result = [{"month": k, "total": v["total"], "subscribers": v["count"]}
              for k, v in sorted(monthly.items())]
    return result

# ═══════════════════════════════════════════════════════════════
#  HTTP-сервер
# ═══════════════════════════════════════════════════════════════
class Handler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        p = urllib.parse.urlparse(self.path); path = urllib.parse.unquote(p.path)
        if path == "/api/reports/monthly": self._json(200, get_monthly_aggregates()); return
        if path.startswith("/api/history/"):
            phone = path.split("/")[-1]
            self._json(200, get_history(phone)); return
        if path == "/api/reports": self._json(200, _db["reports_2"][-200:]); return
        if path.startswith("/api/parameter_values/"):
            rid = path.split("/")[-1]
            try: rid = int(rid)
            except: self._json(400, {"error": "bad id"}); return
            self._json(200, [pv for pv in _db["parameter_values_2"] if pv["report_id"] == rid]); return
        if path == "/": path = "/index.html"
        safe = os.path.normpath(path).lstrip(os.sep).lstrip("/")
        fp = os.path.join(STATIC_DIR, safe)
        if not os.path.isfile(fp): self.send_error(404); return
        ext = os.path.splitext(fp)[1].lower()
        with open(fp, "rb") as f: data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        p = urllib.parse.urlparse(self.path); path = urllib.parse.unquote(p.path)
        if path == "/api/upload-csv": self._upload()
        else: self.send_error(404)

    def _upload(self):
        ct = self.headers.get("Content-Type", ""); cl = int(self.headers.get("Content-Length", 0))
        if "multipart/form-data" not in ct: self._json(400, {"error": "need multipart"}); return
        boundary = None
        for part in ct.split(";"):
            part = part.strip()
            if part.startswith("boundary="): boundary = part[9:]; break
        if not boundary: self._json(400, {"error": "no boundary"}); return
        body = self.rfile.read(cl); fdata = self._extract(body, boundary)
        if not fdata: self._json(400, {"error": "no file"}); return
        try: text = fdata.decode("utf-8")
        except: text = fdata.decode("windows-1251", errors="replace")
        subs, rows, raw = parse_csv(text)
        if not subs: self._json(400, {"error": "no subscribers found"}); return
        rids = save_report(subs, rows)
        result = {"subscribers": {}, "totalCount": len(subs), "allRowsCount": len(rows),
                  "totalRawLines": len(raw), "reportIds": rids}
        for num, d in subs.items():
            result["subscribers"][num] = {"items": d["items"], "planFee": d["planFee"],
                "planName": d["planName"], "totalCharged": d.get("totalCharged", 0),
                "vat": d.get("vat", 0), "itemCount": len(d["items"])}
        self._json(200, result)

    def _extract(self, body, boundary):
        for part in body.split(("--" + boundary).encode()):
            if b"filename=" not in part: continue
            he = part.find(b"\r\n\r\n")
            if he == -1: continue
            fc = part[he+4:]
            if fc.endswith(b"\r\n"): fc = fc[:-2]
            return fc
        return None

    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers(); self.wfile.write(body)

    def log_message(self, fmt, *a): print(f"[{self.log_date_time_string()}] {fmt % a}")

def main():
    s = http.server.HTTPServer((HOST, PORT), Handler)
    print(f"\n  MegaFon Server → http://localhost:{PORT}\n")
    try: s.serve_forever()
    except KeyboardInterrupt: s.server_close()

if __name__ == "__main__": main()
