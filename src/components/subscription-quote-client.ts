"use client";
import { z } from "zod";

export async function readCommercialResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(
      "Unable to confirm the saved result. Refresh before retrying; your edits remain here.",
    );
  }
  if (!response.ok) {
    const result = z.object({ code: z.string() }).safeParse(json);
    const code = result.success ? result.data.code : "";
    throw new Error(
      code === "MFA_REQUIRED"
        ? "Verify in Security, then retry. Your edits remain here."
        : code === "UNAUTHENTICATED"
          ? "Sign in again in another tab, then retry to preserve your edits."
          : code === "CONFLICT"
            ? "The saved pricing or billing details changed. Refresh the saved state and review the current version before retrying. Your edits remain here."
            : code === "SETUP_REQUIRED"
              ? "The payment provider or selected currency is unavailable. Ask the operator to review checkout configuration. Saved records remain available."
              : code === "PRICING_SETUP_REQUIRED"
                ? "This quote needs reviewed billing details and explicit prices and allowances. Refresh and review the setup gaps."
                : code === "FORBIDDEN" || code === "NOT_FOUND"
                  ? "Your current access does not allow this action. Ask the Business Owner or platform operator."
                  : "Unable to complete the action. Check the fields and effective date, then retry.",
    );
  }
  const parsed = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(json);
  if (!parsed.success)
    throw new Error(
      "Unable to confirm the saved result. Refresh before retrying; your edits remain here.",
    );
  return parsed.data.data;
}
