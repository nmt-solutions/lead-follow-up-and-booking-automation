import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a Business" };
export default async function NewBusinessPage() {
  try {
    await (await getServices()).access.authenticatePrivileged(await headers());
  } catch (error: unknown) {
    pageFailure(error);
  }
  redirect("/onboarding/new");
}
