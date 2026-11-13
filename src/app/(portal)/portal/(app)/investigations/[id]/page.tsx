import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { clientIp } from "@/portal/server/auth";
import { findForCaller, investigationView, recordView } from "@/portal/server/investigations";
import { requirePortalPage } from "@/portal/server/page-guard";
import { LiveInvestigation } from "@/portal/ui/investigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investigation" };

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePortalPage();
  const { id } = await params;
  const row = findForCaller(ctx, id);
  // Another company's or another employee's id looks exactly like a missing one.
  if (!row) notFound();
  recordView(ctx, row, clientIp(await headers()));
  return <LiveInvestigation initial={investigationView(row)} csrf={ctx.session.csrf_token} />;
}
