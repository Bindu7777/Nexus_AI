// All prices on the public site live here. Launch pricing; edit freely.
// `status: "planned"` items render with a "Planned" tag so the page never
// claims something the prototype does not have yet.

export type PlanFeature = { label: string; status?: "planned" };

export type Plan = {
  id: "platform" | "pilot" | "enterprise";
  name: string;
  /** Shown large. Keep it a plain string so "Talk to us" works too. */
  price: string;
  cadence?: string;
  summary: string;
  features: PlanFeature[];
  cta: { label: string; action: "pilot" | "contact" };
};

export const pricing = {
  headline: "One price per company. Your whole team can investigate.",
  note: "Pricing shown is launch pricing and may change.",
  /** Set to true only once Bindu confirms the first pilot is free. */
  firstPilotFree: false,
  plans: [
    {
      id: "platform",
      name: "Nexus Platform",
      price: "$1,000",
      cadence: "per company per month, billed monthly",
      summary: "Everything Nexus does, for everyone at your company.",
      features: [
        { label: "The on-premise Nexus platform" },
        { label: "All supported connectors" },
        { label: "IDE plugin for your engineers", status: "planned" },
        { label: "Company admin portal", status: "planned" },
        { label: "Persistent audit log", status: "planned" },
        { label: "Onboarding help from the team that builds it" },
      ],
      cta: { label: "Book a pilot", action: "pilot" },
    },
    {
      id: "pilot",
      name: "Pilot",
      price: "Talk to us",
      summary: "Two weeks on one real historical ticket from your backlog.",
      features: [{ label: "Runs inside your network" }, { label: "One ticket, start to finish" }],
      cta: { label: "Book a pilot", action: "pilot" },
    },
    {
      id: "enterprise",
      name: "Enterprise",
      price: "Talk to us",
      summary: "For custom deployments, single sign-on, and security reviews.",
      features: [{ label: "Custom deployment" }, { label: "Single sign-on", status: "planned" }, { label: "Security review support" }],
      cta: { label: "Talk to us", action: "pilot" },
    },
  ] satisfies Plan[],
};

export function pilotPrice() {
  return pricing.firstPilotFree ? "Free for the first pilot" : "Talk to us";
}
