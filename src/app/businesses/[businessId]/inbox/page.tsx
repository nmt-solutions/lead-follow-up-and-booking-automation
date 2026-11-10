import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { InboxImport } from "@/components/inbox-import";
import { ConversationList } from "@/components/conversation-list";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversations" };
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
    <div className="app-page">
      <PageHeader
        title={<>Conversations</>}
        description={
          <>
            Read inquiries and replies from potential customers. Review a
            conversation to see what they need and choose the next step.
          </>
        }
      ></PageHeader>
      <ConversationList
        businessId={businessId}
        conversations={state.inbox.conversations}
      />
      {state.inbox.canManage ? (
        <Accordion
          type="single"
          collapsible
          className="rounded-xl border border-border bg-card px-6"
        >
          <AccordionItem value="import" className="border-0">
            <AccordionTrigger>Import a received inquiry</AccordionTrigger>
            <AccordionContent>
              <InboxImport
                businessId={businessId}
                connections={state.inbox.connections}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can review shared conversations. Ask an Owner or Admin to manage
          incoming-message imports.
        </p>
      )}
    </div>
  );
}
