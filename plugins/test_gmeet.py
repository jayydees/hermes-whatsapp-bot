"""Run with: python test_gmeet.py"""
import asyncio
import hashlib
import importlib.util
import inspect
import io
import json
import os
import re
import socket
import sys
import tempfile
import time
import urllib.error
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "gmeet", "__init__.py")
spec = importlib.util.spec_from_file_location("gmeet_plugin", PATH)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

NOW = datetime(2026, 10, 17, 14, 0, tzinfo=g.IST)
URI = "https://meet.google.com/abc-defg-hij"
fails = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


# ---------------------------------------------------------------- parse

def dt(*a):
    return ("at", datetime(*a, tzinfo=g.IST))


PARSE_OK = {
    "9pm": dt(2026, 10, 17, 21, 0),
    "9 pm": dt(2026, 10, 17, 21, 0),
    "9PM": dt(2026, 10, 17, 21, 0),
    "9:30pm": dt(2026, 10, 17, 21, 30),
    "9.30pm": dt(2026, 10, 17, 21, 30),
    "9:30 pm": dt(2026, 10, 17, 21, 30),
    "21:00": dt(2026, 10, 17, 21, 0),
    "21.00": dt(2026, 10, 17, 21, 0),
    "2130": dt(2026, 10, 17, 21, 30),
    "0930": dt(2026, 10, 18, 9, 30),
    "9am": dt(2026, 10, 18, 9, 0),
    "12am": dt(2026, 10, 18, 0, 0),
    "12pm": dt(2026, 10, 18, 12, 0),
    "12am 20-10-2026": dt(2026, 10, 20, 0, 0),
    "12pm 20-10-2026": dt(2026, 10, 20, 12, 0),
    "9pm 18-10-2026": dt(2026, 10, 18, 21, 0),
    "18-10-2026 9pm": dt(2026, 10, 18, 21, 0),
    "9pm 18/10/2026": dt(2026, 10, 18, 21, 0),
    "9pm 18.10.2026": dt(2026, 10, 18, 21, 0),
    "9pm 18-10-26": dt(2026, 10, 18, 21, 0),
    "9pm 18-10": dt(2026, 10, 18, 21, 0),
    "9pm 8-1-2027": dt(2027, 1, 8, 21, 0),
    "9pm tomorrow": dt(2026, 10, 18, 21, 0),
    "tomorrow 9pm": dt(2026, 10, 18, 21, 0),
    "9pm tmrw": dt(2026, 10, 18, 21, 0),
    "9pm today": dt(2026, 10, 17, 21, 0),
    "9pm 01-01": dt(2027, 1, 1, 21, 0),
    "9pm 16-10": dt(2027, 10, 16, 21, 0),
    "1:58pm 17-10-2026": dt(2026, 10, 17, 13, 58),
    "11:59pm 31-12-2026": dt(2026, 12, 31, 23, 59),
    "5pm": dt(2026, 10, 17, 17, 0),
    "  9pm   18-10-2026  ": dt(2026, 10, 18, 21, 0),
    "9pm 17-10-2027": dt(2027, 10, 17, 21, 0),
    "9pm,18-10-2026": dt(2026, 10, 18, 21, 0),
    "9pm, 18-10-2026": dt(2026, 10, 18, 21, 0),
    "9 PM , 18-10-2026": dt(2026, 10, 18, 21, 0),
    "Tomorrow 9:30 PM": dt(2026, 10, 18, 21, 30),
    "1:58pm 17-10": dt(2026, 10, 17, 13, 58),
}
for args, want in PARSE_OK.items():
    check(f"parse {args!r}", g.parse(args, NOW) == want)

for args in ["instant", "INSTANT", "Instant", "now", "NOW"]:
    check(f"parse {args!r} instant", g.parse(args, NOW) == ("instant",))

