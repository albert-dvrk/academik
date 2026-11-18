import json


SCHEMA = """
    CREATE TABLE IF NOT EXISTS student_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        nickname TEXT NOT NULL,
        initials TEXT NOT NULL,
        name TEXT NOT NULL,
        year INTEGER NOT NULL,
        group_name TEXT NOT NULL,
        faculty TEXT NOT NULL,
        program TEXT NOT NULL,
        current_semester INTEGER NOT NULL,
        deadline TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS student_semesters (
        user_id INTEGER NOT NULL REFERENCES users(id),
        semester INTEGER NOT NULL,
        courses TEXT NOT NULL,
        PRIMARY KEY (user_id, semester)
    );
    CREATE TABLE IF NOT EXISTS group_schedules (
        group_name TEXT PRIMARY KEY,
        weekly_lessons TEXT NOT NULL,
        session_courses TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campus_content (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS student_record_books (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        number TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        topic INTEGER NOT NULL,
        message TEXT NOT NULL,
        reply TEXT NOT NULL,
        occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS support_messages_user ON support_messages(user_id, id);
    CREATE TABLE IF NOT EXISTS support_thread_messages (
        message_id INTEGER PRIMARY KEY REFERENCES support_messages(id),
        thread_id INTEGER NOT NULL REFERENCES support_messages(id)
    );
"""


def seed(conn, root, campus):
    users = list(conn.execute("""
        SELECT id, student FROM users WHERE NOT EXISTS (
            SELECT 1 FROM student_profiles WHERE user_id=users.id
        )
    """))
    needs_schedules = conn.execute("SELECT 1 FROM group_schedules LIMIT 1").fetchone() is None
    if users or needs_schedules:
        demo = json.loads((root / "demo.json").read_text(encoding="utf-8"))
    for user in users:
        student = demo[user["student"]]
        profile = student["profile"]
        conn.execute("INSERT INTO student_profiles VALUES (?,?,?,?,?,?,?,?,?,?)", (
            user["id"], profile["nickname"], profile["initials"], profile["name"], profile["year"],
            profile["group"], profile["faculty"], profile["program"], student["currentSemester"],
            json.dumps(student["deadline"], ensure_ascii=False),
        ))
        conn.executemany("INSERT INTO student_semesters VALUES (?,?,?)", [
            (user["id"], semester["number"], json.dumps(semester["courses"], ensure_ascii=False))
            for semester in student["semesters"]
        ])
    if needs_schedules:
        groups = json.loads((root / "extra_schedules.json").read_text(encoding="utf-8"))
        session_courses = {}
        for student in demo.values():
            group = student["profile"]["group"]
            groups[group] = student["lessons"]
            semester = next(item for item in student["semesters"] if item["number"] == student["currentSemester"])
            session_courses[group] = [
                {"title": course["title"], "assessment": course["assessment"]}
                for course in semester["courses"]
            ]
        conn.executemany("INSERT INTO group_schedules VALUES (?,?,?)", [
            (group, json.dumps(lessons, ensure_ascii=False), json.dumps(session_courses.get(group, []), ensure_ascii=False))
            for group, lessons in groups.items()
        ])
    conn.executemany("INSERT INTO campus_content VALUES (?,?) ON CONFLICT DO NOTHING", [
        (key, json.dumps(value, ensure_ascii=False)) for key, value in campus.items()
    ])
    conn.executemany("UPDATE student_profiles SET faculty=? WHERE faculty=?", [
        ("Информационные технологии", "Информационных технологий"),
        ("Прикладная информатика", "Прикладной информатики"),
    ])
    conn.executemany("""
        INSERT INTO student_record_books(user_id,number)
        SELECT id,? FROM users WHERE student=? ON CONFLICT DO NOTHING
    """, [("ДЕМО-2401", "sasha"), ("ДЕМО-2302", "misha")])
    for title, old, new in (
        ("Лабораторная № 4", "11 ноября до 23:59 · SQL", "23 ноября до 23:59 · SQL"),
        ("Практическая работа № 2", "13 ноября до 18:00 · Компьютерные сети", "24 ноября до 18:00 · Компьютерные сети"),
    ):
        conn.execute("UPDATE student_profiles SET deadline=? WHERE deadline=?", (
            json.dumps({"title": title, "detail": new}, ensure_ascii=False),
            json.dumps({"title": title, "detail": old}, ensure_ascii=False),
        ))


def student_profile(conn, user_id):
    row = conn.execute("""
        SELECT p.*, r.number AS record_book FROM student_profiles p
        LEFT JOIN student_record_books r ON r.user_id=p.user_id WHERE p.user_id=?
    """, (user_id,)).fetchone()
    profile = {key: row[key] for key in ("nickname", "initials", "name", "year", "faculty", "program")}
    profile["group"] = row["group_name"]
    profile["recordBook"] = row["record_book"]
    return {"profile": profile, "currentSemester": row["current_semester"], "deadline": json.loads(row["deadline"])}


DEMO_GROUP_MEMBERS = {
    "ИС-24": (
        "Андреева Т. Г.", "Васильев В. Ю.", "Волков А. Б.", "Иванова М. Д.",
        "Козлов Н. М.", "Кузнецова Е. В.", "Морозов Р. Л.", "Новикова И. С.",
        "Орлова Ю. П.", "Попов Д. Р.", "Соколов К. А.",
    ),
    "ПИ-23": (
        "Алексеев Г. Т.", "Егорова Д. К.", "Зайцев П. И.", "Лебедева А. Н.",
        "Михайлов Б. С.", "Николаева Л. В.", "Петров С. Е.", "Романова В. М.",
        "Смирнов И. Р.", "Фёдорова Н. О.", "Яковлев М. Д.",
    ),
}


def group_members(profile):
    return DEMO_GROUP_MEMBERS.get(profile["group"], ())


def semesters(conn, user_id):
    rows = conn.execute("SELECT semester,courses FROM student_semesters WHERE user_id=? ORDER BY semester", (user_id,))
    return [{"number": row["semester"], "courses": json.loads(row["courses"])} for row in rows]


def schedules(conn, group=None):
    sql = "SELECT group_name,weekly_lessons,session_courses FROM group_schedules"
    rows = conn.execute(sql) if group is None else conn.execute(sql + " WHERE group_name=?", (group,))
    return {row["group_name"]: (json.loads(row["weekly_lessons"]), json.loads(row["session_courses"])) for row in rows}


def content(conn, key):
    row = conn.execute("SELECT payload FROM campus_content WHERE key=?", (key,)).fetchone()
    return json.loads(row["payload"])
