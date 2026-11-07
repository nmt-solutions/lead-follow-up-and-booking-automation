import {
  ApplicationError,
  type ApplicationErrorCode,
} from "./application-error";

const failures = {
  DATA_POLICY_REQUIRED: {
    status: 409,
    message:
      "Data access, source rights or retention policy needs operator review. Affected export or destruction remains blocked.",
  },
  EXPORT_LIMIT_REACHED: {
    status: 409,
    message:
      "This export exceeds the configured byte bound. Ask the operator to review a bounded export scope.",
  },
  SELLER_DOCUMENT_SETUP_REQUIRED: {
    status: 503,
    message:
      "Seller documents need an approved effective issuer configuration matching the original currency, rounding and required legal fields. Ask the document operator to review setup.",
  },
  PAID_ACCESS_REQUIRED: {
    status: 409,
    message:
      "Paid access or matching included units are unavailable. Review Subscription payments and allowances; stored work remains available.",
  },
  PRICING_SETUP_REQUIRED: {
    status: 409,
    message:
      "Review billing evidence and configure explicit currency prices and allowances before creating this quote. Refresh the subscription quote to see the missing setup.",
  },
  INVALID_PROVIDER_RESPONSE: {
    status: 502,
    message:
      "The connection check could not be validated. Refresh setup or ask an Admin to review the integration.",
  },
  CALENDAR_SETUP_REQUIRED: {
    status: 503,
    message:
      "Booking needs a configured calendar adapter and separate read/write calendar permission. Ask an Admin to review appointment setup. RFQ handling remains available.",
  },
  COMMERCIAL_SETUP_REQUIRED: {
    status: 503,
    message:
      "Commercial execution has no configured provider. Review the approved action and record authoritative Business evidence only after completing it externally.",
  },
  CHANNEL_SETUP_REQUIRED: {
    status: 503,
    message:
      "Channel delivery is not configured. The response remains unsent; ask an Admin to review channel setup or reply manually.",
  },
  AI_SETUP_REQUIRED: {
    status: 503,
    message:
      "AI needs approved model settings, reviewed Business context, operator API credentials, funding evidence and an explicit allowance. Ask the platform operator to review AI setup.",
  },
  AI_VALIDATION_REQUIRED: {
    status: 409,
    message:
      "Review successful representative extraction and drafting previews for this exact profile and current Business knowledge before activation.",
  },
  AI_ALLOWANCE_EXHAUSTED: {
    status: 409,
    message:
      "The approved AI attempt or fallback allowance is exhausted. Review usage before approving another profile.",
  },
  DISCOVERY_SETUP_REQUIRED: {
    status: 503,
    message:
      "Discovery needs configured active reach, coverage, authorized allowances, data permissions and an approved provider and worker. Contact the service operator.",
  },
  DISCOVERY_SCOPE_INVALID: {
    status: 400,
    message:
      "Select confirmed markets within active reach and supported coverage, and an allowance within the configured run limit.",
  },
  DISCOVERY_INTERRUPTED: {
    status: 409,
    message:
      "Discovery was interrupted. Completed work and reserved usage are preserved. Review the run before starting another.",
  },
  FILE_SETUP_REQUIRED: {
    status: 503,
    message:
      "Private files need storage, limits, retention and cleanup configuration. Contact the service operator.",
  },
  FILE_DISALLOWED: {
    status: 400,
    message:
      "This file does not match the configured file type or size rules. Choose a supported file.",
  },
  FILE_UNAVAILABLE: {
    status: 410,
    message:
      "This file or link is unavailable or expired. Refresh the file list and try again.",
  },
  INVALID_INPUT: {
    status: 400,
    message: "Check the request fields and try again.",
  },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue." },
  MFA_REQUIRED: {
    status: 403,
    message:
      "Verify your authenticator or recovery code in Security to continue.",
  },
  FORBIDDEN: { status: 403, message: "This action is not allowed." },
  NOT_FOUND: { status: 404, message: "Business not found." },
  CONFLICT: {
    status: 409,
    message: "This action is no longer available. Refresh and try again.",
  },
  INVITATION_UNAVAILABLE: {
    status: 410,
    message:
      "This invitation is unavailable. Sign in with the invited email or ask for a new invitation.",
  },
  PROVIDER_UNAVAILABLE: {
    status: 503,
    message: "This service is unavailable. Please try again shortly.",
  },
  SETUP_REQUIRED: {
    status: 503,
    message: "Sign-in is not available yet. Please try again later.",
  },
} satisfies Record<ApplicationErrorCode, { status: number; message: string }>;

export function publicFailure(error: unknown) {
  if (error instanceof ApplicationError)
    return { code: error.code, ...failures[error.code] };
  return {
    code: "INTERNAL_ERROR",
    status: 500,
    message: "Something went wrong. Please try again.",
  };
}

export function errorResponse(error: unknown, requestId: string) {
  const failure = publicFailure(error);
  return Response.json(
    { success: false, code: failure.code, message: failure.message, requestId },
    {
      status: failure.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function dataResponse<T>(data: T, status = 200) {
  return Response.json(
    { success: true, data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
