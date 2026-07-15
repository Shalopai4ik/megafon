#!/usr/bin/env python3
"""MegaFon Analysis Server — pure Python, no dependencies."""

import http.server
import json
import os
import re
import urllib.parse
from io import BytesIO

PORT = int(os.environ.get("PORT", 3001))
HOST = "0.0.0.0"
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

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


def parse_csv_full(text):
    """Parse MegaFon CSV bill: extract ALL data first, then filter."""
    subscribers = {}
    current_number = None
    current_plan = ""
    all_rows = []  # every parsed row from the file

    lines = text.split("\n")
    for line in lines:
        raw = line.replace("\r", "").strip()

        # --- skip garbage lines ---
        if not raw:
            continue
        # chat messages like [15.07.2026 6:45] Anikey: ...
        if re.match(r"^\[\d{2}\.\d{2}\.\d{4}", raw):
            continue
        # page numbers like "138  из  1356"
        if re.match(r"^\d+\s+из\s+\d+", raw):
            continue
        # lines that are just a name (no semicolons, no digits pattern)
        if re.match(r"^Хлебопашев\s", raw):
            continue
        # skip HTML fragments
        if raw.startswith("<") or raw.startswith("</"):
            continue
        # skip known non-data lines
        if raw.startswith("* "):
            continue

        lower = raw.lower()

        # --- detect subscriber number ---
        if "абонентский номер" in lower:
            m = re.search(r"(\d{10,})", raw)
            if m:
                current_number = m.group(1)[-10:]
                if current_number not in subscribers:
                    subscribers[current_number] = {
                        "items": [],
                        "planFee": 0,
                        "planName": "",
                        "rawRows": [],
                    }
                current_plan = ""
            continue

        # --- detect tariff plan ---
        if "тарифный план" in lower:
            q = re.search(r"«(.+?)»", raw)
            if q and current_number:
                current_plan = q.group(1)
                subscribers[current_number]["planName"] = current_plan
            continue

        # --- detect header row ---
        if lower.startswith("название услуги"):
            continue

        # --- detect "итого начислено" ---
        if "итого" in lower and "начислено" in lower:
            if current_number and ";" in raw:
                parts = [p.strip() for p in raw.split(";")]
                # save total for reference
                total_val = 0
                for p in parts[1:]:
                    p_clean = p.replace(",", ".").replace(" ", "")
                    try:
                        total_val = float(p_clean)
                    except ValueError:
                        pass
                subscribers[current_number]["totalCharged"] = total_val
            continue

        # --- detect VAT line ---
        if "ндс" in lower:
            if current_number and ";" in raw:
                parts = [p.strip() for p in raw.split(";")]
                for p in parts:
                    p_clean = p.replace(",", ".").replace(" ", "")
                    try:
                        subscribers[current_number]["vat"] = float(p_clean)
                    except ValueError:
                        pass
            continue

        # --- detect "Сумма по номерам" summary ---
        if "сумма по номерам" in lower:
            continue

        # --- detect "Абонент:" header ---
        if lower.startswith("абонент:") or lower.startswith("абонент ;"):
            continue

        # --- detect "Все суммы приведены..." ---
        if "все суммы приведены" in lower:
            continue

        # --- detect "Начисления приведены..." ---
        if "начисления приведены" in lower:
            continue

        # --- detect "Абонентская плата" section header (no semicolons) ---
        if lower.strip() == "абонентская плата":
            continue

        # --- category headers (no semicolons, just a label) ---
        if ";" not in raw:
            # Could be a category header like "Услуги голосовой связи в домашнем регионе"
            # or "Прочие", "Дополнительные услуги" etc.
            # Skip these — they're just labels
            continue

        # --- service line with semicolons ---
        if current_number and current_number in subscribers:
            parts = [p.strip() for p in raw.split(";")]
            # Store ALL raw parts
            row = {"raw": raw, "parts": parts}

            # Parse known structure: name;volume;noDiscount;discount;withDiscount
            service_name = parts[0].strip() if len(parts) >= 1 else ""
            raw_volume = parts[1].strip() if len(parts) >= 2 else ""
            no_discount = _parse_float(parts[2]) if len(parts) >= 3 else 0
            discount = _parse_float(parts[3]) if len(parts) >= 4 else 0
            with_discount = _parse_float(parts[4]) if len(parts) >= 5 else 0

            # Parse volume into number + unit
            volume, unit = _parse_volume(raw_volume)

            # Store all columns in rawRows for full data access
            all_cols = {}
            for i, p in enumerate(parts):
                all_cols[f"col{i}"] = p.strip()

            item = {
                "serviceName": service_name,
                "rawVolume": raw_volume,
                "volume": volume,
                "unit": unit,
                "noDiscount": no_discount,
                "discount": discount,
                "withDiscount": with_discount,
                "allColumns": all_cols,
                "columnCount": len(parts),
            }

            subscribers[current_number]["items"].append(item)
            subscribers[current_number]["rawRows"].append(row)
            all_rows.append({
                "subscriber": current_number,
                "serviceName": service_name,
                "rawVolume": raw_volume,
                "noDiscount": no_discount,
                "discount": discount,
                "withDiscount": with_discount,
                "allColumns": all_cols,
            })

    # Build planFee from plan fee items
    for num, data in subscribers.items():
        for item in data["items"]:
            sn = item["serviceName"].lower()
            if "абонентская плата по тарифному плану" in sn:
                data["planFee"] += item["withDiscount"]

    return subscribers, all_rows


