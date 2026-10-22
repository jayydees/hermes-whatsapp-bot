"""Hermes /gmeet command: Google Meet links (instant or on the calendar) with no LLM."""
import asyncio
import hashlib
import http.client
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

log = logging.getLogger("gmeet")

IST = timezone(timedelta(hours=5, minutes=30))
_now = lambda: datetime.now(IST)

ATTACH_MODE = "attach"  # "attach": reuse the open space; "create": let Calendar make its own conference
MEET_PREFIX = "https://meet.google.com/"
MEET_API = "https://meet.googleapis.com/v2/spaces"
CAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
DEFAULT_TOKEN_PATH = "/opt/data/secrets/gmeet-token.json"
TOTAL_BUDGET = 15
REQUEST_TIMEOUT = 8
VARIANTS = 5  # extra event ids per slot after deletions: base+"v1" .. base+"v5"

USAGE = "Usage: /gmeet instant  or  /gmeet 9pm 18-10-2026"
_SLOW = "Google did not answer in time, try again"
_ODD = "Google returned an unexpected reply, try again"

_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class GmeetError(Exception):
    pass


# ---------------------------------------------------------------- parsing

_TIME12 = re.compile(r"(\d{1,2})(?:[:.](\d{2}))?(am|pm)")
_TIME24 = re.compile(r"(\d{1,2})[:.](\d{2})|(\d{2})(\d{2})")
_DATE = re.compile(r"(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d+))?")
_REL = {"today": 0, "tomorrow": 1, "tmrw": 1}


def _parse_time(tok):
    """Return (hour, minute), None if tok is not time-shaped, ValueError if shaped but invalid."""
    m = _TIME12.fullmatch(tok)
    if m:
        h, mi = int(m[1]), int(m[2] or 0)
        if not 1 <= h <= 12 or mi > 59:
            raise ValueError("That is not a valid time.")
        return h % 12 + (12 if m[3] == "pm" else 0), mi
    m = _TIME24.fullmatch(tok)
    if m:
        h, mi = int(m[1] or m[3]), int(m[2] or m[4])
        if h > 23 or mi > 59:
            raise ValueError("That is not a valid time.")
        return h, mi
    if re.fullmatch(r"\d{1,2}", tok):
        raise ValueError("Add am/pm or use 24h like 21:00.")
    return None


def _parse_date(tok):
    if tok in _REL:
        return ("rel", _REL[tok])
    m = _DATE.fullmatch(tok)
    if not m:
        return None
    y = m[3]
    if y is not None and len(y) not in (2, 4):
        raise ValueError("Year must have 2 or 4 digits.")
    if y is not None and len(y) == 2:
        y = "20" + y
    return ("dmy", int(m[1]), int(m[2]), int(y) if y else None)


def _when(dt):
    return f"{_DAYS[dt.weekday()]} {dt.day} {_MONTHS[dt.month - 1]} {dt.year}, {dt.hour % 12 or 12}:{dt.minute:02d} {'PM' if dt.hour >= 12 else 'AM'}"


def _resolve(clock, day, now):
    h, mi = clock
    grace = now - timedelta(minutes=5)

    def mk(y, mo, d):
        try:
            return datetime(y, mo, d, h, mi, tzinfo=IST)
        except ValueError:
            raise ValueError("That date does not exist.") from None

    explicit = True
    if day is None:
        explicit = False
        dt = now.replace(hour=h, minute=mi, second=0, microsecond=0)
        if dt <= now:
            dt += timedelta(days=1)
    elif day[0] == "rel":
        dt = (now + timedelta(days=day[1])).replace(hour=h, minute=mi, second=0, microsecond=0)
    else:
        _, d, mo, y = day
        if y is None:  # roll to next year only when the DATE is behind us; a passed time today is an error
            y = grace.year + ((mo, d) < (grace.month, grace.day))
        dt = mk(y, mo, d)
    if explicit and dt < grace:
        raise ValueError(f"That time has passed ({_when(dt)} IST)")
    if dt - now > timedelta(days=366):
        raise ValueError("That is more than a year away.")
    return dt


