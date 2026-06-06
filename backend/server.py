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
import re
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
    result = await db.employees.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Not found")
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

@api.get("/projects", name="list_projects")
async def list_projects(user: dict = Depends(require_roles("admin", "manager", "employee"))):
    items = await db.projects.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_sanitize_project_for_role(i, user) for i in items]

@api.post("/projects", name="create_projects")
async def create_project(body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc()
    doc["created_by"] = user["id"]
    doc["created_by_role"] = user["role"]
    doc["created_by_name"] = user.get("name") or user.get("email")
    if user["role"] != "admin":
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
    return _sanitize_project_for_role(doc, user)

@api.put("/projects/{item_id}", name="update_projects")
async def update_project(item_id: str, body: GenericDoc, user: dict = Depends(require_roles("admin", "manager"))):
    updates = body.model_dump()
    updates.pop("id", None)
    updates.pop("created_at", None)
    updates.pop("created_by", None)
    updates.pop("created_by_role", None)
    updates.pop("created_by_name", None)
    updates.pop("budget_set", None)
    updates.pop("budget_set_by", None)
    if user["role"] != "admin":
        updates.pop("budget", None)
    elif "budget" in updates:
        updates.pop("budget", None)
    updates["updated_at"] = now_utc()
    result = await db.projects.update_one({"id": item_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Not found")
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
async def delete_project(item_id: str, user: dict = Depends(require_roles("admin", "manager"))):
    result = await db.projects.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Not found")
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
make_crud("clients", "clients", list_roles=("admin",), write_roles=("admin",))

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

# Assigned daily tasks (CEO assigns → employee inbox)
ASSIGNED_TASK_STATUSES = ("todo", "in_progress", "review", "done")

class AssignedTaskInput(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_id: str
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
async def create_assigned_task(body: AssignedTaskInput, user: dict = Depends(require_roles("admin"))):
    assignee = await db.users.find_one({"id": body.assignee_id}, {"_id": 0, "password_hash": 0})
    if not assignee:
        raise HTTPException(404, "Assignee not found")
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
    users = await db.users.find(
        {"id": {"$ne": user["id"]}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).sort("name", 1).to_list(500)
    return users

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
    doc = await db.notes.find_one({"id": note_id}, {"_id": 0})
    return await _enrich_note(doc, user)

@api.post("/notes/{note_id}/share")
async def share_note(note_id: str, body: ShareNoteInput, user: dict = Depends(get_current_user)):
    existing = await db.notes.find_one({"id": note_id, "user_id": user["id"]})
    if not existing:
        raise HTTPException(404, "Not found")
    user_ids = list(dict.fromkeys(body.user_ids))
    if user_ids:
        count = await db.users.count_documents({"id": {"$in": user_ids}})
        if count != len(user_ids):
            raise HTTPException(400, "One or more users not found")
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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
    if user.get("role") != "admin":
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
            {"id": new_id(), "title": "AWS infrastructure", "category": "Cloud", "project": "Aurora POS Rollout", "amount": 42000, "date": "2026-01-15", "vendor": "Amazon Web Services", "created_at": now_utc()},
            {"id": new_id(), "title": "Office rent", "category": "Operations", "amount": 85000, "date": "2026-01-01", "vendor": "WeWork", "created_at": now_utc()},
            {"id": new_id(), "title": "Marketing campaign", "category": "Marketing", "amount": 32000, "date": "2025-12-20", "vendor": "Google Ads", "created_at": now_utc()},
            {"id": new_id(), "title": "Design tools subscription", "category": "Software", "amount": 18000, "date": "2025-11-10", "vendor": "Figma", "created_at": now_utc()},
            {"id": new_id(), "title": "Travel — client visit", "category": "Travel", "amount": 12500, "date": "2026-02-02", "vendor": "MakeMyTrip", "created_at": now_utc()},
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
    await db.assigned_tasks.create_index([("assignee_id", 1), ("task_date", 1)])
    await db.notes.create_index([("user_id", 1), ("updated_at", -1)])
    await db.notes.create_index("shared_with")
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
