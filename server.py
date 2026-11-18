import hashlib
import base64
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from functools import cache
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from io import BytesIO
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit

import academic

ROOT = Path(__file__).resolve().parent
DATABASE_URL = os.environ.get("DATABASE_URL")
ON_VERCEL = os.environ.get("VERCEL") == "1"
DB = Path(os.environ.get("PULSE_DB", ROOT / "pulse.sqlite3"))
SESSION_TTL = 8 * 60 * 60
DEMO_CERTIFICATE = "Справка об обучении"
DEMO_TRANSCRIPT = "Выписка из зачётки"
REQUEST_TYPES = {DEMO_CERTIFICATE, "Справка об успеваемости", DEMO_TRANSCRIPT}
CERTIFICATE_CLARIFICATION = "Напишите, куда нужна справка об обучении. Например, по месту работы или для другой организации."
MAX_COMPARISON_TARGETS = 5
PAGE_PATHS = {"/", "/login", "/today", "/schedule", "/schedule/compare", "/grades", "/requests", "/profile", "/notifications", "/news", "/map", "/support"}
SUPPORT_TOPICS = {1: "Вход в аккаунт", 2: "Заявки и справки", 3: "Работа платформы", 4: "Другое"}
MOSCOW = timezone(timedelta(hours=3))
CAMPUS_CALENDAR = {
    "transferDate": "2026-11-09",
    "sessionWeeks": [
        ["2026-11-30", "Зачётная неделя", "Зачёт", "credit"],
        ["2026-12-07", "Экзаменационная неделя", "Экзамен", "exam"],
    ],
    "reminder": ["Проверь расписание сессии", "Уточни даты зачётов и экзаменов перед началом сессии."],
}
CAMPUS_EVENTS = [
    ["Конкурс · до 19 ноября", "Конкурс студенческих проектов «Кампус будущего»", "Предложи улучшение для кампуса. Заявки от команд принимаются до 19 ноября, финал пройдёт 24 ноября в актовом зале."],
    ["Встреча · 23 ноября, 15:30", "День карьеры", "В холле корпуса А можно познакомиться с работодателями, узнать о стажировках и получить обратную связь по резюме."],
    ["Мастер-класс · 26 ноября, 17:00", "Как подготовить проект к защите", "В аудитории Б-204 разберут структуру выступления и проведут короткую репетицию защиты."],
]
CAMPUS_ANNOUNCEMENTS = [
    {"id": "dean-office-hours", "title": "Дополнительные часы приёма в деканате",
     "detail": "25 ноября с 14:00 до 17:00 деканат проведёт дополнительный приём по вопросам справок и заявлений. Кабинет А-210."},
]


def campus_calendar(conn):
    config = academic.content(conn, "calendar")
    transfer_date = date.fromisoformat(config["transferDate"])
    weeks = [(date.fromisoformat(start), title, assessment, kind)
             for start, title, assessment, kind in config["sessionWeeks"]]
    return transfer_date, weeks, config["reminder"]


def session_week(day, weeks):
    return next((week for week in weeks if 0 <= (day - week[0]).days < 7), None)


def lessons_on(group, day, catalog, calendar):
    if 6 <= day.month <= 8:
        return []
    transfer_date, weeks, _ = calendar
    regular, session_courses = catalog.get(group, ([[] for _ in range(7)], []))
    session = session_week(day, weeks)
    if session and session_courses:
        start, _, assessment, kind = session
        courses = [course["title"] for course in session_courses
                   if course.get("assessment") == assessment]
        index = (day - start).days
        if index >= len(courses):
            return []
        title = courses[index]
        regular_lesson = next((lesson for lessons in regular for lesson in lessons if lesson[1] == title), None)
        if regular_lesson is None:
            return []
        _, _, detail, previous_room, _ = regular_lesson
        if previous_room:
            detail = re.sub(r"Ауд\. [^·]+", f"Ауд. {previous_room} ", detail)
        return [["10:00–11:30", title, detail, None, kind]]
    lessons = []
    for time, title, detail, previous_room, kind in regular[day.weekday()]:
        if previous_room and day != transfer_date:
            detail = re.sub(r"Ауд\. [^·]+", f"Ауд. {previous_room} ", detail)
        lessons.append([time, title, detail, previous_room if day == transfer_date else None, kind])
    return lessons