def _parse_float(s):
    try:
        return float(s.strip().replace(",", ".").replace(" ", ""))
    except (ValueError, AttributeError):
        return 0


def _parse_volume(raw):
    """Parse '84 мин' -> (84.0, 'мин')"""
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


class MegaFonHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        self.send_cors()
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == "/":
            path = "/index.html"

        safe = os.path.normpath(path).lstrip(os.sep).lstrip("/")
        fp = os.path.join(STATIC_DIR, safe)

        if not os.path.isfile(fp):
            self.send_error(404, "Not found")
            return

        ext = os.path.splitext(fp)[1].lower()
        ct = MIME.get(ext, "application/octet-stream")

        with open(fp, "rb") as f:
            data = f.read()

        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.send_cors()
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/api/upload-csv":
            self.handle_upload_csv()
        else:
            self.send_error(404, "Not found")

    def handle_upload_csv(self):
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", 0))

        if "multipart/form-data" not in content_type:
            self.send_json(400, {"error": "Ожидается multipart/form-data"})
            return

        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[len("boundary="):]
                break

        if not boundary:
            self.send_json(400, {"error": "Нет boundary"})
            return

        body = self.rfile.read(content_length)
        file_data = self._extract_file_from_multipart(body, boundary)

        if not file_data:
            self.send_json(400, {"error": "Файл не найден в запросе"})
            return

        # Try utf-8 first, fallback to windows-1251
        try:
            text = file_data.decode("utf-8")
        except UnicodeDecodeError:
            text = file_data.decode("windows-1251", errors="replace")

        subscribers, all_rows = parse_csv_full(text)

        if not subscribers:
            self.send_json(400, {"error": "Не удалось распознать абонентов из файла"})
            return

        # Build response with full data
        result = {
            "subscribers": {},
            "totalCount": len(subscribers),
            "allRowsCount": len(all_rows),
            "rawData": all_rows[:500],  # first 500 rows for reference
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

        self.send_json(200, result)

    def _extract_file_from_multipart(self, body, boundary):
        """Extract file content from multipart body."""
        boundary_bytes = boundary.encode()
        parts = body.split(b"--" + boundary_bytes)

        for part in parts:
            if b"filename=" not in part:
                continue
            # Find the end of headers (double \r\n)
            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            file_content = part[header_end + 4:]
            # Remove trailing \r\n-- if present
            if file_content.endswith(b"\r\n"):
                file_content = file_content[:-2]
            return file_content
        return None

    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    server = http.server.HTTPServer((HOST, PORT), MegaFonHandler)
    print(f"\n{'=' * 40}")
    print(f"  MegaFon Analysis Server")
    print(f"  http://localhost:{PORT}")
    print(f"  Pure Python — no dependencies")
    print(f"{'=' * 40}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
