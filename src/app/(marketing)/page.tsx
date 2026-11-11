import { hero } from "@/marketing/content";
import { Environment } from "@/marketing/components/environment";
import { Evidence } from "@/marketing/components/evidence";
import { Faq } from "@/marketing/components/faq";
import { Footer } from "@/marketing/components/footer";
import { GuessVsProof } from "@/marketing/components/guess-vs-proof";
import { Header } from "@/marketing/components/header";
import { HeroScene } from "@/marketing/components/hero-scene";
import { HowItWorks } from "@/marketing/components/how-it-works";
import { IdeMock } from "@/marketing/components/ide-mock";
import { Integrations } from "@/marketing/components/integrations";
import { PilotButton } from "@/marketing/components/pilot-button";
import { PilotDialog } from "@/marketing/components/pilot-dialog";
import { Pricing } from "@/marketing/components/pricing";
import { Problem } from "@/marketing/components/problem";
import { FinalCta, Trust } from "@/marketing/components/sections";
import { Ticker } from "@/marketing/components/ticker";
import { Walkthrough } from "@/marketing/components/walkthrough";

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
        <Problem />
        <HowItWorks />
        <Walkthrough />
        <Evidence />
        <GuessVsProof />
        <Integrations />
        <Environment />
        <IdeMock />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <PilotDialog />
    </>
  );
}