def notification_feed(student, catalog, calendar, today=None, request_updates=()):
    today = today or datetime.now(MOSCOW).date()
    transfer_date, weeks, reminder = calendar
    changed = next((lesson for lesson in lessons_on(student["profile"]["group"], transfer_date, catalog, calendar)
                    if lesson[3]), None)
    sessions = [{"title": title, "start": start.isoformat(), "end": (start + timedelta(days=6)).isoformat()}
                for start, title, _, _ in weeks if -6 <= (start - today).days <= 28]
    feed = {"deadline": student["deadline"], "transfer": changed, "transferDate": transfer_date.isoformat(),
            "sessions": sessions, "requestUpdates": list(request_updates)}
    feed["reminder"] = reminder
    items = [("deadline", student["deadline"]), ("reminder", reminder)]
    if changed:
        items.append(("transfer", [feed["transferDate"], changed]))
    items.extend(("session", item) for item in sessions)
    keys = {
        "notifications": {digest(json.dumps(item, sort_keys=True)) for item in items},
        "requests": {digest(json.dumps(("request", item), sort_keys=True)) for item in request_updates},
    }
    return feed, keys


def student_notifications(conn, user, student=None):
    updates = [dict(row) for row in conn.execute("""
        SELECT id, type, status FROM requests WHERE user_id=? AND type IN (?,?)
        AND status IN ('Требуется уточнение', 'Готова') ORDER BY id DESC
    """, (user["id"], DEMO_CERTIFICATE, DEMO_TRANSCRIPT))]
    student = student or academic.student_profile(conn, user["id"])
    catalog = academic.schedules(conn, student["profile"]["group"])
    feed, keys = notification_feed(student, catalog, campus_calendar(conn), request_updates=updates)
    announcements = academic.content(conn, "announcements")
    feed["announcements"] = announcements
    keys["notifications"].update(digest(json.dumps(("announcement", item), sort_keys=True))
                                 for item in announcements)
    return feed, keys


def campus_news_keys(events):
    return {digest(json.dumps(("campus", item), sort_keys=True)) for item in events}


def unread_count(conn, user_id, keys):
    read = {row["notification_key"] for row in conn.execute(
        "SELECT notification_key FROM notification_reads WHERE user_id=?", (user_id,))}
    return len(keys - read)


def schedule_data(query, own_group, catalog, calendar, weekly=False):
    group = own_group
    value = query.get("date", [datetime.now(MOSCOW).date().isoformat()])[0]
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        start = date.fromisoformat(value)
        if weekly:
            start -= timedelta(days=start.weekday())
        days = [start + timedelta(days=index) for index in range(7 if weekly else 1)]
    except (ValueError, OverflowError):
        raise RequestError(400, "Укажи дату в формате ГГГГ-ММ-ДД.") from None
    session = session_week(start, calendar[1]) if group in catalog and catalog[group][1] else None
    return {"group": group, "sessionTitle": session[1] if session else None,
            "days": [{"date": day.isoformat(), "lessons": lessons_on(group, day, catalog, calendar)} for day in days]}


def teacher_name(lesson):
    return lesson[2].split(" · ", 1)[1]


def schedule_targets(catalog):
    teachers = sorted({teacher_name(lesson) for week, _ in catalog.values()
                       for day in week for lesson in day})
    return {
        **{f"g{index}": ("group", name) for index, name in enumerate(sorted(catalog))},
        **{f"t{index}": ("teacher", name) for index, name in enumerate(teachers)},
    }


def comparison_options(query, own_group, catalog):
    term = query.get("q", [""])[0].strip().casefold()
    if not term or len(term) > 80:
        return {"options": []}
    options = []
    for key, (kind, name) in schedule_targets(catalog).items():
        alias = name.casefold().replace("ис-", "is-").replace("пи-", "pi-") if kind == "group" else ""
        if name != own_group and (term in name.casefold() or term in alias):
            options.append({"id": key, "kind": kind, "name": name})
    return {"options": options[:8]}


