"""
Bitsparx HQ — Company Management System
FastAPI backend with JWT auth, role-based access, 12 module CRUDs,
PinBot WhatsApp templates and SpringEdge text fallback.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import json
import os
import re
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any
from zoneinfo import ZoneInfo

import bcrypt
import jwt
import httpx
from bedrock_llm import bedrock_chat
from document_storage import save_pdf, read_pdf, delete_pdf, ensure_dirs as ensure_blob_dirs
from note_storage import (
    save_note_image, read_note_image, delete_note_image, ensure_note_image_dirs,
    ALLOWED_IMAGE_TYPES,
)
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, File, UploadFile, Form
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# ──────────────────────────────────────────────────────────────────────────────
# Config & DB
# ──────────────────────────────────────────────────────────────────────────────
def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default).lower()).strip().lower() in ("1", "true", "yes")

COOKIE_SECURE = _env_bool("COOKIE_SECURE", default=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("bitsparx")

def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    raise RuntimeError(
        f"Missing required environment variable: {name}. "
        "Create backend/.env (for local dev) or export the variable before starting the server."
    )

mongo_url = os.environ.get("MONGO_URL", "").strip() or "mongodb://127.0.0.1:27017"
db_name = os.environ.get("DB_NAME", "").strip() or "bitsparx_hq"

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

APP_TZ = ZoneInfo("Asia/Kolkata")
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
if not JWT_SECRET:
    if COOKIE_SECURE:
        # In production (secure cookies), require an explicit secret.
        JWT_SECRET = _required_env("JWT_SECRET")
    else:
        JWT_SECRET = "dev-insecure-jwt-secret"
        log.warning("JWT_SECRET not set; using insecure dev default. Set JWT_SECRET in backend/.env.")

app = FastAPI(title="Bitsparx HQ API")
api = APIRouter(prefix="/api")

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def now_ist() -> datetime:
    return datetime.now(APP_TZ)

def today_ist() -> str:
    return now_ist().strftime("%Y-%m-%d")

def new_id() -> str:
    return str(uuid.uuid4())

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

SESSION_RESTRICTED_ROLES = frozenset({"employee", "manager"})
TAB_STALE_SECONDS = 45

def create_access_token(user_id: str, email: str, role: str, sid: Optional[str] = None) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    if sid:
        payload["sid"] = sid
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def _validate_user_session(user: dict, payload: dict) -> None:
    if user.get("role") not in SESSION_RESTRICTED_ROLES:
        return
    sid = payload.get("sid")
    if not sid:
        raise HTTPException(status_code=401, detail="SESSION_INVALID")
    session = await db.user_sessions.find_one({"user_id": user["id"]}, {"_id": 0})
    if not session or session.get("sid") != sid:
        raise HTTPException(status_code=401, detail="SESSION_SUPERSEDED")

def _tab_is_active(session: dict) -> bool:
    if not session.get("active_tab_id"):
        return False
    claimed = session.get("tab_claimed_at")
    if not claimed:
        return False
    try:
        dt = datetime.fromisoformat(claimed.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() < TAB_STALE_SECONDS
    except Exception:
        return False

def strip_id(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user = strip_id(user)
    user.pop("password_hash", None)
    await _validate_user_session(user, payload)
    return user

def require_roles(*roles: str):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker

# ──────────────────────────────────────────────────────────────────────────────
# WhatsApp (PinBot templates + SpringEdge text fallback)
# ──────────────────────────────────────────────────────────────────────────────
class WhatsAppService:
    """PinBot template API (primary) with SpringEdge text fallback."""

    def __init__(self):
        self.pinbot_api_key = os.environ.get("PINBOT_API_KEY", "").strip()
        self.phone_number_id = os.environ.get("PINBOT_PHONE_NUMBER_ID", "").strip()
        self.default_template = os.environ.get("PINBOT_TEMPLATE_NAME", "lms_notification").strip()
        self.attendance_template = os.environ.get("PINBOT_ATTENDANCE_TEMPLATE", "bitsparx_attendence").strip()
        self.meeting_template = os.environ.get("PINBOT_MEETING_TEMPLATE", "bitsparx_meeting").strip()
        self.pinbot_enabled = bool(self.pinbot_api_key and self.phone_number_id)
        self.springedge_api_key = os.environ.get("SPRINGEDGE_API_KEY", "").strip()
        self.sender = os.environ.get("SPRINGEDGE_SENDER", "BITSPARX")
        self.springedge_url = os.environ.get(
            "SPRINGEDGE_WHATSAPP_URL", "https://api.springedge.com/whatsapp/v1/send"
        )
        self.springedge_enabled = (
            os.environ.get("SPRINGEDGE_ENABLED", "false").lower() == "true"
            and bool(self.springedge_api_key)
        )

    async def _persist(self, record: dict) -> dict:
        await db.notifications.insert_one(record.copy())
        return record

    async def send_template(
        self,
        to: str,
        params: List[str],
        event: str = "generic",
        template_name: Optional[str] = None,
        meta: Optional[dict] = None,
    ) -> dict:
        template_name = template_name or self.default_template
        record = {
            "id": new_id(),
            "to": to,
            "message": " | ".join(params),
            "template_name": template_name,
            "template_params": params,
            "event": event,
            "meta": meta or {},
            "status": "queued",
            "provider": "pinbot",
            "created_at": now_utc(),
        }
        if not self.pinbot_enabled:
            record["status"] = "logged_only"
            record["info"] = "PinBot not configured. Set PINBOT_API_KEY & PINBOT_PHONE_NUMBER_ID."
            log.info(f"[WA·LOG] to={to} event={event} template={template_name} params={params}")
            return await self._persist(record)
        url = f"https://partnersv1.pinbot.ai/v3/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": {
                "language": {"code": "en"},
                "name": template_name,
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "text", "text": p[:1024]} for p in params],
                    }
                ],
            },
        }
        if meta:
            payload["biz_opaque_callback_data"] = json.dumps(meta)[:512]
        try:
            async with httpx.AsyncClient(timeout=20.0) as cx:
                resp = await cx.post(
                    url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "apikey": self.pinbot_api_key,
                    },
                )
                record["status"] = "sent" if resp.status_code < 300 else "failed"
                record["http_status"] = resp.status_code
                record["response"] = resp.text[:500]
        except Exception as e:
            record["status"] = "failed"
            record["error"] = str(e)
            log.exception("PinBot template send failed")
        return await self._persist(record)

    async def send(self, to: str, message: str, event: str = "generic", meta: Optional[dict] = None) -> dict:
        record = {
            "id": new_id(),
            "to": to,
            "message": message,
            "event": event,
            "meta": meta or {},
            "sender": self.sender,
            "status": "queued",
            "provider": "springedge",
            "created_at": now_utc(),
        }
        if not self.springedge_enabled:
            record["status"] = "logged_only"
            record["info"] = "WhatsApp not configured. Set PINBOT_API_KEY or SPRINGEDGE_API_KEY."
            log.info(f"[WA·LOG] to={to} event={event} msg={message[:80]}")
            return await self._persist(record)
        try:
            async with httpx.AsyncClient(timeout=15.0) as cx:
                resp = await cx.post(
                    self.springedge_url,
                    data={
                        "apikey": self.springedge_api_key,
                        "sender": self.sender,
                        "to": to,
                        "message": message,
                    },
                )
                record["status"] = "sent" if resp.status_code < 300 else "failed"
                record["http_status"] = resp.status_code
                record["response"] = resp.text[:500]
        except Exception as e:
            record["status"] = "failed"
            record["error"] = str(e)
            log.exception("SpringEdge send failed")
        return await self._persist(record)

wa = WhatsAppService()

# ──────────────────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────────────────
class LoginInput(BaseModel):
    email: EmailStr
    password: str
    device_id: Optional[str] = None

class SessionTabInput(BaseModel):
    device_id: str
    tab_id: str

class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "employee"
    phone: Optional[str] = None
    department: Optional[str] = None

class GenericDoc(BaseModel):
    model_config = ConfigDict(extra="allow")

# ──────────────────────────────────────────────────────────────────────────────
# Auth endpoints
# ──────────────────────────────────────────────────────────────────────────────
@api.post("/auth/login")
async def login(body: LoginInput, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    role = user.get("role", "employee")
    sid = None
    if role in SESSION_RESTRICTED_ROLES:
        device_id = (body.device_id or "").strip()
        if not device_id:
            raise HTTPException(status_code=400, detail="Device ID required")
        sid = new_id()
        await db.user_sessions.update_one(
            {"user_id": user["id"]},
            {"$set": {
                "user_id": user["id"],
                "sid": sid,
                "device_id": device_id,
                "active_tab_id": None,
                "tab_claimed_at": None,
                "last_seen_at": now_utc(),
                "created_at": now_utc(),
            }},
            upsert=True,
        )

    token = create_access_token(user["id"], user["email"], role, sid=sid)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="none" if COOKIE_SECURE else "lax",
        max_age=43200,
        path="/",
    )
    user = strip_id(user)
    user.pop("password_hash", None)
    return {"user": user, "token": token}

@api.post("/auth/register")
async def register(body: RegisterInput, user: dict = Depends(require_roles("admin"))):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "id": new_id(),
        "email": email,
        "name": body.name,
        "role": body.role if body.role in ("admin", "manager", "employee") else "employee",
        "phone": body.phone,
        "department": body.department,
        "password_hash": hash_password(body.password),
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc.copy())
    doc.pop("password_hash", None)
    return strip_id(doc)

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

@api.post("/auth/session/claim-tab")
async def claim_session_tab(body: SessionTabInput, user: dict = Depends(get_current_user)):
    if user.get("role") not in SESSION_RESTRICTED_ROLES:
        return {"ok": True}
    session = await db.user_sessions.find_one({"user_id": user["id"]}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="SESSION_INVALID")
    if session.get("device_id") and session["device_id"] != body.device_id.strip():
        raise HTTPException(status_code=401, detail="SESSION_SUPERSEDED")
    active_tab = session.get("active_tab_id")
    if active_tab and active_tab != body.tab_id and _tab_is_active(session):
        raise HTTPException(status_code=409, detail="Another tab is already active. Close other tabs and refresh.")
    await db.user_sessions.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "active_tab_id": body.tab_id,
            "tab_claimed_at": now_utc(),
            "last_seen_at": now_utc(),
            "device_id": body.device_id.strip(),
        }},
    )
    return {"ok": True}

@api.post("/auth/session/heartbeat")
async def session_heartbeat(body: SessionTabInput, user: dict = Depends(get_current_user)):
    if user.get("role") not in SESSION_RESTRICTED_ROLES:
        return {"ok": True}
    session = await db.user_sessions.find_one({"user_id": user["id"]}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="SESSION_INVALID")
    if session.get("device_id") != body.device_id.strip():
        raise HTTPException(status_code=401, detail="SESSION_SUPERSEDED")
    if session.get("active_tab_id") != body.tab_id:
        raise HTTPException(status_code=409, detail="This tab is no longer the active session.")
    await db.user_sessions.update_one(
        {"user_id": user["id"]},
        {"$set": {"last_seen_at": now_utc(), "tab_claimed_at": now_utc()}},
    )
    return {"ok": True}

@api.post("/auth/logout")
async def logout(response: Response, request: Request):
    try:
        user = await get_current_user(request)
        if user.get("role") in SESSION_RESTRICTED_ROLES:
            await db.user_sessions.delete_one({"user_id": user["id"]})
    except HTTPException:
        pass
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

# ──────────────────────────────────────────────────────────────────────────────
# Generic CRUD factory
# ──────────────────────────────────────────────────────────────────────────────
def make_crud(path: str, collection: str, notify_event: Optional[str] = None,
              notify_template=None, notify_async=None, list_roles=None, write_roles=None,
              create_roles=None, on_create=None):
    """
    Registers POST /{path}, GET /{path}, GET /{path}/{id}, PUT /{path}/{id}, DELETE /{path}/{id}
    """
    list_roles = list_roles or ("admin", "manager", "employee")
    write_roles = write_roles or ("admin", "manager")
    create_roles = create_roles or write_roles

    @api.get(f"/{path}", name=f"list_{collection}")
    async def list_items(user: dict = Depends(require_roles(*list_roles))):
        items = await db[collection].find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return items

    @api.post(f"/{path}", name=f"create_{collection}")
    async def create_item(body: GenericDoc, user: dict = Depends(require_roles(*create_roles))):
        doc = body.model_dump()
        doc["id"] = new_id()
        doc["created_at"] = now_utc()
        doc["created_by"] = user["id"]
        doc["created_by_role"] = user.get("role")
        doc["created_by_name"] = user.get("name") or user.get("email")
        if on_create:
            on_create(doc, user)
        await db[collection].insert_one(doc.copy())
        whatsapp: List[dict] = []
        if notify_async:
            try:
                whatsapp = await notify_async(doc) or []
            except Exception:
                log.exception("notify failed")
        elif notify_event and notify_template:
            try:
                msg = notify_template(doc)
                phone = doc.get("phone") or doc.get("contact_phone") or os.environ.get("ADMIN_PHONE", "919999999999")
                await wa.send(phone, msg, event=notify_event, meta={"id": doc["id"], "collection": collection})
            except Exception:
                log.exception("notify failed")
        result = strip_id(doc)
        if whatsapp:
            result["whatsapp"] = whatsapp
        return result

    @api.get(f"/{path}/{{item_id}}", name=f"get_{collection}")
    async def get_item(item_id: str, user: dict = Depends(require_roles(*list_roles))):
        doc = await db[collection].find_one({"id": item_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    @api.put(f"/{path}/{{item_id}}", name=f"update_{collection}")
    async def update_item(item_id: str, body: GenericDoc, user: dict = Depends(require_roles(*write_roles))):
        updates = body.model_dump()
        updates.pop("id", None); updates.pop("created_at", None)
        updates["updated_at"] = now_utc()
        result = await db[collection].update_one({"id": item_id}, {"$set": updates})
        if result.matched_count == 0:
            raise HTTPException(404, "Not found")
        doc = await db[collection].find_one({"id": item_id}, {"_id": 0})
        return doc

    @api.delete(f"/{path}/{{item_id}}", name=f"delete_{collection}")
    async def delete_item(item_id: str, user: dict = Depends(require_roles(*write_roles))):
        result = await db[collection].delete_one({"id": item_id})
        if result.deleted_count == 0:
            raise HTTPException(404, "Not found")
        return {"ok": True}

# ──────────────────────────────────────────────────────────────────────────────
# Employees (login account + directory)
# ──────────────────────────────────────────────────────────────────────────────
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", re.IGNORECASE)

def normalize_phone(raw: Optional[str]) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10 and digits[0] in "6789":
        return f"91{digits}"
    if len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        return digits
    raise HTTPException(status_code=400, detail="Enter a valid 10-digit Indian mobile (e.g. 9876543210 or +91 9876543210)")

def normalize_phone_optional(raw: Optional[str]) -> Optional[str]:
    try:
        return normalize_phone(raw)
    except HTTPException:
        return None

def parse_app_datetime(iso_ts: str) -> datetime:
    raw = (iso_ts or "").strip()
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        # datetime-local inputs and stored meeting times are IST for Bitsparx HQ
        dt = dt.replace(tzinfo=APP_TZ)
    return dt.astimezone(APP_TZ)

def format_ist_datetime(iso_ts: Optional[str]) -> str:
    if not iso_ts:
        return "TBD"
    dt = parse_app_datetime(iso_ts)
    time_part = dt.strftime("%I:%M %p").lstrip("0")
    return f"{dt.strftime('%A')}, {dt.day} {dt.strftime('%b %Y')}, {time_part} IST"

def format_checkin_time(iso_ts: str) -> str:
    return format_ist_datetime(iso_ts)

async def resolve_user_phone(user: dict) -> str:
    email = (user.get("email") or "").strip().lower()
    if email:
        emp = await db.employees.find_one({"email": email}, {"_id": 0, "phone": 1})
        if emp:
            phone = normalize_phone_optional(emp.get("phone"))
            if phone:
                return phone
    phone = normalize_phone_optional(user.get("phone"))
    if phone:
        return phone
    return os.environ.get("ADMIN_PHONE", "919999999999")

async def collect_attendance_notify_phones(user: dict) -> List[str]:
    """Employee phone plus admin phones (deduped) for check-in WhatsApp alerts."""
    phones: List[str] = []
    seen: set[str] = set()

    def add(raw: Optional[str]) -> None:
        p = normalize_phone_optional(raw)
        if p and p not in seen:
            seen.add(p)
            phones.append(p)

    email = (user.get("email") or "").strip().lower()
    if email:
        emp = await db.employees.find_one({"email": email}, {"_id": 0, "phone": 1})
        if emp:
            add(emp.get("phone"))
    add(user.get("phone"))

    if os.environ.get("PINBOT_ATTENDANCE_NOTIFY_ADMINS", "true").lower() == "true":
        add(os.environ.get("ADMIN_PHONE"))
        async for admin in db.users.find({"role": "admin"}, {"_id": 0, "phone": 1}):
            add(admin.get("phone"))

    if not phones:
        add(os.environ.get("ADMIN_PHONE", "919999999999"))
    return phones

def _norm_attendee_key(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())

def format_meeting_time(start_at: Optional[str]) -> str:
    return format_ist_datetime(start_at)

def resolve_meeting_link(meeting: dict) -> str:
    link = (meeting.get("meeting_link") or "").strip()
    if link:
        return link if link.startswith(("http://", "https://")) else f"https://{link}"
    location = (meeting.get("location") or "").strip()
    if location.startswith(("http://", "https://")):
        return location
    if re.match(r"^(zoom\.us|meet\.google|teams\.microsoft)", location, re.I):
        return f"https://{location}"
    if location:
        return f"{meeting.get('title', 'Meeting')} — {location}"
    return "Contact organizer for meeting details"

async def resolve_meeting_attendee_phones(attendees: Any) -> List[str]:
    if isinstance(attendees, str):
        attendees = [attendees]
    attendees = list(attendees or [])
    phones: List[str] = []
    seen: set[str] = set()

    def add_phone(raw: Optional[str]) -> None:
        phone = normalize_phone_optional(raw)
        if phone and phone not in seen:
            seen.add(phone)
            phones.append(phone)

    all_team = any(_norm_attendee_key(a) == "all team" for a in attendees)
    employees = await db.employees.find({}, {"_id": 0, "name": 1, "email": 1, "phone": 1}).to_list(1000)
    users_list = await db.users.find({}, {"_id": 0, "name": 1, "email": 1, "phone": 1}).to_list(1000)

    if all_team or not attendees:
        for emp in employees:
            add_phone(emp.get("phone"))
        if not phones:
            for u in users_list:
                add_phone(u.get("phone"))
        return phones

    for attendee in attendees:
        key = _norm_attendee_key(str(attendee))
        if not key or key == "all team":
            continue
        matched = False
        for emp in employees:
            if key in (_norm_attendee_key(emp.get("name")), _norm_attendee_key(emp.get("email"))):
                add_phone(emp.get("phone"))
                matched = True
                break
        if matched:
            continue
        for u in users_list:
            if key in (_norm_attendee_key(u.get("name")), _norm_attendee_key(u.get("email"))):
                add_phone(u.get("phone"))
                break
    return phones

async def notify_meeting_scheduled(meeting: dict) -> List[dict]:
    """Send bitsparx_meeting template: {{1}} time, {{2}} meeting link."""
    time_str = format_meeting_time(meeting.get("start_at"))
    link_str = resolve_meeting_link(meeting)
    meta = {"meeting_id": meeting.get("id"), "title": meeting.get("title")}
    results: List[dict] = []
    for phone in await resolve_meeting_attendee_phones(meeting.get("attendees")):
        record = await wa.send_template(
            phone,
            params=[time_str, link_str],
            event="meeting_scheduled",
            template_name=wa.meeting_template,
            meta=meta,
        )
        results.append({
            "to": phone,
            "status": record.get("status"),
            "template": record.get("template_name"),
        })
    return results

async def notify_attendance_checkin(user: dict, check_in_iso: str) -> List[dict]:
    """Send bitsparx_attendence template: {{1}} name, {{2}} time."""
    name = (user.get("name") or user.get("email") or "Team member").strip()
    time_str = format_checkin_time(check_in_iso)
    meta = {"user_id": user["id"], "user_name": name}
    results: List[dict] = []
    for phone in await collect_attendance_notify_phones(user):
        record = await wa.send_template(
            phone,
            params=[name, time_str],
            event="attendance_checkin",
            template_name=wa.attendance_template,
            meta=meta,
        )
        results.append({
            "to": phone,
            "status": record.get("status"),
            "template": record.get("template_name"),
        })
    return results

def normalize_email(raw: Optional[str]) -> str:
    email = (raw or "").strip().lower()
    if not email or not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    return email

def validate_employee_contact(doc: dict) -> dict:
    if not (doc.get("phone") or "").strip():
        raise HTTPException(status_code=400, detail="Phone number is required")
    doc["email"] = normalize_email(doc.get("email"))
    doc["phone"] = normalize_phone(doc.get("phone"))
    return doc

def designation_to_role(designation: Optional[str]) -> str:
    key = (designation or "").strip().lower()
    if key == "ceo":
        return "admin"
    if key == "manager":
        return "manager"
    return "employee"

async def sync_employee_user(employee: dict, password: Optional[str] = None):
    email = (employee.get("email") or "").lower().strip()
    if not email:
        return
    user_fields = {
        "name": employee.get("name"),
        "role": designation_to_role(employee.get("designation")),
        "phone": employee.get("phone"),
        "department": employee.get("department"),
        "employee_id": employee.get("id"),
    }
    existing = await db.users.find_one({"email": email})
    if password:
        user_fields["password_hash"] = hash_password(password)
    if existing:
        await db.users.update_one({"email": email}, {"$set": user_fields})
    elif password:
        await db.users.insert_one({
            "id": new_id(),
            "email": email,
            "created_at": now_utc(),
            **user_fields,
        })

async def _employee_emails() -> list[str]:
    rows = await db.employees.find({}, {"_id": 0, "email": 1}).to_list(2000)
    return sorted({
        (r.get("email") or "").lower().strip()
        for r in rows
        if (r.get("email") or "").strip()
    })

async def _directory_users_query(exclude_user_id: Optional[str] = None) -> dict:
    """Active platform users: current employees plus CEO/admin accounts."""
    emails = await _employee_emails()
    query: dict = {
        "$or": [
            {"email": {"$in": emails}},
            {"role": "admin"},
        ]
    }
    if exclude_user_id:
        return {"$and": [query, {"id": {"$ne": exclude_user_id}}]}
    return query

async def list_directory_users(exclude_user_id: Optional[str] = None) -> list[dict]:
    query = await _directory_users_query(exclude_user_id)
    return await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(500)

async def is_directory_user(user_id: str) -> bool:
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "role": 1})
    if not user_doc:
        return False
    if user_doc.get("role") == "admin":
        return True
    email = (user_doc.get("email") or "").lower().strip()
    if not email:
        return False
    return await db.employees.count_documents({"email": email}) > 0

def _employee_notify(doc: dict):
    return f"Welcome to Bitsparx HQ, {doc.get('name', 'colleague')}! Your account is being set up."

@api.get("/employees", name="list_employees")
async def list_employees(user: dict = Depends(require_roles("admin", "manager", "employee"))):
    items = await db.employees.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items

@api.post("/employees", name="create_employees")
async def create_employee(body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    doc = body.model_dump()
    password = (doc.pop("password", None) or "").strip() or None
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")
    validate_employee_contact(doc)
    doc["id"] = new_id()
    doc["created_at"] = now_utc()
    doc["created_by"] = user["id"]
    await db.employees.insert_one(doc.copy())
    await sync_employee_user(doc, password)
    try:
        phone = doc.get("phone") or os.environ.get("ADMIN_PHONE", "919999999999")
        await wa.send(phone, _employee_notify(doc), event="employee_added", meta={"id": doc["id"], "collection": "employees"})
    except Exception:
        log.exception("notify failed")
    return strip_id(doc)

@api.get("/employees/{item_id}", name="get_employees")
async def get_employee(item_id: str, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    doc = await db.employees.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc

@api.put("/employees/{item_id}", name="update_employees")
async def update_employee(item_id: str, body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    updates = body.model_dump()
    updates.pop("id", None)
    updates.pop("created_at", None)
    password = (updates.pop("password", None) or "").strip() or None
    validate_employee_contact(updates)
    updates["updated_at"] = now_utc()
    result = await db.employees.update_one({"id": item_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.employees.find_one({"id": item_id}, {"_id": 0})
    await sync_employee_user(doc, password)
    return doc

@api.delete("/employees/{item_id}", name="delete_employees")
async def delete_employee(item_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    doc = await db.employees.find_one({"id": item_id}, {"_id": 0, "email": 1})
    if not doc:
        raise HTTPException(404, "Not found")
    email = (doc.get("email") or "").lower().strip()
    if email:
        linked = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
        if linked:
            await db.user_sessions.delete_many({"user_id": linked["id"]})
            await db.users.delete_one({"email": email})
    await db.employees.delete_one({"id": item_id})
    return {"ok": True}

# ──────────────────────────────────────────────────────────────────────────────
# Module CRUDs (12 modules)
# ──────────────────────────────────────────────────────────────────────────────
def _sanitize_project_for_role(doc: dict, user: dict) -> dict:
    out = dict(doc)
    if user["role"] != "admin":
        out.pop("budget", None)
        out.pop("budget_set", None)
        out.pop("budget_set_by", None)
        out.pop("created_by_role", None)
    return out

async def _sync_project_team_members(doc: dict) -> dict:
    raw = doc.get("team_member_ids")
    if raw is None:
        return doc
    ids = raw if isinstance(raw, list) else [s.strip() for s in str(raw).split(",") if s.strip()]
    doc["team_member_ids"] = ids
    names = []
    for mid in ids:
        u = await db.users.find_one({"id": mid}, {"_id": 0, "name": 1, "email": 1})
        if u:
            names.append(u.get("name") or u.get("email"))
    doc["team_members"] = names
    return doc

async def _assigned_project_ids(user: dict) -> list[str]:
    uid = user["id"]
    name = user.get("name") or ""
    email = user.get("email") or ""
    ids: set[str] = set()

    for p in await db.projects.find({
        "$or": [
            {"team_member_ids": uid},
            {"team_members": {"$in": [name, email]}},
            {"created_by": uid},
        ]
    }, {"_id": 0, "id": 1}).to_list(1000):
        ids.add(p["id"])

    task_filter = {"$or": []}
    for key in (name, email):
        if key:
            task_filter["$or"].append({"assignee": key})
    if task_filter["$or"]:
        tasks = await db.tasks.find(task_filter, {"_id": 0, "project": 1}).to_list(5000)
        project_names = list({t.get("project") for t in tasks if t.get("project")})
        if project_names:
            for p in await db.projects.find({"name": {"$in": project_names}}, {"_id": 0, "id": 1}).to_list(1000):
                ids.add(p["id"])

    return list(ids)

async def _ensure_project_access(user: dict, project: dict):
    if user.get("role") != "employee":
        return
    if project.get("id") not in await _assigned_project_ids(user):
        raise HTTPException(404, "Not found")

@api.get("/projects", name="list_projects")
async def list_projects(user: dict = Depends(require_roles("admin", "manager", "employee"))):
    if user["role"] == "employee":
        allowed = await _assigned_project_ids(user)
        query = {"id": {"$in": allowed}} if allowed else {"id": {"$in": []}}
    else:
        query = {}
    items = await db.projects.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_sanitize_project_for_role(i, user) for i in items]

@api.post("/projects", name="create_projects")
async def create_project(body: GenericDoc, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc()
    doc["created_by"] = user["id"]
    doc["created_by_role"] = user["role"]
    doc["created_by_name"] = user.get("name") or user.get("email")
    if user["role"] == "employee":
        doc.pop("budget", None)
        doc["budget"] = None
        doc["budget_set"] = False
        member_ids = list(doc.get("team_member_ids") or [])
        if user["id"] not in member_ids:
            member_ids.append(user["id"])
        doc["team_member_ids"] = member_ids
    elif user["role"] != "admin":
        doc.pop("budget", None)
        doc["budget"] = None
        doc["budget_set"] = False
    else:
        budget = doc.get("budget")
        if budget is not None and budget != "":
            doc["budget"] = float(budget)
            doc["budget_set"] = True
            doc["budget_set_by"] = user["id"]
        else:
            doc["budget"] = None
            doc["budget_set"] = False
    await _sync_project_team_members(doc)
    await db.projects.insert_one(doc.copy())
    try:
        phone = doc.get("phone") or doc.get("contact_phone") or os.environ.get("ADMIN_PHONE", "919999999999")
        await wa.send(phone, f"New project assigned: {doc.get('name', '-')}. Deadline: {doc.get('deadline', 'TBD')}.",
                      event="project_created", meta={"id": doc["id"], "collection": "projects"})
    except Exception:
        log.exception("notify failed")
    return strip_id(_sanitize_project_for_role(doc, user))

@api.get("/projects/{item_id}", name="get_projects")
async def get_project(item_id: str, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    doc = await db.projects.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    await _ensure_project_access(user, doc)
    return _sanitize_project_for_role(doc, user)

EMPLOYEE_PROJECT_FIELDS = frozenset({
    "name", "client", "status", "progress", "start_date", "deadline", "parts", "description",
})

@api.put("/projects/{item_id}", name="update_projects")
async def update_project(item_id: str, body: GenericDoc, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    existing = await db.projects.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    await _ensure_project_access(user, existing)

    updates = body.model_dump()
    for key in ("id", "created_at", "created_by", "created_by_role", "created_by_name", "budget_set", "budget_set_by"):
        updates.pop(key, None)

    if user["role"] == "employee":
        updates = {k: v for k, v in updates.items() if k in EMPLOYEE_PROJECT_FIELDS}
        if "parts" in updates and updates["parts"] is not None:
            normalized = []
            for part in updates["parts"]:
                if not isinstance(part, dict):
                    continue
                title = (part.get("title") or "").strip()
                if not title:
                    continue
                normalized.append({
                    "id": part.get("id") or new_id(),
                    "title": title,
                    "created_at": part.get("created_at") or now_utc(),
                })
            updates["parts"] = normalized
    elif user["role"] != "admin":
        updates.pop("budget", None)
        if "team_member_ids" in updates:
            await _sync_project_team_members(updates)
    else:
        if "budget" in updates:
            updates.pop("budget", None)
        if "team_member_ids" in updates:
            await _sync_project_team_members(updates)

    if not updates:
        return _sanitize_project_for_role(existing, user)

    updates["updated_at"] = now_utc()
    await db.projects.update_one({"id": item_id}, {"$set": updates})
    doc = await db.projects.find_one({"id": item_id}, {"_id": 0})
    return _sanitize_project_for_role(doc, user)

class ProjectBudgetInput(BaseModel):
    budget: float

@api.put("/projects/{item_id}/budget", name="set_project_budget")
async def set_project_budget(item_id: str, body: ProjectBudgetInput, user: dict = Depends(require_roles("admin"))):
    if body.budget <= 0:
        raise HTTPException(400, "Budget must be greater than zero")
    result = await db.projects.update_one(
        {"id": item_id},
        {"$set": {
            "budget": float(body.budget),
            "budget_set": True,
            "budget_set_by": user["id"],
            "budget_set_at": now_utc(),
            "updated_at": now_utc(),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.projects.find_one({"id": item_id}, {"_id": 0})
    return doc

@api.get("/projects/{item_id}/finance", name="project_finance")
async def project_finance(item_id: str, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    project = await db.projects.find_one({"id": item_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Not found")
    await _ensure_project_access(user, project)
    name = project.get("name") or ""
    expenses = await db.expenses.find({"project": name}, {"_id": 0}).to_list(5000)
    spent = round(sum(float(e.get("amount") or 0) for e in expenses), 2)
    budget_set = bool(project.get("budget_set") or project.get("budget"))
    budget = float(project["budget"]) if budget_set and project.get("budget") is not None else None
    remaining = round((budget or 0) - spent, 2) if budget is not None else None
    chart = [{"name": "Spent", "value": spent}]
    if budget is not None:
        chart = [
            {"name": "Budget", "value": budget},
            {"name": "Spent", "value": spent},
            {"name": "Remaining", "value": max(remaining, 0)},
        ]
    return {
        "project_id": item_id,
        "project_name": name,
        "budget": budget,
        "budget_set": budget_set,
        "spent": spent,
        "remaining": remaining,
        "created_by_role": project.get("created_by_role"),
        "created_by_name": project.get("created_by_name"),
        "chart": chart,
    }

@api.delete("/projects/{item_id}", name="delete_projects")
async def delete_project(item_id: str, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    doc = await db.projects.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    await _ensure_project_access(user, doc)
    if user["role"] == "employee" and doc.get("created_by") != user["id"]:
        raise HTTPException(403, "Only the project creator can delete this project")
    await db.projects.delete_one({"id": item_id})
    return {"ok": True}

make_crud("tasks", "tasks",
          notify_event="task_assigned",
          notify_template=lambda d: f"Task '{d.get('title','-')}' assigned to you. Due: {d.get('due_date','TBD')}.")

make_crud("expenses", "expenses")

def _sanitize_invoice_for_role(doc: dict, user: dict) -> dict:
    out = dict(doc)
    if user["role"] != "admin":
        out.pop("amount", None)
        out.pop("amount_set", None)
        out.pop("amount_set_by", None)
        out.pop("created_by_role", None)
        out.pop("created_by_name", None)
    return out

def _invoice_amount_value(inv: dict) -> float:
    if inv.get("amount_set") or inv.get("amount"):
        return float(inv.get("amount") or 0)
    return 0.0

def _escape_pdf_text(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def _build_invoice_pdf(invoice: dict) -> bytes:
    amount_line = f"Amount:      INR {float(invoice.get('amount') or 0):,.2f}"
    lines = [
        "Bitsparx HQ",
        "INVOICE",
        "",
        f"Invoice No:  {invoice.get('invoice_no', '-')}",
        f"Client:      {invoice.get('client', '-')}",
        f"Issue Date:  {invoice.get('date', '-')}",
        f"Due Date:    {invoice.get('due_date', '-')}",
        f"Status:      {invoice.get('status', '-')}",
        "",
        amount_line,
    ]
    y = 750
    cmds = ["BT", "/F1 11 Tf", f"50 {y} Td ({_escape_pdf_text(lines[0])}) Tj"]
    for line in lines[1:]:
        cmds.append("T*")
        cmds.append(f"({_escape_pdf_text(line)}) Tj")
    cmds.append("ET")
    stream = "\n".join(cmds)
    stream_bytes = stream.encode("latin-1", errors="replace")
    parts = [
        b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
        f"4 0 obj<< /Length {len(stream_bytes)} >>stream\n".encode() + stream_bytes + b"\nendstream\nendobj\n",
        b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    ]
    pdf = b"%PDF-1.4\n"
    offsets = [0]
    for part in parts:
        offsets.append(len(pdf))
        pdf += part
    xref = len(pdf)
    pdf += f"xref\n0 {len(parts) + 1}\n".encode()
    pdf += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        pdf += f"{off:010d} 00000 n \n".encode()
    pdf += f"trailer<< /Size {len(parts) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return pdf

@api.get("/invoices", name="list_invoices")
async def list_invoices(user: dict = Depends(require_roles("admin", "manager", "employee"))):
    items = await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_sanitize_invoice_for_role(i, user) for i in items]

@api.post("/invoices", name="create_invoices")
async def create_invoice(body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc()
    doc["created_by"] = user["id"]
    doc["created_by_role"] = user["role"]
    doc["created_by_name"] = user.get("name") or user.get("email")
    if user["role"] != "admin":
        doc.pop("amount", None)
        doc["amount"] = None
        doc["amount_set"] = False
    else:
        amount = doc.get("amount")
        if amount is not None and amount != "":
            doc["amount"] = float(amount)
            doc["amount_set"] = True
            doc["amount_set_by"] = user["id"]
        else:
            doc["amount"] = None
            doc["amount_set"] = False
    await db.invoices.insert_one(doc.copy())
    return strip_id(_sanitize_invoice_for_role(doc, user))

@api.get("/invoices/{item_id}", name="get_invoices")
async def get_invoice(item_id: str, user: dict = Depends(require_roles("admin", "manager", "employee"))):
    doc = await db.invoices.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return _sanitize_invoice_for_role(doc, user)

@api.put("/invoices/{item_id}", name="update_invoices")
async def update_invoice(item_id: str, body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    updates = body.model_dump()
    updates.pop("id", None)
    updates.pop("created_at", None)
    updates.pop("created_by", None)
    updates.pop("created_by_role", None)
    updates.pop("created_by_name", None)
    updates.pop("amount_set", None)
    updates.pop("amount_set_by", None)
    if user["role"] != "admin":
        updates.pop("amount", None)
    elif "amount" in updates:
        updates.pop("amount", None)
    updates["updated_at"] = now_utc()
    result = await db.invoices.update_one({"id": item_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.invoices.find_one({"id": item_id}, {"_id": 0})
    return _sanitize_invoice_for_role(doc, user)

class InvoiceAmountInput(BaseModel):
    amount: float

@api.put("/invoices/{item_id}/amount", name="set_invoice_amount")
async def set_invoice_amount(item_id: str, body: InvoiceAmountInput, user: dict = Depends(require_roles("admin"))):
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")
    result = await db.invoices.update_one(
        {"id": item_id},
        {"$set": {
            "amount": float(body.amount),
            "amount_set": True,
            "amount_set_by": user["id"],
            "amount_set_at": now_utc(),
            "updated_at": now_utc(),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.invoices.find_one({"id": item_id}, {"_id": 0})
    return doc

@api.get("/invoices/{item_id}/pdf", name="download_invoice_pdf")
async def download_invoice_pdf(item_id: str, user: dict = Depends(require_roles("admin"))):
    doc = await db.invoices.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    amount_set = bool(doc.get("amount_set") or doc.get("amount"))
    if not amount_set:
        raise HTTPException(400, "Amount not added")
    pdf_bytes = _build_invoice_pdf(doc)
    filename = f"{doc.get('invoice_no', 'invoice')}.pdf".replace("/", "-")
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@api.delete("/invoices/{item_id}", name="delete_invoices")
async def delete_invoice(item_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    result = await db.invoices.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

make_crud("meetings", "meetings",
          notify_async=notify_meeting_scheduled,
          write_roles=("admin", "manager", "employee"))

make_crud("visits", "visits",
          notify_event="client_visit",
          notify_template=lambda d: f"Client visit logged at {d.get('location','-')} on {d.get('visit_date','-')}.")

make_crud("assets", "assets")
make_crud("amc", "amc",
          notify_event="amc_renewal",
          notify_template=lambda d: f"AMC '{d.get('title','-')}' renewal due on {d.get('renewal_date','-')}.")

def _ticket_on_create(doc: dict, user: dict):
    if user.get("role") == "employee":
        doc["assigned_to"] = user.get("name") or user.get("email")
        doc.setdefault("status", "open")
        doc.setdefault("sla_hours", 24)

make_crud("tickets", "tickets",
          notify_event="ticket_update",
          notify_template=lambda d: f"Ticket #{d.get('id','')[:8]}: {d.get('subject','-')} — status: {d.get('status','open')}.",
          write_roles=("admin", "manager"),
          create_roles=("admin", "manager", "employee"),
          on_create=_ticket_on_create)

@api.get("/documents", name="list_documents")
async def list_documents(user: dict = Depends(require_roles("admin", "manager"))):
    items = await db.documents.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items

@api.post("/documents", name="create_documents")
async def create_document(body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc()
    doc["uploaded_by"] = doc.get("uploaded_by") or user.get("name") or user.get("email")
    doc["has_file"] = bool(doc.get("blob_key"))
    await db.documents.insert_one(doc.copy())
    return strip_id(doc)

@api.post("/documents/upload", name="upload_document")
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form("Other"),
    client: Optional[str] = Form(None),
    version: str = Form("v1.0"),
    user: dict = Depends(require_roles("admin", "manager")),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are allowed")
    content_type = (file.content_type or "").lower()
    if content_type and content_type not in ("application/pdf", "application/x-pdf", "binary/octet-stream"):
        raise HTTPException(400, "Only PDF files are allowed")
    data = await file.read()
    doc_id = new_id()
    blob_key = f"{doc_id}.pdf"
    try:
        size_bytes = save_pdf(blob_key, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    doc = {
        "id": doc_id,
        "name": file.filename,
        "category": category or "Other",
        "client": (client or "").strip() or None,
        "version": version or "v1.0",
        "size_kb": round(size_bytes / 1024),
        "uploaded_by": user.get("name") or user.get("email"),
        "blob_key": blob_key,
        "mime_type": "application/pdf",
        "has_file": True,
        "created_at": now_utc(),
    }
    await db.documents.insert_one(doc.copy())
    return strip_id(doc)

@api.get("/documents/{item_id}", name="get_documents")
async def get_document(item_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    doc = await db.documents.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc

@api.get("/documents/{item_id}/file", name="download_document_file")
async def download_document_file(item_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    doc = await db.documents.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    blob_key = doc.get("blob_key")
    if not blob_key:
        raise HTTPException(404, "No PDF file attached to this document")
    try:
        data = read_pdf(blob_key)
    except FileNotFoundError:
        raise HTTPException(404, "PDF file not found in storage")
    filename = doc.get("name") or f"{item_id}.pdf"
    return StreamingResponse(
        iter([data]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )

@api.put("/documents/{item_id}", name="update_documents")
async def update_document(item_id: str, body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    updates = body.model_dump()
    updates.pop("id", None)
    updates.pop("created_at", None)
    updates.pop("blob_key", None)
    updates.pop("has_file", None)
    updates["updated_at"] = now_utc()
    result = await db.documents.update_one({"id": item_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.documents.find_one({"id": item_id}, {"_id": 0})
    return doc

@api.delete("/documents/{item_id}", name="delete_documents")
async def delete_document(item_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    doc = await db.documents.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("blob_key"):
        try:
            delete_pdf(doc["blob_key"])
        except Exception:
            log.exception("blob delete failed for %s", item_id)
    await db.documents.delete_one({"id": item_id})
    return {"ok": True}

make_crud("clients", "clients", list_roles=("admin",), write_roles=("admin",))

# Attendance — special model
class AttendanceCheckIn(BaseModel):
    note: Optional[str] = None
    location: Optional[str] = None

@api.post("/attendance/check-in")
async def check_in(body: AttendanceCheckIn, user: dict = Depends(get_current_user)):
    today = today_ist()
    existing = await db.attendance.find_one({"user_id": user["id"], "date": today})
    if existing and existing.get("check_in"):
        raise HTTPException(400, "Already checked in today")
    doc = existing or {"id": new_id(), "user_id": user["id"], "user_name": user["name"], "date": today, "created_at": now_utc()}
    doc["check_in"] = now_utc()
    doc["check_in_note"] = body.note
    doc["check_in_location"] = body.location
    await db.attendance.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    whatsapp: List[dict] = []
    try:
        whatsapp = await notify_attendance_checkin(user, doc["check_in"])
    except Exception:
        log.exception("Attendance check-in WhatsApp notification failed")
    result = strip_id(doc)
    result["whatsapp"] = whatsapp
    return result

@api.post("/attendance/check-out")
async def check_out(body: AttendanceCheckIn, user: dict = Depends(get_current_user)):
    today = today_ist()
    record = await db.attendance.find_one({"user_id": user["id"], "date": today})
    if not record:
        raise HTTPException(400, "Not checked in today")
    record["check_out"] = now_utc()
    record["check_out_note"] = body.note
    # work hours
    try:
        ci = datetime.fromisoformat(record["check_in"])
        co = datetime.fromisoformat(record["check_out"])
        record["work_hours"] = round((co - ci).total_seconds() / 3600, 2)
    except Exception:
        record["work_hours"] = 0
    await db.attendance.update_one({"id": record["id"]}, {"$set": record})
    await wa.send(
        user.get("phone") or "919999999999",
        f"Checked out at {format_ist_datetime(record['check_out'])} ({record['work_hours']}h)",
        event="attendance_checkout",
    )
    return strip_id(record)

@api.get("/attendance")
async def list_attendance(user: dict = Depends(get_current_user)):
    query = {} if user["role"] in ("admin", "manager") else {"user_id": user["id"]}
    items = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return items

@api.get("/attendance/today")
async def my_attendance_today(user: dict = Depends(get_current_user)):
    today = today_ist()
    rec = await db.attendance.find_one({"user_id": user["id"], "date": today}, {"_id": 0})
    return rec or {}

# Leaves
class LeaveInput(BaseModel):
    start_date: str
    end_date: str
    reason: str
    type: str = "casual"

@api.post("/leaves")
async def apply_leave(body: LeaveInput, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc.update({"id": new_id(), "user_id": user["id"], "user_name": user["name"],
                "status": "pending", "created_at": now_utc()})
    await db.leaves.insert_one(doc.copy())
    await wa.send(user.get("phone") or "919999999999",
                  f"Leave request submitted: {body.start_date} to {body.end_date}",
                  event="leave_request")
    return strip_id(doc)

@api.get("/leaves")
async def list_leaves(user: dict = Depends(get_current_user)):
    query = {} if user["role"] in ("admin", "manager") else {"user_id": user["id"]}
    return await db.leaves.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.put("/leaves/{leave_id}/approve")
async def approve_leave(leave_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    rec = await db.leaves.find_one({"id": leave_id})
    if not rec:
        raise HTTPException(404, "Not found")
    await db.leaves.update_one({"id": leave_id}, {"$set": {"status": "approved", "approved_by": user["id"], "approved_at": now_utc()}})
    applicant = await db.users.find_one({"id": rec["user_id"]})
    if applicant:
        await wa.send(applicant.get("phone") or "919999999999",
                      f"Your leave ({rec['start_date']} → {rec['end_date']}) has been APPROVED.",
                      event="leave_approval")
    return {"ok": True}

@api.put("/leaves/{leave_id}/reject")
async def reject_leave(leave_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    rec = await db.leaves.find_one({"id": leave_id})
    if not rec:
        raise HTTPException(404, "Not found")
    await db.leaves.update_one({"id": leave_id}, {"$set": {"status": "rejected", "approved_by": user["id"], "approved_at": now_utc()}})
    applicant = await db.users.find_one({"id": rec["user_id"]})
    if applicant:
        await wa.send(applicant.get("phone") or "919999999999",
                      f"Your leave request has been REJECTED.",
                      event="leave_rejection")
    return {"ok": True}

# Assigned daily tasks (CEO assigns → employee inbox)
ASSIGNED_TASK_STATUSES = ("todo", "in_progress", "review", "done")

class AssignedTaskInput(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_id: Optional[str] = None
    task_date: str
    status: Optional[str] = "todo"
    priority: Optional[str] = "medium"

@api.get("/assigned-tasks")
async def list_assigned_tasks(task_date: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if user["role"] != "admin":
        query["assignee_id"] = user["id"]
    if task_date:
        query["task_date"] = task_date
    items = await db.assigned_tasks.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

@api.post("/assigned-tasks")
async def create_assigned_task(body: AssignedTaskInput, user: dict = Depends(get_current_user)):
    if user["role"] == "admin":
        if not body.assignee_id:
            raise HTTPException(400, "Assignee is required")
        if not await is_directory_user(body.assignee_id):
            raise HTTPException(400, "Assignee is not an active team member")
        assignee = await db.users.find_one({"id": body.assignee_id}, {"_id": 0, "password_hash": 0})
        if not assignee:
            raise HTTPException(404, "Assignee not found")
    elif user["role"] == "employee":
        assignee = user
    else:
        raise HTTPException(403, "Insufficient permissions")
    doc = {
        "id": new_id(),
        "title": body.title.strip(),
        "description": (body.description or "").strip(),
        "assignee_id": assignee["id"],
        "assignee_name": assignee.get("name") or assignee.get("email"),
        "assigned_by": user["id"],
        "assigned_by_name": user.get("name") or user.get("email"),
        "task_date": body.task_date,
        "status": body.status or "todo",
        "priority": body.priority or "medium",
        "assignee_seen_at": None,
        "created_at": now_utc(),
    }
    await db.assigned_tasks.insert_one(doc.copy())
    try:
        phone = assignee.get("phone") or os.environ.get("ADMIN_PHONE", "919999999999")
        await wa.send(
            phone,
            f"New task for {body.task_date}: {doc['title']}",
            event="daily_task_assigned",
            meta={"task_id": doc["id"], "assignee_id": assignee["id"]},
        )
    except Exception:
        log.exception("daily task notify failed")
    return strip_id(doc)

@api.put("/assigned-tasks/{task_id}")
async def update_assigned_task(task_id: str, body: GenericDoc, user: dict = Depends(get_current_user)):
    existing = await db.assigned_tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    if user["role"] == "admin":
        updates = body.model_dump()
        updates.pop("id", None)
        updates.pop("created_at", None)
        if updates.get("assignee_id"):
            if not await is_directory_user(updates["assignee_id"]):
                raise HTTPException(400, "Assignee is not an active team member")
            assignee = await db.users.find_one({"id": updates["assignee_id"]}, {"_id": 0})
            if not assignee:
                raise HTTPException(404, "Assignee not found")
            updates["assignee_name"] = assignee.get("name") or assignee.get("email")
            if updates["assignee_id"] != existing.get("assignee_id"):
                updates["assignee_seen_at"] = None
        updates["updated_at"] = now_utc()
        await db.assigned_tasks.update_one({"id": task_id}, {"$set": updates})
    else:
        if existing.get("assignee_id") != user["id"]:
            raise HTTPException(403, "Forbidden")
        status = body.model_dump().get("status")
        if status not in ASSIGNED_TASK_STATUSES:
            raise HTTPException(400, "Invalid status")
        await db.assigned_tasks.update_one(
            {"id": task_id},
            {"$set": {"status": status, "updated_at": now_utc()}},
        )
    doc = await db.assigned_tasks.find_one({"id": task_id}, {"_id": 0})
    return doc

@api.delete("/assigned-tasks/{task_id}")
async def delete_assigned_task(task_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.assigned_tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

@api.post("/assigned-tasks/mark-seen")
async def mark_assigned_tasks_seen(user: dict = Depends(get_current_user)):
    await db.assigned_tasks.update_many(
        {
            "assignee_id": user["id"],
            "$or": [{"assignee_seen_at": None}, {"assignee_seen_at": {"$exists": False}}],
        },
        {"$set": {"assignee_seen_at": now_utc()}},
    )
    return {"ok": True}

# Personal notes (private notepad + sharing between team)
class NoteInput(BaseModel):
    title: Optional[str] = ""
    content: str = ""

class ShareNoteInput(BaseModel):
    user_ids: List[str] = Field(default_factory=list)

NOTE_IMAGE_URL_RE = re.compile(r"/api/notes/images/([a-f0-9-]{36})")

async def _link_note_images(content: str, note_id: str, user_id: str) -> None:
    for image_id in set(NOTE_IMAGE_URL_RE.findall(content or "")):
        await db.note_images.update_one(
            {"id": image_id, "user_id": user_id},
            {"$set": {"note_id": note_id, "updated_at": now_utc()}},
        )

async def _enrich_note(note: dict, viewer: dict) -> dict:
    note = dict(note)
    note["is_owner"] = note.get("user_id") == viewer["id"]
    note["shared_with"] = note.get("shared_with") or []
    if note["is_owner"]:
        if note["shared_with"]:
            shared_users = await db.users.find(
                {"id": {"$in": note["shared_with"]}},
                {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
            ).to_list(200)
            note["shared_with_users"] = [
                {"id": u["id"], "name": u.get("name") or u.get("email"), "role": u.get("role")}
                for u in shared_users
            ]
        else:
            note["shared_with_users"] = []
    else:
        owner = await db.users.find_one({"id": note.get("user_id")}, {"_id": 0, "name": 1, "email": 1})
        note["owner_name"] = (owner or {}).get("name") or (owner or {}).get("email") or "Unknown"
        seen_by = note.get("shared_seen_by") or []
        note["is_unread"] = viewer["id"] not in seen_by
    return note

@api.get("/notes/share-targets")
async def note_share_targets(user: dict = Depends(get_current_user)):
    users = await list_directory_users(exclude_user_id=user["id"])
    return [
        {"id": u["id"], "name": u.get("name"), "email": u.get("email"), "role": u.get("role")}
        for u in users
    ]

@api.get("/notes")
async def list_notes(user: dict = Depends(get_current_user)):
    items = await db.notes.find(
        {"$or": [{"user_id": user["id"]}, {"shared_with": user["id"]}]},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(200)
    return [await _enrich_note(n, user) for n in items]

@api.post("/notes")
async def create_note(body: NoteInput, user: dict = Depends(get_current_user)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "title": (body.title or "").strip() or "Untitled",
        "content": body.content or "",
        "shared_with": [],
        "shared_seen_by": [],
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    await db.notes.insert_one(doc.copy())
    await _link_note_images(doc["content"], doc["id"], user["id"])
    return await _enrich_note(strip_id(doc), user)

@api.put("/notes/{note_id}")
async def update_note(note_id: str, body: NoteInput, user: dict = Depends(get_current_user)):
    existing = await db.notes.find_one({"id": note_id, "user_id": user["id"]})
    if not existing:
        raise HTTPException(404, "Not found")
    updates = {
        "title": (body.title or "").strip() or "Untitled",
        "content": body.content or "",
        "updated_at": now_utc(),
    }
    await db.notes.update_one({"id": note_id}, {"$set": updates})
    await _link_note_images(updates["content"], note_id, user["id"])
    doc = await db.notes.find_one({"id": note_id}, {"_id": 0})
    return await _enrich_note(doc, user)

@api.post("/notes/{note_id}/share")
async def share_note(note_id: str, body: ShareNoteInput, user: dict = Depends(get_current_user)):
    existing = await db.notes.find_one({"id": note_id, "user_id": user["id"]})
    if not existing:
        raise HTTPException(404, "Not found")
    user_ids = list(dict.fromkeys(body.user_ids))
    if user_ids:
        allowed = {u["id"] for u in await list_directory_users()}
        if not all(uid in allowed for uid in user_ids):
            raise HTTPException(400, "One or more users are not active team members")
    old_shared = set(existing.get("shared_with") or [])
    new_shared = set(user_ids)
    newly_added = new_shared - old_shared
    seen_by = [
        u for u in (existing.get("shared_seen_by") or [])
        if u in new_shared and u not in newly_added
    ]
    await db.notes.update_one(
        {"id": note_id},
        {"$set": {"shared_with": user_ids, "shared_seen_by": seen_by, "updated_at": now_utc()}},
    )
    doc = await db.notes.find_one({"id": note_id}, {"_id": 0})
    return await _enrich_note(doc, user)

@api.post("/notes/{note_id}/mark-seen")
async def mark_note_seen(note_id: str, user: dict = Depends(get_current_user)):
    note = await db.notes.find_one({"id": note_id, "shared_with": user["id"]}, {"_id": 0})
    if not note:
        raise HTTPException(404, "Not found")
    await db.notes.update_one({"id": note_id}, {"$addToSet": {"shared_seen_by": user["id"]}})
    return {"ok": True}

@api.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    result = await db.notes.delete_one({"id": note_id, "user_id": user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

async def _user_can_access_note_image(user: dict, image_doc: dict) -> bool:
    if image_doc.get("user_id") == user["id"]:
        return True
    note_id = image_doc.get("note_id")
    if not note_id:
        return False
    note = await db.notes.find_one({"id": note_id}, {"_id": 0, "user_id": 1, "shared_with": 1})
    if not note:
        return False
    if note.get("user_id") == user["id"]:
        return True
    return user["id"] in (note.get("shared_with") or [])

@api.post("/notes/images")
async def upload_note_image(
    file: UploadFile = File(...),
    note_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    if note_id:
        note = await db.notes.find_one({"id": note_id, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not note:
            raise HTTPException(404, "Note not found")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, GIF, and WebP images are allowed")
    data = await file.read()
    image_id = new_id()
    ext = ALLOWED_IMAGE_TYPES[content_type]
    blob_key = f"{image_id}{ext}"
    try:
        size_bytes = save_note_image(blob_key, data, content_type)
    except ValueError as e:
        raise HTTPException(400, str(e))
    doc = {
        "id": image_id,
        "user_id": user["id"],
        "note_id": note_id,
        "blob_key": blob_key,
        "mime": content_type,
        "size_bytes": size_bytes,
        "created_at": now_utc(),
    }
    await db.note_images.insert_one(doc.copy())
    return {"id": image_id, "url": f"/api/notes/images/{image_id}"}

@api.get("/notes/images/{image_id}")
async def get_note_image(image_id: str, user: dict = Depends(get_current_user)):
    image_doc = await db.note_images.find_one({"id": image_id}, {"_id": 0})
    if not image_doc:
        raise HTTPException(404, "Image not found")
    if not await _user_can_access_note_image(user, image_doc):
        raise HTTPException(403, "Access denied")
    try:
        data, mime = read_note_image(image_doc["blob_key"])
    except FileNotFoundError:
        raise HTTPException(404, "Image file missing")
    return StreamingResponse(iter([data]), media_type=mime)

@api.patch("/notes/images/{image_id}")
async def update_note_image_meta(
    image_id: str,
    note_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    image_doc = await db.note_images.find_one({"id": image_id, "user_id": user["id"]}, {"_id": 0})
    if not image_doc:
        raise HTTPException(404, "Image not found")
    if note_id:
        note = await db.notes.find_one({"id": note_id, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not note:
            raise HTTPException(404, "Note not found")
    await db.note_images.update_one({"id": image_id}, {"$set": {"note_id": note_id, "updated_at": now_utc()}})
    return {"ok": True, "url": f"/api/notes/images/{image_id}"}

@api.delete("/notes/images/{image_id}")
async def remove_note_image(image_id: str, user: dict = Depends(get_current_user)):
    image_doc = await db.note_images.find_one({"id": image_id, "user_id": user["id"]}, {"_id": 0})
    if not image_doc:
        raise HTTPException(404, "Image not found")
    delete_note_image(image_doc["blob_key"])
    await db.note_images.delete_one({"id": image_id})
    return {"ok": True}

# Notifications
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    return await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)

@api.delete("/notifications")
async def clear_notifications(user: dict = Depends(require_roles("admin"))):
    result = await db.notifications.delete_many({})
    return {"ok": True, "deleted": result.deleted_count}

class TestNotify(BaseModel):
    to: str
    message: str

@api.post("/notifications/test")
async def send_test_notification(body: TestNotify, user: dict = Depends(require_roles("admin"))):
    return await wa.send(body.to, body.message, event="test")

# Reports / Dashboard
@api.get("/reports/dashboard")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    today = today_ist()
    counts = {
        "employees": await db.employees.count_documents({}),
        "projects": await db.projects.count_documents({}),
        "active_projects": await db.projects.count_documents({"status": {"$in": ["active", "in_progress"]}}),
        "tasks": await db.tasks.count_documents({}),
        "tickets": await db.tickets.count_documents({}),
        "open_tickets": await db.tickets.count_documents({"status": {"$ne": "closed"}}),
        "clients": await db.clients.count_documents({}),
        "assets": await db.assets.count_documents({}),
        "amc_due": await db.amc.count_documents({}),
        "today_attendance": await db.attendance.count_documents({"date": today}),
        "pending_leaves": await db.leaves.count_documents({"status": "pending"}),
        "notifications": await db.notifications.count_documents({}),
        "users": await db.users.count_documents({}),
    }
    # Expenses totals
    expense_pipeline = [{"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    exp = await db.expenses.aggregate(expense_pipeline).to_list(1)
    inv_docs = await db.invoices.find({}, {"_id": 0, "amount": 1, "amount_set": 1}).to_list(5000)
    counts["total_expenses"] = round(exp[0]["total"], 2) if exp else 0
    counts["total_invoiced"] = round(sum(_invoice_amount_value(i) for i in inv_docs), 2)
    counts["pnl"] = counts["total_invoiced"] - counts["total_expenses"]
    return counts

@api.get("/reports/finance-trend")
async def finance_trend(user: dict = Depends(get_current_user)):
    """Aggregate expenses & invoices by month for last 6 months."""
    expenses = await db.expenses.find({}, {"_id": 0}).to_list(5000)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(5000)
    buckets = {}
    for e in expenses:
        m = (e.get("date") or e.get("created_at", ""))[:7]
        buckets.setdefault(m, {"month": m, "expense": 0, "revenue": 0})
        buckets[m]["expense"] += float(e.get("amount", 0) or 0)
    for i in invoices:
        m = (i.get("date") or i.get("created_at", ""))[:7]
        buckets.setdefault(m, {"month": m, "expense": 0, "revenue": 0})
        buckets[m]["revenue"] += _invoice_amount_value(i)
    out = sorted(buckets.values(), key=lambda x: x["month"])
    return out[-6:]

@api.get("/users")
async def list_users(user: dict = Depends(require_roles("admin", "manager"))):
    return await list_directory_users()

# ──────────────────────────────────────────────────────────────────────────────
# Employee-scoped views (role-aware)
# ──────────────────────────────────────────────────────────────────────────────
def _employee_match(user: dict, field_candidates: list[str]):
    """Return a Mongo $or filter that matches the employee by name OR email."""
    keys = []
    for c in field_candidates:
        keys.append({c: user.get("name")})
        keys.append({c: user.get("email")})
    return {"$or": keys}

@api.get("/me/sidebar-alerts")
async def sidebar_alerts(user: dict = Depends(get_current_user)):
    uid = user["id"]
    task_count = await db.assigned_tasks.count_documents({
        "assignee_id": uid,
        "$or": [{"assignee_seen_at": None}, {"assignee_seen_at": {"$exists": False}}],
    })
    note_count = await db.notes.count_documents({
        "shared_with": uid,
        "user_id": {"$ne": uid},
        "shared_seen_by": {"$nin": [uid]},
    })
    return {"assigned_tasks": task_count, "shared_notes": note_count}

@api.get("/me/dashboard")
async def my_dashboard(user: dict = Depends(get_current_user)):
    today = today_ist()
    my_tasks = await db.tasks.count_documents(_employee_match(user, ["assignee"]))
    my_open_tasks = await db.tasks.count_documents(
        {"$and": [_employee_match(user, ["assignee"]), {"status": {"$ne": "done"}}]}
    )
    my_tickets = await db.tickets.count_documents(_employee_match(user, ["assigned_to"]))
    my_meeting_items = await db.meetings.find(
        {"$or": [
            {"attendees": {"$regex": user.get("name", "") or "X", "$options": "i"}},
            {"attendees": "All Team"},
        ]},
        {"_id": 0, "start_at": 1, "end_at": 1},
    ).to_list(500)
    my_meetings = sum(1 for m in my_meeting_items if _meeting_still_upcoming(m))
    my_visits = await db.visits.count_documents(_employee_match(user, ["employee"]))
    my_attendance = await db.attendance.count_documents({"user_id": user["id"]})
    my_leaves_pending = await db.leaves.count_documents({"user_id": user["id"], "status": "pending"})
    today_record = await db.attendance.find_one({"user_id": user["id"], "date": today}, {"_id": 0})
    my_assigned_tasks = await db.assigned_tasks.count_documents({"assignee_id": user["id"]})
    my_open_assigned = await db.assigned_tasks.count_documents(
        {"assignee_id": user["id"], "status": {"$ne": "done"}}
    )
    return {
        "my_tasks": my_tasks,
        "my_open_tasks": my_open_tasks,
        "my_assigned_tasks": my_assigned_tasks,
        "my_open_assigned": my_open_assigned,
        "my_tickets": my_tickets,
        "my_meetings": my_meetings,
        "my_visits": my_visits,
        "my_attendance_days": my_attendance,
        "my_leaves_pending": my_leaves_pending,
        "today_attendance": today_record or {},
    }

@api.get("/me/tasks")
async def my_tasks(user: dict = Depends(get_current_user)):
    return await db.tasks.find(_employee_match(user, ["assignee"]), {"_id": 0}).sort("due_date", 1).to_list(500)

@api.get("/me/tickets")
async def my_tickets(user: dict = Depends(get_current_user)):
    return await db.tickets.find(_employee_match(user, ["assigned_to"]), {"_id": 0}).sort("created_at", -1).to_list(500)

def _meeting_still_upcoming(meeting: dict) -> bool:
    end_raw = meeting.get("end_at") or meeting.get("start_at")
    if not end_raw:
        return False
    try:
        end_dt = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00"))
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        return end_dt >= datetime.now(timezone.utc)
    except Exception:
        return True

@api.get("/me/meetings")
async def my_meetings(user: dict = Depends(get_current_user)):
    name = user.get("name") or "X"
    items = await db.meetings.find(
        {"$or": [{"attendees": {"$regex": name, "$options": "i"}}, {"attendees": "All Team"}]},
        {"_id": 0},
    ).sort("start_at", 1).to_list(500)
    return [m for m in items if _meeting_still_upcoming(m)]

# ──────────────────────────────────────────────────────────────────────────────
# Global Search
# ──────────────────────────────────────────────────────────────────────────────
SEARCH_COLLECTIONS = {
    "projects": ("name", ["name", "client", "manager"], "/projects"),
    "clients": ("name", ["name", "contact_person", "industry", "email"], "/crm"),
    "employees": ("name", ["name", "designation", "department", "email"], "/employees"),
    "tickets": ("subject", ["subject", "client", "assigned_to"], "/helpdesk"),
    "assets": ("name", ["name", "category", "serial", "assigned_to"], "/assets"),
    "documents": ("name", ["name", "category", "client"], "/documents"),
    "amc": ("title", ["title", "vendor"], "/amc"),
    "meetings": ("title", ["title", "location"], "/meetings"),
    "visits": ("client", ["client", "location", "employee"], "/visits"),
    "tasks": ("title", ["title", "project", "assignee"], "/projects"),
    "invoices": ("invoice_no", ["invoice_no", "client"], "/finance"),
    "expenses": ("title", ["title", "category", "vendor"], "/finance"),
}

@api.get("/search")
async def global_search(q: str, user: dict = Depends(get_current_user)):
    if not q or len(q.strip()) < 2:
        return {"results": []}
    q = q.strip()
    pattern = {"$regex": q, "$options": "i"}
    results = []
    searchable = SEARCH_COLLECTIONS
    if user.get("role") == "employee":
        searchable = {k: v for k, v in SEARCH_COLLECTIONS.items() if k not in ("clients", "documents")}
    elif user.get("role") != "admin":
        searchable = {k: v for k, v in SEARCH_COLLECTIONS.items() if k != "clients"}
    for col, (title_field, fields, route) in searchable.items():
        or_filter = [{f: pattern} for f in fields]
        docs = await db[col].find({"$or": or_filter}, {"_id": 0}).limit(5).to_list(5)
        for d in docs:
            results.append({
                "type": col,
                "title": d.get(title_field) or d.get("name") or "—",
                "subtitle": d.get("client") or d.get("category") or d.get("department") or d.get("designation") or "",
                "route": route,
                "id": d.get("id"),
            })
    return {"results": results[:25]}

# ──────────────────────────────────────────────────────────────────────────────
# AI Assistant (Amazon Bedrock)
# ──────────────────────────────────────────────────────────────────────────────
async def _build_context(user: dict) -> str:
    """Build a concise data summary for the LLM system prompt."""
    counts = {
        "employees": await db.employees.count_documents({}),
        "projects": await db.projects.count_documents({}),
        "active_projects": await db.projects.count_documents({"status": {"$in": ["active", "in_progress"]}}),
        "clients": await db.clients.count_documents({}),
        "open_tickets": await db.tickets.count_documents({"status": {"$ne": "closed"}}),
        "assets": await db.assets.count_documents({}),
        "pending_leaves": await db.leaves.count_documents({"status": "pending"}),
    }
    pnl_exp = await db.expenses.aggregate([{"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
    inv_docs = await db.invoices.find({}, {"_id": 0, "amount": 1, "amount_set": 1}).to_list(5000)
    expenses = pnl_exp[0]["t"] if pnl_exp else 0
    revenue = sum(_invoice_amount_value(i) for i in inv_docs)
    counts["revenue"] = revenue
    counts["expenses"] = expenses
    counts["pnl"] = revenue - expenses

    recent_projects = await db.projects.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    recent_tickets = await db.tickets.find({"status": {"$ne": "closed"}}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
    recent_clients = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)

    return f"""Company snapshot (Bitsparx Tech):
