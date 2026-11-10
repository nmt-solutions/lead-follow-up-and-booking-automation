import { Suspense } from "react";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { AppNavigation, type NavigationBusiness } from "./app-navigation";
import { PageSkeleton } from "./page-skeleton";

async function NavigationData({ children }: { children: React.ReactNode }) {
  let businesses: NavigationBusiness[] = [];
  try {
    const services = await getServices();
    const credentials = await headers();
    const profiles = await services.application.listBusinesses(credentials);
    businesses = await Promise.all(
      profiles.map(async (profile) => {
        const access = await services.team
          .requireBusinessCapability(credentials, profile.id, "profile.read")
          .catch(() => null);
        const canManageAi = await services.ai
          .workspace(credentials, profile.id)
          .then(
            () => true,
            () => false,
          );
        return {
          id: profile.id,
          name: profile.name,
          canManage: access?.role === "owner" || access?.role === "admin",
          canManageAi,
        };
      }),
    );
  } catch {
    // The page owns authentication and error recovery. Navigation must not hide it.
  }
  return <AppNavigation businesses={businesses}>{children}</AppNavigation>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="page-container py-10">
          <PageSkeleton />
        </div>
      }
    >
      <NavigationData>{children}</NavigationData>
    </Suspense>
  );
}
