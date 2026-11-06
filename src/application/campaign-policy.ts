import { isDeepStrictEqual } from "node:util";
import { ApplicationError } from "../models/application-error";
import type {
  CampaignRevision,
  CampaignSnapshot,
  SaveCampaign,
  DecideCampaign,
} from "../models/campaigns";

type Revision = Pick<
  CampaignRevision,
  "id" | "campaignId" | "version" | "snapshot" | "payloadHash" | "actorId"
> & { requestKey: string; fingerprint: string };
type Decision = {
  actorId: string;
  decision: "approved" | "rejected";
  note: string;
};
type Recipient = CampaignSnapshot["recipients"][number];

/** Application policy operates on authoritative transaction facts. Repositories load those facts and enforce the result under the shared Business lock. */
export function campaignSaveDisposition(
  actorId: string,
  input: SaveCampaign,
  all: Revision[],
  fingerprint: string,
) {
  const replay = all.find((r) => r.requestKey === input.requestKey);
  if (replay) {
    if (replay.actorId !== actorId || replay.fingerprint !== fingerprint)
      throw new ApplicationError("CONFLICT");
    return "replay";
  }
  const latest = all.filter((r) => r.campaignId === input.campaignId).at(-1);
  if ((latest?.version ?? 0) !== input.expectedVersion)
    throw new ApplicationError("CONFLICT");
  return "create";
}
export function selectCampaignRecipients(
  input: SaveCampaign,
  candidates: Recipient[],
) {
  const selected = input.recipients.map((s) => {
    const c = candidates.find(
      (c) => c.prospectId === s.prospectId && c.contactId === s.contactId,
    );
    if (!c) throw new ApplicationError("NOT_FOUND");
    if (c.evidenceKey !== s.evidenceKey) throw new ApplicationError("CONFLICT");
    return c;
  });
  if (new Set(selected.map((c) => c.address)).size !== selected.length)
    throw new ApplicationError("INVALID_INPUT");
  return selected;
}
export function requireCampaignOwner(role: string) {
  if (role !== "owner") throw new ApplicationError("FORBIDDEN");
}
export function campaignDecisionDisposition(
  actorId: string,
  input: DecideCampaign,
  r: Revision,
  seen: Decision | undefined,
  all: Revision[],
  actualHash: string,
) {
  if (r.payloadHash !== input.payloadHash || actualHash !== r.payloadHash)
    throw new ApplicationError("CONFLICT");
  if (seen) {
    if (
      seen.actorId !== actorId ||
      seen.decision !== input.decision ||
      seen.note !== input.note
    )
      throw new ApplicationError("CONFLICT");
    return "replay";
  }
  if (all.some((p) => p.campaignId === r.campaignId && p.version > r.version))
    throw new ApplicationError("CONFLICT");
  return "create";
}
export function campaignEvidenceCurrent(
  snapshot: CampaignSnapshot,
  candidates: Recipient[],
) {
  return snapshot.recipients.every((s) =>
    candidates.some(
      (c) =>
        c.prospectId === s.prospectId &&
        c.contactId === s.contactId &&
        c.evidenceKey === s.evidenceKey,
    ),
  );
}
export function campaignSenderUnchanged(
  snapshot: CampaignSnapshot,
  sender:
    { version: number; configuration: CampaignSnapshot["sender"] } | undefined,
  binding: CampaignSnapshot["senderContext"]["binding"] | null,
) {
  return Boolean(
    sender &&
    sender.version === snapshot.senderVersion &&
    isDeepStrictEqual(sender.configuration, snapshot.sender) &&
    isDeepStrictEqual(binding, snapshot.senderContext.binding),
  );
}
export function requireCampaignApprovalContext(
  snapshot: CampaignSnapshot,
  candidates: Recipient[],
  policyVersion: number,
  senderUnchanged: boolean,
) {
  if (
    policyVersion !== snapshot.authorityVersion ||
    !campaignEvidenceCurrent(snapshot, candidates) ||
    !senderUnchanged
  )
    throw new ApplicationError("CONFLICT");
}
export function campaignAuthorityCheck(
  approved: boolean,
  authorized: boolean,
  policyVersion: number,
  reviewedPolicyVersion: number,
) {
  if (policyVersion !== reviewedPolicyVersion)
    return {
      status: "blocked" as const,
      reason:
        "Commercial authority changed. Review a new campaign version; campaign approval grants no commercial authority.",
    };
  if (!approved)
    return {
      status: "unknown" as const,
      reason:
        "No approving actor is bound to this plan. Current Owners may review it; commercial commitments remain subject to separate policy.",
    };
  return authorized
    ? {
        status: "allowed" as const,
        reason:
          "The approving Owner remains authorized. Commercial commitments remain subject to separate policy.",
      }
    : {
        status: "blocked" as const,
        reason:
          "The recorded approving Owner or authorizing session is no longer authorized.",
      };
}
