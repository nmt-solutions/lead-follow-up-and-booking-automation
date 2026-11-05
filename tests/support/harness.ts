import { createAuth, type SignInMail } from "../../src/auth/auth";
import { runtimeDatabase, verifyRuntimeRole } from "../../src/db/runtime";
import { createBusinessRepository } from "../../src/db/business-repository";
import { createBusinessApplication } from "../../src/application/business";
import { ApplicationError } from "../../src/models/application-error";
import { startPostgres } from "./postgres";
import { vi } from "vitest";
import type { Actor } from "../../src/models/business";
import { createBusinessHttp } from "../../src/http/business";
import type { FailureDiagnostic } from "../../src/http/respond";

export async function createHarness() {
  const postgres = await startPostgres();
  await verifyRuntimeRole(postgres.runtime);
  const database = runtimeDatabase(postgres.runtime);
  const sent: SignInMail[] = [];
  const mail = {
    sent,
    async send(message: SignInMail) {
      this.sent.push(message);
    },
  };
  let now = new Date("2026-11-05T09:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const clock = {
    now: () => new Date(now),
    set(value: string) {
      now = new Date(value);
      vi.setSystemTime(now);
    },
  };
  const baseURL = "http://localhost:3000";
  const auth = createAuth({
    database,
    baseURL,
    secret: "test-only-secret-for-isolated-business-database",
    mailer: mail,
  });
  const authenticate = async (headers: Headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session) throw new ApplicationError("UNAUTHENTICATED");
    return { userId: session.user.id };
  };
  const repository = createBusinessRepository(database);
  const application = createBusinessApplication({
    authenticate,
    repository,
    clock,
  });
  const diagnostics: FailureDiagnostic[] = [];
  const http = createBusinessHttp({
    application,
    origin: baseURL,
    reportFailure: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    ...postgres,
    application,
    auth,
    mail,
    clock,
    authenticate,
    repository,
    http,
    diagnostics,
    // A worker receives its actor from trusted job ownership, never the job's untrusted payload.
    workerFor(actor: Actor) {
      return createBusinessApplication<void>({
        authenticate: async () => actor,
        repository,
        clock,
      });
    },
    async close() {
      try {
        await postgres.close();
      } finally {
        vi.useRealTimers();
      }
    },
    async signIn(email: string) {
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseURL },
          body: JSON.stringify({
            email,
            callbackURL: "/businesses",
            errorCallbackURL: "/sign-in",
          }),
        }),
      );
      if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
      const message = mail.sent.at(-1);
      if (!message || message.email !== email)
        throw new Error("Sign-in email missing");
      const verified = await auth.handler(new Request(message.url));
      const cookie = verified.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      if (!cookie) throw new Error(`Verification failed (${verified.status})`);
      return new Headers({ cookie });
    },
    async signOut(headers: Headers) {
      await auth.api.signOut({ headers });
    },
  };
}
