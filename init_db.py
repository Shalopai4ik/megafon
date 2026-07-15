"""Database initialization and sample data generation for MegaFon analysis system."""

import random
import psycopg2
from datetime import date, datetime

DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 5434,
    "user": "postgres",
    "password": "",
    "dbname": "megafon",
}

PARAMETERS = [
    ("Premium Voice - услуги контент-провайдеров", "premium_voice_services", "calls"),
    ("Абонентская плата M2M", "m2m_subscription_fee", "fee"),
    ("Абонентская плата M2M Флекс", "flexible_m2m_subscription", "fee"),
    ("Абонентская плата за пользование услугой Экспресс-набор (FMC) (за абонентский номер)", "express_dial_fmc_subscription", "fee"),
    ("Абонентская плата за услугу Защита сотрудников", "employee_protection_subscription", "fee"),
    ("Абонентская плата и начисления по опции «Бизнес без границ+»", "business_without_borders_plus", "fee"),
    ("Абонентская плата и начисления по опции «Бизнес без границ»", "business_without_borders", "fee"),
    ("Абонентская плата и разовые начисления за голосовые опции", "voice_options_charges", "fee"),
    ("Абонентская плата по тарифному плану", "plan_subscription_fee", "fee"),
    ("Абонентская плата по тарифному плану (посуточное списание)", "daily_plan_subscription_fee", "fee"),
    ("Автоответчик", "voicemail_service", "services"),
    ("Блокировка номера", "number_blocking", "services"),
    ("ВАТС МультиФон", "multi_fon_vas", "services"),
    ("Видеостриминг", "video_streaming", "services"),
    ("Виртуальная АТС, SMS: абон. плата. за тех. поддержку, sms", "virtual_pbx_sms_support", "services"),
    ("Виртуальная АТС: абонентская плата за тариф (не облагается НДС)", "virtual_pbx_plan_fee_no_vat", "services"),
    ("Виртуальная АТС: дополнительные опции (не облагается НДС)", "virtual_pbx_additional_options_no_vat", "services"),
    ("в том числе НДС (22%)", "nalog", "tax"),
    ("Входящие SMS в международном роуминге", "incoming_sms_international_roaming", "sms"),
    ("Входящие вызовы в домашнем регионе", "incoming_calls_home_region", "calls"),
    ("Входящие вызовы в международном роуминге", "incoming_calls_international_roaming", "calls"),
    ("Входящие вызовы в путешествиях по России", "incoming_calls_traveling_russia", "calls"),
    ("Входящие сообщения в домашнем регионе", "incoming_messages_home_region", "sms"),
    ("Входящие сообщения в путешествиях по России", "incoming_messages_traveling_russia", "sms"),
    ("Вызовы в международном роуминге", "calls_international_roaming", "calls"),
    ("Голосовая почта", "voice_mailbox", "calls"),
    ("Голосовое SMS", "voice_sms", "sms"),
    ("Дополнительный городской номер", "additional_city_number", "services"),
    ("Дополнительный номер", "additional_number", "services"),
    ("Доставка счета на e-mail", "bill_delivery_email", "services"),
    ("Ежемесячная абонентская плата", "monthly_subscription_fee", "tax"),
    ("Замена SIM-карты", "sim_card_replacement", "services"),
    ("Запрет развлекательного контента", "ban_entertainment_content", "services"),
    ("Звонок за счет друга", "call_friends_expense", "services"),
    ("Исходящие SMS в международном роуминге", "outgoing_sms_international_roaming", "sms"),
    ("Исходящие SMS на банковские номера", "outgoing_sms_banking_numbers", "sms"),
    ("Исходящие вызовы в домашнем регионе", "outgoing_calls_home_region", "calls"),
    ("Исходящие вызовы внутри сети в домашнем регионе", "on_net_outgoing_calls_home_region", "calls"),
    ("Исходящие вызовы внутри сети в путешествиях по России", "on_net_outgoing_calls_traveling_russia", "calls"),
    ("Исходящие вызовы в путешествиях по России", "outgoing_calls_traveling_russia", "calls"),
    ("Исходящие вызовы на номера других операторов в домашнем регионе", "off_net_outgoing_calls_home_region", "calls"),
    ("Исходящие вызовы на номера других операторов региона пребывания в путешествиях по России", "off_net_outgoing_calls_traveling_russia", "calls"),
    ("Исходящие вызовы на номера России в международном роуминге", "outgoing_calls_to_russia_international_roaming", "calls"),
    ("Исходящие вызовы на номера страны пребывания в международном роуминге", "outgoing_calls_country_stay_international_roaming", "calls"),
    ("Исходящие междугородные вызовы в домашнем регионе", "domestic_long_distance_calls_home_region", "calls"),
    ("Исходящие междугородные вызовы в путешествиях по России", "domestic_long_distance_calls_traveling_russia", "calls"),
    ("Исходящие международные вызовы в домашнем регионе", "international_outgoing_calls_home_region", "calls"),
    ("Исходящие международные вызовы в путешествиях по России", "international_outgoing_calls_traveling_russia", "calls"),
    ("Исходящие сообщения в домашнем регионе", "outgoing_messages_home_region", "sms"),
    ("Исходящие сообщения в путешествиях по России", "outgoing_messages_traveling_russia", "sms"),
    ("Итого начислено", "total_amount_charged", "tax"),
    ("Итого по услугам, облагаемым НДС", "total_vatable_services", "tax"),
    ("Массовые вызовы", "bulk_calling", "services"),
    ("МИ.SMS на абонентов оператора К-Телеком", "mi_sms_k_telecom_subscribers", "services"),
    ("МИ.SMS на абонентов оператора КТК-Телеком", "mi_sms_ktk_telecom_subscribers", "services"),
    ("МИ.SMS на абонентов оператора ПАО ВымпелКом", "mi_sms_beeline_subscribers", "services"),
    ("МИ.SMS на абонентов оператора ПАО МТС", "mi_sms_mts_subscribers", "services"),
    ("МИ.SMS на абонентов оператора ПАО Теле2", "mi_sms_tele2_subscribers", "services"),
    ("МИ.SMS на других операторов РФ", "mi_sms_other_russian_operators", "services"),
    ("МИ.SMS на зарубежных операторов стран из группы 3", "mi_sms_foreign_group3_countries", "services"),
    ("МИ.Детализация счета", "mi_bill_detailing", "services"),
    ("МИ.Индивидуальная подпись отправителя ПАО МегаФон", "mi_custom_sender_signature_megafon", "services"),
    ("МИ.Индивидуальная подпись отправителя ПАО МТС", "mi_custom_sender_signature_mts", "services"),
    ("МИ.Мобильное информирование", "mi_mobile_notification", "services"),
    ("МИ.Нешаблонированные SMS-cообщения Мегафон", "mi_non_template_sms_megafon", "services"),
    ("Мобильные SMS-сервисы", "mobile_sms_services", "sms"),
    ("Мобильный интернет в домашнем регионе", "mobile_internet_home_region", "internet"),
    ("Мобильный интернет в международном роуминге", "mobile_internet_international_roaming", "internet"),
    ("Мобильный интернет в национальном роуминге", "mobile_internet_national_roaming", "internet"),
    ("Мобильный интернет в путешествиях по России", "mobile_internet_traveling_russia", "internet"),
    ("Начисления за голосовые услуги в национальном роуминге", "national_roaming_voice_charges", "fee"),
    ("Начисления за передачу мультимедийных сообщений", "multimedia_message_transfer_charges", "fee"),
    ("Начисления за услуги передачи сообщений в национальном роуминге", "messaging_services_national_roaming", "fee"),
    ("Офис в кармане", "pocket_office", "services"),
    ("Прочие исходящие вызовы в международном роуминге", "other_outgoing_calls_international_roaming", "calls"),
    ("Прочие начисления", "miscellaneous_charges", "fee"),
    ("Разовые услуги", "one_time_services", "fee"),
    ("Тарифный план на 31.01.2026 «Интернет. Без Переплат 04.23»", "tariff_internet_no_extra_pay_04_23", "tariff"),
    ("Тарифный план на 31.01.2026 «Мобильные SMS-сервисы»", "tariff_mobile_sms_services", "tariff"),
    ("Тарифный план на 31.01.2026 «Управляй! Специалист +»", "tariff_manage_it_specialist_plus", "tariff"),
    ("Тарифный план на 31.01.2026 «Федеральный Специальный»", "tariff_federal_special", "tariff"),
    ("Тарифный план на 31.01.2026 «Федеральный Специальный B2B»", "tariff_federal_special_b2b", "tariff"),
    ("Удержание вызова", "call_hold", "services"),
    ("Услуги международного роуминга", "international_roaming_services", "services"),
    ("Услуги национального роуминга", "national_roaming_services", "services"),
]