PARSE_ERR = [
    "", "   ", "9", "21", "9pm 31-02-2026", "9pm 31-02", "9pm 18-10-202", "13pm", "0pm", "25:00",
    "9:60pm", "9pm 16-10-2026", "9pm 17-10-2025", "9pm 18-10-2027", "foo", "9pm foo", "9pm 10pm",
    "18-10-2026", "tomorrow", "instant 9pm", "1:30am today", "9pm 18-10-20266",
    "1pm 17-10", "1pm today", "9pm 29-02", "9pm 29-02-2027", "9pm 32-10", "9pm 18-13", "9pm 29-02-2028", ",", "9pm,,10pm",
]
for args in PARSE_ERR:
    r = g.parse(args, NOW)
    check(f"parse error {args!r}", r[0] == "error" and bool(r[1]))
check("empty gives usage", g.parse("", NOW) == ("error", g.USAGE))
check("garbage gives usage", g.parse("foo", NOW) == ("error", g.USAGE))
check("bare hour message", "am/pm" in g.parse("9", NOW)[1])
check("passed message", g.parse("9pm 16-10-2026", NOW)[1].startswith("That time has passed ("))
check("passed today without year is an error, not next year", g.parse("1pm 17-10", NOW)[1].startswith("That time has passed ("))
check("passed today message", g.parse("1pm today", NOW)[1].startswith("That time has passed ("))
check("29-02 non-leap says date does not exist", g.parse("9pm 29-02", NOW) == ("error", "That date does not exist."))
check("29-02 rolls to leap year", g.parse("9pm 29-02", datetime(2027, 3, 1, 10, 0, tzinfo=g.IST)) == dt(2028, 2, 29, 21, 0))
check("just after midnight keeps yesterday within grace", g.parse("11:58pm 16-10", datetime(2026, 10, 17, 0, 1, tzinfo=g.IST)) == dt(2026, 10, 16, 23, 58))
check("new year: 31-12 within grace stays last year", g.parse("11:58pm 31-12", datetime(2027, 1, 1, 0, 1, tzinfo=g.IST)) == dt(2026, 12, 31, 23, 58))
check("new year: 01-01 is today", g.parse("9pm 01-01", datetime(2027, 1, 1, 0, 1, tzinfo=g.IST)) == dt(2027, 1, 1, 21, 0))
check("no date passed time rolls to tomorrow", g.parse("1pm", NOW) == dt(2026, 10, 18, 13, 0))
check("usage has no em dash", "\u2014" not in g.USAGE)


# ---------------------------------------------------------------- formatter

def hermes_format(s):
    s = re.sub(r'(?<!\*)\*(?!\s|\*)([^*\n]*?\S[^*\n]*?)\*(?!\*)', r'_\1_', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'*\1*', s)
    s = re.sub(r'__(.+?)__', r'*\1*', s)
    s = re.sub(r'~~(.+?)~~', r'~\1~', s)
    return s


inst = hermes_format(g._reply(("instant",), URI, False)).split("\n")
check("fmt instant label bold", inst[0] == "*Google Meet, instant*")
check("fmt instant url alone", inst[1] == URI)
sched_plan = ("at", datetime(2026, 10, 18, 21, 0, tzinfo=g.IST))
sched = hermes_format(g._reply(sched_plan, URI, False)).split("\n")
check("fmt sched label bold", sched[0] == "*Google Meet, Sun 18 Oct 2026, 9:00 PM IST* (60 min)")
check("fmt sched url alone", sched[1] == URI)
under = "https://meet.google.com/a_b_c"
check("fmt url with underscores unchanged", hermes_format(g._reply(("instant",), under, False)).split("\n")[1] == under)
am = g._reply(("at", datetime(2026, 10, 19, 9, 30, tzinfo=g.IST)), URI, True).split("\n")
check("reply 9:30 AM, existing", am[0] == "**Google Meet, Mon 19 Oct 2026, 9:30 AM IST** (60 min)" and am[2] == "Already on your Google Calendar.")
check("reply midnight is 12:00 AM", "12:00 AM" in g._reply(("at", datetime(2026, 10, 19, 0, 0, tzinfo=g.IST)), URI, False))


