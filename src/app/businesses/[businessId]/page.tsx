import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Inbox,
  MapPin,
  Search,
  Send,
  Settings2,
} from "lucide-react";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { IsometricView } from "@/components/isometric-view";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };
export default async function BusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ created?: string; joined?: string }>;
}) {
  const { businessId } = await params;
  const services = await getServices();
  const credentials = await headers();
  const state = await (async () => {
    try {
      const [profile, access] = await Promise.all([
        services.application.getProfile(credentials, businessId),
        services.team.requireBusinessCapability(
          credentials,
          businessId,
          "profile.read",
        ),
      ]);
      return { profile, access };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  const { profile, access } = state;
  const canManage = access.role !== "salesperson";
  const configured = Boolean(
    profile.configuration?.homeMarketConfirmedAt &&
    profile.configuration?.buyersReviewedAt,
  );
  const base = `/businesses/${businessId}`;
  const query = await searchParams;
  return (
    <div className="space-y-8">
      {query.created === "1" && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-xl border border-success/30 bg-card p-4 text-sm"
        >
          <CheckCircle2
            className="size-5 shrink-0 text-success"
            aria-hidden="true"
          />
          Your business is ready. Start with a prospect search or connect your
          sales inbox.
        </p>
      )}
      {query.joined === "1" && (
        <p
          role="status"
          className="rounded-xl border border-border bg-card p-4 text-sm"
        >
          Invitation accepted. You now have access to {profile.name}.
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Your business at a glance</p>
          <h1 className="page-title mt-2">{profile.name}</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Find potential customers and keep sales conversations moving.
          </p>
        </div>
        {canManage && (
          <Button asChild variant="outline">
            <Link href={`${base}/configuration`}>
              <Settings2 aria-hidden="true" />
              Business setup
            </Link>
          </Button>
        )}
      </header>
      <section
        className="grid items-center gap-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 lg:grid-cols-[1.1fr_1fr]"
        aria-labelledby="next-step-heading"
      >
        <div className="space-y-5">
          <Badge>{configured ? "Next step" : "Finish setup"}</Badge>
          <h2
            id="next-step-heading"
            className="max-w-md text-3xl leading-tight font-semibold tracking-tight"
          >
            {configured
              ? "Find your next customer."
              : "Tell us who you want to reach."}
          </h2>
          <p className="max-w-md leading-relaxed text-muted-foreground">
            {configured
              ? "Search for buyers who match your business. Review each prospect before choosing who to contact."
              : "Your business profile is saved. Add your customers and confirm your search area to get ready for prospect searches."}
          </p>
          <Button asChild>
            <Link
              href={`${base}/${configured ? "discovery" : "configuration"}`}
            >
              {configured
                ? "Find prospects"
                : canManage
                  ? "Continue setup"
                  : "View business setup"}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          {profile.homeMarket && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {profile.homeMarket}
            </p>
          )}
        </div>
        <IsometricView />
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Search,
            title: "Find prospects",
            description: "Search for customers who may need what you sell.",
            path: "/discovery",
          },
          {
            icon: Inbox,
            title: "Sales inbox",
            description: "Read inquiries and replies from potential customers.",
            path: "/inbox",
          },
          {
            icon: Send,
            title: "Outreach",
            description: "Prepare messages and review them before sending.",
            path: "/campaigns",
          },
        ].map((item) => (
          <Link
            key={item.path}
            href={base + item.path}
            className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-primary">
                <item.icon aria-hidden="true" className="size-5" />
              </span>
              <ArrowUpRight
                className="size-4 text-muted-foreground group-hover:text-primary"
                aria-hidden="true"
              />
            </div>
            <div>
              <h2 className="font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              {
                complete: true,
                label: "Add your business",
                text: "Your profile is saved.",
                path: "/profile",
              },
              {
                complete: configured,
                label: "Choose customers and location",
                text: configured
                  ? "Your search preferences are saved."
                  : "Complete your business setup.",
                path: "/configuration",
              },
            ].map((item) => (
              <Link
                key={item.path}
                href={base + item.path}
                className="flex items-start gap-3 rounded-xl p-3 hover:bg-muted"
              >
                {item.complete ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-success"
                  />
                ) : (
                  <Circle
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="flex-1">
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {item.text}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0"
                />
              </Link>
            ))}
            <Link
              href={`${base}/mailboxes`}
              className="flex items-start gap-3 rounded-xl p-3 hover:bg-muted"
            >
              <Inbox
                className="mt-0.5 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">
                  Connect a sales inbox
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Choose which emails LeadRelay can process.
                </span>
              </span>
              <ArrowRight className="mt-1 size-4 shrink-0" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What you sell</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {profile.offering}
            </p>
            <Button asChild variant="ghost" className="mt-4">
              <Link href={`${base}/profile`}>
                {canManage ? "Edit business profile" : "View business profile"}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
