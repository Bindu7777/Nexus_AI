// TODO: dependency regression. Registered so the structure is visible; never runs.
// Will look for a dependency version change (lockfile diff) shortly before the
// first report that touches the located code paths.
import { defineDetector } from "../../types";

export default defineDetector({
  id: "dependency-regression",
  name: "Dependency regression (planned)",
  category: "dependency",
  requires: ["commits", "first_report"],
  status: "placeholder",
  applies: () => false,
  check: () => ({ findings: [], abstained: "Dependency regression detection is not built yet." }),
  explain: (f) => ({ ...f.facts }),
});
