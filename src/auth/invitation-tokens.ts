import { createHash, createHmac } from "node:crypto";
import type { InvitationTokens } from "../models/team";

// Recoverable for delivery retries, unguessable without the server secret. Only the hash is stored.
export function invitationTokens(secret: string): InvitationTokens {
  return {
    issue: (id) =>
      createHmac("sha256", secret)
        .update(`business-invitation:${id}`)
        .digest("hex"),
    hash: (token) => createHash("sha256").update(token).digest("hex"),
  };
}
