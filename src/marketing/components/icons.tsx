// Small original line icons. Decorative unless given a title.
type P = { className?: string; title?: string };

function Svg({ children, className, title, viewBox = "0 0 24 24" }: P & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.6 2.6L16 9.6" />
  </Svg>
);
export const IconAbstain = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 21 19H3L12 3.5Z" />
    <path d="M12 10v4" />
    <path d="M12 16.8v.2" />
  </Svg>
);
export const IconEvidence = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 20 12 12 21 4 12Z" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </Svg>
);
export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </Svg>
);
export const IconReplay = (p: P) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4.5h4.5" />
  </Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const IconDrag = (p: P) => (
  <Svg {...p}>
    <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />
  </Svg>
);

/** The Nexus mark: two evidence points joined by a path into a verdict. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nx-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B6BFF" />
          <stop offset="0.5" stopColor="#4F8BFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="url(#nx-mark)" strokeWidth="2" />
      <path d="M9 22V10l14 12V10" fill="none" stroke="url(#nx-mark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23" cy="10" r="2.6" fill="#FFB454" />
    </svg>
  );
}

export function Mark({ kind, children }: { kind: "verified" | "abstain" | "evidence" | "planned"; children: React.ReactNode }) {
  const Icon = kind === "verified" ? IconCheck : kind === "abstain" ? IconAbstain : kind === "evidence" ? IconEvidence : null;
  return (
    <span className={`mark mark--${kind}`}>
      {Icon ? <Icon /> : null}
      {children}
    </span>
  );
}
