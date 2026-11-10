import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CircleHelp,
  KeyRound,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = {
  alternates: { canonical: "/getting-started" },
  title: "Vendor getting-started guide",
  description:
    "Set up your business, find prospects, connect sales channels, and review AI-assisted outreach in Lead Relay.",
  robots: { index: true, follow: true },
};
const steps = [
  {
    id: "access",
    title: "Create your account",
    icon: KeyRound,
    description:
      "Create an account with your name, email, a password, and a Company or Personal account choice. Add a company name if applicable.",
    tasks: [
      "Verify your email using the link we send. Scan the authenticator QR code or enter the setup key manually. Enter its 6-digit code and save your recovery codes.",
      "Sign in with your password and authenticator, or choose Passwordless sign in to receive an email link. Use Forgot password to receive a link, verify your authenticator, and choose a new password.",
      "If you were invited, use the invited email and accept the invitation. Ask the business owner if the link has expired.",
    ],
    outcome:
      "You can open your businesses and see the business you own or joined.",
  },
  {
    id: "business",
    title: "Add your business once",
    icon: Building2,
    description:
      "Follow the full-screen setup: your business, your customers, your location, and review. Your company name is filled in from sign-up.",
    tasks: [
      "Describe what you sell in everyday language. Include the product or service a buyer would search for.",
      "Choose the customer types you serve. For individual consumers, discovery requires a public buying request.",
      "Enter your address. Lead Relay uses its city, state, and country as the default search area. Choose a different area if you serve another location or work remotely.",
      "Review the customer types and search area, then create your business. Your address remains available for setup and billing.",
    ],
    outcome:
      "Continue to optional email, calendar, and first-search steps. Skip any of them or choose Set up later. Open Finish setup from the business overview to return.",
  },
  {
    id: "knowledge",
    title: "Give the AI approved business information",
    icon: BookOpen,
    description:
      "Open Answers and sales info. Add products, common answers and questions for new leads, then choose who handles questions the assistant cannot answer.",
    tasks: [
      "Add accurate product or service information, qualification questions, and approved answers.",
      "Review and approve the relevant knowledge revision. Draft or outdated information may not be available to an AI workflow.",
      "Open Sales approval rules in Business settings to choose who may quote, discount, or make a commercial commitment. An AI draft does not grant those permissions.",
    ],
    outcome:
      "Your team and enabled AI workflows have approved information to work from.",
  },
  {
    id: "channels",
    title: "Connect only the channels you need",
    icon: Mail,
    description:
      "Connect Gmail or Outlook and your calendar during setup, or use Email accounts and Calendar in the sidebar later. Each connection is optional.",
    tasks: [
      "For email, choose Connect Gmail or Connect Outlook. Choose your account and approve access on the provider page. Lead Relay saves the connection using the email address confirmed by your provider.",
      "Your connection starts with new email. To import older messages or change the selection, open Advanced email settings. Choose the date range and message limit before importing.",
      "For bookings, connect Google Calendar or Microsoft Calendar, approve access, and choose your work calendar. You can change that calendar later.",
      "Check the connection status. A saved account name alone does not mean that reading, sending, or reply capture is ready.",
    ],
    outcome:
      "Each channel you intend to use has a clear connection and permission status.",
  },
  {
    id: "search",
    title: "Run your first prospect search",
    icon: Search,
    description:
      "Open Search setup to check your saved product, buyers and location. Then open Find prospects to review the search phrase, areas and credit limit.",
    tasks: [
      "Choose an available search area. The saved location does not automatically buy paid coverage or enable a search provider.",
      "Keep private customer details and confidential requirements out of the public search phrase.",
      "Approve the stated allowance and start the search. Refresh to see queued work, progress, and saved results. The sidebar shows used and remaining credits for this business, including work already started.",
      "Read the source links behind each match. A relevant business and a usable contact are different things. Neither proves permission to send.",
    ],
    outcome:
      "You can review saved prospects and the evidence behind them. If setup is blocked, the page names the missing requirement.",
  },
  {
    id: "outreach",
    title: "Review outreach before it runs",
    icon: Send,
    description:
      "Open Email campaigns to prepare a campaign for selected prospects and contacts.",
    tasks: [
      "Review the exact recipients, sending identity, reply route, message text, timing, and maximum attempts.",
      "Use AI drafts as a starting point. Check names, facts, prices, promises, and whether a recipient may lawfully receive the message.",
      "An owner must approve the fixed campaign version where required. Approval and starting an approved sequence are separate actions.",
      "Changing recipients or the message plan can require a new review. Do not retry an uncertain send until its saved outcome has been checked.",
    ],
    outcome:
      "The approved version records what your business authorized, with an explicit start action where supported.",
  },
  {
    id: "conversations",
    title: "Manage replies and next steps",
    icon: Users,
    description:
      "Open Conversations to read incoming inquiries and supported replies. Review what the buyer needs before responding.",
    tasks: [
      "Associate a message with the correct opportunity when the app asks for a review.",
      "Use human takeover when a person should manage the conversation. Automation stays paused until control is explicitly returned.",
      "Use approved booking or quotation actions only when the required permissions and connected services are ready.",
      "Open Results to review recorded outcomes. A sent message is not the same as a delivered message, an interested buyer, or a sale.",
    ],
    outcome:
      "Your team can see the conversation, its current owner, and the next approved action.",
  },
];
const questions = [
  [
    "Why can't I start a search?",
    "Check the setup requirements shown on Find prospects. Customer types and location must be confirmed. Paid access, search coverage, provider readiness, and an approved allowance may also be required. Ask your business owner or NMT Solutions about an operator-managed requirement.",
  ],
  [
    "Why is the AI assistant unavailable?",
    "AI workflows need a supported configuration, approved business knowledge, and any required profile review and activation. A connected inbox does not enable AI on its own. Ask an owner, admin, or service operator to review the status shown in AI assistant.",
  ],
  [
    "Why isn't an email appearing?",
    "Check the connected account, selected mailbox scope, read permission, and synchronization status. Past correspondence appears only when a separate historical import was authorized. Unsupported or unselected mail is not treated as a new inquiry.",
  ],
  [
    "Do I need to enter my address again?",
    "Your saved address is reused in business setup and can prefill billing. Check that the legal billing address is correct before saving. Use a separate search area only if you serve somewhere different.",
  ],
  [
    "Can I send to every contact Lead Relay finds?",
    "No. Public contact details do not establish permission. Review the recipient, applicable rules, sending identity, opt-outs, and the approval required for the campaign.",
  ],
  [
    "Does creating a business start a paid subscription?",
    "Creating a business saves its profile and setup. A paid pilot or subscription follows its own accepted quote, checkout, and payment authorization. Review the displayed commercial terms before paying.",
  ],
  [
    "How do I leave or export my information?",
    "Owners and admins can open Export or remove data in Business settings. Export, ending business access, removing provider permissions, and cancelling a subscription are separate steps. Follow the status shown for each action or contact NMT Solutions for help.",
  ],
];

