import type { Database } from "../db/runtime";
import type { Clock } from "../models/business";
import type { GmailConfiguration } from "./configuration";
import { createGmailRepository } from "../db/gmail-repository";
import { createGmailGrantService } from "../application/gmail-grants";
import { createGmailHttp } from "./http";
import { calendarCredentialVault } from "../appointments/credentials";

/** Server composition shared by the web host, Trigger worker and HTTP-contract fixtures. */
export function createGmailConnection(
  database: Database,
  options: {
    clock: Clock;
    configuration: GmailConfiguration | null;
    fetch: typeof fetch;
  },
) {
  return createGmailGrantService({
    repository: createGmailRepository(database, options.clock),
    clock: options.clock,
    client: options.configuration,
    http: options.configuration
      ? createGmailHttp(options.configuration, options.fetch)
      : null,
    vault: options.configuration
      ? calendarCredentialVault(options.configuration)
      : null,
  });
}
