import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Circle,
  Inbox,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

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
  const data = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      const [profile, access] = await Promise.all([
        services.application.getProfile(credentials, businessId),
        services.team.requireBusinessCapability(
          credentials,
          businessId,
          "profile.read",
        ),
      ]);
      const [report, inbox, mailboxes, ai, knowledge] = await Promise.all([
        services.reporting.read(credentials, businessId, {}).catch(() => null),
        services.inbox.workspace(credentials, businessId).catch(() => null),
        services.mailboxes.workspace(credentials, businessId).catch(() => null),
        services.ai.workspace(credentials, businessId).catch(() => null),
        services.knowledge.workspace(credentials, businessId).catch(() => null),
      ]);
      return { profile, access, report, inbox, mailboxes, ai, knowledge };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  const { profile, access, report, inbox, mailboxes, ai, knowledge } = data;
  const base = `/businesses/${businessId}`;
  const configured = Boolean(
    profile.configuration?.homeMarketConfirmedAt &&
    profile.configuration?.buyersReviewedAt,
  );
  const connected =
    mailboxes?.mailboxes.some(
      (item) => item.configuration.enabled && item.visibility === "current",
    ) ?? false;
  const knowledgeReady = Boolean(knowledge?.current);
  const aiReady = Boolean(ai?.activation.profileId && !ai.setup.length);
  const tasks = [
    {
      label: "Add your business",
      description: "Name and products saved",
      complete: true,
      path: "/profile",
    },
    {
      label: "Choose customers and location",
      description: configured
        ? "Search preferences confirmed"
        : "Complete your business setup",
      complete: configured,
      path: "/configuration",
    },
    {
      label: "Connect a sales inbox",
      description: connected
        ? "An inbox is ready to process sales mail"
        : "Choose the sales mail to process",
      complete: connected,
      path: "/mailboxes",
    },
    {
      label: "Approve business knowledge",
      description: knowledgeReady
        ? "Approved information is available"
        : "Give AI the answers your team uses",
      complete: knowledgeReady,
      path: "/knowledge",
    },
  ];
  const completed = tasks.filter((item) => item.complete).length;
  const recent = [...(inbox?.conversations ?? [])]
    .sort((a, b) => Date.parse(b.lastReceivedAt) - Date.parse(a.lastReceivedAt))
    .slice(0, 5);
  const query = await searchParams;
  const metrics = [
    { id: "observed_prospects", label: "Prospects", icon: Search },
    { id: "incoming_messages", label: "Incoming messages", icon: Inbox },
    { id: "qualified", label: "Qualified opportunities", icon: Users },
    {
      id: "appointment_requests",
      label: "Appointment requests",
      icon: CalendarDays,
    },
  ];
  return (
    <div className="app-page">
      <PageHeader
        title="Overview"
        description={`Your sales activity for ${profile.name}.`}
        actions={
          <>
            {mailboxes?.canManage && (
              <Button asChild variant="outline">
                <Link href={`/onboarding/${businessId}?step=email`}>
                  Finish setup
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={base + "/inbox"}>
                <Inbox data-icon="inline-start" aria-hidden="true" />
                Conversations
              </Link>
            </Button>
            <Button asChild>
              <Link
                href={base + (configured ? "/discovery" : "/configuration")}
              >
                <Search data-icon="inline-start" aria-hidden="true" />
                {configured ? "Find prospects" : "Review business details"}
              </Link>
            </Button>
          </>
        }
      />
      {(query.created === "1" || query.joined === "1") && (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>
            {query.created === "1"
              ? "Your business is saved"
              : "You joined the business"}
          </AlertTitle>
          <AlertDescription>
            {query.created === "1"
              ? "Your customers and location are ready. Continue with the setup checklist below."
              : `You now have access to ${profile.name}.`}
          </AlertDescription>
        </Alert>
      )}
      <section
        aria-label="Recorded activity for the last 30 days"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {metrics.map((item) => {
          const metric = report?.metrics.find(
            (metric) => metric.id === item.id,
          );
          return (
            <Card key={item.id}>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardDescription>{item.label}</CardDescription>
                <item.icon
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight tabular-nums">
                  {metric?.value != null
                    ? new Intl.NumberFormat("en").format(metric.value)
                    : "Unavailable"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {metric?.status === "recorded"
                    ? "Recorded in the last 30 days"
                    : "Open Reports to review availability"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <CardTitle>Recent conversations</CardTitle>
                <CardDescription>
                  Customer inquiries and replies received by your business.
                </CardDescription>
              </div>
              <Button asChild variant="ghost">
                <Link href={base + "/inbox"}>
                  View all
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recent.length ? (
                <ul className="divide-y divide-border">
                  {recent.map((conversation) => (
                    <li key={conversation.id}>
                      <Link
                        href={`${base}/inbox/${conversation.id}`}
                        className="flex items-start gap-3 rounded-lg py-4 hover:bg-muted/50"
                      >
                        <Avatar className="size-10">
                          <AvatarFallback>
                            {conversation.buyerName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {conversation.buyerName}
                            </span>
                            <time
                              className="text-xs text-muted-foreground"
                              dateTime={conversation.lastReceivedAt}
                            >
                              {new Date(
                                conversation.lastReceivedAt,
                              ).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                timeZone: "UTC",
                              })}
                            </time>
                          </span>
                          <span className="truncate text-sm text-muted-foreground">
                            {conversation.subject}
                          </span>
                        </div>
                        {conversation.needsReview && (
                          <Badge variant="warning">Review</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Inbox aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {inbox
                        ? "Your conversations will appear here"
                        : "Conversations are unavailable"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {inbox
                        ? "Connect a sales inbox or import a received inquiry. Prospect search results stay in Find prospects."
                        : "Open Conversations to review access or retry loading your messages."}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button asChild variant="outline">
                      <Link href={base + (inbox ? "/mailboxes" : "/inbox")}>
                        {inbox ? "Connect an inbox" : "Open conversations"}
                      </Link>
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <CardTitle>Business setup</CardTitle>
                <CardDescription>
                  {completed} of {tasks.length} steps complete. Your progress is
                  based on saved settings.
                </CardDescription>
              </div>
              <Badge
                variant={completed === tasks.length ? "success" : "primary"}
              >
                {completed === tasks.length ? "Ready" : "In progress"}
              </Badge>
            </CardHeader>
            <CardContent>
              <Progress
                value={(completed / tasks.length) * 100}
                aria-label={`${completed} of ${tasks.length} setup steps complete`}
                className="mb-5"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {tasks.map((item) => (
                  <Link
                    key={item.path}
                    href={base + item.path}
                    className="flex items-start gap-3 rounded-lg p-3 hover:bg-muted"
                  >
                    <span className="mt-0.5">
                      {item.complete ? (
                        <CheckCircle2
                          className="size-5 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          className="size-5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="flex flex-1 flex-col gap-1">
                      <span className="text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <aside className="flex flex-col gap-6">
          {ai && (
            <Card>
              <CardHeader>
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
                    <Sparkles className="size-5" aria-hidden="true" />
                  </span>
                  <Badge variant={aiReady ? "success" : "default"}>
                    {aiReady ? "Profile active" : "Setup needed"}
                  </Badge>
                </div>
                <CardTitle>Your AI assistant</CardTitle>
                <CardDescription>
                  {aiReady
                    ? "Uses your approved business information for supported research review and sales drafts."
                    : "Approve business knowledge and activate a reviewed profile to use supported AI workflows."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-xs leading-6 text-muted-foreground">
                  Review generated facts and messages. Sending and other sales
                  actions need their own approval.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link href={base + "/ai"}>
                    Open AI assistant
                    <ArrowRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>What you sell</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
                {profile.offering}
              </p>
              <Separator />
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  Default search area
                </p>
                <p className="text-sm font-medium">
                  {profile.homeMarket || "Not set"}
                </p>
              </div>
              <Button asChild variant="ghost" className="w-fit">
                <Link href={base + "/profile"}>
                  {access.role === "salesperson"
                    ? "View profile"
                    : "Edit profile"}
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Link
            href="/getting-started"
            className="flex items-start gap-3 rounded-xl border border-border p-4 hover:bg-card"
          >
            <BookOpen
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">The vendor guide</span>
              <span className="text-xs leading-5 text-muted-foreground">
                Setup, your first search, and handling replies.
              </span>
            </span>
          </Link>
        </aside>
      </div>
    </div>
  );
}
