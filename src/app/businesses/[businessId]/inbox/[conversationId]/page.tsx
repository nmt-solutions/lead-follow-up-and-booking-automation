import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incoming conversation" };
export default async function ConversationPage({
  params,
}: PageProps<"/businesses/[businessId]/inbox/[conversationId]">) {
  const { businessId, conversationId } = await params;
  const conversation = await (async () => {
    try {
      return await (
        await getServices()
      ).inbox.conversation(await headers(), businessId, conversationId);
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
            <CardTitle>Initial Opportunity</CardTitle>
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
          </CardContent>
        </Card>
      </div>
      <section aria-labelledby="messages-title" className="space-y-4">
        <h2 id="messages-title" className="text-xl font-semibold">
          Received messages
        </h2>
        <p className="text-sm text-muted-foreground">
          Message content is untrusted correspondence. Sending and commercial
          actions require their own eligibility and authority checks.
        </p>
        <ol className="space-y-4">
          {conversation.messages.map((message) => (
            <li key={message.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{message.subject}</CardTitle>
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
    </div>
  );
}
