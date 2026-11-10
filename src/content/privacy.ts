import type { PolicySection } from "@/components/policy-document";
import { sellerDetails } from "./seller";

export const privacySections: PolicySection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    paragraphs: [
      `Lead Relay is a prospect discovery and sales follow-up service operated by ${sellerDetails.legalName}, India. Our registered address is ${sellerDetails.address}. CIN: ${sellerDetails.cin}. This policy covers leadrelay.nmtsolutions.in and the Lead Relay service. It explains how we handle information about business users, team members, prospects, and people who contact our customers.`,
      "For privacy questions or requests, email wafa.khan@nmtsolutions.in. Include the business name and enough information for us to find the relevant record. Do not email passwords, authenticator codes, payment credentials, or private access tokens.",
      `Our designated grievance officer is ${sellerDetails.grievanceOfficer}, Director. Contact ${sellerDetails.grievanceEmail} or ${sellerDetails.phone}. We acknowledge grievances within 48 hours and aim to resolve them within one month.`,
    ],
  },
  {
    id: "information",
    title: "Information we collect",
    paragraphs: [
      "We collect the information needed to provide the features you use. Some information comes from you, some comes from connected services you authorize, and some comes from public sources used for prospect searches.",
    ],
    bullets: [
      "Account and security information, including your first and last name, email, Company or Personal account choice, company name where provided, password hash, team role, session records, authenticator enrollment, and security events.",
      "Business information, including your name, website, products or services, address, search areas, customer types, and approved business knowledge.",
      "Sales information, including prospect details, public source links, contact details, messages, drafts, inquiries, notes, call records, appointments, and approvals.",
      "Connected service information, including the account identity, granted permissions, selected mailboxes or calendars, synchronization records, and credentials needed to maintain an authorized connection.",
      "Billing information, including legal business details, invoice contacts, tax identifiers, supporting documents, subscription records, invoices, and payment references.",
      "Technical and support information, including request identifiers, operational events, error diagnostics, and information you send when asking for help.",
    ],
  },
  {
    id: "use",
    title: "How we use information",
    paragraphs: [
      "We use information to sign you in, protect your account, separate business records, find relevant prospects, manage sales conversations, prepare drafts, perform actions you authorize, provide support, and administer subscriptions and billing.",
      "We also use security and operational records to prevent misuse, investigate failures, reconcile uncertain actions, and meet legal obligations. Adding a public contact to Lead Relay does not establish permission to send that person a message.",
    ],
  },
  {
    id: "connections",
    title: "Email, calendars, and WhatsApp",
    paragraphs: [
      "You choose whether to connect a supported Google, Microsoft, or WhatsApp business account. We access the data and permissions needed for the functions you authorize. Mailbox processing follows the sales mailboxes, folders, or conversations selected for the connection. Importing historical correspondence requires a separate selection of its time range and limits.",
      "Calendar access supports availability checks and approved booking actions. WhatsApp access supports the connected business identity and authorized conversation functions. We store the connection records and credentials needed to provide these functions.",
      "You can disable or disconnect a connection in Lead Relay. You can also remove access in the provider's account settings. Disconnecting stops future use of that connection, but it does not automatically erase records already saved or remove every form of provider consent. Microsoft consent and some provider account changes may require action in the provider's own dashboard.",
      "We use Google account data to provide the user-facing features you request. We do not use Google account data for advertising, sell it to data brokers, or use it to train general-purpose AI models. Our use and transfer of information received from Google APIs must follow the Google API Services User Data Policy, including its Limited Use requirements.",
    ],
  },
  {
    id: "ai",
    title: "AI processing",
    paragraphs: [
      "Lead Relay uses AI for supported research review and sales drafting. When you use an AI feature, relevant inputs can include your business offering, approved answers, public source information, and the message or sample being processed. The enabled workflow sends those inputs to its configured AI provider, directly or through the configured AI gateway.",
      "The current application supports approved OpenAI models and a Vercel AI Gateway route. Feature availability depends on the business's approved configuration. Providers process requests under the terms that apply to the service and account used.",
      "AI output can contain mistakes. Review contact details, source evidence, prices, promises, and proposed messages before approving an action. A generated draft or a model's recommendation does not itself authorize sending, booking, spending, or accepting an order.",
    ],
  },
  {
    id: "sharing",
    title: "Who receives information",
    paragraphs: [
      "Authorized members of your business can access records according to their role. Our service providers process information needed to operate the service, such as hosting, databases, private file storage, email delivery, background jobs, search, AI processing, connected communication services, and payments.",
      "Depending on the features enabled, these services can include Google, Microsoft, Meta, OpenAI, Vercel AI Gateway, Exa, Cloudflare R2, Resend, Trigger.dev, and Razorpay. A provider may be unavailable or unused for your business. Contact us for information about the providers involved in a particular workflow.",
      "Payment providers collect the payment credentials needed for checkout or payment authorization. Lead Relay keeps the billing and payment references needed to manage your subscription. Do not upload full payment card details or banking passwords to business files or sales messages.",
      "We may disclose information when lawfully required, to investigate fraud or abuse, or to protect the service and the people using it. We do not sell your connected mailbox contents or customer conversation records.",
    ],
  },
  {
    id: "storage",
    title: "Storage, security, and retention",
    paragraphs: [
      "We use business-scoped access controls, role checks, protected connections, and security verification for sensitive actions. These controls reduce risk, but no service can guarantee that every security incident will be prevented.",
      "Our providers may process information outside your country. The location and safeguards depend on the provider and enabled service. We do not promise that all data remains in India.",
      "We keep records for the period needed to provide the service, maintain security and action history, resolve disputes, and meet legal or contractual duties. The applicable feature and retention policy determine the period. Financial documents, supporting evidence, legal holds, and records of accepted or uncertain actions may need to remain after a connection is disabled or a subscription ends.",
      "Deletion requests can require identity checks, review of retention obligations, and separate action for connected providers. Removal from active systems does not necessarily remove every backup immediately. We will explain material restrictions that apply to your request.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies and browser storage",
    paragraphs: [
      "Lead Relay uses cookies for sessions and security. The sidebar and setup flow also remember navigation preferences. Some forms use browser session storage to preserve a draft after an interrupted request. These functions are needed for account access, navigation, or form recovery.",
      "Blocking cookies can prevent sign-in or protected actions from working. You can clear browser storage through your browser settings. Clearing a local draft does not delete records already saved to the service.",
    ],
  },
  {
    id: "choices",
    title: "Your choices and privacy requests",
    paragraphs: [
      "You can update business information, manage team access, change notification preferences, and disable supported connections in the application. Owners and admins can use Export or remove data to review available business export and offboarding options. Some operations depend on configured policies and may require operator assistance.",
      "To ask about access, correction, deletion, consent withdrawal, or a privacy complaint, contact wafa.khan@nmtsolutions.in. We may ask for information to verify your identity and authority. The rights and restrictions that apply depend on your location and the law in force.",
      "If you are a prospect or a customer of a business using Lead Relay, contact that business about its messages and use of your information. You can also contact us with the relevant source link or message details so we can identify the record and help route your request.",
      "Lead Relay is intended for adults acting for businesses. Do not submit children's personal information or sensitive personal information that is not needed for the sales task.",
    ],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    paragraphs: [
      "We will update this page when our practices change and show the new update date. Where a change requires notice or a new permission, we will provide the notice or request the permission before using the affected data in that new way.",
    ],
  },
];