# ---------------------------------------------------------------- fake network

class Resp:
    def __init__(self, status, body):
        self.status, self._b = status, body

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_urlopen(route):
    calls = []

    def urlopen(req, timeout=None):
        calls.append((req.get_method(), req.full_url, json.loads(req.data) if req.data and req.data[:1] == b"{" else None))
        status, body = route(req)
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        if status >= 400:
            raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(body))
        return Resp(status, body)

    urlopen.calls = calls
    return urlopen


def base_route(events_get=None, events_post=None, space=None, token=None):
    def route(req):
        u, m = req.full_url, req.get_method()
        if u.startswith("https://oauth.test/"):
            return token or (200, {"access_token": "AT", "expires_in": 3599})
        if u.startswith(g.MEET_API):
            return space or (200, {"meetingUri": URI, "meetingCode": "abc-defg-hij"})
        if m == "GET":
            return events_get() if callable(events_get) else events_get
        return events_post or (200, {"id": "x"})
    return route


tmp = tempfile.mkdtemp()
tokfile = os.path.join(tmp, "tok.json")
with open(tokfile, "w") as f:
    json.dump({"client_id": "c", "client_secret": "s", "refresh_token": "r", "token_uri": "https://oauth.test/token"}, f)
os.environ["GMEET_TOKEN"] = tokfile
g._now = lambda: NOW
real_urlopen = g.urllib.request.urlopen


def run(args, route):
    g._tok.update(value=None, exp=0.0)
    fu = fake_urlopen(route)
    g.urllib.request.urlopen = fu
    try:
        return asyncio.run(g._handle(args)), fu.calls
    finally:
        g.urllib.request.urlopen = real_urlopen


# ---------------------------------------------------------------- handler never raises

def boom(exc):
    def route(req):
        if req.full_url.startswith("https://oauth.test/"):
            return 200, {"access_token": "AT", "expires_in": 3599}
        raise exc
    return route


FAILURES = {
    "http 500 json": lambda: base_route(space=(500, {"error": {"message": "backend down"}})),
    "http 500 html": lambda: base_route(space=(500, "<html>oops</html>")),
    "urlerror": lambda: boom(urllib.error.URLError("dns")),
    "socket timeout": lambda: boom(socket.timeout("slow")),
    "html 200": lambda: base_route(space=(200, "<html>login</html>")),
    "401 json": lambda: base_route(space=(401, {"error": {"message": "Invalid Credentials"}})),
    "invalid_grant": lambda: base_route(token=(400, {"error": "invalid_grant"})),
    "bad space uri": lambda: base_route(space=(200, {"meetingUri": "http://evil.test/x", "meetingCode": "c"})),
}
for name, mk in FAILURES.items():
    out, _ = run("instant", mk())
    check(f"handler failure: {name}", isinstance(out, str) and out.startswith("Could not create the link:"))
out, _ = run("instant", FAILURES["401 json"]())
check("401 message carries Google text", "Invalid Credentials" in out and "AT" not in out.replace("Invalid", ""))
out, _ = run("instant", FAILURES["invalid_grant"]())
check("invalid_grant message", "Re-run gmeet-auth" in out)
os.environ["GMEET_TOKEN"] = os.path.join(tmp, "missing.json")
out, _ = run("instant", base_route())
check("missing token file", out.startswith("Could not create the link:"))
os.environ["GMEET_TOKEN"] = tokfile
out, calls = run("garbage", base_route())
check("parse error returns usage, no network", out == g.USAGE and not calls)
out, _ = run(None, base_route())
check("None args returns usage", out == g.USAGE)


# ---------------------------------------------------------------- happy paths

out, calls = run("instant", base_route())
check("instant reply", out == f"**Google Meet, instant**\n{URI}\nAnyone with the link can join.")
check("instant makes token + space calls only", [c[1].split("/")[2] for c in calls] == ["oauth.test", "meet.googleapis.com"])
check("space body is OPEN", calls[1][2] == {"config": {"accessType": "OPEN"}})

