"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { z } from "zod";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  mailboxWorkspaceSchema,
  type MailboxWorkspace,
} from "@/models/mailboxes";
import type { GmailView } from "@/models/gmail";
import type { MicrosoftMailView } from "@/models/microsoft-mail";
import { isPendingEmailAccount } from "@/models/email-setup";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ProviderMark } from "./provider-mark";
import { EmailConnection } from "./email-connection";
import { Skeleton } from "./ui/skeleton";

const Advanced = dynamic(
  () => import("./mailbox-advanced").then((module) => module.MailboxAdvanced),
  { loading: () => <Skeleton className="h-36 w-full" /> },
);
export function MailboxManager({
  businessId,
  initialState,
  gmailConnections = {},
  microsoftConnections = {},
  availableProviders,
}: {
  businessId: string;
  initialState: MailboxWorkspace;
  gmailConnections?: Record<string, GmailView>;
  microsoftConnections?: Record<string, MicrosoftMailView>;
  availableProviders: { gmail: boolean; microsoft: boolean };
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/businesses/${businessId}/mailboxes`;
  const incomplete = state.mailboxes.some(
    (mailbox) =>
      isPendingEmailAccount(mailbox.account) &&
      (gmailConnections[mailbox.id]?.reason ||
        microsoftConnections[mailbox.id]?.reason),
  );
  const accounts = state.mailboxes.filter(
    (mailbox) => !isPendingEmailAccount(mailbox.account),
  );
  async function refresh() {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) throw new Error();
    const result = z
      .object({ data: mailboxWorkspaceSchema })
      .parse(await response.json());
    setState(result.data);
  }
  async function connect(provider: "gmail" | "microsoft") {
    if (pending) return;
    setPending(provider);
    setError("");
    setRecovery("");
    try {
      const response = await fetch(`${base}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ code: z.string() }).safeParse(raw);
        const code = failure.success ? failure.data.code : "";
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : "",
        );
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your account security to connect an email."
            : code === "UNAUTHENTICATED"
              ? "Sign in again to connect your email."
              : code === "CHANNEL_SETUP_REQUIRED"
                ? "This connection isn't available yet. Contact us for help."
                : "We couldn't start the connection. Please try again.",
        );
        return;
      }
      const result = z
        .object({ data: z.object({ authorizationUrl: z.url() }) })
        .parse(raw);
      const url = new URL(result.data.authorizationUrl);
      if (
        url.origin !==
          (provider === "gmail"
            ? "https://accounts.google.com"
            : "https://login.microsoftonline.com") ||
        url.pathname !==
          (provider === "gmail"
            ? "/o/oauth2/v2/auth"
            : "/common/oauth2/v2.0/authorize")
      )
        throw new Error();
      window.location.assign(url.toString());
    } catch {
      setError("The connection couldn't start. Please try again.");
    } finally {
      setPending("");
    }
  }
  async function sync(mailboxId: string) {
    if (pending) return;
    setPending(mailboxId);
    setError("");
    setRecovery("");
    setNotice("");
    try {
      const response = await fetch(`${base}/${mailboxId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "incremental" }),
      });
      if (!response.ok) {
        const failure = z
          .object({ code: z.string() })
          .safeParse(await response.json());
        const code = failure.success ? failure.data.code : "";
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : "",
        );
        throw new Error();
      }
      await refresh();
      setNotice(
        "Email check requested. Its latest status appears on your account.",
      );
    } catch {
      setError(
        "We couldn't check for new email. Check your connection and try again.",
      );
    } finally {
      setPending("");
    }
  }
  return (
    <div className="flex flex-col gap-8">
      {incomplete && (
        <Alert>
          <AlertDescription>
            The connection wasn&apos;t completed. Choose your provider below to
            try again.
          </AlertDescription>
        </Alert>
      )}
      {accounts.length > 0 && (
        <section
          className="flex flex-col gap-5"
          aria-labelledby="connected-email"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="connected-email" className="text-xl font-medium">
              Your email accounts
            </h2>
            <Button variant="outline" asChild>
              <Link href={`/businesses/${businessId}/inbox`}>
                Open conversations
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {accounts.map((mailbox) => {
            const job = mailbox.jobs[0];
            const view =
              mailbox.provider === "gmail"
                ? gmailConnections[mailbox.id]
                : microsoftConnections[mailbox.id];
            const accessApproved = view?.status === "connected";
            const attention =
              job?.reason === "worker_required" ||
              job?.reason === "setup_required";
            return (
              <Card key={mailbox.id}>
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
                      <ProviderMark provider={mailbox.provider} />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="break-all">
                        {mailbox.account}
                      </CardTitle>
                      <CardDescription>
                        {mailbox.provider === "gmail"
                          ? "Gmail / Google Workspace"
                          : "Outlook / Microsoft 365"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {state.canManage ? (
                    <EmailConnection
                      provider={mailbox.provider}
                      businessId={businessId}
                      mailboxId={mailbox.id}
                      initialState={view}
                      enabled={
                        mailbox.configuration.enabled &&
                        (mailbox.configuration.requestedRead ||
                          mailbox.configuration.requestedSend)
                      }
                      onChanged={refresh}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Your business owner manages this connection.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="text-xs leading-6 text-muted-foreground">
                      {attention
                        ? "Email access is saved. Contact support to finish enabling synchronization."
                        : mailbox.visibility === "current"
                          ? "Sales email is up to date."
                          : accessApproved
                            ? "Email access is saved. Follow-ups stay paused until sales email is up to date."
                            : "Finish connecting this account to receive sales conversations."}
                      {mailbox.lastSyncedAt &&
                        ` Last checked ${new Date(mailbox.lastSyncedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC.`}
                    </p>
                    {state.canManage && accessApproved && (
                      <Button
                        variant="ghost"
                        disabled={Boolean(pending)}
                        onClick={() => void sync(mailbox.id)}
                      >
                        {pending === mailbox.id ? (
                          <Loader2
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <RefreshCw aria-hidden="true" />
                        )}
                        Check for new mail
                      </Button>
                    )}
                  </div>
                  {mailbox.pendingIncomingReplies +
                    mailbox.pendingManualReplies >
                    0 && (
                    <p className="text-sm text-warning">
                      Some messages need review. Open Advanced email settings
                      below to resolve them.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
      {state.canManage && (
        <section
          aria-labelledby="connect-email"
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Mail aria-hidden="true" />
            </div>
            <h2
              id="connect-email"
              className="font-display text-3xl font-medium tracking-[-0.045em] sm:text-4xl"
            >
              {accounts.length
                ? "Connect another email."
                : "Connect your work email."}
            </h2>
            <p className="max-w-xl text-sm leading-7 text-muted-foreground">
              Choose your provider and approve access on its page. Replies to
              messages sent through Lead Relay appear in Conversations. You can
              add other received inquiries there.
            </p>
          </div>
          <ol
            className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground"
            aria-label="Email connection steps"
          >
            {["Choose provider", "Approve access", "Return connected"].map(
              (step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full border border-border bg-card font-mono text-primary">
                    {i + 1}
                  </span>
                  {step}
                  {i < 2 && (
                    <ChevronRight className="ml-2 size-3" aria-hidden="true" />
                  )}
                </li>
              ),
            )}
          </ol>
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                {
                  id: "gmail",
                  name: "Google",
                  label: "Gmail & Google Workspace",
                },
                {
                  id: "microsoft",
                  name: "Microsoft",
                  label: "Outlook & Microsoft 365",
                },
              ] as const
            ).map((provider) => (
              <Card key={provider.id}>
                <CardHeader className="gap-4">
                  <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card">
                    <ProviderMark provider={provider.id} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <CardTitle>{provider.name}</CardTitle>
                    <CardDescription>{provider.label}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full justify-between"
                    disabled={
                      Boolean(pending) || !availableProviders[provider.id]
                    }
                    onClick={() => void connect(provider.id)}
                  >
                    {pending === provider.id
                      ? "Opening consent..."
                      : availableProviders[provider.id]
                        ? `Connect ${provider.name}`
                        : "Not available yet"}
                    {pending === provider.id ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    )}
                  </Button>
                  {!availableProviders[provider.id] && (
                    <a
                      href="mailto:wafa.khan@nmtsolutions.in"
                      className="mt-3 inline-flex min-h-11 items-center text-xs text-primary underline"
                    >
                      Contact us to enable this connection
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-5">
            <ShieldCheck
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                You&apos;re in control of the access.
              </p>
              <p className="text-sm leading-7 text-muted-foreground">
                Lead Relay requests permission to read new email and send
                messages you approve. Importing older email is optional and
                stays off until you choose it. You can disconnect at any time.
              </p>
              <Link
                href="/privacy-policy"
                className="w-fit text-xs text-primary underline underline-offset-4"
              >
                How we handle your email
              </Link>
            </div>
          </div>
        </section>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {recovery && (
              <Link
                href={recovery}
                target="_blank"
                rel="noreferrer"
                className="ml-2 underline"
              >
                {recovery === "/security" ? "Open account security" : "Sign in"}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-5 pt-6">
          <div className="flex items-center gap-4">
            <CalendarDays className="size-5 text-primary" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium">Taking appointments?</h2>
              <p className="text-sm text-muted-foreground">
                Connect a calendar for availability and bookings.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href={`/businesses/${businessId}/calendar`}>
              Connect calendar
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
      <Button asChild variant="ghost" className="w-fit">
        <Link href={`/businesses/${businessId}`}>
          Continue to your business
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </Button>
      {state.canManage && accounts.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="advanced">
            <AccordionTrigger>Advanced email settings</AccordionTrigger>
            <AccordionContent>
              <p className="mb-6 text-sm leading-7 text-muted-foreground">
                Change which email is processed, import older messages, or
                review synchronization issues.
              </p>
              <Advanced
                businessId={businessId}
                initialState={{
                  ...state,
                  mailboxes: accounts,
                  connections: state.connections.filter(
                    (c) => !isPendingEmailAccount(c.account),
                  ),
                }}
                gmailConnections={gmailConnections}
                microsoftConnections={microsoftConnections}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      {!state.canManage && !accounts.length && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <Mail className="size-6 text-primary" aria-hidden="true" />
            <CardTitle>No email connected yet</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ask your business owner to connect Google or Microsoft.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
