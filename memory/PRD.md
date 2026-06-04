# Bitsparx HQ — Product Requirements Document

## Original problem statement
Build a Management System for Bitsparx Tech, named **Bitsparx HQ**. The image specified 12 modules (8 Core + 4 Added). Wire it to **SpringEdge WhatsApp** for notifications.

## Iteration history
- **v1.0** — Initial MVP: 12 modules CRUD, JWT auth (admin/manager/employee), SpringEdge WhatsApp service, dashboard with charts.
- **v1.1** — Pro polish: Plus Jakarta Sans font, role-based sidebar & per-employee dashboard, full Teams-style calendar (react-big-calendar), working global search across all modules, BitsBot AI chatbot (Amazon Bedrock Nova), modern Leaflet+CARTO map.
- **v1.2** — Enterprise UX: Beautiful dark mode (system-aware + persistent), drag-and-drop kanban for Projects & Tasks (4 columns each, dnd-kit), full mobile responsiveness (drawer sidebar, stacked KPIs, touch-friendly drag, horizontal-scroll tabs).

## User Personas
- **Admin** — full access to all modules, user management, WhatsApp test sends.
- **Manager** — read all modules, write to operational data, approve/reject leaves.
- **Employee** — sees only their own data (My Tasks, My Meetings, My Tickets, attendance, leaves).

## Architecture
- **Backend**: FastAPI + MongoDB (motor). Single `server.py`. JWT auth (bcrypt). Amazon Bedrock Converse API (Nova). httpx for SpringEdge. All routes prefixed `/api`.
- **Frontend**: React + Tailwind + shadcn/ui + Phosphor Icons + react-big-calendar + react-leaflet + dnd-kit + Recharts + sonner. ThemeProvider (light/dark/system) with pre-React inline script to avoid FOUC.
- **WhatsApp**: SpringEdge HTTP API client with log-only fallback when `SPRINGEDGE_API_KEY` is unset.
- **AI**: BitsBot floating chat widget — Amazon Bedrock, fed company snapshot in system prompt, fed company snapshot in system prompt, session-based history persisted to MongoDB.

## What's Been Implemented (cumulative)
- JWT auth + RBAC; 3 seeded demo accounts.
- 12 modules with CRUD: Attendance (check-in/out + leaves + approvals), Projects (drag kanban + list), Tasks (drag kanban + list), Finance & Expenses (expenses + invoices + trend), Employees, Meetings (full month/week/day/agenda calendar), Client Visits (Leaflet map + log), Asset Master, AMC & Maintenance, Helpdesk/Tickets, Document Manager, Reports & Analytics (charts + JSON export), Client CRM (kanban pipeline).
- WhatsApp notifications via SpringEdge — auto-triggered on attendance, leaves, projects, tasks, AMC, tickets, meetings.
- Dashboard — distinct admin vs employee views; KPIs, P&L, 6-month trend, recent activity.
- Global search across all collections (`/api/search`) with live dropdown.
- BitsBot AI chatbot (`/api/chat`) — Claude Sonnet, knows company data, persists sessions.
- Light & dark themes, mobile drawer + responsive layout (tested @ 414px and 1920px).

## Core Requirements (Static)
- Always use REACT_APP_BACKEND_URL on frontend, MONGO_URL on backend.
- All API routes under `/api`.
- WhatsApp template events: attendance, leave, projects, tasks, AMC renewals, tickets, meetings.

## Prioritized Backlog
- **P0** — Plug in real `SPRINGEDGE_API_KEY` and verify live WhatsApp send.
- **P1** — File uploads for Document Manager (we have an object-storage playbook).
- **P1** — Per-module Pydantic models (replace `GenericDoc(extra='allow')`).
- **P1** — Pagination on list endpoints (currently capped at 1000).
- **P2** — PDF/Excel export for Reports (currently JSON).
- **P2** — Push notifications & in-app notification center beyond WhatsApp.
- **P2** — Calendar drag-to-resize meetings.
- **P3** — Brute-force lockout, password reset email flow.
- **P3** — Per-employee appraisal cycles & 1:1 notes.

## Credentials
See `/app/memory/test_credentials.md`.