eid = "gm" + hashlib.sha1(datetime(2026, 10, 18, 21, 0, tzinfo=g.IST).isoformat().encode()).hexdigest()[:24]
out, calls = run("9pm 18-10-2026", base_route(events_get=(404, {"error": {"message": "Not Found"}})))
check("scheduled new reply", out.splitlines()[0] == "**Google Meet, Sun 18 Oct 2026, 9:00 PM IST** (60 min)" and out.splitlines()[2] == "Added to your Google Calendar.")
check("scheduled new call order", [(c[0], c[1].split("/")[2]) for c in calls] == [("POST", "oauth.test"), ("GET", "www.googleapis.com"), ("POST", "meet.googleapis.com"), ("POST", "www.googleapis.com")])
body = calls[-1][2]
check("event id deterministic", body["id"] == eid and calls[1][1].endswith("/" + eid) and re.fullmatch(r"[a-v0-9]{5,1024}", eid))
check("event times", body["start"] == {"dateTime": "2026-10-18T21:00:00+05:30", "timeZone": "Asia/Kolkata"} and body["end"]["dateTime"] == "2026-10-18T22:00:00+05:30")
check("event attaches open space", body["location"] == URI and body["description"] == "Join: " + URI and body["conferenceData"]["conferenceId"] == "abc-defg-hij" and body["conferenceData"]["entryPoints"][0]["label"] == "meet.google.com/abc-defg-hij")
check("event insert asks for conferenceDataVersion", "conferenceDataVersion=1" in calls[-1][1])

g.ATTACH_MODE = "create"
_, calls = run("9pm 18-10-2026", base_route(events_get=(404, {})))
g.ATTACH_MODE = "attach"
cd = calls[-1][2]["conferenceData"]
check("create mode uses createRequest", cd == {"createRequest": {"requestId": eid, "conferenceSolutionKey": {"type": "hangoutsMeet"}}} and calls[-1][2]["location"] == URI)

other = "https://meet.google.com/xyz-xyz-xyz"
out, calls = run("9pm 18-10-2026", base_route(events_get=(200, {"location": other, "hangoutLink": "https://meet.google.com/zzz-zzzz-zzz"})))
check("existing event returns location", out.splitlines()[1] == other and out.splitlines()[2] == "Already on your Google Calendar.")
check("existing event makes no space call", not any("meet.googleapis.com" in c[1] for c in calls))
out, _ = run("9pm 18-10-2026", base_route(events_get=(200, {"location": "Room 4", "hangoutLink": "https://meet.google.com/zzz-zzzz-zzz"})))
check("falls back to hangoutLink", out.splitlines()[1] == "https://meet.google.com/zzz-zzzz-zzz")

seq = iter([(404, {}), (200, {"location": other})])
out, calls = run("9pm 18-10-2026", base_route(events_get=lambda: next(seq), events_post=(409, {"error": {"message": "exists"}})))
check("insert 409 falls back to GET", out.splitlines()[1] == other and out.splitlines()[2] == "Already on your Google Calendar.")

out, _ = run("9pm 18-10-2026", base_route(events_get=(403, {"error": {"message": "Calendar API has not been used"}})))
check("calendar 403 message", out.startswith("Could not create the link:") and "Calendar API has not been used" in out)


# ---------------------------------------------------------------- deleted / moved events (id variants)

START = {"dateTime": "2026-10-18T21:00:00+05:30", "timeZone": "Asia/Kolkata"}
LIVE = (200, {"status": "confirmed", "location": other, "start": START})
CANC = (200, {"status": "cancelled", "location": "https://meet.google.com/dead-dead-dea", "start": START})
NF = (404, {"error": {"message": "Not Found"}})
V = [eid] + [eid + f"v{n}" for n in range(1, g.VARIANTS + 1)]


