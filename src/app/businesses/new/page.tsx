import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ProfileForm } from "@/components/profile-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a Business" };
export default async function NewBusinessPage() {
  try {
    await (await getServices()).application.listBusinesses(await headers());
  } catch (error: unknown) {
    pageFailure(error);
  }
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          Back to your Businesses
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Create a Business
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Each Business has its own private profile.
        </p>
      </div>
      <ProfileForm />
    </div>
  );
}
