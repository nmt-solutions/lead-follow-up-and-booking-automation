import { z } from "zod";
import { ApplicationError } from "../models/application-error";

export type OAuthProvider =
  "gmail" | "microsoft" | "google-calendar" | "microsoft-calendar";
const contextSchema = z.object({
  businessId: z.uuid(),
  mailboxId: z.uuid().optional(),
  onboarding: z.boolean().optional(),
});
const stateSchema = z.string().regex(/^[a-f0-9]{64}$/);
export function oauthCallbackPath(provider: OAuthProvider) {
  return `/api/connections/${provider}/callback`;
}
/** Context only; the database's single-use state still verifies actor, session and generation. */
export function setOAuthContext(
  response: Response,
  authorizationUrl: string,
  provider: OAuthProvider,
  context: z.infer<typeof contextSchema>,
) {
  const url = new URL(authorizationUrl);
  const state = stateSchema.parse(url.searchParams.get("state"));
  const redirect = new URL(
    url.searchParams.get("redirect_uri") ?? "",
    url.origin,
  );
  if (redirect.pathname !== oauthCallbackPath(provider)) return response;
  const value = Buffer.from(
    JSON.stringify(contextSchema.parse(context)),
  ).toString("base64url");
  response.headers.append(
    "Set-Cookie",
    `lr_${provider}_${state}=${value}; Path=${oauthCallbackPath(provider)}; HttpOnly; SameSite=Lax; Max-Age=600${redirect.protocol === "https:" ? "; Secure" : ""}`,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export function readOAuthContext(request: Request, provider: OAuthProvider) {
  const params = new URL(request.url).searchParams;
  if (params.getAll("state").length !== 1)
    throw new ApplicationError("INVALID_INPUT");
  const state = stateSchema.safeParse(params.get("state"));
  if (!state.success) throw new ApplicationError("INVALID_INPUT");
  const name = `lr_${provider}_${state.data}`;
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  try {
    if (!value || value.length > 512) throw new Error();
    return {
      ...contextSchema.parse(
        JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
      ),
      cookieName: name,
    };
  } catch {
    throw new ApplicationError("INVALID_INPUT");
  }
}
export function clearOAuthContext(
  response: Response,
  provider: OAuthProvider,
  cookieName: string,
  origin: string,
) {
  response.headers.append(
    "Set-Cookie",
    `${cookieName}=; Path=${oauthCallbackPath(provider)}; HttpOnly; SameSite=Lax; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
  );
  return response;
}
