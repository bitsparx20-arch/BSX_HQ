"""
Bitsparx HQ — Company Management System
FastAPI backend with JWT auth, role-based access, 12 module CRUDs,
and SpringEdge WhatsApp notification service.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any

import bcrypt
import jwt
import httpx
from bedrock_llm import bedrock_chat
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# ──────────────────────────────────────────────────────────────────────────────
# Config & DB
# ──────────────────────────────────────────────────────────────────────────────
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"

def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default).lower()).strip().lower() in ("1", "true", "yes")

COOKIE_SECURE = _env_bool("COOKIE_SECURE", default=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("bitsparx")

app = FastAPI(title="Bitsparx HQ API")
api = APIRouter(prefix="/api")

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

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
    return user

def require_roles(*roles: str):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker

# ──────────────────────────────────────────────────────────────────────────────
# SpringEdge WhatsApp service
# ──────────────────────────────────────────────────────────────────────────────
class WhatsAppService:
    """SpringEdge WhatsApp gateway. Falls back to log-only when keys missing."""

    def __init__(self):
        self.api_key = os.environ.get("SPRINGEDGE_API_KEY", "").strip()
        self.sender = os.environ.get("SPRINGEDGE_SENDER", "BITSPARX")
        self.url = os.environ.get("SPRINGEDGE_WHATSAPP_URL", "https://api.springedge.com/whatsapp/v1/send")
        self.enabled = (
            os.environ.get("SPRINGEDGE_ENABLED", "false").lower() == "true"
            and bool(self.api_key)
        )

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
        if not self.enabled:
            record["status"] = "logged_only"
            record["info"] = "SpringEdge not configured. Set SPRINGEDGE_API_KEY & SPRINGEDGE_ENABLED=true."
            log.info(f"[WA·LOG] to={to} event={event} msg={message[:80]}")
            await db.notifications.insert_one(record.copy())
            return record
        try:
            async with httpx.AsyncClient(timeout=15.0) as cx:
                resp = await cx.post(
                    self.url,
                    data={
                        "apikey": self.api_key,
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
        await db.notifications.insert_one(record.copy())
        return record

wa = WhatsAppService()

# ──────────────────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────────────────
class LoginInput(BaseModel):
    email: EmailStr
    password: str

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
    token = create_access_token(user["id"], user["email"], user.get("role", "employee"))
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

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

# ──────────────────────────────────────────────────────────────────────────────
# Generic CRUD factory
# ──────────────────────────────────────────────────────────────────────────────
def make_crud(path: str, collection: str, notify_event: Optional[str] = None,
              notify_template=None, list_roles=None, write_roles=None):
    """
    Registers POST /{path}, GET /{path}, GET /{path}/{id}, PUT /{path}/{id}, DELETE /{path}/{id}
    """
    list_roles = list_roles or ("admin", "manager", "employee")
    write_roles = write_roles or ("admin", "manager")

    @api.get(f"/{path}", name=f"list_{collection}")
    async def list_items(user: dict = Depends(require_roles(*list_roles))):
        items = await db[collection].find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return items

    @api.post(f"/{path}", name=f"create_{collection}")
    async def create_item(body: GenericDoc, user: dict = Depends(require_roles(*write_roles))):
        doc = body.model_dump()
        doc["id"] = new_id()
        doc["created_at"] = now_utc()
        doc["created_by"] = user["id"]
        await db[collection].insert_one(doc.copy())
        if notify_event and notify_template:
            try:
                msg = notify_template(doc)
                phone = doc.get("phone") or doc.get("contact_phone") or os.environ.get("ADMIN_PHONE", "919999999999")
                await wa.send(phone, msg, event=notify_event, meta={"id": doc["id"], "collection": collection})
            except Exception:
                log.exception("notify failed")
        return strip_id(doc)

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
# Module CRUDs (12 modules)
# ──────────────────────────────────────────────────────────────────────────────
make_crud("employees", "employees",
          notify_event="employee_added",
          notify_template=lambda d: f"Welcome to Bitsparx HQ, {d.get('name','colleague')}! Your account is being set up.")

make_crud("projects", "projects",
          notify_event="project_created",
          notify_template=lambda d: f"New project assigned: {d.get('name','-')}. Deadline: {d.get('deadline','TBD')}.")

make_crud("tasks", "tasks",
          notify_event="task_assigned",
          notify_template=lambda d: f"Task '{d.get('title','-')}' assigned to you. Due: {d.get('due_date','TBD')}.")

make_crud("expenses", "expenses")
make_crud("invoices", "invoices")
make_crud("meetings", "meetings",
          notify_event="meeting_scheduled",
          notify_template=lambda d: f"Meeting '{d.get('title','-')}' scheduled on {d.get('start_at','TBD')}.")

make_crud("visits", "visits",
          notify_event="client_visit",
          notify_template=lambda d: f"Client visit logged at {d.get('location','-')} on {d.get('visit_date','-')}.")

make_crud("assets", "assets")
make_crud("amc", "amc",
          notify_event="amc_renewal",
          notify_template=lambda d: f"AMC '{d.get('title','-')}' renewal due on {d.get('renewal_date','-')}.")

make_crud("tickets", "tickets",
          notify_event="ticket_update",
          notify_template=lambda d: f"Ticket #{d.get('id','')[:8]}: {d.get('subject','-')} — status: {d.get('status','open')}.")

make_crud("documents", "documents")
make_crud("clients", "clients")

# Attendance — special model
class AttendanceCheckIn(BaseModel):
    note: Optional[str] = None
    location: Optional[str] = None

@api.post("/attendance/check-in")
async def check_in(body: AttendanceCheckIn, user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"user_id": user["id"], "date": today})
    if existing and existing.get("check_in"):
        raise HTTPException(400, "Already checked in today")
    doc = existing or {"id": new_id(), "user_id": user["id"], "user_name": user["name"], "date": today, "created_at": now_utc()}
    doc["check_in"] = now_utc()
    doc["check_in_note"] = body.note
    doc["check_in_location"] = body.location
    await db.attendance.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    await wa.send(user.get("phone") or "919999999999", f"Checked in at {doc['check_in']}", event="attendance_checkin", meta={"user_id": user["id"]})
    return strip_id(doc)

@api.post("/attendance/check-out")
async def check_out(body: AttendanceCheckIn, user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
    await wa.send(user.get("phone") or "919999999999", f"Checked out at {record['check_out']} ({record['work_hours']}h)", event="attendance_checkout")
    return strip_id(record)

@api.get("/attendance")
async def list_attendance(user: dict = Depends(get_current_user)):
    query = {} if user["role"] in ("admin", "manager") else {"user_id": user["id"]}
    items = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return items

@api.get("/attendance/today")
async def my_attendance_today(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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

# Notifications
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    return await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)

class TestNotify(BaseModel):
    to: str
    message: str

@api.post("/notifications/test")
async def send_test_notification(body: TestNotify, user: dict = Depends(require_roles("admin"))):
    return await wa.send(body.to, body.message, event="test")

# Reports / Dashboard
@api.get("/reports/dashboard")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
    inv = await db.invoices.aggregate(expense_pipeline).to_list(1)
    counts["total_expenses"] = round(exp[0]["total"], 2) if exp else 0
    counts["total_invoiced"] = round(inv[0]["total"], 2) if inv else 0
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
        buckets[m]["revenue"] += float(i.get("amount", 0) or 0)
    out = sorted(buckets.values(), key=lambda x: x["month"])
    return out[-6:]

@api.get("/users")
async def list_users(user: dict = Depends(require_roles("admin", "manager"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

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

@api.get("/me/dashboard")
async def my_dashboard(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    my_tasks = await db.tasks.count_documents(_employee_match(user, ["assignee"]))
    my_open_tasks = await db.tasks.count_documents(
        {"$and": [_employee_match(user, ["assignee"]), {"status": {"$ne": "done"}}]}
    )
    my_tickets = await db.tickets.count_documents(_employee_match(user, ["assigned_to"]))
    my_meetings = await db.meetings.count_documents({"attendees": {"$regex": user.get("name", "") or "X", "$options": "i"}})
    my_visits = await db.visits.count_documents(_employee_match(user, ["employee"]))
    my_attendance = await db.attendance.count_documents({"user_id": user["id"]})
    my_leaves_pending = await db.leaves.count_documents({"user_id": user["id"], "status": "pending"})
    today_record = await db.attendance.find_one({"user_id": user["id"], "date": today}, {"_id": 0})
    return {
        "my_tasks": my_tasks,
        "my_open_tasks": my_open_tasks,
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

@api.get("/me/meetings")
async def my_meetings(user: dict = Depends(get_current_user)):
    name = user.get("name") or "X"
    items = await db.meetings.find(
        {"$or": [{"attendees": {"$regex": name, "$options": "i"}}, {"attendees": "All Team"}]},
        {"_id": 0},
    ).sort("start_at", 1).to_list(500)
    return items

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
    for col, (title_field, fields, route) in SEARCH_COLLECTIONS.items():
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
    pnl_inv = await db.invoices.aggregate([{"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
    expenses = pnl_exp[0]["t"] if pnl_exp else 0
    revenue = pnl_inv[0]["t"] if pnl_inv else 0
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
            {"id": new_id(), "name": "Aurora POS Rollout", "client": "Aurora Retail Pvt Ltd", "manager": "Karan Mehta", "status": "in_progress", "progress": 62, "budget": 480000, "deadline": "2026-04-30", "start_date": "2026-01-10", "created_at": now_utc()},
            {"id": new_id(), "name": "Helix Patient Portal", "client": "Helix Health Systems", "manager": "Vikram Iyer", "status": "in_progress", "progress": 38, "budget": 220000, "deadline": "2026-06-15", "start_date": "2026-02-01", "created_at": now_utc()},
            {"id": new_id(), "name": "Vertex Fleet Tracker", "client": "Vertex Logistics", "manager": "Riya Sharma", "status": "planning", "progress": 10, "budget": 660000, "deadline": "2026-08-30", "start_date": "2026-03-01", "created_at": now_utc()},
            {"id": new_id(), "name": "Pixelnova Brand Site", "client": "Pixelnova Studio", "manager": "Sneha Patel", "status": "completed", "progress": 100, "budget": 95000, "deadline": "2026-01-28", "start_date": "2025-12-01", "created_at": now_utc()},
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
            {"id": new_id(), "title": "AWS infrastructure", "category": "Cloud", "project": "Aurora POS Rollout", "amount": 42000, "date": "2026-01-15", "vendor": "Amazon Web Services", "created_at": now_utc()},
            {"id": new_id(), "title": "Office rent", "category": "Operations", "amount": 85000, "date": "2026-01-01", "vendor": "WeWork", "created_at": now_utc()},
            {"id": new_id(), "title": "Marketing campaign", "category": "Marketing", "amount": 32000, "date": "2025-12-20", "vendor": "Google Ads", "created_at": now_utc()},
            {"id": new_id(), "title": "Design tools subscription", "category": "Software", "amount": 18000, "date": "2025-11-10", "vendor": "Figma", "created_at": now_utc()},
            {"id": new_id(), "title": "Travel — client visit", "category": "Travel", "amount": 12500, "date": "2026-02-02", "vendor": "MakeMyTrip", "created_at": now_utc()},
        ])

    if await db.invoices.count_documents({}) == 0:
        await db.invoices.insert_many([
            {"id": new_id(), "invoice_no": "INV-2026-001", "client": "Aurora Retail Pvt Ltd", "amount": 250000, "status": "paid", "date": "2026-01-15", "due_date": "2026-02-15", "created_at": now_utc()},
            {"id": new_id(), "invoice_no": "INV-2026-002", "client": "Helix Health Systems", "amount": 110000, "status": "sent", "date": "2026-02-01", "due_date": "2026-03-01", "created_at": now_utc()},
            {"id": new_id(), "invoice_no": "INV-2025-099", "client": "Pixelnova Studio", "amount": 95000, "status": "paid", "date": "2025-12-28", "due_date": "2026-01-28", "created_at": now_utc()},
            {"id": new_id(), "invoice_no": "INV-2026-003", "client": "Vertex Logistics", "amount": 220000, "status": "draft", "date": "2026-02-10", "due_date": "2026-03-10", "created_at": now_utc()},
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
            {"id": new_id(), "name": "MacBook Pro 16\" M3", "category": "Laptop", "serial": "MBP-2024-A12", "assigned_to": "Riya Sharma", "purchase_date": "2024-08-01", "value": 285000, "depreciation": 15, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "Dell XPS 15", "category": "Laptop", "serial": "DXPS-2023-B07", "assigned_to": "Vikram Iyer", "purchase_date": "2023-11-15", "value": 165000, "depreciation": 25, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "iPhone 15 Pro", "category": "Mobile", "serial": "IP15P-098", "assigned_to": "Karan Mehta", "purchase_date": "2024-01-20", "value": 135000, "depreciation": 20, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "LG UltraWide Monitor", "category": "Peripheral", "serial": "LGU-2024-301", "assigned_to": "Sneha Patel", "purchase_date": "2024-03-10", "value": 42000, "depreciation": 10, "status": "assigned", "created_at": now_utc()},
            {"id": new_id(), "name": "HP LaserJet Pro", "category": "Printer", "serial": "HPLJ-002", "assigned_to": None, "purchase_date": "2022-06-15", "value": 28000, "depreciation": 40, "status": "in_storage", "created_at": now_utc()},
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
            {"id": new_id(), "name": "Aurora MSA - signed.pdf", "category": "Contract", "client": "Aurora Retail Pvt Ltd", "version": "v2.1", "size_kb": 845, "uploaded_by": "Bitsparx Admin", "created_at": now_utc()},
            {"id": new_id(), "name": "Helix Quotation Q1.pdf", "category": "Quotation", "client": "Helix Health Systems", "version": "v1.0", "size_kb": 312, "uploaded_by": "Karan Mehta", "created_at": now_utc()},
            {"id": new_id(), "name": "Vertex NDA.pdf", "category": "NDA", "client": "Vertex Logistics", "version": "v1.0", "size_kb": 218, "uploaded_by": "Bitsparx Admin", "created_at": now_utc()},
            {"id": new_id(), "name": "Internal — Employee handbook 2026.pdf", "category": "HR", "client": None, "version": "v3.2", "size_kb": 1240, "uploaded_by": "Priya Manager", "created_at": now_utc()},
        ])

    log.info("Seed complete")


@app.on_event("startup")
async def on_start():
    # indexes
    await db.users.create_index("email", unique=True)
    await db.attendance.create_index([("user_id", 1), ("date", 1)])
    await seed()

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

# Mount routers + CORS
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
