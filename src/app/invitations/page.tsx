import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { InvitationAcceptance } from "@/components/invitation-acceptance";
import { SignOut } from "@/components/sign-out";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team invitation", referrer: "no-referrer" };
export default async function InvitationPage() {
  let signedIn = false;
  let available = true;
  try {
    signedIn = Boolean(
      await (
        await getServices()
      ).auth.api.getSession({ headers: await headers() }),
    );
  } catch {
    available = false;
  }
  return (
    <main className="mx-auto max-w-xl space-y-8 px-5 py-12 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/businesses"
          className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          Your Businesses
        </Link>
        {signedIn && <SignOut stayOnPage />}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Team invitation</h1>
      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <InvitationAcceptance signedIn={signedIn} available={available} />
      </section>
    </main>
  );
}
