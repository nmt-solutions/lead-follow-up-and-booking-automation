import { ApplicationError } from "../models/application-error";
import type { AssociateInquiry, AssociationChange } from "../models/inbox";

type AssociationState = {
  buyerId: string;
  defaultOpportunityId: string | null;
  version: number;
};
type MessageLink = { id: string; opportunityId: string | null };

/** Pure correction policy, evaluated against the repository's locked current state. */
export function planInquiryAssociation(
  state: AssociationState,
  links: MessageLink[],
  input: AssociateInquiry,
  opportunityId: string | null,
  actorId: string,
) {
  if (input.discoveryObservationId && !opportunityId)
    throw new ApplicationError("INVALID_INPUT");
  if (state.version !== input.expectedVersion)
    throw new ApplicationError("CONFLICT");
  const selected = input.allMessages
    ? links
    : links.filter((link) => input.messageIds.includes(link.id));
  if (
    !selected.length ||
    (!input.allMessages && selected.length !== input.messageIds.length)
  )
    throw new ApplicationError("NOT_FOUND");
  if (
    input.buyerId !== state.buyerId &&
    (selected.length !== links.length || input.future === "keep")
  )
    throw new ApplicationError("INVALID_INPUT");
  const defaultOpportunityId =
    input.future === "keep"
      ? state.defaultOpportunityId
      : input.future === "target"
        ? opportunityId
        : null;
  const selectedIds = selected.map((link) => link.id);
  const unresolved = links.some((link) =>
    selectedIds.includes(link.id) ? !opportunityId : !link.opportunityId,
  );
  const before: AssociationChange = {
    buyerId: state.buyerId,
    defaultOpportunityId: state.defaultOpportunityId,
    messages: selected.map((link) => ({
      id: link.id,
      opportunityId: link.opportunityId,
    })),
  };
  const after: AssociationChange = {
    buyerId: input.buyerId,
    defaultOpportunityId,
    messages: selected.map((link) => ({ id: link.id, opportunityId })),
  };
  return {
    selectedIds,
    before,
    after,
    state: {
      buyerId: input.buyerId,
      defaultOpportunityId,
      version: state.version + 1,
      reviewReason: unresolved
        ? "Messages need a purchasing-need association"
        : null,
      reviewOwnerId: actorId,
      nextAction: unresolved
        ? "Review unassociated messages and choose or create a purchasing need"
        : defaultOpportunityId
          ? "Review incoming inquiry"
          : "Review new messages without a matching reply reference",
    },
  };
}

export function purchasingNeedDefaults() {
  return {
    stage: "inquiry",
    ownerId: null,
    handoffReason:
      "Human review required; association grants no action authority",
    nextAction: "Review purchasing need",
  } as const;
}
