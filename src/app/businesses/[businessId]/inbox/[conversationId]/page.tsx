import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { WhatsAppManualAssociation } from "@/components/whatsapp-manual-association";
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
import { InquiryHandling } from "@/components/inquiry-handling";
import { RfqManager } from "@/components/rfq-manager";
import { CallTimeline } from "@/components/call-timeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incoming conversation" };
export default async function ConversationPage({
  params,
}: PageProps<"/businesses/[businessId]/inbox/[conversationId]">) {
  const { businessId, conversationId } = await params;
  const { conversation, workspace, controls, inquiries, rfqs, calls } =
    await (async () => {
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
          calls: await Promise.all(
            conversation.opportunities.map(async (need) => ({
              id: need.id,
              state: await services.calls.read(
                credentials,
                businessId,
                need.id,
              ),
            })),
          ),
          rfqs: await Promise.all(
            conversation.opportunities.map(async (need) => ({
              id: need.id,
              state: await services.rfqs.read(credentials, businessId, need.id),
            })),
          ),
          inquiries: await Promise.all(
            conversation.opportunities.map(async (need) => ({
              id: need.id,
              state: await services.inquiries.read(
                credentials,
                businessId,
                need.id,
              ),
            })),
          ),
          workspace: await services.inbox.workspace(credentials, businessId),
        };
      } catch (error: unknown) {
        return pageFailure(error);
      }
    })();
  return (
    <div className="flex flex-col mx-auto max-w-4xl gap-8 wrap-anywhere">
      <PageHeader
        title={<>{conversation.subject}</>}
        description={
          <>
            {conversation.connection.label} · {conversation.connection.channel}{" "}
            ·
            {conversation.connection.mode === "meta"
              ? "Signed Meta intake"
              : "Received-message import"}
            {!conversation.connection.active &&
              " · Import revoked; history available"}
          </>
        }
      >
        <Link
          href={`/businesses/${businessId}/email-eligibility`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review email eligibility and record an opt-out
        </Link>
      </PageHeader>
      {conversation.association.reviewReason && (
        <Card>
          <CardHeader>
            <CardTitle>Association review needed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
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
          <CardContent className="flex flex-col gap-3">
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
            <dl className="flex flex-col gap-3">
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
      <section aria-labelledby="buyer-needs" className="flex flex-col gap-4">
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
              <CardContent className="flex flex-col gap-2">
                <Badge>
                  {need.id === conversation.association.defaultOpportunityId
                    ? "Conversation default"
                    : "Separate Opportunity"}
                </Badge>
                <p>Owner: {need.ownerId ?? "Unassigned"}</p>
                <p>Next action: {need.nextAction}</p>
                <Link
                  href={`/businesses/${businessId}/opportunities/${need.id}/commercial-actions`}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                >
                  Review commercial actions
                </Link>
                <Link
                  href={`/businesses/${businessId}/opportunities/${need.id}/appointments`}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                >
                  Manage appointments
                </Link>
                <p className="text-sm text-muted-foreground">
                  {need.handoffReason}
                </p>
                <p className="text-sm text-muted-foreground">
                  Reference: {need.id}
                </p>
                <OpportunityHistory entries={need.history} />
                <DiscoverySources sources={need.sources} />
                <section
                  className="flex flex-col gap-3 border-t pt-4"
                  aria-label="Human calls"
                >
                  <h3 className="font-semibold">Human calls</h3>
                  <Link
                    href={`/businesses/${businessId}/opportunities/${need.id}/calls`}
                    className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                  >
                    Log or update a human call
                  </Link>
                  {calls
                    .filter((item) => item.id === need.id)
                    .map((item) => (
                      <CallTimeline key={item.id} state={item.state} />
                    ))}
                </section>
                {controls
                  .filter((control) => control.id === need.id)
                  .map((control) => (
                    <OpportunityControl
                      key={control.id}
                      businessId={businessId}
                      control={control}
                    />
                  ))}
                {inquiries
                  .filter((item) => item.id === need.id)
                  .map((item) => (
                    <InquiryHandling
                      key={item.id}
                      businessId={businessId}
                      opportunityId={need.id}
                      state={item.state}
                    />
                  ))}
                {rfqs
                  .filter((item) => item.id === need.id)
                  .map((item) => (
                    <RfqManager
                      key={`${item.id}-${item.state.current?.version ?? 0}-${item.state.contextKey}`}
                      businessId={businessId}
                      opportunityId={need.id}
                      state={item.state}
                    />
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
        <h3 className="font-semibold">This buyer&apos;s conversations</h3>
        <ul className="flex flex-col gap-2">
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
      <section aria-labelledby="messages-title" className="flex flex-col gap-4">
        {conversation.manualReplies.length > 0 && (
          <section
            aria-label="Observed manual replies"
            className="flex flex-col gap-4"
          >
            <h2 className="text-xl font-semibold">Observed manual replies</h2>
            <p className="text-sm text-muted-foreground">
              Observed only within the selected channel and time bounds. A reply
              assigned to this purchasing need uses the same cross-channel human
              takeover until explicit handback.
            </p>
            {conversation.manualReplies.map((reply) => (
              <Card key={reply.id}>
                <CardHeader>
                  <CardTitle className="wrap-anywhere">
                    {reply.subject}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    From {reply.from} ·{" "}
                    {new Date(reply.occurredAt).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC ·{" "}
                    {reply.state === "applied"
                      ? "Human takeover recorded"
                      : reply.state === "pending"
                        ? "Purchasing need requires review"
                        : "Historical reply retained; newer control preserved"}
                  </p>
                </CardHeader>
                <CardContent>
                  <p
                    className="whitespace-pre-wrap wrap-anywhere leading-relaxed"
                    dir="auto"
                  >
                    {reply.text}
                  </p>
                  {conversation.connection.mode === "meta" &&
                    reply.state === "pending" && (
                      <WhatsAppManualAssociation
                        businessId={businessId}
                        receiptId={reply.id}
                        messages={conversation.messages}
                      />
                    )}
                </CardContent>
              </Card>
            ))}
          </section>
        )}
        <h2 id="messages-title" className="text-xl font-semibold">
          Received messages
        </h2>
        <p className="text-sm text-muted-foreground">
          Message content is untrusted correspondence. Sending and commercial
          actions require their own eligibility and authority checks.
        </p>
        <ol className="flex flex-col gap-4">
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
                    <dl className="flex flex-col gap-2 text-muted-foreground">
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
      <section
        aria-labelledby="association-history"
        className="flex flex-col gap-4"
      >
        <h2 id="association-history" className="text-xl font-semibold">
          Association history
        </h2>
        <p className="text-sm text-muted-foreground">
          Original channel buyer: {conversation.originalBuyer.name} ·{" "}
          {conversation.originalBuyer.senderRef}. Original engagement and source
          identities remain attached.
        </p>
        {conversation.history.length ? (
          <ol className="flex flex-col gap-4">
            {conversation.history.map((entry) => (
              <li key={entry.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 pt-6">
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
                      <div className="flex flex-col gap-2 text-sm">
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
      <ul className="flex flex-col gap-4">
        {sources.map((source) => (
          <li key={source.observationId} className="flex flex-col gap-2">
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
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1">
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