export default function GettingStartedPage() {
  return (
    <PublicShell>
      <section className="border-b border-border bg-card">
        <div className="page-container grid items-center gap-8 py-12 sm:py-16 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-5">
            <Badge variant="primary">
              <BookOpen aria-hidden="true" className="size-3.5" />
              Vendor guide
            </Badge>
            <h1 className="max-w-2xl text-4xl leading-tight font-medium tracking-[-0.045em] sm:text-5xl">
              Your first day with Lead Relay.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              Set up your business, find relevant buyers, and manage the
              conversations that follow.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/businesses">
                  Open your businesses
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="#access">Read the steps</a>
              </Button>
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Before you start</CardTitle>
              <CardDescription>Have these details ready.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-4 text-sm">
                {[
                  "The email you use for your business",
                  "A short description of what you sell",
                  "Your customer types and service area",
                  "Access to any inbox or calendar you plan to connect",
                ].map((item) => (
                  <li className="flex items-start gap-3" key={item}>
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>
      <div className="page-container grid gap-10 py-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside>
          <nav
            aria-label="Guide steps"
            className="flex flex-col gap-1 lg:sticky lg:top-28"
          >
            <p className="mb-3 text-sm font-semibold">Getting started</p>
            {steps.map((step, index) => (
              <a
                key={step.id}
                href={`#${step.id}`}
                className="flex items-start gap-3 rounded-lg px-2 py-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                  {index + 1}
                </span>
                {step.title}
              </a>
            ))}
            <a
              href="#questions"
              className="mt-3 flex items-center gap-3 px-2 py-3 text-sm text-muted-foreground"
            >
              <CircleHelp className="size-5" aria-hidden="true" />
              Common questions
            </a>
          </nav>
        </aside>
        <article className="flex max-w-4xl flex-col gap-8">
          <Alert>
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>Use the right role</AlertTitle>
            <AlertDescription>
              Owners and admins complete business setup and manage protected
              settings. Salespeople work with the records and actions their role
              allows. Ask your business owner if a required control is
              unavailable.
            </AlertDescription>
          </Alert>
          {steps.map((step, index) => (
            <section
              id={step.id}
              key={step.id}
              className="scroll-mt-28 rounded-2xl border border-border bg-card p-6 sm:p-8"
            >
              <div className="mb-5 flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-medium tracking-[-0.045em]">
                    {step.title}
                  </h2>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
              <ul className="flex flex-col gap-4 pl-0 sm:pl-14">
                {step.tasks.map((task) => (
                  <li
                    key={task}
                    className="flex items-start gap-3 text-sm leading-7 text-muted-foreground"
                  >
                    <span
                      className="mt-3 size-1 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    {task}
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-border pt-4 text-sm leading-7">
                <Check
                  className="mr-2 inline size-4 text-success"
                  aria-hidden="true"
                />
                {step.outcome}
              </p>
            </section>
          ))}
          <section id="questions" className="scroll-mt-28">
            <h2 className="mb-5 text-2xl font-medium tracking-[-0.045em]">
              Common questions
            </h2>
            <Accordion
              type="multiple"
              className="rounded-2xl border border-border bg-card px-6"
            >
              {questions.map(([question, answer], index) => (
                <AccordionItem key={question} value={`question-${index}`}>
                  <AccordionTrigger>{question}</AccordionTrigger>
                  <AccordionContent className="text-sm leading-7 text-muted-foreground">
                    {answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Need help with your setup?</CardTitle>
              <CardDescription>
                Tell us your business name, the page you are on, and what is
                blocking you. Leave passwords and access codes out of the
                message.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <a href="mailto:wafa.khan@nmtsolutions.in?subject=Lead Relay%20setup%20help">
                  <Mail data-icon="inline-start" aria-hidden="true" />
                  Contact NMT Solutions
                </a>
              </Button>
            </CardContent>
          </Card>
        </article>
      </div>
    </PublicShell>
  );
}
