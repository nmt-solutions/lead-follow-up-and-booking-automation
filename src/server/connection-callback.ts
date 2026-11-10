import { getServices } from "./services";
import {
  clearOAuthContext,
  readOAuthContext,
  type OAuthProvider,
} from "../http/oauth-context";
import { ApplicationError } from "../models/application-error";

export async function connectionCallback(
  request: Request,
  provider: OAuthProvider,
) {
  let context: ReturnType<typeof readOAuthContext>;
  try {
    context = readOAuthContext(request, provider);
  } catch {
    return Response.redirect(
      new URL("/businesses?connection=expired", request.url),
      303,
    );
  }
  const services = await getServices();
  let response: Response;
  if (provider === "gmail" || provider === "microsoft") {
    if (!context.mailboxId) throw new ApplicationError("INVALID_INPUT");
    response = await (
      provider === "gmail" ? services.gmailHttp : services.microsoftMailHttp
    ).callback(request, context.businessId, context.mailboxId);
  } else {
    response = await (
      provider === "google-calendar"
        ? services.googleCalendarHttp
        : services.microsoftCalendarHttp
    ).callback(request, context.businessId);
  }
  if (context.onboarding) {
    const failed =
      response.status !== 303 ||
      new URL(request.url).searchParams.has("error") ||
      response.headers.get("Location")?.includes("connection=failed");
    response = new Response(null, {
      status: 303,
      headers: {
        Location: new URL(
          `/onboarding/${context.businessId}?step=${provider === "gmail" || provider === "microsoft" ? "email" : "calendar"}${failed ? "&connection=failed" : ""}`,
          request.url,
        ).toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } else if (!response.ok && response.status !== 303) {
    const destination = `/businesses/${context.businessId}/${provider === "gmail" || provider === "microsoft" ? "mailboxes" : "calendar"}?connection=failed`;
    response = new Response(null, {
      status: 303,
      headers: { Location: new URL(destination, request.url).toString() },
    });
  }
  return clearOAuthContext(
    response,
    provider,
    context.cookieName,
    new URL(request.url).origin,
  );
}
