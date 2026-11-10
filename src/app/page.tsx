import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  FileSearch,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { LandingDemo } from "@/components/landing-demo";
import { Button } from "@/components/ui/button";
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
import { ProviderMark } from "@/components/provider-mark";

export const metadata: Metadata = {
  title: "Lead Relay — Find prospects. Keep conversations moving.",
  description:
    "Find potential buyers, prepare outreach with AI, and manage sales conversations with Lead Relay by NMT Solutions. Connect Google or Microsoft and get started.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://leadrelay.nmtsolutions.in" },
};
const features = [
  {
    icon: FileSearch,
    title: "Start with relevant prospects",
    description:
      "Tell Lead Relay what you sell and who you serve. Search your chosen markets and review the public evidence behind each potential buyer.",
  },
  {
    icon: Mail,
    title: "Spend less time on the first draft",
    description:
      "Prepare outreach using your approved business information. Review the recipients, message, and timing before your team starts a campaign.",
  },
  {
    icon: MessageSquareText,
    title: "Keep sales conversations together",
    description:
      "Bring supported inquiries and replies into one place. See what needs attention and take over when a buyer needs a personal response.",
  },
];
const steps = [
  {
    title: "Tell us about your business",
    description:
      "Add what you sell, who buys from you, and where you work. Your address becomes the default search area.",
  },
  {
    title: "Connect the tools you use",
    description:
      "Choose Google or Microsoft and approve email access on their page. Add a calendar when you want to handle bookings.",
  },
  {
    title: "Find buyers and review your outreach",
    description:
      "Run a prospect search, check the sources, and prepare a campaign. Your approved rules guide the next sales action.",
  },
];
const questions = [
  {
    title: "Who is Lead Relay for?",
    answer:
      "Businesses that want to find potential buyers and organize sales follow-up. Your offering, customer types, and search area guide the research, so the setup works across industries.",
  },
  {
    title: "Can I use my Gmail or Outlook account?",
    answer:
      "Lead Relay supports approved Google and Microsoft email connections, including Gmail, Google Workspace, Outlook, and supported Microsoft 365 accounts. Choose your provider and approve the requested access on its page. Your account or administrator may have additional restrictions.",
  },
  {
    title: "Does AI send messages without my approval?",
    answer:
      "An AI draft does not authorize a message. You review campaign recipients, content, timing, and limits before approving the required actions. Supported automation follows your approved rules, and you can take over a conversation.",
  },
  {
    title: "Does it import all my old email?",
    answer:
      "No. Historical email import stays off until you explicitly choose a date range and message limit. You can change processing settings or disconnect your account later.",
  },
  {
    title: "How does pricing work?",
    answer:
      "Your quote sets the plan, included search areas, usage limits, and any paid pilot terms. Contact NMT Solutions for a quote. Creating an account does not promise a free trial or unlimited usage.",
  },
];
export default function HomePage() {
  return (
    <PublicShell marketing>
      <section className="page-container grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-24">
        <div className="flex flex-col gap-7">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Sparkles className="size-4" aria-hidden="true" />
            AI-assisted sales, by NMT Solutions
          </div>
          <h1 className="max-w-2xl font-brand text-[clamp(2.8rem,5.2vw,4.8rem)] leading-[1.04] font-[550] tracking-[-0.055em]">
            Find your next buyer.
            <br />
            <span className="brand-gradient-text">
              Keep the conversation going.
            </span>
          </h1>
          <p className="max-w-lg text-base leading-8 text-muted-foreground">
            Find potential customers, prepare your outreach, and follow up with
            your team. Lead Relay brings the next sales step into one place.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button asChild size="lg">
              <Link href="/sign-in">
                Get started
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <a href="#how-it-works">
                See how it works
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Check className="size-4 text-primary" aria-hidden="true" />
              Your business, your approvals
            </span>
            <span className="flex items-center gap-2">
              <Check className="size-4 text-primary" aria-hidden="true" />
              Google & Microsoft connections
            </span>
          </div>
        </div>
        <LandingDemo />
      </section>
      <section
        id="product"
        className="page-container scroll-mt-28 pb-16 sm:pb-24"
      >
        <div className="mb-9 flex max-w-2xl flex-col gap-4">
          <p className="text-xs font-medium text-primary">
            From first search to next step
          </p>
          <h2 className="text-3xl leading-tight font-medium tracking-[-0.045em] sm:text-4xl">
            Less scattered work.
            <br />
            More time for the right conversations.
          </h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Research, outreach, and replies belong in the same sales workflow.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader className="gap-5">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <feature.icon className="size-5" aria-hidden="true" />
                </span>
                <CardTitle className="text-xl leading-7">
                  {feature.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="leading-7">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section
        id="how-it-works"
        className="page-container scroll-mt-28 pb-16 sm:pb-24"
      >
        <div className="glass-panel grid gap-10 rounded-[28px] p-6 sm:p-10 lg:grid-cols-[.8fr_1fr] lg:gap-20">
          <div className="flex flex-col gap-5">
            <p className="text-xs font-medium text-primary">
              A clear place to begin
            </p>
            <h2 className="text-3xl leading-tight font-medium tracking-[-0.045em] sm:text-4xl">
              Your business.
              <br />
              Your email.
              <br />
              Your next customer.
            </h2>
            <p className="max-w-sm text-sm leading-7 text-muted-foreground">
              A guided setup asks for the details that help your team find
              relevant buyers.
            </p>
            <Link
              href="/getting-started"
              className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-primary"
            >
              Read the getting-started guide
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <ol className="flex flex-col gap-8">
            {steps.map((step, index) => (
              <li className="flex gap-5" key={step.title}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/5 font-display text-sm text-primary">
                  {index + 1}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-medium tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="page-container grid gap-10 pb-16 sm:pb-24 lg:grid-cols-2 lg:items-center">
        <div className="flex flex-col gap-5">
          <p className="text-xs font-medium text-primary">
            Keep the tools you know
          </p>
          <h2 className="text-3xl leading-tight font-medium tracking-[-0.045em] sm:text-4xl">
            Connect once.
            <br />
            Get back to your customers.
          </h2>
          <p className="max-w-lg text-sm leading-7 text-muted-foreground">
            Choose Google or Microsoft, then approve access on its own consent
            page. Lead Relay handles the connection details and shows you what
            is ready.
          </p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            You can disconnect at any time.
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              provider: "google",
              name: "Google",
              detail: "Gmail, Workspace & Calendar",
            },
            {
              provider: "microsoft",
              name: "Microsoft",
              detail: "Outlook, Microsoft 365 & Calendar",
            },
          ].map((provider) => (
            <Card key={provider.provider}>
              <CardContent className="flex flex-col gap-5 pt-6">
                <ProviderMark
                  provider={
                    provider.provider === "google" ? "google" : "microsoft"
                  }
                  className="size-8"
                />
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-medium">{provider.name}</h3>
                  <p className="text-xs leading-6 text-muted-foreground">
                    {provider.detail}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex items-start gap-3 px-1 text-xs leading-6 text-muted-foreground sm:col-span-2">
            <CalendarDays
              className="mt-1 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            Email and calendar access are separate. Connect only what your team
            needs.
          </div>
        </div>
      </section>
      <section className="page-container grid gap-9 pb-16 sm:pb-24 lg:grid-cols-[.7fr_1fr]">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-medium text-primary">Before you start</p>
          <h2 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">
            A few useful answers.
          </h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Need help deciding whether Lead Relay fits your business?{" "}
            <a
              href="mailto:wafa.khan@nmtsolutions.in"
              className="text-primary underline underline-offset-4"
            >
              Talk to NMT Solutions.
            </a>
          </p>
        </div>
        <Accordion type="single" collapsible>
          {questions.map((question, index) => (
            <AccordionItem value={`question-${index}`} key={question.title}>
              <AccordionTrigger>{question.title}</AccordionTrigger>
              <AccordionContent className="text-sm leading-7 text-muted-foreground">
                {question.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
      <section className="page-container pb-16">
        <div className="glass-panel flex flex-wrap items-center justify-between gap-8 rounded-[28px] p-7 sm:p-12">
          <div className="flex max-w-2xl flex-col gap-4">
            <h2 className="text-3xl leading-tight font-medium tracking-[-0.045em] sm:text-4xl">
              Give your next sales conversation
              <br className="hidden sm:block" /> a place to start.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Set up your business and see how Lead Relay fits your sales
              process.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/sign-in">
              Get started
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </PublicShell>
  );
}