def slot_route(gets, post=(200, {"id": "x"})):
    def route(req):
        u, m = req.full_url, req.get_method()
        if m == "GET" and u.startswith(g.CAL_API + "/"):
            q = gets.get(u.rsplit("/", 1)[1], [NF])
            return q.pop(0) if len(q) > 1 else q[0]
        if m == "POST" and u.startswith(g.CAL_API):
            return post(req) if callable(post) else post
        return base_route()(req)
    return route


def cal_posts(calls):
    return [c[2]["id"] for c in calls if c[0] == "POST" and c[1].startswith(g.CAL_API)]


def cal_gets(calls):
    return [c[1].rsplit("/", 1)[1] for c in calls if c[0] == "GET"]


check("variant ids are valid base32hex", all(re.fullmatch(r"[a-v0-9]{5,1024}", v) for v in V) and len(set(V)) == len(V))
out, calls = run("9pm 18-10-2026", slot_route({V[0]: [CANC]}))
check("deleted event: new event on v1", out.splitlines()[1] == URI and out.splitlines()[2] == "Added to your Google Calendar." and cal_posts(calls) == [V[1]] and cal_gets(calls) == V[:2])
check("deleted event: dead link never returned", "dead-dead-dea" not in out)
out, calls = run("9pm 18-10-2026", slot_route({V[0]: [CANC], V[1]: [LIVE]}))
check("deleted then recreated: v1 is already there", out.splitlines()[1] == other and out.splitlines()[2] == "Already on your Google Calendar." and not cal_posts(calls) and not any("meet.googleapis.com" in c[1] for c in calls))
out, calls = run("9pm 18-10-2026", slot_route({v: [CANC] for v in V}))
check("all variants deleted: clear error, no insert", out.startswith("Could not create the link:") and "deleted" in out and not cal_posts(calls) and cal_gets(calls) == V)
out, calls = run("9pm 18-10-2026", slot_route({V[0]: [NF, NF]}, post=lambda req: (409, {}) if json.loads(req.data)["id"] == V[0] else (200, {})))
check("purged id (404 but 409 on insert): moves to v1, one space", out.splitlines()[2] == "Added to your Google Calendar." and cal_posts(calls) == V[:2] and sum("meet.googleapis.com" in c[1] for c in calls) == 1)
out, calls = run("9pm 18-10-2026", slot_route({V[0]: [NF, LIVE]}, post=(409, {})))
check("insert race 409 then live: already there", out.splitlines()[1] == other and out.splitlines()[2] == "Already on your Google Calendar." and cal_posts(calls) == [V[0]])
moved = (200, {"status": "confirmed", "location": other, "start": {"dateTime": "2026-10-19T22:00:00+05:30"}})
out, calls = run("9pm 18-10-2026", slot_route({V[0]: [moved]}))
check("moved event: new event on v1", out.splitlines()[1] == URI and cal_posts(calls) == [V[1]])
utc = (200, {"status": "confirmed", "location": other, "start": {"dateTime": "2026-10-18T15:30:00Z"}})
out, _ = run("9pm 18-10-2026", slot_route({V[0]: [utc]}))
check("same instant in UTC counts as same slot", out.splitlines()[1] == other and out.splitlines()[2] == "Already on your Google Calendar.")
out, calls = run("9pm 18-10-2026", slot_route({V[0]: [(410, {"error": {"message": "Gone"}})]}))
check("410 gone: new event on v1", out.splitlines()[2] == "Added to your Google Calendar." and cal_posts(calls) == [V[1]])

# token cached across calls
g._tok.update(value=None, exp=0.0)
fu = fake_urlopen(base_route())
g.urllib.request.urlopen = fu
asyncio.run(g._handle("instant"))
asyncio.run(g._handle("instant"))
g.urllib.request.urlopen = real_urlopen
check("access token cached", sum(1 for c in fu.calls if "oauth.test" in c[1]) == 1)


# ---------------------------------------------------------------- in-flight guard

def slow_route(req):
    if "meet.googleapis.com" in req.full_url:
        time.sleep(0.3)
    return base_route()(req)


async def twice():
    return await asyncio.gather(g._handle("instant"), g._handle("instant"))


