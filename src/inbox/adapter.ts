import { ApplicationError } from "../models/application-error";
import { incomingInquirySchema, type InquiryAdapter } from "../models/inbox";

/** Explicit authenticated import, not a live provider or anonymous webhook. */
export const normalizedInquiryAdapter: InquiryAdapter = {
  async normalize(_context, input) {
    const parsed = incomingInquirySchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
    return parsed.data;
  },
};
