import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  Files,
  FolderOpen,
  Layers3,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { api, type Health } from "./lib/api";
import { Button } from "./components/ui/button";
import { Empty, Loading } from "./components/shared";

const Dashboard = lazy(() =>
  import("./pages/Dashboard").then(({ Dashboard }) => ({ default: Dashboard })),
);
const Library = lazy(() =>
  import("./pages/Library").then(({ Library }) => ({ default: Library })),
);
const Chat = lazy(() =>
  import("./pages/Chat").then(({ Chat }) => ({ default: Chat })),
);
const SearchPage = lazy(() =>
  import("./pages/Search").then(({ SearchPage }) => ({ default: SearchPage })),
);
const Jobs = lazy(() =>
  import("./pages/Jobs").then(({ Jobs }) => ({ default: Jobs })),
);
const SettingsPage = lazy(() =>
  import("./pages/Settings").then(({ SettingsPage }) => ({ default: SettingsPage })),
);

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/documents", label: "Documents", icon: Files },
  { to: "/collections", label: "Collections", icon: FolderOpen },
  { to: "/chat", label: "Ask documents", icon: MessageSquare },
  { to: "/search", label: "Search", icon: Search },
];

export function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    const enabled = localStorage.getItem("theme") === "dark";
    document.documentElement.classList.toggle("dark", enabled);
    return enabled;
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 30000,
  });
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      {mobileOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span className="brand-text">
            LocalDocs AI<span>DOCUMENT ASSISTANT</span>
          </span>
        </NavLink>
        <Button
          className="mobile-close"
          variant="ghost"
          size="icon"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X size={18} />
        </Button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="nav-label system-label">TOOLS</div>
        <nav aria-label="System navigation">
          {[
            { to: "/jobs", label: "Jobs", icon: Activity },
            { to: "/diagnostics", label: "Diagnostics", icon: BookOpen },
            { to: "/settings", label: "Settings", icon: Settings2 },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
              onClick={() => setMobileOpen(false)}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={22} />
            <strong>On-device storage</strong>
            <p>Documents and model requests stay on this machine.</p>
          </div>
          <div className="sidebar-status">
            <span
              className={`health-dot ${health.data?.status === "ready" ? "healthy" : ""}`}
            />
            <span>
              {health.data?.status === "ready"
                ? "Services ready"
                : "Service check needed"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Collapse sidebar"
              onClick={() => setCollapsed((v) => !v)}
            >
              <ChevronLeft size={16} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <div className="row">
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </Button>
            <span className="topbar-label">Local workspace</span>
            <span className="local-badge">
              <ShieldCheck size={12} />
              On this device
            </span>
          </div>
          <div className="row">
            <a
              className="docs-link"
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
            >
              API reference
              <ArrowUpRight size={13} />
            </a>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={toggleTheme}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
          </div>
        </div>
        <main id="main-content">
          <Suspense fallback={<Loading />}>
            <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents" element={<Library />} />
            <Route path="/collections" element={<Library collectionsOnly />} />
            <Route path="/collections/:collectionId" element={<Library />} />
            <Route path="/upload" element={<Library initialUpload />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:conversationId" element={<Chat />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/diagnostics" element={<SearchPage diagnostics />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="*"
              element={
                <Empty
                  title="Page not found"
                  detail="Choose a page from the navigation."
                />
              }
            />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
