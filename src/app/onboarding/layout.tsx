import Link from "next/link";
import { Brand } from "@/components/brand";
import { SetupExit } from "@/components/setup-exit";
import { SignOut } from "@/components/sign-out";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Lead Relay home">
          <Brand />
        </Link>
        <div className="flex items-center gap-2">
          <SetupExit />
          <SignOut />
        </div>
      </header>
      <main className="flex flex-1 flex-col px-5 pb-12 sm:px-8">
        {children}
      </main>
    </div>
  );
}
