"""Iteration 2 backend tests — chat, search, employee-scoped views."""
import os
import pytest
import requests

BASE = "https://hq-management.preview.emergentagent.com"
API = f"{BASE}/api"
ADMIN = ("admin@bitsparx.com", "Admin@123")
EMPLOYEE = ("employee@bitsparx.com", "Employee@123")
MANAGER = ("manager@bitsparx.com", "Manager@123")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def employee_token():
    return _login(*EMPLOYEE)


@pytest.fixture(scope="module")
def manager_token():
    return _login(*MANAGER)


# ─────────────────────────────  Chat (Claude Sonnet) ─────────────────────────────
class TestChat:
    def test_chat_first_message_returns_reply_and_session(self, admin_token):
        r = requests.post(f"{API}/chat",
                          json={"message": "How many open tickets do we have?"},
                          headers=H(admin_token), timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data and isinstance(data["reply"], str) and len(data["reply"]) > 0
        assert "session_id" in data and isinstance(data["session_id"], str)
        # Should reference some real data (digits) — soft check
        assert any(c.isdigit() for c in data["reply"]) or len(data["reply"]) > 20
        pytest.shared_session = data["session_id"]
        pytest.shared_first_reply = data["reply"]

    def test_chat_continuation_same_session(self, admin_token):
        sid = getattr(pytest, "shared_session", None)
        assert sid, "first chat must succeed"
        r = requests.post(f"{API}/chat",
                          json={"message": "And how about the P&L?", "session_id": sid},
                          headers=H(admin_token), timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["session_id"] == sid
        assert len(data["reply"]) > 0

    def test_chat_requires_auth(self):
        r = requests.post(f"{API}/chat", json={"message": "hi"}, timeout=20)
        assert r.status_code == 401

    def test_chat_history(self, admin_token):
        sid = getattr(pytest, "shared_session", None)
        assert sid
        r = requests.get(f"{API}/chat/history", params={"session_id": sid},
                         headers=H(admin_token), timeout=20)
        assert r.status_code == 200
        msgs = r.json()
        assert isinstance(msgs, list)
        # at least 4 entries (2 turns x user+assistant)
        assert len(msgs) >= 4
        roles = {m["role"] for m in msgs}
        assert "user" in roles and "assistant" in roles


# ─────────────────────────────  Global Search ─────────────────────────────
class TestSearch:
    def test_short_query_returns_empty(self, admin_token):
        r = requests.get(f"{API}/search", params={"q": "A"},
                         headers=H(admin_token), timeout=20)
        assert r.status_code == 200
        assert r.json().get("results") == []

    def test_search_aurora_returns_results(self, admin_token):
        r = requests.get(f"{API}/search", params={"q": "Aurora"},
                         headers=H(admin_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        results = data.get("results", [])
        assert isinstance(results, list)
        assert len(results) >= 1, f"expected >=1 result for Aurora, got {results}"
        types = {r["type"] for r in results}
        # should span across at least one of the major collections
        assert types & {"projects", "clients", "tickets", "documents", "tasks", "amc"}
        # each result must have id and route
        for item in results:
            assert "type" in item and "title" in item and "route" in item

    def test_search_requires_auth(self):
        r = requests.get(f"{API}/search", params={"q": "Aurora"}, timeout=20)
        assert r.status_code == 401


# ─────────────────────────────  Employee scoped /me ─────────────────────────────
class TestMyDashboard:
    REQUIRED_KEYS = {"my_tasks", "my_open_tasks", "my_tickets", "my_meetings",
                     "my_visits", "my_attendance_days", "today_attendance"}

    def test_employee_dashboard_keys(self, employee_token):
        r = requests.get(f"{API}/me/dashboard", headers=H(employee_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        missing = self.REQUIRED_KEYS - set(data.keys())
        assert not missing, f"missing keys: {missing}"
        # types
        for k in ["my_tasks", "my_open_tasks", "my_tickets", "my_meetings",
                  "my_visits", "my_attendance_days"]:
            assert isinstance(data[k], int)

    def test_admin_can_also_call_me_dashboard(self, admin_token):
        r = requests.get(f"{API}/me/dashboard", headers=H(admin_token), timeout=20)
        assert r.status_code == 200

    def test_me_tasks_employee_scoped(self, employee_token):
        # Find current user name
        me = requests.get(f"{API}/auth/me", headers=H(employee_token), timeout=20).json()
        name = me["name"]; email = me["email"]
        r = requests.get(f"{API}/me/tasks", headers=H(employee_token), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        for t in items:
            assignee = (t.get("assignee") or "")
            assert assignee == name or assignee == email, \
                f"task {t.get('id')} not assigned to {name}/{email}: {assignee}"

    def test_me_tickets_employee_scoped(self, employee_token):
        me = requests.get(f"{API}/auth/me", headers=H(employee_token), timeout=20).json()
        name = me["name"]; email = me["email"]
        r = requests.get(f"{API}/me/tickets", headers=H(employee_token), timeout=20)
        assert r.status_code == 200
        for t in r.json():
            assigned = (t.get("assigned_to") or "")
            assert assigned == name or assigned == email, \
                f"ticket {t.get('id')} not for me: {assigned}"

    def test_me_meetings_employee_scoped(self, employee_token):
        me = requests.get(f"{API}/auth/me", headers=H(employee_token), timeout=20).json()
        name = me["name"]
        r = requests.get(f"{API}/me/meetings", headers=H(employee_token), timeout=20)
        assert r.status_code == 200
        for m in r.json():
            atts = m.get("attendees") or ""
            if isinstance(atts, list):
                atts = ",".join(atts)
            assert (name and name.lower() in atts.lower()) or "all team" in atts.lower(), \
                f"meeting {m.get('id')} attendees {atts} does not include {name}"


# ─────────────────────────────  Regression — existing CRUD lists ─────────────────────────────
class TestRegression:
    @pytest.mark.parametrize("path", ["projects", "clients", "employees", "tasks",
                                       "invoices", "expenses", "tickets", "assets",
                                       "amc", "meetings", "visits", "documents"])
    def test_list_endpoint_returns_seed_data(self, admin_token, path):
        r = requests.get(f"{API}/{path}", headers=H(admin_token), timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1, f"{path} returned empty list"

    def test_dashboard_reports_unchanged(self, admin_token):
        r = requests.get(f"{API}/reports/dashboard", headers=H(admin_token), timeout=20)
        assert r.status_code == 200
        for k in ("employees", "projects", "active_projects", "clients",
                  "total_invoiced", "total_expenses", "pnl", "notifications"):
            assert k in r.json()
