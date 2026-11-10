import type { PolicySection } from "@/components/policy-document";
import { sellerDetails } from "./seller";

export const termsSections: PolicySection[] = [
  {
    id: "agreement",
    title: "Using Lead Relay",
    paragraphs: [
      `These terms govern your use of Lead Relay at leadrelay.nmtsolutions.in, operated by ${sellerDetails.legalName}, India. Registered address: ${sellerDetails.address}. CIN: ${sellerDetails.cin}. GSTIN: ${sellerDetails.gstin}. By using the service, you agree to these terms. If you use Lead Relay for a business, you confirm that you are authorized to act for that business.`,
      "You must be at least 18 years old and provide accurate account and business information. Our privacy policy explains how we handle personal information. A separate signed agreement or accepted order can set additional commercial terms for your subscription.",
    ],
  },
  {
    id: "accounts",
    title: "Accounts and team access",
    paragraphs: [
      "Use an email address you control. Protect sign-in links, authenticator codes, recovery codes, and connected service credentials. Do not share a personal sign-in session with another user.",
      "Business owners and admins are responsible for the people they invite, the roles they assign, and the information made available to those team members. Tell us promptly if you suspect unauthorized access. We may require additional security verification before sensitive actions.",
    ],
  },
  {
    id: "service",
    title: "What the service does",
    paragraphs: [
      "Lead Relay supports prospect research, sales conversations, business knowledge, AI-assisted drafting, and authorized follow-up or booking workflows. Available features depend on your subscription, configuration, supported providers, permissions, and current service readiness.",
      "A prospect is a possible buyer, not a guaranteed lead, permission to contact, or a promised sale. Public contact information and buying signals may be incomplete or outdated. A prepared email is not evidence that a message was sent, accepted, delivered, or read.",
      "Some work runs in the background. A request can be queued, interrupted, or uncertain after a provider timeout. Review the saved action history before retrying a message, payment, booking, or other action that could be repeated.",
    ],
  },
  {
    id: "permissions",
    title: "Approvals and connected services",
    paragraphs: [
      "Connect only services and business identities that you are authorized to control. Select the mailbox or calendar access you intend to grant. Connecting a mailbox does not by itself authorize importing all past mail, sending outreach, or making commercial commitments.",
      "You remain responsible for the recipients you select, the messages and sequences you approve, your sales approval limits, and any execution you start. Follow-ups must respect opt-outs, replies, human takeover, and the stop conditions shown in the service.",
      "Connected providers have their own terms, charges, availability, and account rules. You are responsible for charges billed directly to you by those providers. Removing a connection in Lead Relay may not remove consent in every provider account or cancel a separate provider subscription.",
    ],
  },
  {
    id: "ai",
    title: "AI-generated research and drafts",
    paragraphs: [
      "AI can make mistakes, omit facts, or produce unsuitable content. Review generated research, contact matches, answers, and messages before relying on them. Check source evidence and factual claims, and confirm any prices, delivery promises, quotations, or other commitments.",
      "AI output does not grant permission to send, spend, book, quote, discount, or accept an order. You decide which available actions to approve. Use of AI may require relevant inputs to be processed by the configured AI provider as described in the privacy policy.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    paragraphs: [
      "Use Lead Relay lawfully and respect the rights of the people whose information you process. You must have a lawful basis and any required consent or other permission for your data and communications. Public availability is not a substitute for permission.",
    ],
    bullets: [
      "Do not send spam, deceptive messages, threats, unlawful content, or messages that ignore a recipient's opt-out.",
      "Do not impersonate another person or business, fabricate consent, or upload information you do not have the right to use.",
      "Do not bypass access controls, business boundaries, approval requirements, usage limits, source restrictions, or provider safeguards.",
      "Do not upload malware, attempt unauthorized access, disrupt the service, or use it to collect data in a way that violates law or source terms.",
      "Do not use the service to make unlawful discriminatory decisions or to process unnecessary sensitive information or children's information.",
    ],
  },
  {
    id: "your-content",
    title: "Your information and content",
    paragraphs: [
      "You retain your rights in the information and content you submit, subject to the rights of other people and source providers. You give us the permission needed to host, process, transmit, and display that content to provide the service and perform your authorized actions.",
      "You are responsible for the accuracy, legality, and necessary permissions for your content. NMT Solutions retains its rights in Lead Relay's software, branding, and service materials. These terms do not give you ownership of the application or permission to misuse its branding.",
    ],
  },
  {
    id: "fees",
    title: "Fees, renewals, and cancellation",
    paragraphs: [
      "Your accepted quote, order, or checkout sets the fees, billing currency, taxes, service period, usage allowances, paid pilot terms, and any renewal arrangement. Do not assume that creating a business or connecting a service includes a free trial or unlimited usage.",
      "Recurring charges require the applicable payment authorization. Review the amount and renewal terms before confirming. A failed payment or expired authorization can limit paid access.",
      "Cancellation takes effect under the terms accepted for your subscription and the confirmed cancellation status. An offboarding request, disconnected mailbox, or removed user is not a confirmed subscription cancellation. Refunds and credits follow the applicable accepted terms and mandatory law. These terms do not create an automatic refund promise or remove rights that the law gives you.",
    ],
  },
  {
    id: "availability",
    title: "Availability and service limits",
    paragraphs: [
      "We work to keep Lead Relay available, but do not promise uninterrupted service, a particular response time, a minimum number of prospects, or a sales result unless we expressly agree to it in writing.",
      "Maintenance, security controls, provider failures, account restrictions, and changes to third-party services can affect features. We may change or retire features and will provide notice where required by law or an applicable agreement. Subject to mandatory law and express written commitments, the service is provided as available without a guarantee that all output will be accurate or suitable for your purpose.",
    ],
  },
  {
    id: "suspension",
    title: "Suspension, ending access, and data",
    paragraphs: [
      "We may restrict or suspend access when reasonably needed to address a security threat, suspected misuse, unlawful activity, unpaid charges, or a material breach of these terms. Where lawful and practical, we will explain the issue and give you a way to address it.",
      "You can request business export and offboarding through the available application controls or by contacting us. Export, deletion, connection revocation, and subscription cancellation are separate actions. Some records must remain for legal, financial, security, or action-reconciliation purposes as explained in the privacy policy.",
    ],
  },
  {
    id: "responsibility",
    title: "Responsibility and disputes",
    paragraphs: [
      "You are responsible for your business decisions and the actions your team authorizes. We are responsible for our service obligations under the agreement and applicable law. Nothing in these terms excludes liability or a right that cannot lawfully be excluded.",
      "If a dispute arises, contact wafa.khan@nmtsolutions.in with the business name and relevant details so we can try to resolve it. Indian law governs these terms, subject to mandatory rights and laws that apply in your location. Disputes may be brought before a court that has jurisdiction under applicable law.",
      "If part of these terms is unenforceable, the remaining terms continue to apply. A delay in enforcing a term does not waive the right to enforce it later.",
    ],
  },
  {
    id: "changes",
    title: "Changes and contact",
    paragraphs: [
      "We may update these terms as the service changes. We will post the updated version here and provide additional notice when law or an applicable agreement requires it. Continued use after changes take effect is subject to the updated terms, except where a further agreement is legally required.",
      `For service, billing or legal questions, contact ${sellerDetails.legalName} at ${sellerDetails.supportEmail} or ${sellerDetails.phone}. Our designated grievance officer is ${sellerDetails.grievanceOfficer}, Director, reachable at the same contact details.`,
    ],
  },
];