def parse(args, now):
    """Return ("instant",), ("at", start_dt) or ("error", message)."""
    now = now.astimezone(IST)
    toks = [t for t in re.split(r"[\s,]+", (args or "").lower()) if t]
    if not toks:
        return ("error", USAGE)
    if len(toks) == 1 and toks[0] in ("instant", "now"):
        return ("instant",)
    parts = []
    for t in toks:  # glue "9 pm" / "9:30 pm" into one token
        if t in ("am", "pm") and parts and re.fullmatch(r"\d{1,2}(?:[:.]\d{2})?", parts[-1]):
            parts[-1] += t
        else:
            parts.append(t)
    clock = day = None
    try:
        for t in parts:
            hm = _parse_time(t)
            if hm is not None:
                if clock:
                    return ("error", USAGE)
                clock = hm
                continue
            d = _parse_date(t)
            if d is None or day:
                return ("error", USAGE)
            day = d
        if clock is None:
            return ("error", USAGE)
        return ("at", _resolve(clock, day, now))
    except ValueError as e:
        return ("error", str(e))


# ---------------------------------------------------------------- Google client

_tok = {"value": None, "exp": 0.0}


def _call(method, url, end, token=None, body=None, form=None):
    """One HTTP call; returns (status, dict). Raises GmeetError on transport or format problems."""
    left = end - time.monotonic()
    if left <= 0:
        raise GmeetError(_SLOW)
    headers, data = {}, None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        try:
            with urllib.request.urlopen(req, timeout=min(REQUEST_TIMEOUT, left)) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
    except (OSError, http.client.HTTPException):  # URLError, socket.timeout, resets, IncompleteRead
        log.warning("google transport failure")
        raise GmeetError(_SLOW) from None
    try:
        out = json.loads(raw)
    except ValueError:
        out = None
    if not isinstance(out, dict):
        log.warning("google non-JSON reply status=%s", status)
        raise GmeetError(_ODD)
    return status, out


def _fail(status, data):
    err = data.get("error")
    msg = err.get("message") if isinstance(err, dict) else err if isinstance(err, str) else None
    msg = str(msg)[:200] if msg else None
    log.warning("google status=%s", status)
    if status in (401, 403):
        return GmeetError(f"Google refused the request ({status}): {msg or 'no details'}")
    return GmeetError(f"Google error {status}" + (f": {msg}" if msg else ""))


