import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { DetailsForm } from "@/nexus-admin/ui/onboarding";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  await requireAdminPage();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Onboard a company</h1>
          <p>Step 1 of 7. A draft is saved after every step, so you can stop and come back.</p>
        </div>
      </div>
      <section className="card card-pad">
        <DetailsForm />
      </section>
    </>
  );
}
