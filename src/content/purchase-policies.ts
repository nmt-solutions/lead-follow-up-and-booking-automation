import type { PolicySection } from "@/components/policy-document";
export const cancellationSections: PolicySection[] = [
  {
    id: "cancel",
    title: "Cancel your subscription",
    paragraphs: [
      "Open your business, go to Plan & billing, select the subscription and choose Cancel subscription. Review and confirm the effective date. You do not need to call us or give a reason. Cancellation is available to authorized business owners and admins.",
      "Cancellation stops future renewals once the payment provider confirms it. Access continues through the confirmed paid period. Allowances expire at that period's end. Cancelling does not automatically refund an already paid period.",
    ],
  },
  {
    id: "pending",
    title: "If confirmation is pending",
    paragraphs: [
      "The billing screen distinguishes a saved cancellation request from provider-confirmed cancellation. If confirmation is pending, refresh the payment status or contact wafa.khan@nmtsolutions.in with your business name and subscription reference. Never send card details, passwords or authenticator codes.",
      "Your bank or payment provider may also provide mandate controls. If you revoke a mandate there, payment status must still be reconciled in Lead Relay. A cancelled subscription may require a new authorization to subscribe again.",
    ],
  },
  {
    id: "renewal",
    title: "Renewal and failed payments",
    paragraphs: [
      "Your checkout shows the exact initial charge, recurring amount, taxes and monthly billing terms before you authorize payment. Cancel before the next renewal to avoid another billing cycle. A charge already submitted may require reconciliation and a separate refund decision.",
      "Failed or unresolved payments can pause paid work. Any applicable grace period is shown in the billing screen and does not create a new allowance. You can still access billing, cancellation and support.",
    ],
  },
];
export const refundSections: PolicySection[] = [
  {
    id: "request",
    title: "Request a refund",
    paragraphs: [
      "Contact wafa.khan@nmtsolutions.in with your business name, payment reference, payment date and the reason for your request. We review duplicate charges, incorrect charges, unauthorized charges and material service failures. Do not send complete card or bank details.",
      "We aim to acknowledge requests within two business days. A refund is subject to verification of the captured payment and applicable law. This policy does not remove any mandatory consumer rights.",
    ],
  },
  {
    id: "eligibility",
    title: "Subscription charges",
    paragraphs: [
      "Monthly charges pay for access and the stated allowances during the billing period. Unused credits, a change of mind or cancellation partway through a period do not normally receive a prorated refund, unless applicable law, an accepted order or a confirmed service failure requires otherwise.",
      "We do not guarantee sales, meetings, a particular prospect count or message delivery. A lack of sales by itself does not establish a service failure. Report technical failures so we can investigate the saved work and usage records.",
    ],
  },
  {
    id: "processing",
    title: "How approved refunds are processed",
    paragraphs: [
      "Approved refunds return through the original payment route where supported. We initiate an approved refund within seven business days of the decision and provide its reference. Your bank or payment provider controls when the credit appears; contact us if it has not arrived within the stated provider timeframe.",
      "A refund is complete only after provider confirmation. Any required credit note is issued against the original invoice. Cancellation, mandate withdrawal and refund are separate actions; requesting one does not silently authorize another.",
    ],
  },
];
export const deliverySections: PolicySection[] = [
  {
    id: "digital",
    title: "Digital service delivery",
    paragraphs: [
      "Lead Relay is an online subscription service. There is no physical shipping. Create an account, protect it with an authenticator, create your business and complete the required plan and billing steps.",
      "Paid allowances become available after Razorpay confirms a captured payment for the correct subscription and billing period. A browser success message or mandate authorization alone does not establish payment. If verification is delayed, the billing screen shows a pending state and continues reconciliation.",
    ],
  },
  {
    id: "connections",
    title: "Connect the services you need",
    paragraphs: [
      "Email and calendar connections are optional during setup. Each provider explains the access requested on its consent page. You can connect later or revoke access. A subscription does not include third-party mailbox subscriptions, phone numbers or Meta/WhatsApp message charges.",
      "Features need the relevant provider connection, permissions and supported market configuration. Connecting a mailbox does not approve outreach. Review recipients, content and permissions before authorizing sending.",
    ],
  },
  {
    id: "help",
    title: "If access is delayed",
    paragraphs: [
      "Refresh Plan & billing to check payment status. If money was debited but access is still pending, email wafa.khan@nmtsolutions.in with the payment reference and business name. Avoid starting another payment until the first result is clear.",
      "Service availability depends on Lead Relay and its providers. Planned maintenance, outages, invalid connections or exhausted allowances can interrupt work. We show saved status and preserve recovery information where supported.",
    ],
  },
];
