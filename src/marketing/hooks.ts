"use client";

import { useEffect, useState, type RefObject } from "react";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useMediaQuery(media: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(media);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [media]);
  return matches;
}

/** True while the element is on screen (or once, with `once`). */
export function useInView<T extends Element>(ref: RefObject<T | null>, options: { once?: boolean; rootMargin?: string; threshold?: number } = {}) {
  const [inView, setInView] = useState(false);
  const { once = false, rootMargin = "0px", threshold = 0.15 } = options;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, once, rootMargin, threshold]);
  return inView;
}

/** Index of the item nearest the middle band of the viewport. */
export function useActiveIndex(refs: RefObject<(HTMLElement | null)[]>, count: number) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const nodes = (refs.current ?? []).slice(0, count).filter(Boolean) as HTMLElement[];
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = nodes.indexOf(entry.target as HTMLElement);
            if (index >= 0) setActive(index);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [refs, count]);
  return active;
}

export const PILOT_EVENT = "nexus:open-pilot";
export function openPilot() {
  window.dispatchEvent(new CustomEvent(PILOT_EVENT));
}
