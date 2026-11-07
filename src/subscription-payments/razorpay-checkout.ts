import { ApplicationError } from "../models/application-error";

/** Documented subscription links only; a link never establishes a paid period. */
export function subscriptionCheckoutUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  }
  if (
    url.origin !== "https://rzp.io" ||
    !/^\/(?:i|rzp)\/[A-Za-z0-9]+$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  return url.href;
}
