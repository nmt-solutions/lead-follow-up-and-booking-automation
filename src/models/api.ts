import {
  ApplicationError,
  type ApplicationErrorCode,
} from "./application-error";

const failures = {
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
