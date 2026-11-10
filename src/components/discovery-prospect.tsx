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
    <li className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
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
      <p className="text-sm text-muted-foreground">
        First evidenced {new Date(prospect.firstCheckedAt).toLocaleString()}
        {" · "}Last source check{" "}
        {new Date(prospect.lastCheckedAt).toLocaleString()}
        {" · "}
        {prospect.history.length} retained observations
      </p>
      {prospect.reviewReasons.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
          <p className="font-medium">Evidence needs review</p>
          <ul className="flex flex-col list-disc gap-2 pl-5">
            {prospect.reviewReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {prospect.company && (
        <p className="text-sm wrap-anywhere">
          Company identity evidence: “{prospect.company.quote}”
        </p>
      )}
      {prospect.request && prospect.requestState && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-4 text-sm">
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
          {prospect.request.reference && (
            <p className="wrap-anywhere">
              Request identity evidence: “{prospect.request.reference.quote}”
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
        <div className="flex flex-col mt-4 gap-4 text-sm">
          {prospect.evidence.map((evidence) => (
            <div key={JSON.stringify(evidence)} className="flex flex-col gap-2">
              <blockquote className="border-l-2 border-border pl-3 wrap-anywhere">
                “{evidence.quote}”
              </blockquote>
              <SourceLink url={evidence.url} />
              <p className="text-muted-foreground">
                Source checked {new Date(evidence.checkedAt).toLocaleString()}
              </p>
              {evidence.retrieval && (
                <p className="text-muted-foreground wrap-anywhere">
                  Source: Exa {evidence.retrieval.contentType} ·{" "}
                  {evidence.retrieval.contentSource ??
                    "fetch origin unreported"}
                  .
                  {evidence.retrieval.publishedAt && (
                    <>
                      {" "}
                      Provider publication date:{" "}
                      {new Date(
                        evidence.retrieval.publishedAt,
                      ).toLocaleString()}
                      .
                    </>
                  )}{" "}
                  A publication date does not establish a current buying
                  request.
                </p>
              )}
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
              <div
                key={index}
                className="flex flex-col gap-2 rounded-lg bg-muted p-4"
              >
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
      <details className="rounded-lg border border-border p-4">
        <summary className="min-h-11 cursor-pointer font-medium">
          Source history and refresh outcomes ({prospect.history.length})
        </summary>
        <div className="flex flex-col mt-4 gap-4 text-sm">
          <p className="text-muted-foreground">
            Historical roles and request statuses are observations from their
            check dates. They do not establish current purchasing responsibility
            or open demand.
          </p>
          {prospect.history.map((observation) => (
            <div
              key={observation.id}
              className="flex flex-col gap-2 rounded-lg bg-muted p-4"
            >
              <p className="font-medium">
                {observation.current
                  ? "Latest source observation"
                  : "Historical observation"}
                {" · "}
                {
                  {
                    created: "New prospect",
                    refreshed: "Existing prospect refreshed",
                    duplicate: "Duplicate consolidated",
                    legacy: "Earlier saved result",
                  }[observation.outcome]
                }
              </p>
              <p>Checked {new Date(observation.checkedAt).toLocaleString()}</p>
              <p className="wrap-anywhere">Run: {observation.runId}</p>
              <p className="wrap-anywhere">
                Fit: {observation.data.matchReason}
              </p>
              <p className="wrap-anywhere">
                Uncertainty: {observation.data.uncertainty}
              </p>
              {observation.data.company && (
                <p className="wrap-anywhere">
                  Company: “{observation.data.company.quote}”
                </p>
              )}
              {observation.data.evidence.map((evidence, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <blockquote className="border-l-2 border-border pl-3 wrap-anywhere">
                    “{evidence.quote}”
                  </blockquote>
                  <SourceLink url={evidence.url} />
                </div>
              ))}
              {observation.data.request ? (
                <div className="flex flex-col gap-2">
                  <p className="wrap-anywhere">
                    Request: “{observation.data.request.quote}”
                  </p>
                  <p>
                    Observed status: {observation.data.request.status};
                    published{" "}
                    {observation.data.request.publishedAt ?? "date unverified"}
                  </p>
                  {observation.data.request.dateQuote && (
                    <p className="wrap-anywhere">
                      Date evidence: “{observation.data.request.dateQuote}”
                    </p>
                  )}
                  {observation.data.request.statusQuote && (
                    <p className="wrap-anywhere">
                      Status evidence: “{observation.data.request.statusQuote}”
                    </p>
                  )}
                  {observation.data.request.expiryQuote && (
                    <p className="wrap-anywhere">
                      Expiry evidence: “{observation.data.request.expiryQuote}”
                    </p>
                  )}
                  {observation.data.request.reference && (
                    <p className="wrap-anywhere">
                      Request identity evidence: “
                      {observation.data.request.reference.quote}”
                    </p>
                  )}
                </div>
              ) : (
                <p>
                  No explicit buying request established in this observation.
                </p>
              )}
              {observation.data.contacts.map((contact, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 border-t border-border pt-3"
                >
                  <p className="wrap-anywhere">
                    Published contact: {contact.name ?? "Name unverified"}
                  </p>
                  {contact.nameQuote && (
                    <p className="wrap-anywhere">
                      Name evidence: “{contact.nameQuote}”
                    </p>
                  )}
                  <p className="wrap-anywhere">
                    {contact.roleEvidence
                      ? `Observed responsibility: “${contact.roleEvidence.quote}”`
                      : "Purchasing responsibility unverified"}
                  </p>
                  {contact.route && (
                    <p className="wrap-anywhere">
                      Route evidence: “{contact.route.quote}”
                    </p>
                  )}
                  <SourceLink url={contact.url} />
                  <p>Checked {new Date(contact.checkedAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <p className="font-medium">Successful source checks</p>
            <p className="text-muted-foreground">
              A check can retain no matching need. Earlier evidence stays in
              history and cannot establish that need as current.
            </p>
            <ul className="flex flex-col gap-3">
              {prospect.sourceChecks.map((check, index) => (
                <li key={index}>
                  <SourceLink url={check.url} />
                  <p>
                    Checked {new Date(check.checkedAt).toLocaleString()} · Run{" "}
                    {check.runId}
                  </p>
                </li>
              ))}
            </ul>
          </div>
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
