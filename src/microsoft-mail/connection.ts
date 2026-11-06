import type { Database } from "../db/runtime";
import type { Clock } from "../models/business";
import type { MicrosoftMailConfiguration } from "./configuration";
import { createMailboxAuthorizationRepository } from "../db/mailbox-authorization-repository";
import { createMicrosoftMailGrantService } from "../application/microsoft-mail-grants";
import { createMicrosoftMailHttp } from "./http";
import { calendarCredentialVault } from "../appointments/credentials";

export function createMicrosoftMailConnection(
  database: Database,
  options: {
    clock: Clock;
    configuration: MicrosoftMailConfiguration | null;
    fetch: typeof fetch;
  },
) {
  return createMicrosoftMailGrantService({
    repository: createMailboxAuthorizationRepository(
      database,
      options.clock,
      "microsoft",
    ),
    clock: options.clock,
    client: options.configuration,
    http: options.configuration
      ? createMicrosoftMailHttp(options.configuration, options.fetch)
      : null,
    vault: options.configuration
      ? calendarCredentialVault(options.configuration)
      : null,
  });
}
