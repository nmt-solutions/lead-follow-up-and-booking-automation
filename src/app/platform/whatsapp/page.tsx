import { PageHeader } from "@/components/page-header";

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
    <div className="app-page">
      <PageHeader
        title={<>WhatsApp evidence</>}
        description={
          <>
            Open the Business ID provided by the customer for an assisted
            control and direct-payment review.
          </>
        }
      ></PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>Select a customer Business</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={select} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
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
