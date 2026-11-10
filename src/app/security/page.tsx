import Link from "next/link";
import { Brand } from "@/components/brand";
import { SignOut } from "@/components/sign-out";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SecurityManager } from "@/components/security-manager";
import { CompleteProfileForm } from "@/components/complete-profile-form";
import { profileSchema } from "@/models/registration";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security", referrer: "no-referrer" };
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string; profile?: string }>;
}) {
  const query = await searchParams;
  const services = await getServices();
  const requestHeaders = await headers();
  const identity = await services.auth.api.getSession({
    headers: requestHeaders,
  });
  const jar = await cookies();
  const pendingChallenge =
    jar.has("better-auth.two_factor") ||
    jar.has("__Secure-better-auth.two_factor");
  if (!identity && !pendingChallenge) redirect("/sign-in");
  const needsProfile = Boolean(
    identity &&
    query.profile &&
    !profileSchema.safeParse(identity.user).success,
  );
  const hasPassword = identity
    ? Boolean(
        (
          await (
            await services.auth.$context
          ).internalAdapter.findCredentialAccount(identity.user.id)
        )?.password,
      )
    : true;
  const status = await (async () => {
    try {
      return identity ? await services.access.status(requestHeaders) : null;
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <Link href="/" aria-label="Lead Relay home">
          <Brand />
        </Link>
        <SignOut />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
        {needsProfile ? (
          <CompleteProfileForm />
        ) : (
          <SecurityManager
            initialStatus={status}
            passwordRequested={query.password === "1"}
            initialHasPassword={hasPassword}
          />
        )}
      </main>
    </div>
  );
}
