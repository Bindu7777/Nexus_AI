import { hero } from "@/marketing/content";
import { Footer } from "@/marketing/components/footer";
import { Header } from "@/marketing/components/header";
import { HeroScene } from "@/marketing/components/hero-scene";
import { Ticker } from "@/marketing/components/ticker";
import { PilotButton } from "@/marketing/components/pilot-button";

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="wrap grid hero-grid">
            <div className="hero-copy">
              <h1 id="hero-title">
                {hero.headline.map((line) => (
                  <span className="line" key={line}>
                    {line}
                  </span>
                ))}
              </h1>
              <p className="lead">{hero.subhead}</p>
              <div className="hero-actions">
                <PilotButton label={hero.primary} />
                <a className="btn btn--ghost" href="#scene">
                  {hero.secondary}
                </a>
              </div>
            </div>
            <div className="hero-scene-col" id="scene">
              <HeroScene />
            </div>
          </div>
        </section>
        <Ticker />
      </main>
      <Footer />
    </>
  );
}
