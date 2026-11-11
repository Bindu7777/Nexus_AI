"use client";

import { openPilot } from "../hooks";
import { IconArrow } from "./icons";

export function PilotButton({ label, variant = "primary", arrow = true }: { label: string; variant?: "primary" | "secondary" | "ghost"; arrow?: boolean }) {
  return (
    <button type="button" className={`btn btn--${variant}`} onClick={openPilot}>
      {label}
      {arrow ? <IconArrow /> : null}
    </button>
  );
}