def _token(end):
    if _tok["value"] and time.time() < _tok["exp"]:
        return _tok["value"]
    try:
        with open(os.environ.get("GMEET_TOKEN") or DEFAULT_TOKEN_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        form = {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "refresh_token": cfg["refresh_token"],
            "grant_type": "refresh_token",
        }
        uri = cfg.get("token_uri") or "https://oauth2.googleapis.com/token"
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise GmeetError("Google login not set up yet. Run gmeet-auth on the PC.") from None
    status, data = _call("POST", uri, end, form=form)
    reason = data.get("error") if isinstance(data.get("error"), str) else "unknown"
    if reason == "invalid_grant":
        raise GmeetError("Google login expired or revoked. Re-run gmeet-auth on the PC.")
    value = data.get("access_token")
    if status != 200 or not isinstance(value, str):
        log.warning("token refresh failed status=%s reason=%s", status, reason)
        raise GmeetError(f"Google login failed ({reason}). Re-run gmeet-auth on the PC.")
    _tok["value"] = value
    _tok["exp"] = time.time() + max(float(data.get("expires_in") or 0) - 300, 0)
    return value


def _create_space(token, end):
    status, d = _call("POST", MEET_API, end, token, {"config": {"accessType": "OPEN"}})
    if status != 200:
        raise _fail(status, d)
    uri, code = d.get("meetingUri"), d.get("meetingCode")
    if not (isinstance(uri, str) and uri.startswith(MEET_PREFIX) and isinstance(code, str)):
        raise GmeetError(_ODD)
    return uri, code


def _event_id(start):
    return "gm" + hashlib.sha1(start.isoformat().encode()).hexdigest()[:24]


def _event_body(start, eid, uri, code):
    if ATTACH_MODE == "create":
        conf = {"createRequest": {"requestId": eid, "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
    else:
        conf = {
            "conferenceSolution": {"key": {"type": "hangoutsMeet"}},
            "conferenceId": code,
            "entryPoints": [{"entryPointType": "video", "uri": uri, "label": uri[len("https://"):]}],
        }
    return {
        "id": eid,
        "summary": "Meeting",
        "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": (start + timedelta(minutes=60)).isoformat(), "timeZone": "Asia/Kolkata"},
        "guestsCanInviteOthers": True,
        "location": uri,
        "description": "Join: " + uri,
        "conferenceData": conf,
    }


def _link_of(event):
    loc = event.get("location")
    if isinstance(loc, str) and loc.startswith(MEET_PREFIX):
        return loc
    link = event.get("hangoutLink")
    if isinstance(link, str) and link.startswith(MEET_PREFIX):
        return link
    raise GmeetError(_ODD)


def _live(status, event, start):
    """True if a GET found a usable event: not deleted and not moved to another start time."""
    if status != 200 or event.get("status") == "cancelled":
        return False
    s = event.get("start")
    try:
        at = datetime.fromisoformat(s["dateTime"])
        return at.tzinfo is None or at == start
    except (TypeError, KeyError, ValueError):
        return True  # no readable start: trust the id rather than create a duplicate


def _make_link(plan):
    """Blocking work; returns (uri, already_existed)."""
    end = time.monotonic() + TOTAL_BUDGET
    token = _token(end)
    if plan[0] == "instant":
        return _create_space(token, end)[0], False
    start = plan[1]
    base, space = _event_id(start), None
    # A deleted event stays fetchable as "cancelled" and its id can never be reinserted (409),
    # so a deleted or moved event burns its id and we move on to base+"v1", "v2"...
    for n in range(VARIANTS + 1):
        eid = base + (f"v{n}" if n else "")
        url = f"{CAL_API}/{eid}"
        status, d = _call("GET", url, end, token)
        if _live(status, d, start):
            return _link_of(d), True
        if status not in (200, 404, 410):
            raise _fail(status, d)
        if status != 404:
            continue
        space = space or _create_space(token, end)
        status, d = _call("POST", CAL_API + "?conferenceDataVersion=1", end, token, _event_body(start, eid, *space))
        if status == 200:
            return space[0], False
        if status != 409:
            raise _fail(status, d)
        status, d = _call("GET", url, end, token)  # 409: lost a race, or the id was purged but is still taken
        if _live(status, d, start):
            return _link_of(d), True
        if status not in (200, 404, 410):
            raise _fail(status, d)
    raise GmeetError("that slot was deleted from your calendar too many times, pick another time")


# ---------------------------------------------------------------- command

_inflight = set()


def _reply(plan, uri, existed):
    if plan[0] == "instant":
        return f"**Google Meet, instant**\n{uri}\nAnyone with the link can join."
    note = "Already on your Google Calendar." if existed else "Added to your Google Calendar."
    return f"**Google Meet, {_when(plan[1])} IST** (60 min)\n{uri}\n{note}"


async def _handle(raw_args):
    try:
        plan = parse(str(raw_args or ""), _now())
        if plan[0] == "error":
            return plan[1]
        key = "instant" if plan[0] == "instant" else plan[1].isoformat()
        if key in _inflight:
            return "Already creating that link, one moment."
        _inflight.add(key)
        try:
            uri, existed = await asyncio.wait_for(asyncio.to_thread(_make_link, plan), TOTAL_BUDGET)
        finally:
            _inflight.discard(key)
        return _reply(plan, uri, existed)
    except GmeetError as e:
        return f"Could not create the link: {e}"
    except TimeoutError:
        return f"Could not create the link: {_SLOW}"
    except Exception:
        log.exception("gmeet failed")
        return "Could not create the link: something went wrong, try again"


def register(ctx):
    ctx.register_command(
        "gmeet",
        handler=_handle,
        description="Google Meet link: /gmeet instant | /gmeet 9pm 18-10-2026",
        args_hint="instant | <time> [dd-mm-yyyy]",
    )
