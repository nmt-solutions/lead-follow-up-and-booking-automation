import type { Clock } from "../../src/models/business";
import type {
  SequenceEnvelope,
  SequenceMailProvider,
  SequenceReceipt,
} from "../../src/models/email-sequences";

/** This fixture records actual transport effects. It deliberately offers no native send deduplication. */
export function deterministicSequenceMail(clock: Clock) {
  const effects: SequenceEnvelope[] = [];
  const accepted = new Map<string, SequenceReceipt>();
  const fixture = {
    effects,
    calls: 0,
    reconciliations: 0,
    beforeSend: async (_envelope: SequenceEnvelope): Promise<void> => {
      void _envelope;
    },
    afterAccept: async (_envelope: SequenceEnvelope): Promise<void> => {
      void _envelope;
    },
    outcome: "accepted" as
      "accepted" | "rate_limited" | "rejected" | "timeout" | "accepted_timeout",
    reconciliation: "authoritative" as
      "authoritative" | "unknown" | "not_accepted",
  };
  const provider: SequenceMailProvider = {
    key: "deterministic-mail-v1",
    mode: "fixture",
    async send(envelope, signal) {
      fixture.calls++;
      await fixture.beforeSend(envelope);
      signal.throwIfAborted();
      if (fixture.outcome === "timeout")
        throw new Error("private-provider-timeout");
      if (fixture.outcome === "rate_limited" || fixture.outcome === "rejected")
        return {
          status: "not_accepted",
          reason: fixture.outcome,
          retryAt:
            fixture.outcome === "rate_limited"
              ? new Date(clock.now().getTime() + 120000).toISOString()
              : null,
        };
      effects.push(envelope);
      const receipt: SequenceReceipt = {
        actionId: envelope.actionId,
        attemptId: envelope.attemptId,
        businessId: envelope.businessId,
        connectionId: envelope.connectionId,
        recipient: envelope.recipient,
        messageRef: `mail-${effects.length}`,
        internetMessageId: envelope.internetMessageId,
        threadRef: `thread-${envelope.opportunityId}`,
        acceptedAt: clock.now().toISOString(),
      };
      accepted.set(envelope.attemptId, receipt);
      await fixture.afterAccept(envelope);
      if (fixture.outcome === "accepted_timeout")
        throw new Error("private-accepted-timeout");
      return { status: "accepted", receipt };
    },
    async reconcile(envelope) {
      fixture.reconciliations++;
      if (fixture.reconciliation === "unknown") return { status: "unknown" };
      if (fixture.reconciliation === "not_accepted")
        return {
          status: "not_accepted",
          reason: "unavailable",
          retryAt: new Date(clock.now().getTime() + 120000).toISOString(),
        };
      const receipt = accepted.get(envelope.attemptId);
      return receipt ? { status: "accepted", receipt } : { status: "unknown" };
    },
  };
  return Object.assign(fixture, { provider });
}