def compare_schedules(query, own_group, catalog, calendar):
    available = schedule_targets(catalog)
    own = schedule_data(query, own_group, catalog, calendar)["days"][0]
    day = date.fromisoformat(own["date"])
    targets = list(dict.fromkeys(query.get("target", [])))
    if len(targets) > MAX_COMPARISON_TARGETS or any(key not in available for key in targets):
        raise RequestError(400, f"Выбери до {MAX_COMPARISON_TARGETS} групп или преподавателей из подсказок.")
    schedules = [{"name": own_group, "kind": "own", "lessons": own["lessons"]}]
    for key in targets:
        kind, name = available[key]
        if kind == "group" and name == own_group:
            continue
        if kind == "group":
            lessons = lessons_on(name, day, catalog, calendar)
        else:
            lessons = sorted({(*lesson, group) for group in catalog
                              for lesson in lessons_on(group, day, catalog, calendar) if teacher_name(lesson) == name},
                             key=lambda lesson: (lesson[0], lesson[5], lesson[1]))
        schedules.append({"name": name, "kind": kind, "lessons": lessons})
    return {"date": own["date"], "schedules": schedules, "maxTargets": MAX_COMPARISON_TARGETS}


@contextmanager
def database():
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row
        from postgres import PostgresConnection

        with psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=8) as conn:
            yield PostgresConnection(conn)
        return
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def add_user(conn, login, password, student):
    salt = secrets.token_bytes(16)
    return conn.execute(
        "INSERT INTO users(login, salt, password_hash, student) VALUES (?, ?, ?, ?) RETURNING id",
        (login, salt, password_hash(password, salt), student),
    ).fetchone()["id"]


