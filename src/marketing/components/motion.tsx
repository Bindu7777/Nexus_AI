"use client";

import { useEffect } from "react";

/**
 * Page-wide motion helper.
 * - Marks each <section> with data-inview / data-seen so CSS can reveal headings
 *   and pause any animation that is off screen.
 * - Pauses SVG (SMIL) animations inside off-screen sections.
 * - Feeds the pointer position to the panel under the cursor for a soft spotlight.
 */
export function MotionObserver() {
  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("main section, .ambient"));
    const setState = (el: HTMLElement, visible: boolean) => {
      el.dataset.inview = visible ? "true" : "false";
      if (visible) el.dataset.seen = "true";
      el.querySelectorAll("svg").forEach((svg) => {
        const s = svg as SVGSVGElement;
        if (typeof s.pauseAnimations !== "function") return;
        if (visible) s.unpauseAnimations();
        else s.pauseAnimations();
      });
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") {
      sections.forEach((el) => setState(el, true));
    } else {
      observer = new IntersectionObserver(
        (entries) => entries.forEach((entry) => setState(entry.target as HTMLElement, entry.isIntersecting)),
        { rootMargin: "-8% 0px -8% 0px", threshold: 0 },
      );
      sections.forEach((el) => observer!.observe(el));
    }

    // Stop everything while the tab is hidden.
    const onVisibility = () => document.documentElement.toggleAttribute("data-page-hidden", document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    // Spotlight on panels, pointer devices only.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let raf = 0;
    const onMove = (event: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const panel = (event.target as Element | null)?.closest?.(".panel") as HTMLElement | null;
        if (!panel) return;
        const box = panel.getBoundingClientRect();
        panel.style.setProperty("--mx", `${event.clientX - box.left}px`);
        panel.style.setProperty("--my", `${event.clientY - box.top}px`);
      });
    };
    if (fine) window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (fine) window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}

/** Fixed ambient background: drifting light fields over a slowly moving grid. */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-grid" />
      <div className="ambient-light ambient-light--a" />
      <div className="ambient-light ambient-light--b" />
      <div className="ambient-light ambient-light--c" />
    </div>
  );
}
