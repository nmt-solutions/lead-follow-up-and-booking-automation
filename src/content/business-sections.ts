import {
  Bell,
  BookOpen,
  Bot,
  Building2,
  ChartNoAxesCombined,
  CircleHelp,
  CreditCard,
  FileCheck2,
  Files,
  FileText,
  Globe2,
  History,
  MailCheck,
  MessageCircle,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

export const businessSections = {
  discovery: {
    title: "Find prospects",
    description:
      "Search for potential customers for your product. Review each match and its sources before choosing who to contact.",
    icon: Search,
    group: "Sales",
  },
  campaigns: {
    title: "Email campaigns",
    description:
      "Choose prospects, write your messages and review who will receive them. Sending starts only after the required approvals and checks.",
    icon: Send,
    group: "Sales",
  },
  reports: {
    title: "Results",
    description:
      "See what your searches and follow-ups produced during a selected period.",
    icon: ChartNoAxesCombined,
    group: "Sales",
  },
  ai: {
    title: "AI assistant",
    description:
      "Test how the assistant reads an inquiry or drafts a reply. A preview does not send a message.",
    icon: Bot,
    group: "Sales",
  },
  configuration: {
    title: "Search setup",
    description:
      "Tell Lead Relay what you sell, who buys it and where to search. New prospect searches use these details.",
    icon: SlidersHorizontal,
    group: "Business",
  },
  profile: {
    title: "Business details",
    description: "Update your business name, website and contact details.",
    icon: Building2,
    group: "Business",
  },
  knowledge: {
    title: "Answers and sales info",
    description:
      "Give the assistant approved product details, answers and questions to ask interested leads.",
    icon: BookOpen,
    group: "Business",
  },
  files: {
    title: "Documents",
    description:
      "Store product brochures and other business documents. Uploading a file does not approve its contents for the assistant.",
    icon: Files,
    group: "Business",
  },
  team: {
    title: "Team members",
    description:
      "Invite teammates and choose what each person can access in this business.",
    icon: Users,
    group: "Business",
    manage: true,
  },
  notifications: {
    title: "Notifications",
    description:
      "Choose where to receive updates about this business and who should receive them.",
    icon: Bell,
    group: "Business",
  },
  whatsapp: {
    title: "WhatsApp",
    description:
      "Connect a business-owned WhatsApp number to receive and manage customer messages.",
    icon: MessageCircle,
    group: "Connections",
    manage: true,
  },
  senders: {
    title: "Sending addresses",
    description:
      "Check which email addresses can send messages and where replies will arrive. Connecting an email account sets up the usual sales address.",
    icon: Send,
    group: "Email and approvals",
  },
  "email-eligibility": {
    title: "Contact permissions",
    description:
      "Record why you may email a contact and respect their opt-outs. Finding a public email address does not give permission to contact it.",
    icon: ShieldCheck,
    group: "Email and approvals",
  },
  "sender-health": {
    title: "Email delivery",
    description:
      "Check delivery problems and complaints so you can fix an affected sending address.",
    icon: MailCheck,
    group: "Email and approvals",
    manage: true,
  },
  "commercial-authority": {
    title: "Sales approval rules",
    description:
      "Decide when your team must approve prices, discounts, quotes or orders before the assistant can communicate them.",
    icon: FileCheck2,
    group: "Email and approvals",
    manage: true,
  },
  plan: {
    title: "Plan and usage",
    description:
      "Check your subscription, remaining credits and renewal. You can also stop future renewals here.",
    icon: Wallet,
    group: "Billing",
    manage: true,
  },
  billing: {
    title: "Billing details",
    description:
      "Save the legal name, billing address and tax details to use for your subscription invoices.",
    icon: CreditCard,
    group: "Billing",
    manage: true,
  },
  "seller-documents": {
    title: "Invoices",
    description: "Download invoices and credit notes for confirmed payments.",
    icon: FileText,
    group: "Billing",
    manage: true,
  },
  "subscription-payments": {
    title: "Payment history",
    description:
      "Check payment confirmation, paid periods and checkout records. Manage your subscription on Plan and usage.",
    icon: CreditCard,
    group: "Billing",
    manage: true,
  },
  "subscription-quotes": {
    title: "Plan quotes",
    description:
      "Review a saved quote or prepare a quote for a different plan. A quote does not charge you or change your subscription.",
    icon: FileText,
    group: "Billing",
    manage: true,
  },
  "reach-changes": {
    title: "Search areas",
    description:
      "Review the markets included in your subscription and the price of a proposed coverage change.",
    icon: Globe2,
    group: "Billing",
    manage: true,
  },
  "financial-adjustments": {
    title: "Refunds and disputes",
    description:
      "Follow the status of refunds, payment disputes and related credit notes. Contact support to request help with a charge.",
    icon: Wallet,
    group: "Billing",
    manage: true,
  },
  tax: {
    title: "Tax details",
    description:
      "Review the billing details used to calculate tax and check previous tax calculations.",
    icon: FileText,
    group: "Billing",
    manage: true,
  },
  pilots: {
    title: "Paid pilot projects",
    description:
      "Manage a separately agreed paid pilot and its results. For a monthly subscription, use Plan and usage.",
    icon: CircleHelp,
    group: "Billing",
    manage: true,
  },
  operations: {
    title: "Activity and fixes",
    description:
      "See work that needs attention, check its status and take the available next action.",
    icon: History,
    group: "Privacy and support",
  },
  data: {
    title: "Export or remove data",
    description:
      "Export this business's records or stop its connected services. Review what each action keeps or removes before confirming.",
    icon: Trash2,
    group: "Privacy and support",
  },
  settings: {
    title: "Business settings",
    description: "Choose what you want to set up or manage for this business.",
    icon: Settings2,
    group: "Business",
  },
} as const;

export type BusinessSection = keyof typeof businessSections;
