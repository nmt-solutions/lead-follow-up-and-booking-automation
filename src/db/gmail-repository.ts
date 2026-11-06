import type { Database } from "./runtime";
import type { Clock } from "../models/business";
import { createMailboxAuthorizationRepository } from "./mailbox-authorization-repository";
export const createGmailRepository = (database: Database, clock: Clock) =>
  createMailboxAuthorizationRepository(database, clock, "gmail");
