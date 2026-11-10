import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { PilotManager, type PilotChoices } from "@/components/pilot-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Paid pilot projects" };
export default async function PilotPage({
  params,
}: PageProps<"/businesses/[businessId]/pilots">) {
  const { businessId } = await params,
    services = await getServices(),
    credentials = await headers();
  const initial = await services.pilots
    .workspace(credentials, businessId)
    .catch(pageFailure);
  const results = await Promise.allSettled([
    services.subscriptionPayments.workspace(credentials, businessId),
    services.senders.workspace(credentials, businessId),
    services.mailboxes.workspace(credentials, businessId),
    services.whatsapp.workspace(credentials, businessId),
    services.googleCalendar.read(credentials, businessId),
    services.microsoftCalendar.read(credentials, businessId),
    services.application.listBusinesses(credentials),
    services.emailEligibility.workspace(credentials, businessId),
    services.reporting.read(credentials, businessId, {}),
  ]);
  const [
    payments,
    senders,
    mailboxes,
    whatsapp,
    google,
    microsoft,
    businesses,
    email,
    report,
  ] = results;
  const choices: PilotChoices = {
    metrics:
      report.status === "fulfilled"
        ? report.value.metrics.map((m) => ({
            id: m.id,
            label: `${m.label} (${m.unit})`,
            unit: m.unit,
          }))
        : [],
    payments:
      payments.status === "fulfilled"
        ? payments.value.actions
            .filter(
              (a) =>
                a.snapshot.term.kind === "days" ||
                !!a.snapshot.pilotContinuation,
            )
            .map((a) => ({
              id: a.id,
              currency: a.snapshot.quote.currency,
              label: `${a.snapshot.term.kind === "days" ? "Pilot" : "Bounded monthly continuation"}: ${a.snapshot.quote.pricing.offer.label}; original pilot ${a.snapshot.quote.currency} ${a.snapshot.quote.initial.subtotalMinor} minor units / ${a.snapshot.quote.initial.days} days; monthly ${a.snapshot.quote.renewal.subtotalMinor} before tax (${a.state})`,
            }))
        : [],
    senders:
      senders.status === "fulfilled"
        ? senders.value.identities.map((s) => ({
            id: s.id,
            label: `${s.configuration.displayName}: ${s.configuration.fromAddress}`,
          }))
        : [],
    mailboxes: [
      ...new Map(
        [
          ...(mailboxes.status === "fulfilled"
            ? mailboxes.value.mailboxes.map((m) => ({
                id: m.id,
                label: `${m.provider}: ${m.account} (${m.visibility})`,
              }))
            : []),
          ...(senders.status === "fulfilled"
            ? senders.value.inboxes
                .filter((i) => i.active)
                .map((i) => ({ id: i.id, label: `Reply inbox: ${i.label}` }))
            : []),
        ].map((m) => [m.id, m]),
      ).values(),
    ],
    whatsapp:
      whatsapp.status === "fulfilled" && whatsapp.value.connection
        ? [
            {
              id: whatsapp.value.connection.id,
              label: `Customer-owned Meta connection (${whatsapp.value.connection.status})`,
            },
          ]
        : [],
    calendars: [
      ...(google.status === "fulfilled" &&
      google.value.connectionId &&
      google.value.selectedCalendarId
        ? [
            {
              id: `google|${google.value.connectionId}|${google.value.selectedCalendarId}`,
              label: `Google: ${google.value.accountEmail} (${google.value.status})`,
            },
          ]
        : []),
      ...(microsoft.status === "fulfilled" &&
      microsoft.value.connectionId &&
      microsoft.value.selectedCalendarId
        ? [
            {
              id: `microsoft|${microsoft.value.connectionId}|${microsoft.value.selectedCalendarId}`,
              label: `Microsoft ${microsoft.value.accountKind}: ${microsoft.value.accountEmail} (${microsoft.value.status})`,
            },
          ]
        : []),
    ],
    businesses:
      businesses.status === "fulfilled"
        ? businesses.value.map((b) => ({ id: b.id, label: b.name }))
        : [],
    emailActions:
      email.status === "fulfilled"
        ? email.value.actions.map((a) => ({
            id: JSON.stringify(a.action),
            action: a.action,
            label: `${a.description}: ${a.recipient}`,
          }))
        : [],
  };
  return (
    <div className="app-page">
      <BusinessPageHeader section="pilots"></BusinessPageHeader>
      <PilotManager
        businessId={businessId}
        initial={initial}
        choices={choices}
      />
    </div>
  );
}