g._tok.update(value=None, exp=0.0)
g.urllib.request.urlopen = fake_urlopen(slow_route)
a, b = asyncio.run(twice())
g.urllib.request.urlopen = real_urlopen
check("in-flight guard", "Already creating that link, one moment." in (a, b))
check("in-flight guard lets first succeed", any(URI in x for x in (a, b)))
check("in-flight set cleared", not g._inflight)


# ---------------------------------------------------------------- secrets never leak, malformed login

import http.client
import logging


class Cap(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(self.format(record))


cap = Cap()
g.log.addHandler(cap)
g.log.setLevel(logging.DEBUG)
SECRETS = ["SECRETclientid", "SECRETclientsecret", "SECRETrefresh", "SECRETaccess"]
with open(tokfile, "w") as f:
    json.dump({"client_id": SECRETS[0], "client_secret": SECRETS[1], "refresh_token": SECRETS[2], "token_uri": "https://oauth.test/token"}, f)


def secret_token(route):
    def r(req):
        st, body = route(req)
        if isinstance(body, dict) and body.get("access_token") == "AT":
            body = dict(body, access_token=SECRETS[3])
        return st, body
    return r


def weird(req):
    if req.full_url.startswith("https://oauth.test/"):
        return 200, {"access_token": SECRETS[3], "expires_in": 3599}
    raise RuntimeError("unexpected")


EXTRA = {
    "incomplete read": lambda: boom(http.client.IncompleteRead(b"")),
    "unexpected exception": lambda: weird,
    "token 500": lambda: base_route(token=(500, {"error": "internal"})),
    "token html": lambda: base_route(token=(200, "<html/>")),
    "token no access_token": lambda: base_route(token=(200, {"expires_in": 3599})),
}
outs = {}
for name, mk in list(FAILURES.items()) + list(EXTRA.items()):
    outs[name], _ = run("instant", secret_token(mk()))
    if name in EXTRA:
        check(f"handler failure: {name}", outs[name].startswith("Could not create the link:"))
outs["cal 500"], _ = run("9pm 18-10-2026", secret_token(slot_route({}, post=(500, {"error": {"message": "x"}}))))
check("incomplete read reads as timeout", outs["incomplete read"] == "Could not create the link: " + g._SLOW)
blob = "\n".join(list(outs.values()) + cap.lines)
check("logs captured, incl. a traceback", len(cap.lines) > 5 and "Traceback" in blob)
check("no secret in any reply or log line", not any(x in blob for x in SECRETS) and "Bearer" not in blob)

for name, content in {"missing": None, "not json": "{oops", "json list": "[]", "missing key": '{"client_id": "c"}'}.items():
    path = os.path.join(tmp, "bad.json")
    if os.path.exists(path):
        os.remove(path)
    if content is not None:
        with open(path, "w") as f:
            f.write(content)
    os.environ["GMEET_TOKEN"] = path
    out, calls = run("instant", base_route())
    check(f"token file {name}: setup message, no network", out == "Could not create the link: Google login not set up yet. Run gmeet-auth on the PC." and not calls)
os.environ["GMEET_TOKEN"] = tokfile
g.log.removeHandler(cap)


# ---------------------------------------------------------------- register + files

class Ctx:
    def register_command(self, name, **kw):
        self.name, self.kw = name, kw


c = Ctx()
g.register(c)
check("register_command", c.name == "gmeet" and c.kw["handler"] is g._handle and inspect.iscoroutinefunction(g._handle))
EM = "\u2014"
check("no em dash in __init__.py", EM not in open(PATH, encoding="utf-8").read())
check("no em dash in plugin.yaml", EM not in open(os.path.join(HERE, "gmeet", "plugin.yaml"), encoding="utf-8").read())
check("no em dash in test_gmeet.py", EM not in open(os.path.abspath(__file__), encoding="utf-8").read())

print()
if fails:
    print(f"{len(fails)} FAILED")
    sys.exit(1)
print("ALL PASS")
