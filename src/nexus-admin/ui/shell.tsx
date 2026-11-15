"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { adminFetch, useAdmin } from "./client";
import { IBuilding, IHome, ILogout, ILogs, IMoon, IPlus, ISettings, ISun, NexusMark } from "./icons";

const NAV = [
  { href: "/nexus-admin", label: "Dashboard", icon: IHome, exact: true },
  { href: "/nexus-admin/companies", label: "Companies", icon: IBuilding },
  { href: "/nexus-admin/onboard", label: "Onboard a company", icon: IPlus },
  { href: "/nexus-admin/logs", label: "Logs", icon: ILogs },
  { href: "/nexus-admin/settings", label: "Settings", icon: ISettings },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/nexus-admin" className="brand">
        <NexusMark />
        <span>
          Nexus Admin
          <small>Nexus staff only</small>
        </span>
      </Link>
      <nav aria-label="Admin">
        <ul className="nav">
          {NAV.map((n) => {
            const active = n.exact ? path === n.href : path.startsWith(n.href);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={active ? "page" : undefined}>
                  <n.icon />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="sidebar-foot">Every action here is recorded in the audit log. Connections are read-only.</div>
    </aside>
  );
}

export function Topbar() {
  const { csrf, name } = useAdmin();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"), []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("nexus-admin-theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }
  async function signOut() {
    await adminFetch(csrf, "/api/nexus-admin/auth/logout", "POST", {});
    window.location.href = "/nexus-admin/login";
  }
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
        {theme === "dark" ? <ISun /> : <IMoon />}
      </button>
      <div className="who">
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span>
          Signed in as <strong>{name}</strong>
        </span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
        <ILogout />
        Sign out
      </button>
    </header>
  );
}
