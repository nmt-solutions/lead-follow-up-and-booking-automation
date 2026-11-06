import type { MetaEvidenceView } from "@/models/whatsapp";
import { Badge } from "./ui/badge";

const labels = {
  missing: "Awaiting assisted review",
  approved: "Reviewed customer control and direct payment",
  expired: "Review expired",
  revoked: "Review revoked",
  stale: "Review does not cover the current connection",
};
export function WhatsAppEvidenceStatus({
  evidence,
}: {
  evidence: MetaEvidenceView;
}) {
  const latest = evidence.history.filter((e) => e.review).at(-1);
  return (
    <div className="space-y-4">
      <Badge>{labels[evidence.status]}</Badge>
      <p className="text-sm text-muted-foreground">
        {evidence.provenance === "assisted_review"
          ? "An authorized operator reviewed account-specific documents. Meta sign-in and provider observations are separate checks."
          : "Ask the onboarding operator for an assisted review of customer control and direct Meta billing for this exact account and number. A declaration or a working token cannot establish payment ownership."}
      </p>
      {latest?.review && (
        <p className="text-sm wrap-anywhere">
          Review {latest.id}, recorded {new Date(latest.at).toLocaleString()} by
          operator {latest.actorId}. Valid until{" "}
          {new Date(latest.review.validUntil).toLocaleString()} unless revoked
          or the connection changes.
        </p>
      )}
      {evidence.history.length > 0 && (
        <details className="rounded-lg border border-border p-4">
          <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Review history ({evidence.history.length})
          </summary>
          <ol className="mt-3 space-y-4 text-sm">
            {evidence.history.map((event) => (
              <li key={event.id} className="space-y-1 wrap-anywhere">
                <p className="font-medium">
                  {event.invalid
                    ? "Invalid record — review required"
                    : event.review
                      ? "Evidence review recorded"
                      : "Review revoked"}{" "}
                  · {new Date(event.at).toLocaleString()}
                </p>
                <p>
                  Record {event.id} · Operator {event.actorId}
                </p>
                {event.review && (
                  <>
                    <p>
                      Connection version {event.review.expectedVersion} ·
                      Portfolio {event.review.assets.portfolioId} · WhatsApp
                      account {event.review.assets.wabaId} · Number{" "}
                      {event.review.assets.phoneNumberId} (
                      {event.review.requestedNumber})
                    </p>
                    <p>
                      Control case: {event.review.controlEvidence.reference} ·
                      Payment case: {event.review.paymentEvidence.reference}
                    </p>
                    <p>
                      Control evidence observed{" "}
                      {new Date(
                        event.review.controlEvidence.observedAt,
                      ).toLocaleString()}
                      ; payment evidence observed{" "}
                      {new Date(
                        event.review.paymentEvidence.observedAt,
                      ).toLocaleString()}
                      .
                    </p>
                    <p>
                      Valid until{" "}
                      {new Date(event.review.validUntil).toLocaleString()}.
                    </p>
                  </>
                )}
                {event.revocation && (
                  <p>
                    Revoked review {event.revocation.reviewId}:{" "}
                    {event.revocation.reason.replaceAll("_", " ")}.
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
