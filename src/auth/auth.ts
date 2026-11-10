import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  factorVersion,
  hasMfa,
  operatorMfaLifetime,
  privilegedRoles,
} from "./access";
import type { Database } from "../db/runtime";
import * as schema from "../db/schema";
import { APP_NAME } from "../lib/brand";
import { profileSchema } from "../models/registration";
import { createHash } from "node:crypto";

export type SignInMail = { email: string; url: string; kind?: "verification" };
export type SignInMailer = { send(message: SignInMail): Promise<void> };

export function createAuth(options: {
  database: Database;
  baseURL: string;
  secret: string;
  mailer: SignInMailer;
}) {
  const attemptedFactors = new WeakMap<
    object,
    { id: string; secret: string }
  >();
  const sessionManagementPaths = new Set([
    "/list-sessions",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/update-session",
  ]);
  return betterAuth({
    appName: APP_NAME,
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    trustedOrigins: [new URL(options.baseURL).origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
    },
    emailVerification: {
      expiresIn: 600,
      sendOnSignUp: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url, token }) => {
        // Native email verification preserves the password selected at signup.
        // Magic links deliberately revoke unproven credentials in Better Auth.
        const identifier = `email-verification:${createHash("sha256").update(token).digest("base64url")}`;
        await options.database
          .insert(schema.verification)
          .values({
            id: identifier,
            identifier,
            value: JSON.stringify({
              type: "email-verification",
              email: user.email,
              userId: user.id,
            }),
            expiresAt: new Date(Date.now() + 599000),
          })
          .onConflictDoNothing();
        await options.mailer.send({
          email: user.email,
          url,
          kind: "verification",
        });
      },
    },
    user: {
      additionalFields: {
        firstName: { type: "string", required: false },
        lastName: { type: "string", required: false },
        accountType: { type: "string", required: false },
        companyName: { type: "string", required: false },
      },
    },
    session: {
      cookieCache: { enabled: false },
      additionalFields: {
        mfaVerifiedAt: { type: "date", required: false, input: false },
        mfaFactorId: { type: "string", required: false, input: false },
        mfaFactorVersion: { type: "string", required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ["/change-password", "/set-password", "/reset-password"].includes(
            ctx.path,
          )
        )
          throw new APIError("FORBIDDEN", {
            message: "Use Account security to set your password.",
          });
        if (
          ctx.path === "/sign-up/email" ||
          (ctx.path === "/update-user" &&
            ["firstName", "lastName", "accountType", "companyName"].some(
              (key) => key in (ctx.body ?? {}),
            ))
        ) {
          const profile = profileSchema.safeParse(ctx.body);
          if (!profile.success)
            throw new APIError("BAD_REQUEST", {
              message: "Enter your name and account details.",
            });
          return {
            context: {
              body: {
                ...ctx.body,
                ...profile.data,
                name: `${profile.data.firstName} ${profile.data.lastName}`,
              },
            },
          };
        }
        if (
          !ctx.path.startsWith("/two-factor/") &&
          !sessionManagementPaths.has(ctx.path)
        )
          return;
        // No email second factor, trusted devices, arbitrary session flags or
        // secret retrieval from a primary-only passwordless session.
        if (
          ctx.path === "/two-factor/send-otp" ||
          ctx.path === "/two-factor/verify-otp"
        )
          throw new APIError("FORBIDDEN", {
            message: "Use an authenticator or recovery code.",
          });
        const identity = await getSessionFromCtx(ctx);
        const verifying =
          ctx.path === "/two-factor/verify-totp" ||
          ctx.path === "/two-factor/verify-backup-code";
        if (verifying) {
          const input = z.strictObject({
            code: ctx.path.endsWith("verify-totp")
              ? z.string().regex(/^\d{6}$/)
              : z.string().regex(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/),
            trustDevice: z.literal(false).optional(),
            disableSession: z.literal(false).optional(),
          });
          if (!input.safeParse(ctx.body).success)
            throw new APIError("BAD_REQUEST", { message: "Check your code." });
        }
        // Password sign-in has no primary session until Better Auth consumes
        // its signed, short-lived two-factor challenge. Snapshot that factor
        // so the after hook can bind assurance to the factor actually used.
        if (!identity && verifying) {
          const cookie = ctx.context.createAuthCookie("two_factor");
          const challengeId = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret,
          );
          const challenge =
            challengeId && challengeId.startsWith("2fa-")
              ? await ctx.context.internalAdapter.findVerificationValue(
                  challengeId,
                )
              : null;
          if (!challenge || challenge.expiresAt <= new Date())
            throw new APIError("UNAUTHORIZED", { message: "Sign in again." });
          const [factor] = await options.database
            .select()
            .from(schema.twoFactor)
            .where(
              and(
                eq(schema.twoFactor.userId, challenge.value),
                eq(schema.twoFactor.verified, true),
              ),
            );
          if (!factor)
            throw new APIError("UNAUTHORIZED", { message: "Sign in again." });
          attemptedFactors.set(ctx.context, {
            id: factor.id,
            secret: factor.secret,
          });
          return;
        }
        if (!identity)
          throw new APIError("UNAUTHORIZED", { message: "Sign in again." });
        if (sessionManagementPaths.has(ctx.path)) {
          const roles = await privilegedRoles(
            options.database,
            identity.user.id,
          );
          if (
            !identity.user.twoFactorEnabled &&
            !roles.business &&
            !roles.operator
          )
            return;
          if (
            !(await hasMfa(
              options.database,
              identity.session.token,
              new Date(),
              operatorMfaLifetime,
            ))
          )
            throw new APIError("FORBIDDEN", {
              message: "Verify MFA before managing sessions.",
            });
          return;
        }
        if (
          ctx.path === "/two-factor/verify-totp" ||
          ctx.path === "/two-factor/verify-backup-code"
        ) {
          // The plugin's built-in account lock applies to its credential-login
          // challenge. Magic-link sessions need the same account-wide budget.
          const allowed = await options.database.transaction(async (tx) => {
            const [factor] = await tx
              .select()
              .from(schema.twoFactor)
              .where(eq(schema.twoFactor.userId, identity.user.id))
              .for("update");
            if (!factor) return true;
            attemptedFactors.set(ctx.context, {
              id: factor.id,
              secret: factor.secret,
            });
            const now = new Date();
            if (factor.lockedUntil && factor.lockedUntil > now) return false;
            const failures = factor.lockedUntil
              ? 1
              : factor.failedVerificationCount + 1;
            await tx
              .update(schema.twoFactor)
              .set({
                failedVerificationCount: failures,
                lockedUntil:
                  failures >= 5
                    ? new Date(now.getTime() + operatorMfaLifetime)
                    : null,
              })
              .where(eq(schema.twoFactor.id, factor.id));
            return true;
          });
          if (!allowed)
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Wait before trying again.",
            });
          return;
        }
        if (
          ctx.path === "/two-factor/enable" &&
          !identity.user.twoFactorEnabled
        ) {
          const age = Date.now() - identity.session.createdAt.getTime();
          if (age < 0 || age >= operatorMfaLifetime)
            throw new APIError("FORBIDDEN", {
              message: "Sign in again before setting up MFA.",
            });
          return;
        }
        if (
          !(await hasMfa(
            options.database,
            identity.session.token,
            new Date(),
            operatorMfaLifetime,
          ))
        )
          throw new APIError("FORBIDDEN", {
            message: "Verify MFA before changing security settings.",
          });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path !== "/two-factor/verify-totp" &&
          ctx.path !== "/two-factor/verify-backup-code"
        )
          return;
        if (ctx.context.returned instanceof APIError) return;
        if (
          !z.object({ token: z.string() }).safeParse(ctx.context.returned)
            .success
        )
          return;
        const identity = ctx.context.newSession ?? ctx.context.session;
        if (!identity) return;
        const attemptedFactor = attemptedFactors.get(ctx.context);
        if (!attemptedFactor) return;
        const [factor] = await options.database
          .select({ id: schema.twoFactor.id })
          .from(schema.twoFactor)
          .where(
            and(
              eq(schema.twoFactor.userId, identity.user.id),
              eq(schema.twoFactor.id, attemptedFactor.id),
              eq(schema.twoFactor.secret, attemptedFactor.secret),
              eq(schema.twoFactor.verified, true),
            ),
          );
        if (!factor) return;
        await options.database
          .update(schema.twoFactor)
          .set({ failedVerificationCount: 0, lockedUntil: null })
          .where(eq(schema.twoFactor.id, factor.id));
        await options.database
          .update(schema.session)
          .set({
            mfaVerifiedAt: new Date(),
            mfaFactorId: factor.id,
            mfaFactorVersion: factorVersion(attemptedFactor.secret),
          })
          .where(
            and(
              eq(schema.session.id, identity.session.id),
              eq(schema.session.userId, identity.user.id),
            ),
          );
      }),
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    logger: { disabled: true },
    plugins: [
      twoFactor({
        issuer: APP_NAME,
        allowPasswordless: true,
        accountLockout: { maxFailedAttempts: 5 },
      }),
      magicLink({
        expiresIn: 600,
        storeToken: "hashed",
        rateLimit: { window: 60, max: 5 },
        sendMagicLink: ({ email, url }) => options.mailer.send({ email, url }),
      }),
    ],
  });
}
