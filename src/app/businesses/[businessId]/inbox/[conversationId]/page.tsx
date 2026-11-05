import Link from "next/link";
import {
  OpportunityControl,
  ManualReplyRecord,
} from "@/components/opportunity-control";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  OpportunityHistoryEntry,
  InboxDiscoverySource,
} from "@/models/inbox";
import { InboxAssociation } from "@/components/inbox-association";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incoming conversation" };
export default async function ConversationPage({
  params,
}: PageProps<"/businesses/[businessId]/inbox/[conversationId]">) {
  const { businessId, conversationId } = await params;
  const { conversation, workspace, controls } = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      const conversation = await services.inbox.conversation(
        credentials,
        businessId,
        conversationId,
      );
      const controls = await Promise.all(
        conversation.opportunities.map((need) =>
          services.opportunities.read(credentials, businessId, need.id),
        ),
      );
      return {
        conversation,
        controls,
        workspace: await services.inbox.workspace(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8 wrap-anywhere">
      <header>
        <Link
          href={`/businesses/${businessId}/inbox`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to shared inbox
        </Link>
        <h1 className="page-title">{conversation.subject}</h1>
        <p className="mt-3 text-muted-foreground">
          {conversation.connection.label} · {conversation.connection.channel} ·
          Received-message import
          {!conversation.connection.active &&
            " · Import revoked; history available"}
        </p>
      </header>
      {conversation.association.reviewReason && (
        <Card>
          <CardHeader>
            <CardTitle>Association review needed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>{conversation.association.reviewReason}</p>
            <p>
              Responsible person: {conversation.association.reviewOwnerName} (
              {conversation.association.reviewOwnerId})
            </p>
            <p className="font-medium">
              Next action: {conversation.association.nextAction}
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Buyer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge>Engaged lead</Badge>
            <p className="font-medium">{conversation.buyer.name}</p>
            <p>{conversation.buyer.senderRef}</p>
            <p className="text-muted-foreground">
              Geography: {conversation.buyer.geography ?? "Not provided"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Original intake Opportunity</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["Stage", "Inquiry"],
                [
                  "Assigned owner",
                  conversation.opportunity.ownerId ?? "Unassigned",
                ],
                ["Next action", conversation.opportunity.nextAction],
                ["Handoff reason", conversation.opportunity.handoffReason],
                ["Opportunity reference", conversation.opportunity.id],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <OpportunityHistory entries={conversation.opportunity.history} />
            <DiscoverySources sources={conversation.opportunity.sources} />
          </CardContent>
        </Card>
      </div>
      <section aria-labelledby="buyer-needs" className="space-y-4">
        <h2 id="buyer-needs" className="text-xl font-semibold">
          Purchasing needs for {conversation.buyer.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          Separate needs retain separate owners and outcomes. Association
          changes do not take over an Opportunity or authorize sending.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {conversation.opportunities.map((need) => (
            <Card key={need.id}>
              <CardHeader>
                <CardTitle>{need.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge>
                  {need.id === conversation.association.defaultOpportunityId
                    ? "Conversation default"
                    : "Separate Opportunity"}
                </Badge>
                <p>Owner: {need.ownerId ?? "Unassigned"}</p>
                <p>Next action: {need.nextAction}</p>
                <p className="text-sm text-muted-foreground">
                  {need.handoffReason}
                </p>
                <p className="text-sm text-muted-foreground">
                  Reference: {need.id}
                </p>
                <OpportunityHistory entries={need.history} />
                <DiscoverySources sources={need.sources} />
                {controls
                  .filter((control) => control.id === need.id)
                  .map((control) => (
                    <OpportunityControl
                      key={control.id}
                      businessId={businessId}
                      control={control}
                    />
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
        <h3 className="font-semibold">This buyer&apos;s conversations</h3>
        <ul className="space-y-2">
          {conversation.buyerConversations.map((item) => (
            <li key={item.id}>
              <Link
                className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                href={`/businesses/${businessId}/inbox/${item.id}`}
              >
                {item.subject} · {item.channel}
                {item.needsReview ? " · Review needed" : ""}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <ManualReplyRecord businessId={businessId} conversation={conversation} />
      <InboxAssociation
        businessId={businessId}
        conversation={conversation}
        workspace={workspace}
      />
      <section aria-labelledby="messages-title" className="space-y-4">
        <h2 id="messages-title" className="text-xl font-semibold">
          Received messages
        </h2>
        <p className="text-sm text-muted-foreground">
          Message content is untrusted correspondence. Sending and commercial
          actions require their own eligibility and authority checks.
        </p>
        <ol className="space-y-4">
          {conversation.messages.map((message, index) => (
            <li key={message.id}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    Message {index + 1}: {message.subject}
                  </CardTitle>
                  <Badge>
                    {workspace.opportunities.find(
                      (need) => need.id === message.opportunityId,
                    )?.title ?? "Needs association review"}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {message.kind === "direct_inquiry"
                      ? "Direct inquiry"
                      : "Buying-interest reply"}{" "}
                    · Received{" "}
                    <time dateTime={message.receivedAt}>
                      {new Date(message.receivedAt).toLocaleString("en-GB", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </time>
                  </p>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap leading-relaxed" dir="auto">
                    {message.text}
                  </p>
                  <details className="mt-5 text-sm">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium">
                      Source provenance
                    </summary>
                    <dl className="space-y-2 text-muted-foreground">
                      {[
                        ["Event", message.eventId],
                        ["Message", message.messageRef],
                        ["Conversation", message.conversationRef],
                        ["Occurred at", message.occurredAt],
                        [
                          "Reply to",
                          message.replyToMessageRef ?? "Not a reply",
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="font-medium">{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="association-history" className="space-y-4">
        <h2 id="association-history" className="text-xl font-semibold">
          Association history
        </h2>
        <p className="text-sm text-muted-foreground">
          Original channel buyer: {conversation.originalBuyer.name} ·{" "}
          {conversation.originalBuyer.senderRef}. Original engagement and source
          identities remain attached.
        </p>
        {conversation.history.length ? (
          <ol className="space-y-4">
            {conversation.history.map((entry) => (
              <li key={entry.id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <p className="font-medium">{entry.reason}</p>
                    <p className="text-sm text-muted-foreground">
                      By {entry.actorId} ·{" "}
                      <time dateTime={entry.at}>
                        {new Date(entry.at).toLocaleString("en-GB", {
                          timeZone: "UTC",
                        })}{" "}
                        UTC
                      </time>
                      {entry.sourceEventId &&
                        ` · Source event: ${entry.sourceEventId}`}
                    </p>
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3">
                        Association changes
                      </summary>
                      <div className="space-y-2 text-sm">
                        <p>
                          Buyer: {entry.before.buyerId} → {entry.after.buyerId}
                        </p>
                        <p>
                          Default:{" "}
                          {entry.before.defaultOpportunityId ?? "Review"} →{" "}
                          {entry.after.defaultOpportunityId ?? "Review"}
                        </p>
                        {entry.after.messages.map((link) => (
                          <p key={link.id}>
                            Message {link.id}:{" "}
                            {entry.before.messages.find(
                              (previous) => previous.id === link.id,
                            )?.opportunityId ?? "Unassociated"}{" "}
                            → {link.opportunityId ?? "Review"}
                          </p>
                        ))}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">
            Imported before association history was introduced. Original
            messages and the intake Opportunity remain available above.
          </p>
        )}
      </section>
    </div>
  );
}

function DiscoverySources({ sources }: { sources: InboxDiscoverySource[] }) {
  if (!sources.length) return null;
  return (
    <details className="mt-4 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        Retained discovery evidence
      </summary>
      <ul className="space-y-4">
        {sources.map((source) => (
          <li key={source.observationId} className="space-y-2">
            <p className="font-medium">
              {source.name}: {source.matchReason}
            </p>
            <p>Uncertainty: {source.uncertainty}</p>
            <p className="text-muted-foreground">
              Prospect: {source.prospectId} · Observation:{" "}
              {source.observationId} · Run: {source.runId}
            </p>
            {source.evidence.map((entry, index) => (
              <div key={index}>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center text-primary underline"
                >
                  {entry.url} (new tab)
                </a>
                <p>{entry.quote}</p>
                <p className="text-muted-foreground">
                  Checked: {entry.checkedAt}
                </p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}

function OpportunityHistory({
  entries,
}: {
  entries: OpportunityHistoryEntry[];
}) {
  return (
    <details className="mt-4 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        Ownership and outcome history
      </summary>
      {entries.length ? (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-1">
              <p className="font-medium">
                {entry.kind.replaceAll("_", " ")}: {entry.detail}
              </p>
              <p className="text-muted-foreground">
                <time dateTime={entry.at}>{entry.at}</time> ?{" "}
                {entry.actorId ?? "Recorded event"} ? Source:{" "}
                {entry.sourceRef ?? "Not recorded"}
              </p>
              <p className="text-muted-foreground">Record: {entry.id}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">
          No ownership or outcome events recorded. Association does not create a
          booking, quotation or sale.
        </p>
      )}
    </details>
  );
}