- Employees: {counts['employees']}, Active projects: {counts['active_projects']}/{counts['projects']}, Clients: {counts['clients']}
- Open tickets: {counts['open_tickets']}, Assets: {counts['assets']}, Pending leaves: {counts['pending_leaves']}
- Revenue: ₹{counts['revenue']:,.0f}, Expenses: ₹{counts['expenses']:,.0f}, P&L: ₹{counts['pnl']:,.0f}

Recent projects: {[{ 'name': p.get('name'), 'client': p.get('client'), 'status': p.get('status'), 'progress': p.get('progress')} for p in recent_projects]}

Open tickets: {[{ 'subject': t.get('subject'), 'priority': t.get('priority'), 'client': t.get('client')} for t in recent_tickets]}

Top clients: {[{ 'name': c.get('name'), 'stage': c.get('stage'), 'deal_value': c.get('deal_value')} for c in recent_clients]}

Current user: {user.get('name')} ({user.get('role')})
"""

class ChatInput(BaseModel):
    message: str
    session_id: Optional[str] = None

@api.post("/chat")
async def chat_with_assistant(body: ChatInput, user: dict = Depends(get_current_user)):
    session_id = body.session_id or new_id()
    llm_provider = os.environ.get("LLM_PROVIDER", "bedrock").strip().lower()
    if llm_provider != "bedrock":
        raise HTTPException(503, f"Unsupported LLM_PROVIDER: {llm_provider}")

    bedrock_key = (
        os.environ.get("BEDROCK_API_KEY", "").strip()
        or os.environ.get("AWS_BEARER_TOKEN_BEDROCK", "").strip()
    )
    if not bedrock_key:
        raise HTTPException(503, "Bedrock API key not configured (BEDROCK_API_KEY)")

    history_docs = await db.chat_messages.find(
        {"session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).limit(30).to_list(30)

    company_ctx = await _build_context(user)
    system_msg = (
        "You are BitsBot, the AI assistant for Bitsparx HQ — a company management platform. "
        "Answer questions using the company snapshot below. Be concise, friendly, professional. "
        "Format numbers with commas and ₹ for currency. If a question is outside the company data, "
        "answer briefly using general knowledge. Never invent specific records that aren't in the snapshot.\n\n"
        + company_ctx
    )

    converse_messages = []
    for doc in history_docs:
        role = "user" if doc.get("role") == "user" else "assistant"
        converse_messages.append(
            {"role": role, "content": [{"text": doc.get("content", "")}]}
        )
    converse_messages.append(
        {"role": "user", "content": [{"text": body.message}]}
    )

    try:
        reply_text = await bedrock_chat(
            system_message=system_msg,
            messages=converse_messages,
        )
    except httpx.HTTPStatusError as exc:
        log.exception("Bedrock request failed")
        raise HTTPException(502, f"Bedrock error: {exc.response.status_code}") from exc
    except Exception as exc:
        log.exception("Bedrock chat failed")
        raise HTTPException(502, "AI assistant unavailable") from exc

    now = now_utc()
    await db.chat_messages.insert_many([
        {"id": new_id(), "session_id": session_id, "user_id": user["id"], "role": "user", "content": body.message, "created_at": now},
        {"id": new_id(), "session_id": session_id, "user_id": user["id"], "role": "assistant", "content": reply_text, "created_at": now},
    ])
    return {"reply": reply_text, "session_id": session_id}

@api.get("/chat/history")
async def chat_history(session_id: str, user: dict = Depends(get_current_user)):
    msgs = await db.chat_messages.find(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return msgs

# ──────────────────────────────────────────────────────────────────────────────
# Seeding
# ──────────────────────────────────────────────────────────────────────────────
async def seed():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@bitsparx.com").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "Admin@123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": new_id(), "email": admin_email, "name": "Bitsparx Admin",
            "role": "admin", "phone": "919999999999",
            "department": "Management",
            "password_hash": hash_password(admin_pw), "created_at": now_utc(),
        })
        log.info(f"Seeded admin: {admin_email}")
    elif not verify_password(admin_pw, existing.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pw)}})

    # demo manager + employee
    demo_users = [
        ("manager@bitsparx.com", "Manager@123", "Priya Manager", "manager", "Operations", "919900000001"),
        ("employee@bitsparx.com", "Employee@123", "Arjun Employee", "employee", "Engineering", "919900000002"),
    ]
    for email, pw, name, role, dept, phone in demo_users:
        if not await db.users.find_one({"email": email}):
            await db.users.insert_one({
                "id": new_id(), "email": email, "name": name, "role": role,
                "phone": phone, "department": dept,
                "password_hash": hash_password(pw), "created_at": now_utc(),
            })

    # seed sample employees, clients, projects if empty
    if await db.employees.count_documents({}) == 0:
        sample_emps = [
            {"id": new_id(), "name": "Riya Sharma", "email": "riya@bitsparx.com", "phone": "919900111001", "designation": "Frontend Lead", "department": "Engineering", "salary": 95000, "join_date": "2023-08-12", "performance": 4.6, "status": "active", "created_at": now_utc()},
            {"id": new_id(), "name": "Vikram Iyer", "email": "vikram@bitsparx.com", "phone": "919900111002", "designation": "Backend Engineer", "department": "Engineering", "salary": 88000, "join_date": "2022-11-03", "performance": 4.2, "status": "active", "created_at": now_utc()},
            {"id": new_id(), "name": "Sneha Patel", "email": "sneha@bitsparx.com", "phone": "919900111003", "designation": "Product Designer", "department": "Design", "salary": 78000, "join_date": "2024-02-19", "performance": 4.8, "status": "active", "created_at": now_utc()},
            {"id": new_id(), "name": "Karan Mehta", "email": "karan@bitsparx.com", "phone": "919900111004", "designation": "Sales Manager", "department": "Sales", "salary": 105000, "join_date": "2021-05-22", "performance": 4.4, "status": "active", "created_at": now_utc()},
        ]
        await db.employees.insert_many(sample_emps)

    if await db.clients.count_documents({}) == 0:
        await db.clients.insert_many([
            {"id": new_id(), "name": "Aurora Retail Pvt Ltd", "contact_person": "Mr. Suresh Rao", "email": "suresh@aurora.in", "contact_phone": "918888100001", "industry": "Retail", "stage": "won", "deal_value": 480000, "address": "MG Road, Bangalore", "created_at": now_utc()},
            {"id": new_id(), "name": "Helix Health Systems", "contact_person": "Dr. Anita Kapoor", "email": "anita@helix.in", "contact_phone": "918888100002", "industry": "Healthcare", "stage": "negotiation", "deal_value": 220000, "address": "Bandra, Mumbai", "created_at": now_utc()},
            {"id": new_id(), "name": "Vertex Logistics", "contact_person": "Mr. Imran Sheikh", "email": "imran@vertex.in", "contact_phone": "918888100003", "industry": "Logistics", "stage": "qualified", "deal_value": 660000, "address": "Sector 18, Noida", "created_at": now_utc()},
            {"id": new_id(), "name": "Pixelnova Studio", "contact_person": "Ms. Tara Singh", "email": "tara@pixelnova.in", "contact_phone": "918888100004", "industry": "Media", "stage": "lead", "deal_value": 95000, "address": "HSR Layout, Bangalore", "created_at": now_utc()},
        ])

    if await db.projects.count_documents({}) == 0:
        await db.projects.insert_many([
            {"id": new_id(), "name": "Aurora POS Rollout", "client": "Aurora Retail Pvt Ltd", "manager": "Karan Mehta", "status": "in_progress", "progress": 62, "budget": 480000, "budget_set": True, "created_by_role": "admin", "deadline": "2026-04-30", "start_date": "2026-01-10", "created_at": now_utc()},
            {"id": new_id(), "name": "Helix Patient Portal", "client": "Helix Health Systems", "manager": "Vikram Iyer", "status": "in_progress", "progress": 38, "budget": 220000, "budget_set": True, "created_by_role": "admin", "deadline": "2026-06-15", "start_date": "2026-02-01", "created_at": now_utc()},
            {"id": new_id(), "name": "Vertex Fleet Tracker", "client": "Vertex Logistics", "manager": "Riya Sharma", "status": "planning", "progress": 10, "budget": 660000, "budget_set": True, "created_by_role": "admin", "deadline": "2026-08-30", "start_date": "2026-03-01", "created_at": now_utc()},
            {"id": new_id(), "name": "Pixelnova Brand Site", "client": "Pixelnova Studio", "manager": "Sneha Patel", "status": "completed", "progress": 100, "budget": 95000, "budget_set": True, "created_by_role": "admin", "deadline": "2026-01-28", "start_date": "2025-12-01", "created_at": now_utc()},
        ])

    if await db.tasks.count_documents({}) == 0:
        await db.tasks.insert_many([
            {"id": new_id(), "title": "Design POS dashboard wireframe", "project": "Aurora POS Rollout", "assignee": "Sneha Patel", "status": "in_progress", "priority": "high", "due_date": "2026-02-20", "created_at": now_utc()},
            {"id": new_id(), "title": "Implement OAuth login", "project": "Helix Patient Portal", "assignee": "Vikram Iyer", "status": "todo", "priority": "high", "due_date": "2026-02-25", "created_at": now_utc()},
            {"id": new_id(), "title": "Fleet GPS API integration", "project": "Vertex Fleet Tracker", "assignee": "Riya Sharma", "status": "todo", "priority": "medium", "due_date": "2026-03-10", "created_at": now_utc()},
            {"id": new_id(), "title": "Customer feedback survey", "project": "Pixelnova Brand Site", "assignee": "Karan Mehta", "status": "done", "priority": "low", "due_date": "2026-01-30", "created_at": now_utc()},
        ])

    if await db.expenses.count_documents({}) == 0:
        await db.expenses.insert_many([
            {"id": new_id(), "title": "AWS infrastructure", "category": "Cloud", "project": "Aurora POS Rollout", "qty": 1, "unit_cost": 42000, "amount": 42000, "date": "2026-01-15", "vendor": "Amazon Web Services", "created_at": now_utc()},
            {"id": new_id(), "title": "Office rent", "category": "Operations", "qty": 1, "unit_cost": 85000, "amount": 85000, "date": "2026-01-01", "vendor": "WeWork", "created_at": now_utc()},
            {"id": new_id(), "title": "Marketing campaign", "category": "Marketing", "qty": 4, "unit_cost": 8000, "amount": 32000, "date": "2025-12-20", "vendor": "Google Ads", "created_at": now_utc()},
            {"id": new_id(), "title": "Design tools subscription", "category": "Software", "qty": 6, "unit_cost": 3000, "amount": 18000, "date": "2025-11-10", "vendor": "Figma", "created_at": now_utc()},
            {"id": new_id(), "title": "Travel — client visit", "category": "Travel", "qty": 2, "unit_cost": 6250, "amount": 12500, "date": "2026-02-02", "vendor": "MakeMyTrip", "created_at": now_utc()},
        ])

    if await db.invoices.count_documents({}) == 0:
        await db.invoices.insert_many([
            {"id": new_id(), "invoice_no": "INV-2026-001", "client": "Aurora Retail Pvt Ltd", "amount": 250000, "amount_set": True, "created_by_role": "admin", "status": "paid", "date": "2026-01-15", "due_date": "2026-02-15", "created_at": now_utc()},
            {"id": new_id(), "invoice_no": "INV-2026-002", "client": "Helix Health Systems", "amount": 110000, "amount_set": True, "created_by_role": "admin", "status": "sent", "date": "2026-02-01", "due_date": "2026-03-01", "created_at": now_utc()},
            {"id": new_id(), "invoice_no": "INV-2025-099", "client": "Pixelnova Studio", "amount": 95000, "amount_set": True, "created_by_role": "admin", "status": "paid", "date": "2025-12-28", "due_date": "2026-01-28", "created_at": now_utc()},
            {"id": new_id(), "invoice_no": "INV-2026-003", "client": "Vertex Logistics", "amount": 220000, "amount_set": True, "created_by_role": "admin", "status": "draft", "date": "2026-02-10", "due_date": "2026-03-10", "created_at": now_utc()},
        ])

    if await db.meetings.count_documents({}) == 0:
        await db.meetings.insert_many([
            {"id": new_id(), "title": "Aurora Sprint Review", "start_at": "2026-02-18T10:00:00", "end_at": "2026-02-18T11:00:00", "attendees": ["Karan Mehta", "Sneha Patel"], "location": "Meet Room A", "recurring": "weekly", "created_at": now_utc()},
            {"id": new_id(), "title": "Helix Discovery Call", "start_at": "2026-02-20T15:30:00", "end_at": "2026-02-20T16:30:00", "attendees": ["Vikram Iyer", "Anita Kapoor"], "location": "Zoom", "recurring": "none", "created_at": now_utc()},
            {"id": new_id(), "title": "Monthly All Hands", "start_at": "2026-02-28T09:00:00", "end_at": "2026-02-28T10:00:00", "attendees": ["All Team"], "location": "Main Auditorium", "recurring": "monthly", "created_at": now_utc()},
        ])

    if await db.visits.count_documents({}) == 0:
        await db.visits.insert_many([
            {"id": new_id(), "client": "Aurora Retail Pvt Ltd", "location": "MG Road, Bangalore", "lat": 12.9716, "lng": 77.5946, "visit_date": "2026-02-12", "purpose": "Demo & training", "employee": "Karan Mehta", "outcome": "Positive — moving to phase 2", "created_at": now_utc()},
            {"id": new_id(), "client": "Helix Health Systems", "location": "Bandra, Mumbai", "lat": 19.0596, "lng": 72.8295, "visit_date": "2026-02-08", "purpose": "Requirement gathering", "employee": "Vikram Iyer", "outcome": "Scope finalized", "created_at": now_utc()},
            {"id": new_id(), "client": "Vertex Logistics", "location": "Sector 18, Noida", "lat": 28.5697, "lng": 77.3257, "visit_date": "2026-02-05", "purpose": "Site survey", "employee": "Riya Sharma", "outcome": "Need follow-up", "created_at": now_utc()},
        ])

    if await db.assets.count_documents({}) == 0:
        await db.assets.insert_many([
            {"id": new_id(), "name": "MacBook Pro 16\" M3", "category": "Laptop", "serial": "MBP-2024-A12", "assigned_to": "Riya Sharma", "purchase_date": "2024-08-01", "qty": 1, "unit_cost": 285000, "value": 285000, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "Dell XPS 15", "category": "Laptop", "serial": "DXPS-2023-B07", "assigned_to": "Vikram Iyer", "purchase_date": "2023-11-15", "qty": 1, "unit_cost": 165000, "value": 165000, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "iPhone 15 Pro", "category": "Mobile", "serial": "IP15P-098", "assigned_to": "Karan Mehta", "purchase_date": "2024-01-20", "qty": 1, "unit_cost": 135000, "value": 135000, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "LG UltraWide Monitor", "category": "Peripheral", "serial": "LGU-2024-301", "assigned_to": "Sneha Patel", "purchase_date": "2024-03-10", "qty": 1, "unit_cost": 42000, "value": 42000, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "HP LaserJet Pro", "category": "Printer", "serial": "HPLJ-002", "assigned_to": None, "purchase_date": "2022-06-15", "qty": 1, "unit_cost": 28000, "value": 28000, "status": "in_storage", "created_at": now_utc()},
        ])

    if await db.amc.count_documents({}) == 0:
        await db.amc.insert_many([
            {"id": new_id(), "title": "Office HVAC Service", "vendor": "CoolAir Solutions", "contact_phone": "919900222001", "start_date": "2025-08-01", "renewal_date": "2026-08-01", "value": 24000, "status": "active", "created_at": now_utc()},
            {"id": new_id(), "title": "Server Rack Maintenance", "vendor": "Dell India", "contact_phone": "919900222002", "start_date": "2025-04-01", "renewal_date": "2026-04-01", "value": 78000, "status": "renewal_due", "created_at": now_utc()},
            {"id": new_id(), "title": "Software Licenses", "vendor": "Microsoft", "contact_phone": "919900222003", "start_date": "2025-12-01", "renewal_date": "2026-12-01", "value": 145000, "status": "active", "created_at": now_utc()},
        ])

    if await db.tickets.count_documents({}) == 0:
        await db.tickets.insert_many([
            {"id": new_id(), "subject": "POS terminal not syncing", "client": "Aurora Retail Pvt Ltd", "priority": "high", "status": "open", "assigned_to": "Vikram Iyer", "sla_hours": 4, "created_at": now_utc()},
            {"id": new_id(), "subject": "Reset admin password", "client": "Helix Health Systems", "priority": "low", "status": "in_progress", "assigned_to": "Riya Sharma", "sla_hours": 24, "created_at": now_utc()},
            {"id": new_id(), "subject": "Export CSV failing", "client": "Pixelnova Studio", "priority": "medium", "status": "closed", "assigned_to": "Sneha Patel", "sla_hours": 12, "created_at": now_utc()},
        ])

    if await db.documents.count_documents({}) == 0:
        await db.documents.insert_many([
            {"id": new_id(), "name": "Aurora MSA - signed.pdf", "category": "Contract", "client": "Aurora Retail Pvt Ltd", "version": "v2.1", "size_kb": 845, "uploaded_by": "Bitsparx Admin", "has_file": False, "created_at": now_utc()},
            {"id": new_id(), "name": "Helix Quotation Q1.pdf", "category": "Quotation", "client": "Helix Health Systems", "version": "v1.0", "size_kb": 312, "uploaded_by": "Karan Mehta", "has_file": False, "created_at": now_utc()},
            {"id": new_id(), "name": "Vertex NDA.pdf", "category": "NDA", "client": "Vertex Logistics", "version": "v1.0", "size_kb": 218, "uploaded_by": "Bitsparx Admin", "has_file": False, "created_at": now_utc()},
            {"id": new_id(), "name": "Internal — Employee handbook 2026.pdf", "category": "HR", "client": None, "version": "v3.2", "size_kb": 1240, "uploaded_by": "Priya Manager", "has_file": False, "created_at": now_utc()},
        ])

    log.info("Seed complete")


@app.on_event("startup")
async def on_start():
    ensure_blob_dirs()
    ensure_note_image_dirs()
    # indexes
    await db.users.create_index("email", unique=True)
    await db.attendance.create_index([("user_id", 1), ("date", 1)])
    await db.assigned_tasks.create_index([("assignee_id", 1), ("task_date", 1)])
    await db.notes.create_index([("user_id", 1), ("updated_at", -1)])
    await db.notes.create_index("shared_with")
    await db.note_images.create_index("note_id")
    await db.note_images.create_index("user_id")
    await seed()

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw or raw == "*":
        return [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]

# Mount routers + CORS
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
