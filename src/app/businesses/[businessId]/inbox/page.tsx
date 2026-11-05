import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { InboxImport } from "@/components/inbox-import";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared sales inbox" };
export default async function InboxPage({
  params,
}: PageProps<"/businesses/[businessId]/inbox">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        inbox: await services.inbox.workspace(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Business profile
        </Link>
        <p className="mb-3 text-sm font-medium text-primary wrap-anywhere">
          {state.profile.name}
        </p>
        <h1 className="page-title">Shared sales inbox</h1>
        <p className="mt-3 text-muted-foreground">
          Direct inquiries and buying-interest replies from any geography. Each
          conversation retains its sources. Review purchasing needs and
          explicitly associate messages across verified channels.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Incoming conversations</CardTitle>
          <CardDescription>
            Incoming messages require review. Intake does not authorize sending,
            prices, spending, booking or orders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.inbox.conversations.length ? (
            <ul className="divide-y divide-border">
              {state.inbox.conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href={`/businesses/${businessId}/inbox/${conversation.id}`}
                    className="block min-h-11 space-y-2 rounded-lg p-4 transition-colors hover:bg-muted motion-reduce:transition-none"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-semibold wrap-anywhere">
                        {conversation.subject}
                      </span>
                      <Badge>{conversation.channel}</Badge>
                      {conversation.needsReview && (
                        <Badge>Association review needed</Badge>
                      )}
                    </div>
                    <p className="wrap-anywhere">{conversation.buyerName}</p>
                    <p className="text-sm text-muted-foreground">
                      Engaged lead · Inquiry ·{" "}
                      <time dateTime={conversation.lastReceivedAt}>
                        {new Date(conversation.lastReceivedAt).toLocaleString(
                          "en-GB",
                          { timeZone: "UTC" },
                        )}{" "}
                        UTC
                      </time>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              No incoming inquiries yet. An Owner or Admin can add an import
              connection below and import a received inquiry. Public discovery
              signals stay in prospect discovery.
            </p>
          )}
        </CardContent>
      </Card>
      {state.inbox.canManage ? (
        <InboxImport
          businessId={businessId}
          connections={state.inbox.connections}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          You can review shared conversations. Ask an Owner or Admin to manage
          incoming-message imports.
        </p>
      )}
    </div>
  );
}