def initialize():
    with database() as conn:
        tables = """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                login TEXT UNIQUE NOT NULL,
                salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                student TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS avatars (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                image BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                type TEXT NOT NULL,
                status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS request_events (
                id INTEGER PRIMARY KEY,
                request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                occurred_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS notification_reads (
                user_id INTEGER NOT NULL REFERENCES users(id),
                notification_key TEXT NOT NULL,
                PRIMARY KEY (user_id, notification_key)
            );
            CREATE TABLE IF NOT EXISTS request_messages (
                id INTEGER PRIMARY KEY,
                request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
                author TEXT NOT NULL CHECK (author IN ('student', 'office')),
                body TEXT NOT NULL,
                occurred_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS request_messages_request ON request_messages(request_id, id);
            CREATE INDEX IF NOT EXISTS request_events_request ON request_events(request_id, id);
        """
        tables += academic.SCHEMA
        if DATABASE_URL:
            conn.execute("SELECT pg_advisory_xact_lock(761846132)")
            conn.create_schema(tables)
        else:
            conn.executescript(tables + """
            CREATE TRIGGER IF NOT EXISTS request_created AFTER INSERT ON requests
            BEGIN
                INSERT INTO request_events(request_id,status,occurred_at)
                VALUES (NEW.id, NEW.status, unixepoch());
            END;
            CREATE TRIGGER IF NOT EXISTS request_status_changed AFTER UPDATE OF status ON requests
            WHEN OLD.status <> NEW.status
            BEGIN
                INSERT INTO request_events(request_id,status,occurred_at)
                VALUES (NEW.id, NEW.status, unixepoch());
            END;
        """)
            conn.execute("BEGIN IMMEDIATE")
        conn.execute("""
            INSERT INTO request_events(request_id,status,occurred_at)
            SELECT id,status,? FROM requests
            WHERE NOT EXISTS (SELECT 1 FROM request_events WHERE request_id=requests.id)
        """, (int(time.time()),))
        for login in ("sasha.demo", "misha.demo"):
            conn.execute("UPDATE users SET login=? WHERE login=?",
                         (f"{login}@student.example", login))
        if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            for login, password, student, kind in [
                ("sasha.demo@student.example", "Sasha-demo-26!", "sasha", "Справка об обучении"),
                ("misha.demo@student.example", "Misha-demo-26!", "misha", "Справка об успеваемости"),
            ]:
                user_id = add_user(conn, login, password, student)
                request_id = conn.execute("INSERT INTO requests(user_id,type,status) VALUES (?,?,?) RETURNING id",
                                          (user_id, kind, "Принята")).fetchone()["id"]
                conn.execute("UPDATE requests SET status=? WHERE id=?", ("В работе", request_id))
                conn.execute("""
                    UPDATE request_events SET occurred_at =
                        CASE status WHEN 'Принята' THEN 1794209400
                        ELSE 1794215700 END
                    WHERE request_id=?
                """, (request_id,))
        campus_map = json.loads((ROOT / "campus_map.json").read_text(encoding="utf-8"))
        academic.seed(conn, ROOT, {"calendar": CAMPUS_CALENDAR, "news": CAMPUS_EVENTS,
                                   "map": campus_map, "announcements": CAMPUS_ANNOUNCEMENTS})
        conn.execute("""
            INSERT INTO request_messages(request_id,author,body,occurred_at)
            SELECT r.id,'office',?,1794216600
            FROM requests r JOIN users u ON u.id=r.user_id
            WHERE u.student IN ('sasha','misha') AND r.status='В работе' AND r.type<>?
              AND r.id=(SELECT MIN(id) FROM requests WHERE user_id=r.user_id)
              AND NOT EXISTS (SELECT 1 FROM request_messages WHERE request_id=r.id)
        """, ("Уточните, пожалуйста, для какой организации нужна справка.", DEMO_CERTIFICATE))
        conn.execute("""
            UPDATE request_messages SET body=? WHERE author='office' AND body IN (?,?)
            AND request_id IN (SELECT id FROM requests WHERE type=?)
        """, (CERTIFICATE_CLARIFICATION, "Уточни, пожалуйста, для какой организации нужна справка.",
              "Уточните, пожалуйста, для какой организации нужна справка.", DEMO_CERTIFICATE))
        conn.execute("""
            UPDATE requests SET status='Требуется уточнение'
            WHERE type=? AND status IN ('Принята','В работе')
              AND NOT EXISTS (
                SELECT 1 FROM request_messages WHERE request_id=requests.id AND author='student'
              )
        """, (DEMO_CERTIFICATE,))
        conn.execute("""
            INSERT INTO request_messages(request_id,author,body,occurred_at)
            SELECT r.id,'office',?,? FROM requests r
            WHERE r.type=? AND r.status='Требуется уточнение'
              AND NOT EXISTS (
                SELECT 1 FROM request_messages m WHERE m.request_id=r.id AND m.author='office' AND m.body=?
              )
        """, (CERTIFICATE_CLARIFICATION, int(time.time()), DEMO_CERTIFICATE, CERTIFICATE_CLARIFICATION))


def request_with_history(conn, row):
    events = conn.execute("SELECT status,occurred_at FROM request_events WHERE request_id=? ORDER BY id",
                          (row["id"],))
    messages = conn.execute("""
        SELECT id,author,body,occurred_at FROM request_messages WHERE request_id=? ORDER BY id
    """, (row["id"],))
    return {**dict(row), "history": [dict(event) for event in events],
            "messages": [dict(message) for message in messages]}