TARIFF_PLANS = [
    "Интернет. Без Переплат 04.23",
    "Мобильные SMS-сервисы",
    "Управляй! Специалист +",
    "Федеральный Специальный",
    "Федеральный Специальный B2B",
    "Безлимитный MEGA",
    "Бизнес Стандарт",
    "Корпоративный Premium",
]

TARIFFS = {
    "140": {"minutes": 700, "sms": 300, "internet_mb": 15000},
    "230": {"minutes": 1500, "sms": 500, "internet_mb": 25000},
    "400": {"minutes": 4000, "sms": 1000, "internet_mb": 70000},
}

FIRST_NAMES = [
    "Александр", "Андрей", "Антон", "Артём", "Борис", "Вадим", "Валерий", "Виктор",
    "Виталий", "Владимир", "Геннадий", "Георгий", "Дмитрий", "Евгений", "Егор",
    "Игорь", "Илья", "Кирилл", "Константин", "Леонид", "Максим", "Михаил",
    "Николай", "Олег", "Павел", "Пётр", "Роман", "Руслан", "Сергей", "Станислав",
    "Тарас", "Фёдор", "Эдуард", "Юрий", "Ярослав",
    "Анна", "Елена", "Ирина", "Мария", "Наталья", "Ольга", "Светлана", "Татьяна",
]

