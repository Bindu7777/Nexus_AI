// The onboarding wizard's steps. A draft is saved after every step, so the
// admin can stop and resume.
export const ONBOARDING_STEPS = [
  { id: "company", title: "Company" },
  { id: "application", title: "Application" },
  { id: "tools", title: "Pick tools" },
  { id: "credentials", title: "Credentials and scope" },
  { id: "test", title: "Test connections" },
  { id: "learn", title: "Learn the application" },
  { id: "logins", title: "Create logins" },
  { id: "live", title: "Go live" },
] as const;
export type StepId = (typeof ONBOARDING_STEPS)[number]["id"];

export const isStep = (s: unknown): s is StepId => ONBOARDING_STEPS.some((x) => x.id === s);
