import { PageHeader } from "@/components/page-header";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export const metadata = { title: "Operator sender alerts" };
export default async function OperatorAlertsPage() {
  const state = await (async () => {
    try {
      return await (await getServices()).senderHealth.alerts(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  async function open(form: FormData) {
    "use server";
    await (
      await getServices()
    ).team.requirePlatformCapability(await headers(), "sender-health.manage");
    const id = z.uuid().safeParse(form.get("businessId"));
    if (id.success) redirect(`/platform/sender-health/${id.data}`);
  }
  return (
    <div className="app-page">
      <PageHeader
        title={<>Operator sender alerts</>}
        description={
          <>
            Durable in-app alerts across customer Businesses. Review the exact
            sender, underlying evidence and repair. No external messages are
            sent.
          </>
        }
      ></PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>Open a customer Business</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={open} className="flex flex-col gap-4">
            <Label htmlFor="health-business">Business ID</Label>
            <Input
              id="health-business"
              name="businessId"
              required
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              autoComplete="off"
            />
            <Button>Review sender evidence</Button>
          </form>
        </CardContent>
      </Card>
      <section className="flex flex-col gap-4" aria-label="Sender incidents">
        {!state.alerts.length && <p>No sender incidents have been reported.</p>}
        {state.alerts.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-col gap-2 pt-6">
              <p>
                {a.acknowledged ? "Acknowledged" : "Needs review"} · {a.at}
              </p>
              <p className="break-all text-sm">
                Business {a.businessId} · sender {a.identityId}
              </p>
              <Link
                href={`/platform/sender-health/${a.businessId}#sender-${a.identityId}`}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Review incident and repair
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