LAST_NAMES = [
    "Иванов", "Петров", "Сидоров", "Козлов", "Новиков", "Морозов", "Попов",
    "Волков", "Соколов", "Лебедев", "Кузнецов", "Орлов", "Зайцев", "Смирнов",
    "Васильев", "Фёдоров", "Михайлов", "Борисов", "Яковлев", "Григорьев",
    "Романов", "Давыдов", "Белов", "Комаров", "Осипов", "Савельев", "Тимофеев",
    "Андреев", "Владимиров", "Макаров", "Захаров", "Зимин", "Куликов",
    "Сорокин", "Краснов", "Шестаков", "Кочетков", "Богданов", "Воробьёв",
    "Медведев", "Ершов", "Никитин", "Гусев", "Рыбаков", "Абрамов",
]


def connect():
    return psycopg2.connect(**DB_CONFIG)


def create_tables(conn):
    cur = conn.cursor()
    cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    cur.execute("GRANT ALL ON SCHEMA public TO postgres;")
    cur.execute("GRANT ALL ON SCHEMA public TO public;")

    cur.execute("""
        CREATE TABLE parameters (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            description TEXT,
            category VARCHAR(50),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE reports (
            id SERIAL PRIMARY KEY,
            report_date DATE NOT NULL,
            report_month VARCHAR(7) NOT NULL,
            subscriber_id VARCHAR(50),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("CREATE INDEX idx_reports_date ON reports(report_date)")
    cur.execute("CREATE INDEX idx_reports_month ON reports(report_month)")
    cur.execute("CREATE INDEX idx_reports_subscriber ON reports(subscriber_id)")
    cur.execute("CREATE UNIQUE INDEX reports_report_date_subscriber_id_key ON reports(report_date, subscriber_id)")

    cur.execute("""
        CREATE TABLE parameter_values (
            id SERIAL PRIMARY KEY,
            report_id INTEGER,
            parameter_id INTEGER,
            volume TEXT,
            no_discount NUMERIC(10,2),
            discount NUMERIC(10,2),
            with_discount NUMERIC(10,2),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("CREATE INDEX idx_parameter_values_report ON parameter_values(report_id)")
    cur.execute("CREATE INDEX idx_parameter_values_parameter ON parameter_values(parameter_id)")
    cur.execute("CREATE INDEX idx_parameter_values_composite ON parameter_values(report_id, parameter_id)")
    cur.execute("CREATE UNIQUE INDEX parameter_values_report_id_parameter_id_key ON parameter_values(report_id, parameter_id)")
    cur.execute("ALTER TABLE parameter_values ADD CONSTRAINT parameter_values_parameter_id_fkey FOREIGN KEY (parameter_id) REFERENCES parameters(id) ON DELETE CASCADE")
    cur.execute("ALTER TABLE parameter_values ADD CONSTRAINT parameter_values_report_id_fkey FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE")

    cur.execute("""
        CREATE TABLE users_numbers (
            id SERIAL PRIMARY KEY,
            number BIGINT,
            limit_numbr INTEGER,
            username TEXT
        )
    """)

    conn.commit()
    print("[OK] Tables created")
    return cur


def insert_parameters(cur):
    for name, category, ptype in PARAMETERS:
        cur.execute(
            "INSERT INTO parameters (name, description, category) VALUES (%s, %s, %s)",
            (name, name, category),
        )
    conn.commit()
    print(f"[OK] Inserted {len(PARAMETERS)} parameters")


def generate_phone():
    prefix = random.choice([900, 901, 902, 903, 904, 905, 906, 908, 909, 910, 912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 934, 935, 936, 937, 938, 939, 950, 951, 952, 953, 958])
    rest = "".join([str(random.randint(0, 9)) for _ in range(7)])
    return int(f"{prefix}{rest}")


def generate_users(cur, n=50):
    phones = set()
    users = []
    for i in range(n):
        while True:
            phone = generate_phone()
            if phone not in phones:
                phones.add(phone)
                break
        name = f"{random.choice(LAST_NAMES)} {random.choice(FIRST_NAMES)}"
        limit = random.choice([100, 200, 300, 500, 750, 1000])
        users.append((phone, limit, name))
    for phone, limit, name in users:
        cur.execute("INSERT INTO users_numbers (number, limit_numbr, username) VALUES (%s, %s, %s)", (phone, limit, name))
    conn.commit()
    print(f"[OK] Generated {n} users")
    return users


def get_param_id_by_name(cur, name_part):
    cur.execute("SELECT id FROM parameters WHERE name ILIKE %s LIMIT 1", (f"%{name_part}%",))
    row = cur.fetchone()
    return row[0] if row else None


def generate_reports(cur, users):
    months = [("2026-01-01", "2026-01"), ("2026-02-01", "2026-02"), ("2026-03-01", "2026-03")]
    report_ids = []
    for user in users:
        phone_str = str(user[0])
        for day, month in months:
            cur.execute(
                "INSERT INTO reports (report_date, report_month, subscriber_id) VALUES (%s, %s, %s) RETURNING id",
                (day, month, phone_str),
            )
            rid = cur.fetchone()[0]
            report_ids.append((rid, user, month))
    conn.commit()
    print(f"[OK] Generated {len(report_ids)} reports")
    return report_ids


def volume_str(val, unit):
    if unit == "мин":
        return f"{val} мин"
    elif unit == "шт":
        return f"{val} шт"
    elif unit == "Мбайт":
        return f"{val:.2f} Мбайт"
    return str(val)


def generate_parameter_values(cur, report_ids):
    count = 0

    p_plan_fee = get_param_id_by_name(cur, "Абонентская плата по тарифному плану")
    p_total = get_param_id_by_name(cur, "Итого начислено")
    p_vat = get_param_id_by_name(cur, "в том числе НДС")
    p_out_home = get_param_id_by_name(cur, "Исходящие вызовы в домашнем регионе")
    p_in_home = get_param_id_by_name(cur, "Входящие вызовы в домашнем регионе")
    p_out_onnet = get_param_id_by_name(cur, "Исходящие вызовы внутри сети в домашнем регионе")
    p_out_other = get_param_id_by_name(cur, "Исходящие вызовы на номера других операторов в домашнем регионе")
    p_out_intercity = get_param_id_by_name(cur, "Исходящие междугородные вызовы в домашнем регионе")
    p_internet = get_param_id_by_name(cur, "Мобильный интернет в домашнем регионе")
    p_incoming_sms = get_param_id_by_name(cur, "Входящие сообщения в домашнем регионе")
    p_outgoing_sms = get_param_id_by_name(cur, "Исходящие сообщения в домашнем регионе")
    p_voicemail = get_param_id_by_name(cur, "Голосовая почта")
    p_out_travel = get_param_id_by_name(cur, "Исходящие вызовы в путешествиях по России")
    p_internet_travel = get_param_id_by_name(cur, "Мобильный интернет в путешествиях по России")
    p_sms_travel = get_param_id_by_name(cur, "Исходящие сообщения в путешествиях по России")
    p_in_travel = get_param_id_by_name(cur, "Входящие вызовы в путешествиях по России")
    p_employee = get_param_id_by_name(cur, "Абонентская плата за услугу Защита сотрудников")
    p_vas = get_param_id_by_name(cur, "Прочие начисления")
    p_national_roaming = get_param_id_by_name(cur, "Услуги национального роуминга")

    cost_per_min = {"home": 0.0, "onnet": 0.0, "other": 0.18, "intercity": 0.25, "travel": 0.18}

    for report_id, user, month in report_ids:
        total_extra = 0.0
        plan_fee = random.choice([140, 230, 400])

        def add_val(pid, vol, no_disc, disc, w_disc):
            nonlocal count
            if pid is None:
                return
            cur.execute(
                """INSERT INTO parameter_values (report_id, parameter_id, volume, no_discount, discount, with_discount)
                   VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (report_id, parameter_id) DO NOTHING""",
                (report_id, pid, vol, no_disc, disc, w_disc),
            )
            count += 1

        add_val(p_plan_fee, "1", plan_fee, 0, plan_fee)
        total_extra += plan_fee

        home_out_min = random.randint(0, 300)
        add_val(p_out_home, volume_str(home_out_min, "мин"), 0, 0, 0)

        home_in_min = random.randint(50, 500)
        add_val(p_in_home, volume_str(home_in_min, "мин"), 0, 0, 0)

        onnet_min = random.randint(0, 200)
        add_val(p_out_onnet, volume_str(onnet_min, "мин"), 0, 0, 0)

        other_min = random.randint(0, 80)
        other_cost = round(other_min * cost_per_min["other"], 2)
        add_val(p_out_other, volume_str(other_min, "мин"), other_cost, 0, other_cost)
        total_extra += other_cost

        intercity_min = random.randint(0, 100)
        intercity_cost = round(intercity_min * cost_per_min["intercity"], 2)
        add_val(p_out_intercity, volume_str(intercity_min, "мин"), intercity_cost, 0, intercity_cost)
        total_extra += intercity_cost

        internet_mb = round(random.uniform(100, 40000), 2)
        internet_cost = round(max(0, (internet_mb - 5000)) * 0.0001, 2) if internet_mb > 5000 else 0
        add_val(p_internet, volume_str(internet_mb, "Мбайт"), internet_cost, 0, internet_cost)
        total_extra += internet_cost

        in_sms = random.randint(0, 300)
        add_val(p_incoming_sms, volume_str(in_sms, "шт"), 0, 0, 0)

        out_sms = random.randint(0, 100)
        sms_cost = round(out_sms * 0.05, 2)
        add_val(p_outgoing_sms, volume_str(out_sms, "шт"), sms_cost, 0, sms_cost)
        total_extra += sms_cost

        if random.random() < 0.3:
            vm_min = random.randint(1, 20)
            vm_cost = round(vm_min * 0.5, 2)
            add_val(p_voicemail, volume_str(vm_min, "мин"), vm_cost, 0, vm_cost)
            total_extra += vm_cost

        if random.random() < 0.2:
            tr_out = random.randint(5, 60)
            tr_cost = round(tr_out * cost_per_min["travel"], 2)
            add_val(p_out_travel, volume_str(tr_out, "мин"), tr_cost, 0, tr_cost)
            total_extra += tr_cost

        if random.random() < 0.2:
            tr_int = round(random.uniform(500, 5000), 2)
            add_val(p_internet_travel, volume_str(tr_int, "Мбайт"), 0, 0, 0)

        if random.random() < 0.15:
            tr_sms = random.randint(1, 30)
            tr_sms_cost = round(tr_sms * 0.1, 2)
            add_val(p_sms_travel, volume_str(tr_sms, "шт"), tr_sms_cost, 0, tr_sms_cost)
            total_extra += tr_sms_cost

        if random.random() < 0.1:
            tr_in = random.randint(5, 50)
            add_val(p_in_travel, volume_str(tr_in, "мин"), 0, 0, 0)

        if random.random() < 0.25:
            emp_fee = random.choice([50, 100, 150])
            add_val(p_employee, "1", emp_fee, 0, emp_fee)
            total_extra += emp_fee

        if random.random() < 0.1:
            add_val(p_vas, "1", random.choice([10, 20, 50]), 0, random.choice([10, 20, 50]))
            total_extra += random.choice([10, 20, 50])

        if random.random() < 0.15:
            add_val(p_national_roaming, "1", 0, 0, 0)

        vat = round(total_extra * 0.22, 2)
        add_val(p_vat, "1", vat, 0, vat)
        total_with_vat = round(total_extra + vat, 2)
        add_val(p_total, "1", total_with_vat, 0, total_with_vat)

    conn.commit()
    print(f"[OK] Generated {count} parameter_values")


def main():
    global conn
    print("=== MegaFon DB Initialization ===")
    conn = connect()
    try:
        cur = create_tables(conn)
        insert_parameters(cur)
        users = generate_users(cur, 50)
        report_ids = generate_reports(cur, users)
        generate_parameter_values(cur, report_ids)
        print("\n=== Done! Database is ready. ===")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
