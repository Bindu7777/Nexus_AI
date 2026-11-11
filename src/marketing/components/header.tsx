"use client";

import { useEffect, useState } from "react";
import { nav } from "../content";
import { openPilot } from "../hooks";
import { IconClose, IconMenu, IconMoon, IconSun, Logo } from "./icons";

function effectiveTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => setTheme(effectiveTheme()), []);
  function toggle() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("nexus-theme", next);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    setTheme(next);
  }
  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      {theme === "light" ? <IconMoon /> : <IconSun />}
    </button>
  );
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="site-header" data-scrolled={scrolled || open}>
      <div className="wrap">
        <a href="#top" className="wordmark" aria-label="Nexus AI, back to top">
          <Logo />
          Nexus AI
        </a>
        <nav aria-label="Main">
          <ul className="nav-links">
            {nav.links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="header-end">
          <a className="quiet-link" href={nav.signIn.href}>
            {nav.signIn.label}
          </a>
          <ThemeToggle />
          <button type="button" className="btn btn--primary btn--sm" onClick={openPilot}>
            {nav.cta}
          </button>
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </div>
      <div id="mobile-menu" className="mobile-menu" data-open={open}>
        <ul>
          {nav.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <a href={nav.signIn.href}>{nav.signIn.label}</a>
          </li>
        </ul>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setOpen(false);
            openPilot();
          }}
        >
          {nav.cta}
        </button>
      </div>
    </header>
  );
}
