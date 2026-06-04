import React, { useEffect, useState, useRef } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { api } from "@/lib/api";
import {
  House, Clock, Briefcase, Receipt, UsersThree,
  CalendarBlank, MapPin, HardDrives, BellRinging, Headset,
  FileText, ChartBar, Building, WhatsappLogo, SignOut, MagnifyingGlass,
  Sun, Moon, List, X,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import ChatWidget from "@/components/ChatWidget";

const ALL_NAV = [
  { to: "/", label: "Dashboard", icon: House, exact: true, group: "Overview", roles: ["admin", "manager", "employee"] },
  { to: "/attendance", label: "Attendance", icon: Clock, group: "Workspace", roles: ["admin", "manager", "employee"] },
  { to: "/meetings", label: "Meetings & Calendar", icon: CalendarBlank, group: "Workspace", roles: ["admin", "manager", "employee"] },
  { to: "/projects", label: "Projects", icon: Briefcase, group: "Operations", roles: ["admin", "manager", "employee"] },
  { to: "/employees", label: "Employees", icon: UsersThree, group: "Operations", roles: ["admin", "manager"] },
  { to: "/visits", label: "Client Visits", icon: MapPin, group: "Operations", roles: ["admin", "manager"] },
  { to: "/finance", label: "Finance & Expenses", icon: Receipt, group: "Business", roles: ["admin", "manager"] },
  { to: "/crm", label: "Client CRM", icon: Building, group: "Business", roles: ["admin", "manager"] },
  { to: "/assets", label: "Asset Master", icon: HardDrives, group: "Resources", roles: ["admin", "manager", "employee"] },
  { to: "/amc", label: "AMC & Maintenance", icon: BellRinging, group: "Resources", roles: ["admin", "manager"] },
  { to: "/documents", label: "Document Manager", icon: FileText, group: "Resources", roles: ["admin", "manager", "employee"] },
  { to: "/helpdesk", label: "Helpdesk / Tickets", icon: Headset, group: "Support", roles: ["admin", "manager", "employee"] },
  { to: "/reports", label: "Reports & Analytics", icon: ChartBar, group: "Support", roles: ["admin", "manager"] },
  { to: "/notifications", label: "WhatsApp Log", icon: WhatsappLogo, group: "Support", roles: ["admin", "manager", "employee"] },
];

const ICON_BY_TYPE = {
  projects: Briefcase, clients: Building, employees: UsersThree, tickets: Headset,
  assets: HardDrives, documents: FileText, amc: BellRinging, meetings: CalendarBlank,
  visits: MapPin, tasks: Briefcase, invoices: Receipt, expenses: Receipt,
};

function SidebarBody({ NAV, onNavigate }) {
  const groups = NAV.reduce((acc, n) => {
    (acc[n.group] = acc[n.group] || []).push(n);
    return acc;
  }, {});
  return (
    <>
      <div className="px-5 py-5 border-b border-[var(--bx-border)]">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#2453E5] to-[#1A45CC] grid place-items-center text-white font-bold text-base shadow-sm">B</div>
          <div>
            <div className="font-bold text-[15px] tracking-tight text-[var(--bx-text)]">Bitsparx HQ</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--bx-text-3)] bx-mono">Control Room</div>
          </div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4" data-testid="sidebar-nav">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--bx-text-3)] font-semibold">{group}</div>
            <div className="space-y-0.5">
              {items.map((n) => {
                const Icon = n.icon;
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.exact}
                    onClick={onNavigate}
                    className={({ isActive }) => `bx-nav-item ${isActive ? "active" : ""}`}
                    data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <Icon size={17} weight="regular" />
                    <span>{n.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-[var(--bx-border)] p-3 text-[11px] text-[var(--bx-text-3)] flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        System online · v1.2
      </div>
    </>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifCount, setNotifCount] = useState(0);
  const [notifs, setNotifs] = useState([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    api.get("/notifications").then(({ data }) => {
      setNotifs(data.slice(0, 6));
      setNotifCount(data.length);
    }).catch(() => {});
  }, [location.pathname]);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`).then(({ data }) => {
        setResults(data.results || []);
        setShowResults(true);
      }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initials = (user?.name || user?.email || "?")
    .split(/\s+|@/).filter(Boolean).slice(0, 2)
    .map((s) => s[0].toUpperCase()).join("");

  const role = user?.role || "employee";
  const NAV = ALL_NAV.filter((n) => n.roles.includes(role));

  const goToResult = (r) => {
    setShowResults(false);
    setQ("");
    navigate(r.route);
  };

  return (
    <div className="flex min-h-screen bg-[var(--bx-bg-2)]" data-testid="app-layout">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-[var(--bx-card)] border-r border-[var(--bx-border)] flex-col sticky top-0 h-screen" data-testid="sidebar">
        <SidebarBody NAV={NAV} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/60 z-40 bx-sidebar-overlay" onClick={() => setDrawerOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-[var(--bx-card)] border-r border-[var(--bx-border)] flex flex-col z-50 bx-sidebar-drawer" data-testid="mobile-drawer">
            <SidebarBody NAV={NAV} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-[var(--bx-card)]/95 backdrop-blur border-b border-[var(--bx-border)] px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-[var(--bx-bg-3)] transition"
            data-testid="open-drawer"
          >
            <List size={18} className="text-[var(--bx-text)]" />
          </button>

          <div ref={searchRef} className="relative flex items-center gap-3 flex-1 max-w-xl">
            <MagnifyingGlass size={16} className="text-[var(--bx-text-3)] absolute left-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => results.length > 0 && setShowResults(true)}
              placeholder="Search projects, clients, employees…"
              className="w-full bg-[var(--bx-bg-3)] hover:bg-[var(--bx-bg-2)] focus:bg-[var(--bx-card)] focus:ring-2 focus:ring-[var(--bx-brand)]/30 focus:border-[var(--bx-brand)] border border-[var(--bx-border)] rounded-lg pl-9 pr-3 h-9 text-sm placeholder:text-[var(--bx-text-3)] text-[var(--bx-text)] outline-none transition"
              data-testid="global-search"
            />
            {showResults && results.length > 0 && (
              <div className="absolute top-11 left-0 right-0 bg-[var(--bx-card)] border border-[var(--bx-border)] rounded-lg shadow-lg max-h-96 overflow-y-auto z-50" data-testid="search-results">
                {results.map((r, idx) => {
                  const Icon = ICON_BY_TYPE[r.type] || Briefcase;
                  return (
                    <button
                      key={idx}
                      onClick={() => goToResult(r)}
                      className="w-full text-left px-3 py-2.5 hover:bg-[var(--bx-bg-3)] flex items-center gap-3 border-b border-[var(--bx-border)] last:border-0"
                    >
                      <div className="w-8 h-8 rounded-md bg-[var(--bx-bg-3)] grid place-items-center">
                        <Icon size={14} className="text-[var(--bx-text-2)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--bx-text)] truncate">{r.title}</div>
                        <div className="text-xs text-[var(--bx-text-3)] truncate">{r.subtitle}</div>
                      </div>
                      <span className="text-[10px] bx-mono uppercase tracking-widest text-[var(--bx-text-3)] hidden sm:inline">{r.type}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {showResults && q.length >= 2 && results.length === 0 && (
              <div className="absolute top-11 left-0 right-0 bg-[var(--bx-card)] border border-[var(--bx-border)] rounded-lg shadow-lg p-6 text-center text-sm text-[var(--bx-text-3)] z-50">
                No matches for "{q}"
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              className="h-9 w-9 grid place-items-center rounded-lg hover:bg-[var(--bx-bg-3)] transition"
              data-testid="theme-toggle"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={18} weight="regular" className="text-[var(--bx-text)]" /> : <Moon size={18} weight="regular" className="text-[var(--bx-text)]" />}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative h-9 w-9 grid place-items-center rounded-lg hover:bg-[var(--bx-bg-3)] transition" data-testid="notifications-bell">
                  <WhatsappLogo size={18} weight="regular" className="text-[var(--bx-text)]" />
                  {notifCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF3B30] text-white text-[10px] font-bold grid place-items-center">
                      {notifCount > 99 ? "99+" : notifCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] font-semibold">
                  WhatsApp via SpringEdge
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {notifs.length === 0 && <div className="px-3 py-6 text-center text-sm text-[var(--bx-text-3)]">No notifications yet</div>}
                {notifs.map((n) => (
                  <div key={n.id} className="px-3 py-2.5 hover:bg-[var(--bx-bg-3)] border-b border-[var(--bx-border)] last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] font-semibold">{n.event}</span>
                      <span className={`text-[10px] uppercase tracking-widest font-semibold ${
                        n.status === "sent" ? "text-emerald-500" :
                        n.status === "logged_only" ? "text-amber-500" : "text-rose-500"
                      }`}>{n.status}</span>
                    </div>
                    <div className="text-xs text-[var(--bx-text-2)] line-clamp-2">{n.message}</div>
                    <div className="text-[10px] text-[var(--bx-text-3)] mt-0.5 bx-mono">→ {n.to}</div>
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/notifications" className="w-full text-center justify-center text-sm text-[var(--bx-brand)] font-medium">View all</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 pl-1.5 pr-1.5 sm:pr-3 py-1.5 rounded-lg hover:bg-[var(--bx-bg-3)] transition" data-testid="user-menu">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-gradient-to-br from-[#2453E5] to-[#1A45CC] text-white text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="text-left hidden sm:block">
                    <div className="text-xs font-semibold text-[var(--bx-text)] leading-none">{user?.name}</div>
                    <div className="text-[10px] uppercase tracking-widest text-[var(--bx-text-3)] mt-0.5 font-medium">{user?.role}</div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs text-[var(--bx-text-3)]">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} data-testid="logout-btn">
                  <SignOut size={14} className="mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          <Outlet />
        </main>

        <ChatWidget />
      </div>
    </div>
  );
}
