import type { CallRevision, CallWorkspace } from "@/models/calls";

function Timestamp({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString("en-GB", { timeZone: "UTC" })} UTC
    </time>
  );
}
function Entry({ call }: { call: CallRevision }) {
  return (
    <div className="space-y-2 wrap-anywhere">
      <p className="font-medium">Outcome: {call.outcome}</p>
      <p className="text-sm">
        Occurred: <Timestamp value={call.occurredAt} />
      </p>
      <p className="whitespace-pre-wrap leading-relaxed" dir="auto">
        {call.notes}
      </p>
      <p>
        Responsible person: {call.responsibleName}{" "}
        <span className="text-sm text-muted-foreground">
          ({call.responsibleId})
        </span>
      </p>
      <p className="whitespace-pre-wrap font-medium">
        Next action: {call.nextAction}
      </p>
      <p className="text-sm text-muted-foreground">
        Revision {call.version} saved by {call.actorName} ({call.actorId}) ·{" "}
        <Timestamp value={call.at} />
      </p>
    </div>
  );
}
/** Plain React text keeps correspondence inert, including earlier revisions. */
export function CallTimeline({ state }: { state: CallWorkspace }) {
  return (
    <section
      className="space-y-4"
      aria-label={`Human call timeline for ${state.opportunityTitle}`}
    >
      <p className="text-sm text-muted-foreground">
        {state.callCount} human {state.callCount === 1 ? "call" : "calls"}{" "}
        logged
      </p>
      {state.calls.length ? (
        <ol className="space-y-5">
          {state.calls.map((call) => (
            <li key={call.id} className="space-y-3 rounded-xl border p-4">
              <Entry call={call} />
              <p className="text-sm text-muted-foreground">
                First recorded by {call.recordedByName} ({call.recordedBy}) ·{" "}
                <Timestamp value={call.recordedAt} />
              </p>
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-3 font-medium">
                  Call revision history
                </summary>
                <ol className="space-y-4">
                  {state.history
                    .filter((r) => r.id === call.id)
                    .map((r) => (
                      <li key={r.revisionId}>
                        <Entry call={r} />
                      </li>
                    ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">
          No human calls logged for this purchasing need. Log a call after the
          activity has taken place.
        </p>
      )}
    </section>
  );
}
