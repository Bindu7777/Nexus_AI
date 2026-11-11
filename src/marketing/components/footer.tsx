import { footer, site } from "../content";
import { Logo } from "./icons";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap grid footer-grid">
        <div className="footer-brand">
          <a href="#top" className="wordmark">
            <Logo />
            Nexus AI
          </a>
          <p>{footer.blurb}</p>
        </div>
        <nav className="footer-links-nav" aria-label="Footer" style={{ display: "contents" }}>
          <ul className="footer-links">
            {footer.links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="footer-contact">
          <p>Contact</p>
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </div>
        <div className="footer-base">
          <span>{site.prototypeNote}</span>
          <span>© {new Date().getFullYear()} Nexus AI</span>
        </div>
      </div>
    </footer>
  );
}
