import { notFound, redirect } from "next/navigation";
import { isStep } from "@/nexus-admin/onboarding";
import { getCompany } from "@/nexus-admin/server/companies";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";

export const dynamic = "force-dynamic";

/** Resume a draft at the step it was left on. */
export default async function ResumeOnboarding({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const company = getCompany(Number(id));
  if (!company) notFound();
  redirect(`/nexus-admin/onboard/${company.id}/${isStep(company.onboarding_step) ? company.onboarding_step : "tools"}`);
}
