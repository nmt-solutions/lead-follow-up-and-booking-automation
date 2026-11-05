import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SecurityManager } from "@/components/security-manager";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security", referrer: "no-referrer" };
export default async function SecurityPage() {
  const status = await (async () => {
    try {
      return await (await getServices()).access.status(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <AppShell>
      <div className="mb-8 max-w-2xl space-y-3">
        <p className="eyebrow">Account security</p>
        <h1 className="page-title">A second layer of protection.</h1>
        <p className="text-muted-foreground leading-relaxed">
          Manage secure access for{" "}
          <span className="font-medium text-foreground wrap-anywhere">
            {status.email}
          </span>
          .
        </p>
      </div>
      <SecurityManager initialStatus={status} />
    </AppShell>
  );
}
