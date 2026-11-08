import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp evidence" };
export default async function ReviewsPage() {
  try {
    await (
      await getServices()
    ).team.requirePlatformCapability(await headers(), "whatsapp.review");
  } catch (error: unknown) {
    return pageFailure(error);
  }
  async function select(form: FormData) {
    "use server";
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "whatsapp.review");
    } catch (error: unknown) {
      return pageFailure(error);
    }
    const id = z.uuid().safeParse(form.get("businessId"));
    if (!id.success) return;
    redirect(`/platform/whatsapp/${id.data}`);
  }
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">WhatsApp evidence</h1>
        <p className="mt-3 text-muted-foreground">
          Open the Business ID provided by the customer for an assisted control
          and direct-payment review.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Select a customer Business</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={select} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="businessId">Business ID</Label>
              <Input
                id="businessId"
                name="businessId"
                required
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                autoComplete="off"
              />
            </div>
            <Button type="submit">Open account for review</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
