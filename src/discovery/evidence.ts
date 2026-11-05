import {
  contactCandidateSchema,
  type ContactEvidence,
  type DiscoveryProspect,
  type ProspectView,
  type RunView,
} from "../models/discovery";

// A published employee/title or an AI assertion alone is not purchasing proof.
// Accept a narrow, explicit source declaration tied to the named person.
const titles = {
  owner: ["owner", "co-owner", "business owner", "founder and owner"],
  purchasing: [
    "head of procurement",
    "procurement head",
    "procurement manager",
    "purchasing manager",
    "purchase lead",
    "purchasing lead",
    "buyer",
    "responsible for purchasing",
    "responsible for supplier selection",
  ],
};
export function completeSourceStatement(excerpt: string, quote: string) {
  const statement = quote.replace(/\.$/, "");
  let position = excerpt.indexOf(statement);
  while (position !== -1) {
    if (
      /(?:^|[.!?;\n]\s*)$/.test(excerpt.slice(0, position)) &&
      /^(?:$|[.!?;](?:\s|$)|\r?\n)/.test(
        excerpt.slice(position + statement.length),
      )
    )
      return true;
    position = excerpt.indexOf(statement, position + 1);
  }
  return false;
}

function completeRouteValue(excerpt: string, quote: string, value: string) {
  const valuePosition = quote.indexOf(value);
  if (valuePosition === -1) return false;
  let position = excerpt.indexOf(quote);
  while (position !== -1) {
    const before = excerpt.slice(0, position + valuePosition);
    const after = excerpt.slice(position + valuePosition + value.length);
    if (
      /(?:^|[\s<(:“"'])$/.test(before) &&
      /^(?:$|[\s>,;!?)”"']|\.(?:\s|$))/.test(after)
    )
      return true;
    position = excerpt.indexOf(quote, position + 1);
  }
  return false;
}
export function verifiedContacts(
  candidates: unknown[],
  excerpt: string,
  url: string,
  at: Date,
): ContactEvidence[] {
  return candidates.flatMap((candidate) => {
    const parsed = contactCandidateSchema.safeParse(candidate);
    if (!parsed.success) return [];
    const contact = parsed.data;
    const name =
      contact.name &&
      contact.nameQuote &&
      excerpt.includes(contact.nameQuote) &&
      contact.nameQuote.includes(contact.name)
        ? contact.name
        : null;
    const roleQuote = contact.roleEvidence?.quote;
    const normalizedRole = roleQuote?.toLowerCase().replace(/\.$/, "");
    const roleEvidence =
      name &&
      contact.roleEvidence &&
      roleQuote &&
      completeSourceStatement(excerpt, roleQuote) &&
      titles[contact.roleEvidence.role].some((title) =>
        [
          `${name.toLowerCase()}: ${title}`,
          `${name.toLowerCase()} — ${title}`,
          `${name.toLowerCase()} is ${title}`,
          `${name.toLowerCase()} is the ${title}`,
        ].includes(normalizedRole ?? ""),
      )
        ? contact.roleEvidence
        : null;
    const route =
      contact.route &&
      completeRouteValue(excerpt, contact.route.quote, contact.route.value)
        ? contact.route
        : null;
    if (!name && !route) return [];
    return [
      {
        name,
        nameQuote: name ? contact.nameQuote : null,
        roleEvidence,
        route,
        url,
        checkedAt: at.toISOString(),
      },
    ];
  });
}

export function contactClassification(
  contact: ContactEvidence,
): ProspectView["contactStatus"] {
  if (!contact.route) return "missing";
  return contact.roleEvidence &&
    contact.name &&
    [
      `${contact.name}: ${contact.route.value}`,
      `${contact.name} — ${contact.route.value}`,
    ].includes(contact.route.quote)
    ? "buyer_contact"
    : "general_business_contact";
}

export function prospectView(
  prospect: DiscoveryProspect,
  at: Date,
): DiscoveryProspect & Pick<ProspectView, "contactStatus" | "requestState"> {
  const request = prospect.request;
  const requestState = !request
    ? null
    : request.status === "expired" ||
        (request.expiresAt && new Date(request.expiresAt) <= at)
      ? "expired"
      : !request.publishedAt
        ? "undated"
        : request.status === "open"
          ? "open"
          : "uncertain";
  const contacts = prospect.contacts ?? [];
  const contactStatus = contacts.some(
    (c) => contactClassification(c) === "buyer_contact",
  )
    ? "buyer_contact"
    : contacts.some((c) => c.route)
      ? "general_business_contact"
      : "missing";
  return { ...prospect, contacts, contactStatus, requestState };
}

export function coverageCounts(prospects: ProspectView[]): RunView["counts"] {
  const openBuyingRequests = prospects.filter(
    (p) => p.requestState === "open",
  ).length;
  return {
    evidenceBacked: prospects.length,
    potentialBuyers: prospects.length - openBuyingRequests,
    openBuyingRequests,
    contactable: prospects.filter((p) => p.contactStatus !== "missing").length,
    namedBuyers: prospects.filter((p) =>
      p.contacts.some((c) => c.name && c.roleEvidence),
    ).length,
  };
}
