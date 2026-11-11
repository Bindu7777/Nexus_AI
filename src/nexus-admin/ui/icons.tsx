type P = { className?: string };
const S = ({ children, className }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

export const ICheck = (p: P) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.6 2.6L16 9.6" /></S>);
export const IAlert = (p: P) => (<S {...p}><path d="M12 3.5 21 19H3L12 3.5Z" /><path d="M12 10v4M12 16.8v.2" /></S>);
export const IX = (p: P) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></S>);
export const IClock = (p: P) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>);
export const IPause = (p: P) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></S>);
export const IHome = (p: P) => (<S {...p}><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" /></S>);
export const IBuilding = (p: P) => (<S {...p}><rect x="4" y="3" width="11" height="18" rx="1.5" /><path d="M15 9h4a1 1 0 0 1 1 1v11h-5M8 7h3M8 11h3M8 15h3" /></S>);
export const IPlus = (p: P) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></S>);
export const ILogs = (p: P) => (<S {...p}><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></S>);
export const ISettings = (p: P) => (<S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></S>);
export const ILogout = (p: P) => (<S {...p}><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 16l-4-4 4-4M6 12h10" /></S>);
export const ISun = (p: P) => (<S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" /></S>);
export const IMoon = (p: P) => (<S {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></S>);
export const ICopy = (p: P) => (<S {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></S>);
export const IShield = (p: P) => (<S {...p}><path d="M12 2.5 20 5.5V12c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10V5.5Z" /><path d="m8.5 12 2.4 2.4L15.5 9.8" /></S>);
export const ILock = (p: P) => (<S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>);
export const IRefresh = (p: P) => (<S {...p}><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" /></S>);
export const IArrow = (p: P) => (<S {...p}><path d="M5 12h13M13 6l6 6-6 6" /></S>);
export const IDownload = (p: P) => (<S {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></S>);

export function NexusMark({ className }: P) {
  return (
    <svg viewBox="0 0 32 32" className={className} width="26" height="26" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="#3B6BFF" strokeWidth="2" />
      <path d="M9 22V10l14 12V10" fill="none" stroke="#22D3EE" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23" cy="10" r="2.6" fill="#FFB454" />
    </svg>
  );
}
