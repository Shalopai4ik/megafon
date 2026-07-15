"""MegaFon Analysis Server — Python/Flask replacement for Node.js server.js."""

import os
import psycopg2
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=__name__, static_url_path="")
CORS(app)

DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 5434,
    "user": "postgres",
    "password": "",
    "dbname": "megafon",
}


def get_db():
    return psycopg2.connect(**DB_CONFIG)


def rows_to_dicts(cursor):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall]


def jsonify_cursor(cursor):
    rows = rows_to_dicts(cursor)
    for row in rows:
        for k, v in row.items():
            if hasattr(v, "isoformat"):
                row[k] = v.isoformat()
            elif hasattr(v, "__float__"):
                row[k] = float(v)
    return jsonify(rows)


# ── Static files ──────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def static_files(path):
    if os.path.isfile(path):
        return send_from_directory(".", path)
    return "Not found", 404


# ── API: user-by-number ───────────────────────────────────────

@app.route("/api/user-by-number/<phone_number>")
def user_by_number(phone_number):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM users_numbers WHERE number = %s LIMIT 1", (phone_number,))
        row = cur.fetchone()
        if row:
            return jsonify({"user_id": row[0]})
        return jsonify({"error": "Пользователь не найден"}), 404
    finally:
        conn.close()


# ── API: reports ──────────────────────────────────────────────

@app.route("/api/reports", methods=["GET"])
def get_reports():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100")
        return jsonify_cursor(cur)
    finally:
        conn.close()


@app.route("/api/reports", methods=["POST"])
def create_report():
    data = request.get_json(force=True)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO reports (report_date, report_month, subscriber_id)
               VALUES (%s, %s, %s) RETURNING id""",
            (data.get("report_date"), data.get("report_month"), data.get("subscriber_id")),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        cur.execute("SELECT * FROM reports WHERE id = %s", (new_id,))
        row = rows_to_dicts(cur)[0]
        for k, v in row.items():
            if hasattr(v, "isoformat"):
                row[k] = v.isoformat()
        return jsonify(row), 201
    finally:
        conn.close()


# ── API: parameter_values ─────────────────────────────────────

@app.route("/api/parameter_values", methods=["POST"])
def upsert_parameter_value():
    data = request.get_json(force=True)
    report_id = int(data["report_id"])
    parameter_id = int(data["parameter_id"])
    volume = data.get("volume", "")
    no_discount = data.get("no_discount", 0)
    discount = data.get("discount", 0)
    with_discount = data.get("with_discount", 0)

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id FROM parameter_values WHERE report_id = %s AND parameter_id = %s",
            (report_id, parameter_id),
        )
        existing = cur.fetchone()
        if existing:
            cur.execute(
                """UPDATE parameter_values SET volume=%s, no_discount=%s, discount=%s, with_discount=%s
                   WHERE id=%s RETURNING id""",
                (volume, no_discount, discount, with_discount, existing[0]),
            )
            conn.commit()
            return jsonify({"id": existing[0], **data})
        else:
            cur.execute(
                """INSERT INTO parameter_values (report_id, parameter_id, volume, no_discount, discount, with_discount)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (report_id, parameter_id, volume, no_discount, discount, with_discount),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return jsonify({"id": new_id, **data}), 201
    finally:
        conn.close()


@app.route("/api/parameter_values/<int:report_id>")
def get_parameter_values(report_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM parameter_values WHERE report_id = %s ORDER BY id", (report_id,))
        return jsonify_cursor(cur)
    finally:
        conn.close()


# ── API: execute-sql ──────────────────────────────────────────

@app.route("/api/execute-sql", methods=["POST"])
def execute_sql():
    data = request.get_json(force=True)
    sql = data.get("sql", "")
    if not sql:
        return jsonify({"error": "SQL не предоставлен"}), 400

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        if cur.description:
            result = rows_to_dicts(cur)
            for row in result:
                for k, v in row.items():
                    if hasattr(v, "isoformat"):
                        row[k] = v.isoformat()
                    elif hasattr(v, "__float__"):
                        row[k] = float(v)
            return jsonify({"success": True, "result": result})
        conn.commit()
        return jsonify({"success": True, "message": "Запрос выполнен успешно"})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# ── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    print(f"Сервер запущен: http://localhost:{port}")
    print("Режим: Python/Flask + PostgreSQL")
    print(f"Порт PostgreSQL: {DB_CONFIG['port']}")
    app.run(host="0.0.0.0", port=port, debug=True)
