// TODO: configuration drift. Registered so the structure is visible; never runs.
// Will compare environment and feature-flag configuration between a known-good
// and the failing environment, from read-only config sources.
import { defineDetector } from "../../types";

export default defineDetector({
  id: "config-drift",
  name: "Configuration drift (planned)",
  category: "configuration",
  requires: ["logs"],
  status: "placeholder",
  applies: () => false,
  check: () => ({ findings: [], abstained: "Configuration drift detection is not built yet." }),
  explain: (f) => ({ ...f.facts }),
});
