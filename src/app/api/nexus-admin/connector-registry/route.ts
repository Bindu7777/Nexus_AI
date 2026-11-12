import { formModel } from "@/nexus-admin/connectors/form";
import { registry } from "@/nexus-admin/connectors/registry";
import { CATEGORIES } from "@/nexus-admin/connectors/types";
import { adminRoute, ok } from "@/nexus-admin/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The registry as serializable form models. The onboarding screens render from this. */
export async function GET(request: Request) {
  return adminRoute(request, () => ok({ categories: CATEGORIES, connectors: registry().all().map(formModel) }));
}
