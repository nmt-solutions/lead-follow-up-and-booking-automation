import type { ProspectView } from "@/models/discovery";
import { contactClassification } from "@/discovery/evidence";
import { Badge } from "./ui/badge";

const contactLabels = {
  buyer_contact: "Buyer contact",
  general_business_contact: "General business contact",
  missing: "Missing contact",
};
const requestLabels = {
  open: "Open buying request",
  expired: "Expired request",
  undated: "Undated request",
  uncertain: "Uncertain request status",
};

function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 wrap-anywhere"
    >
      {url}
    </a>
  );
}

export function DiscoveryProspectCard({
  prospect,
}: {
  prospect: ProspectView;
}) {
  return (
    <li className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="font-semibold wrap-anywhere">{prospect.name}</h5>
          <p className="mt-1 text-sm text-muted-foreground wrap-anywhere">
            {prospect.buyer.label} · {prospect.market}
          </p>
        </div>
        <Badge>{contactLabels[prospect.contactStatus]}</Badge>
      </div>
      <p className="wrap-anywhere">{prospect.matchReason}</p>
      <p className="text-sm text-muted-foreground wrap-anywhere">
        Uncertainty: {prospect.uncertainty}
      </p>
      {prospect.request && prospect.requestState && (
        <div className="space-y-2 rounded-lg bg-muted p-4 text-sm">
          <p className="font-medium">{requestLabels[prospect.requestState]}</p>
          <blockquote className="wrap-anywhere">
            “{prospect.request.quote}”
          </blockquote>
          <p>
            {prospect.request.publishedAt
              ? `Published ${prospect.request.publishedAt}`
              : "Publication date unverified"}
          </p>
          <p className="text-muted-foreground">
            Source observed{" "}
            {new Date(prospect.evidence[0].checkedAt).toLocaleString()}
          </p>
          {prospect.request.dateQuote && (
            <p className="wrap-anywhere">
              Date evidence: “{prospect.request.dateQuote}”
            </p>
          )}
          {prospect.request.statusQuote && (
            <p className="wrap-anywhere">
              Source status evidence: “{prospect.request.statusQuote}”
            </p>
          )}
          {prospect.request.expiresAt && (
            <p>
              Source expiry:{" "}
              {new Date(prospect.request.expiresAt).toLocaleString()}
            </p>
          )}
          {prospect.request.expiryQuote && (
            <p className="wrap-anywhere">
              Expiry evidence: “{prospect.request.expiryQuote}”
            </p>
          )}
          <p className="text-muted-foreground">
            Status uses the source observation below and any evidenced expiry.
            Refresh reloads saved evidence; it does not recheck the source.
          </p>
        </div>
      )}
      <details className="rounded-lg border border-border p-4">
        <summary className="min-h-11 cursor-pointer font-medium">
          Fit evidence and public contacts
        </summary>
        <div className="mt-4 space-y-4 text-sm">
          {prospect.evidence.map((evidence) => (
            <div key={evidence.url} className="space-y-2">
              <blockquote className="border-l-2 border-border pl-3 wrap-anywhere">
                “{evidence.quote}”
              </blockquote>
              <SourceLink url={evidence.url} />
              <p className="text-muted-foreground">
                Source checked {new Date(evidence.checkedAt).toLocaleString()}
              </p>
            </div>
          ))}
          {prospect.contacts.length === 0 && (
            <p className="text-muted-foreground">
              No usable evidenced public contact retained. This match remains
              available for research.
            </p>
          )}
          {prospect.contacts.map((contact, index) => {
            const classification = contactClassification(contact);
            return (
              <div key={index} className="space-y-2 rounded-lg bg-muted p-4">
                <p className="font-medium">{contactLabels[classification]}</p>
                {contact.name && (
                  <p className="wrap-anywhere">
                    Published name: {contact.name}
                  </p>
                )}
                {contact.nameQuote && (
                  <p className="wrap-anywhere">
                    Name evidence: “{contact.nameQuote}”
                  </p>
                )}
                <p className="wrap-anywhere">
                  {contact.roleEvidence
                    ? `Purchasing responsibility evidence: “${contact.roleEvidence.quote}”`
                    : "Purchasing responsibility is unverified. A listed employee is not an established buyer."}
                </p>
                {contact.route ? (
                  <>
                    <p className="wrap-anywhere">
                      Public{" "}
                      {contact.route.kind === "contact_form"
                        ? "contact form"
                        : contact.route.kind}
                      : {contact.route.value}
                    </p>
                    <p className="wrap-anywhere">
                      Route evidence: “{contact.route.quote}”
                    </p>
                    {classification !== "buyer_contact" && (
                      <p className="text-muted-foreground">
                        This route has no verified connection to a named
                        purchasing decision maker.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    No usable public contact route established.
                  </p>
                )}
                <SourceLink url={contact.url} />
                <p className="text-muted-foreground">
                  Checked {new Date(contact.checkedAt).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </details>
      <p className="text-sm text-muted-foreground">
        Public evidence and contact availability establish no outreach
        permission, approval or direct engagement. This record remains a
        prospect.
      </p>
    </li>
  );
}