@cache
def prepare_database():
    initialize()


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class Handler(BaseHTTPRequestHandler):
    def request_url(self):
        url = urlsplit(self.path)
        if not ON_VERCEL or url.path not in ("/api/index", "/api/index.py"):
            return url
        parameters = parse_qsl(url.query, keep_blank_values=True)
        path = next((value for key, value in parameters if key == "_pulse_route"), "")
        query = urlencode([(key, value) for key, value in parameters if key != "_pulse_route"])
        return url._replace(path="/" + path.lstrip("/"), query=query)

    def prepare_cloud_database(self):
        if ON_VERCEL:
            if not DATABASE_URL:
                raise RequestError(503, "База данных ещё не настроена.")
            prepare_database()

    def send_content(self, status, content, content_type, cookie=None, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; object-src 'none'; base-uri 'none'; "
                         "frame-ancestors 'self'; form-action 'self'")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status, data, cookie=None):
        self.send_content(status, json.dumps(data, ensure_ascii=False).encode(),
                          "application/json; charset=utf-8", cookie)

    def token(self):
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
        except CookieError:
            return ""
        item = cookies.get("pulse_session")
        return digest(item.value) if item else ""

    def session_cookie(self, token, ttl):
        secure = "; Secure" if DATABASE_URL or os.environ.get("PULSE_SECURE_COOKIE") == "1" else ""
        return f"pulse_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={ttl}{secure}"

    def user(self, conn):
        user = conn.execute(
            "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id "
            "WHERE s.token=? AND s.expires>?", (self.token(), int(time.time())),
        ).fetchone()
        if user is None:
            raise RequestError(401, "Войди в личный кабинет.")
        return user

    def profile_data(self, conn, user, student=None):
        student = student or academic.student_profile(conn, user["id"])
        _, keys = student_notifications(conn, user, student)
        events = academic.content(conn, "news")
        return {**student["profile"],
                "groupMembers": academic.group_members(student["profile"]),
                "campusMap": academic.content(conn, "map"),
                "unreadCount": unread_count(conn, user["id"], keys["notifications"]),
                "requestUnreadCount": unread_count(conn, user["id"], keys["requests"]),
                "newsUnreadCount": unread_count(conn, user["id"], campus_news_keys(events)),
                "hasAvatar": conn.execute("SELECT 1 FROM avatars WHERE user_id=?", (user["id"],)).fetchone() is not None}

    def read_json(self, max_size=4096):
        if self.headers.get_content_type() != "application/json":
            raise RequestError(415, "Ожидается JSON.")
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or len(length) > 8 or not 0 < int(length) <= max_size:
            raise RequestError(400, "Некорректный размер запроса.")
        try:
            body = json.loads(self.rfile.read(int(length)))
        except (UnicodeError, ValueError):
            raise RequestError(400, "Некорректный запрос.") from None
        if not isinstance(body, dict):
            raise RequestError(400, "Некорректный запрос.")
        return body

    def credentials(self, conn, body):
        email = body.get("email")
        password = body.get("password")
        if (not isinstance(email, str) or not isinstance(password, str)
                or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip())
                or not 1 <= len(password) <= 128):
            raise RequestError(400, "Укажи студенческую почту и пароль.")
        try:
            user = conn.execute("SELECT * FROM users WHERE login=?", (email.strip().lower(),)).fetchone()
            candidate = password_hash(password, user["salt"] if user else bytes(16))
        except UnicodeError:
            raise RequestError(400, "Укажи студенческую почту и пароль.") from None
        if user is None or not hmac.compare_digest(candidate, user["password_hash"]):
            raise RequestError(401, "Неверная почта или пароль.")
        return user["id"]

    def do_GET(self):
        url = self.request_url()
        path = url.path
        assets = {
            **{page: ("index.html", "text/html; charset=utf-8") for page in PAGE_PATHS},
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/interactions.js": ("interactions.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/favicon.svg": ("favicon.svg", "image/svg+xml"),
            "/workspace-texture.webp": ("workspace-texture.webp", "image/webp"),
        }
        if path in assets:
            name, content_type = assets[path]
            self.send_content(200, (ROOT / "web" / name).read_bytes(), content_type)
            return
        try:
            if not self.token():
                raise RequestError(401, "Войди в личный кабинет.")
            self.prepare_cloud_database()
            with database() as conn:
                user = self.user(conn)
                student = academic.student_profile(conn, user["id"])
                profile = student["profile"]
                query = parse_qs(url.query)
                if path == "/api/profile":
                    data = self.profile_data(conn, user, student)
                elif path == "/api/profile/avatar":
                    row = conn.execute("SELECT image FROM avatars WHERE user_id=?", (user["id"],)).fetchone()
                    if row is None:
                        raise RequestError(404, "Аватарка не найдена.")
                    self.send_content(200, row["image"], "image/jpeg")
                    return
                elif path == "/api/requests":
                    rows = conn.execute("SELECT id,type,status FROM requests WHERE user_id=? ORDER BY id DESC",
                                        (user["id"],))
                    _, keys = student_notifications(conn, user, student)
                    data = {"requests": [request_with_history(conn, row) for row in rows],
                            "unreadCount": unread_count(conn, user["id"], keys["requests"])}
                elif path == "/api/today":
                    schedule = schedule_data(query, profile["group"], academic.schedules(conn, profile["group"]),
                                             campus_calendar(conn))
                    last = conn.execute("SELECT id,type,status FROM requests WHERE user_id=? ORDER BY id DESC LIMIT 1",
                                        (user["id"],)).fetchone()
                    data = {**schedule["days"][0], "deadline": student["deadline"],
                            "lastRequest": dict(last) if last else None}
                elif path in ("/api/schedule/today", "/api/schedule/week"):
                    data = schedule_data(query, profile["group"], academic.schedules(conn, profile["group"]),
                                         campus_calendar(conn), weekly=path.endswith("/week"))
                elif path == "/api/schedule/options":
                    data = comparison_options(query, profile["group"], academic.schedules(conn))
                elif path == "/api/schedule/compare":
                    data = compare_schedules(query, profile["group"], academic.schedules(conn), campus_calendar(conn))
                elif path == "/api/points":
                    semesters = academic.semesters(conn, user["id"])
                    data = {"currentSemester": student["currentSemester"],
                            "semesters": [item["number"] for item in semesters]}
                    if "semester" in query:
                        requested = query["semester"][0]
                        semester = next((item for item in semesters
                                         if str(item["number"]) == requested), None)
                        data["semester"] = semester or next(item for item in semesters
                                                            if item["number"] == data["currentSemester"])
                elif re.fullmatch(r"/api/points/[0-9]{1,2}", path):
                    semesters = academic.semesters(conn, user["id"])
                    number = int(path.rsplit("/", 1)[1])
                    data = next((item for item in semesters if item["number"] == number), None)
                    if data is None:
                        raise RequestError(404, "Семестр не найден.")
                elif path == "/api/notifications":
                    data, keys = student_notifications(conn, user, student)
                    data.pop("requestUpdates")
                    data["unreadCount"] = unread_count(conn, user["id"], keys["notifications"])
                elif path == "/api/news":
                    events = academic.content(conn, "news")
                    data = {"campusEvents": events,
                            "unreadCount": unread_count(conn, user["id"], campus_news_keys(events))}
                elif path == "/api/map":
                    data = academic.content(conn, "map")
                elif path == "/api/support":
                    rows = conn.execute("""
                        SELECT m.id, COALESCE(t.thread_id,m.id) AS thread_id, m.topic,m.message,m.reply,m.occurred_at
                        FROM support_messages m LEFT JOIN support_thread_messages t ON t.message_id=m.id
                        WHERE m.user_id=? ORDER BY m.id
                    """, (user["id"],))
                    data = {"topics": SUPPORT_TOPICS, "messages": [dict(row) for row in rows]}
                elif re.fullmatch(r"/api/requests/[0-9]{1,18}/certificate", path):
                    from certificate import create_certificate, create_transcript

                    request_id = int(path.split("/")[-2])
                    row = conn.execute("""
                        SELECT type FROM requests WHERE id=? AND user_id=? AND type IN (?,?) AND status='Готова'
                    """, (request_id, user["id"], DEMO_CERTIFICATE, DEMO_TRANSCRIPT)).fetchone()
                    if row is None:
                        raise RequestError(404, "Справка не найдена.")
                    if row["type"] == DEMO_TRANSCRIPT:
                        last_semester = (profile["year"] - 1) * 2
                        completed = [semester for semester in academic.semesters(conn, user["id"])
                                     if semester["number"] <= last_semester]
                        pdf = create_transcript(request_id, profile, completed)
                        filename = f"academic-transcript-{request_id}.pdf"
                    else:
                        pdf = create_certificate(request_id, profile)
                        filename = f"academic-demo-{request_id}.pdf"
                    self.send_content(200, pdf, "application/pdf", filename=filename)
                    return
                elif re.fullmatch(r"/api/requests/[0-9]{1,18}", path):
                    row = conn.execute("SELECT id,type,status FROM requests WHERE id=? AND user_id=?",
                                       (int(path.rsplit("/", 1)[1]), user["id"])).fetchone()
                    if row is None:
                        raise RequestError(404, "Заявка не найдена.")
                    data = request_with_history(conn, row)
                else:
                    raise RequestError(404, "Страница не найдена.")
            self.send_json(200, data)
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})

    def do_POST(self):
        path = self.request_url().path
        try:
            self.prepare_cloud_database()
            body = self.read_json(180000 if path == "/api/profile/avatar" else 4096)
            cookie = None
            status = 200
            data = {}
            with database() as conn:
                if path == "/api/login":
                    user_id = self.credentials(conn, body)
                    token = secrets.token_urlsafe(32)
                    now = int(time.time())
                    conn.execute("DELETE FROM sessions WHERE token=? OR expires<=?", (self.token(), now))
                    conn.execute("INSERT INTO sessions VALUES (?,?,?)", (digest(token), user_id, now + SESSION_TTL))
                    cookie = self.session_cookie(token, SESSION_TTL)
                    user = conn.execute("SELECT id,student FROM users WHERE id=?", (user_id,)).fetchone()
                    data = self.profile_data(conn, user)
                elif path == "/api/support":
                    user = self.user(conn)
                    thread_id = body.get("thread_id")
                    topic, message = body.get("topic"), body.get("message")
                    if thread_id is not None:
                        if type(thread_id) is not int or not 1 <= thread_id < 2**63:
                            raise RequestError(400, "Некорректный номер чата.")
                        thread = conn.execute("""
                            SELECT m.topic FROM support_messages m
                            LEFT JOIN support_thread_messages t ON t.message_id=m.id
                            WHERE m.id=? AND m.user_id=? AND t.message_id IS NULL
                        """, (thread_id, user["id"])).fetchone()
                        if thread is None:
                            raise RequestError(404, "Чат не найден.")
                        topic = thread["topic"]
                    if type(topic) is not int or topic not in SUPPORT_TOPICS:
                        raise RequestError(400, "Выбери тему обращения.")
                    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 250 or "\x00" in message:
                        raise RequestError(400, "Введи сообщение от 1 до 250 символов.")
                    message = message.strip()
                    try:
                        message.encode("utf-8")
                    except UnicodeError:
                        raise RequestError(400, "Сообщение содержит недопустимые символы.") from None
                    now = int(time.time())
                    message_id = conn.execute("""
                        INSERT INTO support_messages(user_id,topic,message,reply,occurred_at)
                        VALUES (?,?,?,?,?) RETURNING id
                    """, (user["id"], topic, message, "", now)).fetchone()["id"]
                    if thread_id is not None:
                        conn.execute("INSERT INTO support_thread_messages VALUES (?,?)", (message_id, thread_id))
                    data = {"id": message_id, "thread_id": thread_id or message_id, "topic": topic,
                            "message": message, "reply": "", "occurred_at": now}
                    status = 201
                elif path == "/api/profile/avatar":
                    from PIL import Image, UnidentifiedImageError

                    user = self.user(conn)
                    try:
                        raw = base64.b64decode(body.get("image", ""), validate=True)
                        with Image.open(BytesIO(raw), formats=["JPEG"]) as image:
                            if not all(1 <= edge <= 256 for edge in image.size):
                                raise ValueError
                            cleaned = BytesIO()
                            image.convert("RGB").save(cleaned, "JPEG", quality=85)
                    except (TypeError, ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
                        raise RequestError(400, "Не удалось прочитать изображение.") from None
                    conn.execute("INSERT INTO avatars VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET image=excluded.image",
                                 (user["id"], cleaned.getvalue()))
                    data = {"hasAvatar": True}
                elif path == "/api/logout":
                    conn.execute("DELETE FROM sessions WHERE token=?", (self.token(),))
                    cookie = self.session_cookie("", 0)
                elif path in ("/api/notifications/read", "/api/news/read", "/api/requests/read"):
                    user = self.user(conn)
                    keys = (campus_news_keys(academic.content(conn, "news")) if path == "/api/news/read"
                            else student_notifications(conn, user)[1][path.split("/")[2]])
                    conn.executemany("INSERT INTO notification_reads VALUES (?,?) ON CONFLICT DO NOTHING",
                                     ((user["id"], key) for key in keys))
                    data = {"unreadCount": 0}
                elif path == "/api/requests":
                    user = self.user(conn)
                    kind = body.get("type")
                    if not isinstance(kind, str) or kind not in REQUEST_TYPES:
                        raise RequestError(400, "Выбери тип заявки из списка.")
                    if kind == DEMO_CERTIFICATE:
                        purpose = body.get("purpose")
                        if not isinstance(purpose, str) or not 1 <= len(purpose.strip()) <= 250 or "\x00" in purpose:
                            raise RequestError(400, "Укажи, куда нужна справка, от 1 до 250 символов.")
                        purpose = purpose.strip()
                        try:
                            purpose.encode("utf-8")
                        except UnicodeError:
                            raise RequestError(400, "Поле содержит недопустимые символы.") from None
                    cursor = conn.execute("INSERT INTO requests(user_id,type,status) VALUES (?,?,?) RETURNING id",
                                          (user["id"], kind, "Принята"))
                    request_id = cursor.fetchone()["id"]
                    request_status = "Принята"
                    if kind == DEMO_CERTIFICATE:
                        now = int(time.time())
                        conn.executemany("""
                            INSERT INTO request_messages(request_id,author,body,occurred_at) VALUES (?,?,?,?)
                        """, [(request_id, "office", CERTIFICATE_CLARIFICATION, now),
                              (request_id, "student", purpose, now)])
                    if kind in (DEMO_CERTIFICATE, DEMO_TRANSCRIPT):
                        for request_status in ("В работе", "Готова"):
                            conn.execute("UPDATE requests SET status=? WHERE id=?", (request_status, request_id))
                    status = 201
                    data = request_with_history(conn, {"id": request_id, "type": kind, "status": request_status})
                    data["unreadCount"] = unread_count(conn, user["id"], student_notifications(conn, user)[1]["requests"])
                elif re.fullmatch(r"/api/requests/[0-9]{1,18}/messages", path):
                    if not DATABASE_URL:
                        conn.execute("BEGIN IMMEDIATE")
                    user = self.user(conn)
                    request_id = int(path.split("/")[-2])
                    request = conn.execute("SELECT id,type,status FROM requests WHERE id=? AND user_id=?"
                                           + (" FOR UPDATE" if DATABASE_URL else ""),
                                           (request_id, user["id"])).fetchone()
                    if request is None:
                        raise RequestError(404, "Заявка не найдена.")
                    message = body.get("message")
                    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 1000:
                        raise RequestError(400, "Сообщение должно содержать от 1 до 1000 символов.")
                    message = message.strip()
                    try:
                        message.encode("utf-8")
                    except UnicodeError:
                        raise RequestError(400, "Сообщение содержит недопустимые символы.") from None
                    now = int(time.time())
                    cursor = conn.execute("""
                        INSERT INTO request_messages(request_id,author,body,occurred_at)
                        VALUES (?,'student',?,?) RETURNING id
                    """, (request_id, message, now))
                    status = 201
                    data = {"id": cursor.fetchone()["id"], "author": "student", "body": message, "occurred_at": now}
                    if request["status"] == "Требуется уточнение" and request["type"] == DEMO_CERTIFICATE:
                        for new_status in ("В работе", "Готова"):
                            conn.execute("UPDATE requests SET status=? WHERE id=?", (new_status, request_id))
                        data["request"] = request_with_history(conn, {**dict(request), "status": "Готова"})
                        data["unreadCount"] = unread_count(conn, user["id"], student_notifications(conn, user)[1]["requests"])
                else:
                    raise RequestError(404, "Страница не найдена.")
            self.send_json(status, data, cookie)
        except RequestError as error:
            self.send_json(error.status, {"error": error.message})


if __name__ == "__main__":
    initialize()
    port = int(os.environ.get("PULSE_PORT", "8765"))
    host = os.environ.get("PULSE_HOST", "127.0.0.1")
    with ThreadingHTTPServer((host, port), Handler) as server:
        print(f"http://{host}:{port}", flush=True)
        server.serve_forever()
