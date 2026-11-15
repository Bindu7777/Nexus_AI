import { ticker } from "../content";
import { IconAbstain, IconCheck } from "./icons";

function Items({ hidden }: { hidden?: boolean }) {
  return (
    <ul className="ticker-list" aria-hidden={hidden || undefined}>
      {ticker.items.map((item) => (
        <li key={item.id} className="ticker-item">
          {item.status === "verified" ? <IconCheck className="ok" /> : <IconAbstain className="no" />}
          <span className="tid">{item.id}</span>
          <span>·</span>
          <span>{item.what}</span>
          <span>·</span>
          <span className={item.status === "verified" ? "ok" : "no"}>{item.statusText ?? "verified"}</span>
          <span>·</span>
          <span>{item.tail}</span>
        </li>
      ))}
    </ul>
  );
}

export function Ticker() {
  return (
    <section className="ticker" aria-label={ticker.label}>
      <div className="wrap ticker-label">
        <span className="example-label">{ticker.label}</span>
      </div>
      <div className="ticker-viewport" tabIndex={0} aria-label={`${ticker.label}. Hover or focus to pause.`}>
        <div className="ticker-track">
          <Items />
          <Items hidden />
        </div>
      </div>
    </section>
  );
}
