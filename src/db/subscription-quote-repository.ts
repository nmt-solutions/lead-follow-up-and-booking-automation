import type { SubscriptionQuoteRepository } from "../application/subscription-quotes";
import type { Database } from "./runtime";
import { readBillingWorkspace } from "./billing-repository";
import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { scoped, requireCapability, type Transaction } from "./scope";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  pricingRevisionSchema,
  subscriptionQuoteSchema,
  commercialIssues,
  selectionIssues,
  reviewSubscriptionQuote,
} from "../models/subscription-quotes";
import {
  platformOperator,
  subscriptionPricingRevision,
  subscriptionQuote,
  user,
} from "./schema";

async function requirePricingOperator(tx: Transaction, actor: Actor) {
  const [operator] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!operator?.pricing) throw new ApplicationError("FORBIDDEN");
}
async function catalog(tx: Transaction, at: Date) {
  const rows = await tx
    .select()
    .from(subscriptionPricingRevision)
    .orderBy(asc(subscriptionPricingRevision.version));
  const history = rows.map((row) =>
    pricingRevisionSchema.parse({
      ...row,
      at: row.at.toISOString(),
      effectiveFrom: row.effectiveFrom.toISOString(),
    }),
  );
  return {
    version: history.at(-1)?.version ?? 0,
    current:
      history.filter((row) => new Date(row.effectiveFrom) <= at).at(-1) ?? null,
    history,
  };
}

export function createSubscriptionQuoteRepository(
  database: Database,
): SubscriptionQuoteRepository {
  return {
    catalog(actor, at) {
      return scoped(database, actor, "", async (tx) => {
        await requirePricingOperator(tx, actor);
        return catalog(tx, at);
      });
    },
    configure(actor, input, at) {
      return scoped(database, actor, "", async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('subscription-pricing', 0))`,
        );
        await requirePricingOperator(tx, actor);
        const state = await catalog(tx, at);
        if (state.version !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const effectiveFrom = input.effectiveFrom
          ? new Date(input.effectiveFrom)
          : at;
        const latest = state.history.at(-1);
        if (
          effectiveFrom < at ||
          (latest && effectiveFrom < new Date(latest.effectiveFrom))
        )
          throw new ApplicationError("INVALID_INPUT");
        const [identity] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, actor.userId));
        if (!identity) throw new ApplicationError("UNAUTHENTICATED");
        await tx.insert(subscriptionPricingRevision).values({
          id: randomUUID(),
          version: state.version + 1,
          effectiveFrom,
          offers: input.offers,
          note: input.note,
          actorId: actor.userId,
          actorName: identity.name,
          at,
        });
        return catalog(tx, at);
      });
    },
    workspace(actor, businessId, at) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "billing.read");
        const billing = await readBillingWorkspace(tx, businessId, at);
        const pricing = (await catalog(tx, at)).current;
        const rows = await tx
          .select()
          .from(subscriptionQuote)
          .where(eq(subscriptionQuote.businessId, businessId))
          .orderBy(asc(subscriptionQuote.at), asc(subscriptionQuote.id));
        return {
          billing,
          currency: billing.currency,
          catalogVersion: pricing?.version ?? 0,
          offers: pricing?.offers ?? [],
          quotes: rows.map((row) =>
            reviewSubscriptionQuote(
              subscriptionQuoteSchema.parse(row.snapshot),
              billing,
              pricing,
            ),
          ),
          issues: commercialIssues(billing, pricing),
          checkoutReady: false,
        };
      });
    },
    quote(actor, businessId, quoteId, at) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "billing.read");
        const [row] = await tx
          .select()
          .from(subscriptionQuote)
          .where(
            and(
              eq(subscriptionQuote.businessId, businessId),
              eq(subscriptionQuote.id, quoteId),
            ),
          );
        if (!row) throw new ApplicationError("NOT_FOUND");
        return reviewSubscriptionQuote(
          subscriptionQuoteSchema.parse(row.snapshot),
          await readBillingWorkspace(tx, businessId, at),
          (await catalog(tx, at)).current,
        );
      });
    },
    createQuote(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('subscription-pricing', 0))`,
          );
          const billing = await readBillingWorkspace(tx, businessId, at);
          const pricing = (await catalog(tx, at)).current;
          const [existing] = await tx
            .select()
            .from(subscriptionQuote)
            .where(
              and(
                eq(subscriptionQuote.businessId, businessId),
                eq(subscriptionQuote.requestKey, input.requestKey),
              ),
            );
          if (existing) {
            const snapshot = subscriptionQuoteSchema.parse(existing.snapshot);
            if (JSON.stringify(snapshot.selection) !== JSON.stringify(input))
              throw new ApplicationError("CONFLICT");
            return reviewSubscriptionQuote(snapshot, billing, pricing);
          }
          const offer = pricing?.offers.find(
            (item) => item.id === input.offerId,
          );
          const issues = [
            ...commercialIssues(billing, pricing),
            ...selectionIssues(
              offer,
              billing.currency,
              input.term,
              input.reservedCapacityId,
            ),
          ];
          if (
            issues.length ||
            !billing.current ||
            !billing.currency ||
            !pricing ||
            !offer
          )
            throw new ApplicationError("PRICING_SETUP_REQUIRED");
          if (
            input.expectedCatalogVersion !== pricing.version ||
            input.expectedBillingVersion !== billing.version ||
            input.expectedReviewVersion !== billing.reviewVersion
          )
            throw new ApplicationError("CONFLICT");
          const review = billing.reviews
            .filter((item) => item.profileId === billing.current!.id)
            .at(-1);
          if (!review || review.outcome !== "reviewed")
            throw new ApplicationError("PRICING_SETUP_REQUIRED");
          const price = offer.prices[billing.currency]!;
          const reserved =
            offer.reservedCapacity.find(
              (item) => item.id === input.reservedCapacityId,
            ) ?? null;
          const reservedPrice = reserved?.prices[billing.currency];
          const pilot = input.term === "paid_pilot";
          const initialLines = [
            {
              kind: "subscription",
              label: offer.label,
              amountMinor: (pilot ? price.pilotMinor : price.monthlyMinor)!,
            },
            ...(reserved
              ? [
                  {
                    kind: "reserved_capacity",
                    label: reserved.label,
                    amountMinor: (pilot
                      ? reservedPrice?.pilotMinor
                      : reservedPrice?.monthlyMinor)!,
                  },
                ]
              : []),
          ];
          const renewalLines = [
            {
              kind: "subscription",
              label: offer.label,
              amountMinor: price.monthlyMinor!,
            },
            ...(reserved
              ? [
                  {
                    kind: "reserved_capacity",
                    label: reserved.label,
                    amountMinor: reservedPrice!.monthlyMinor!,
                  },
                ]
              : []),
          ];
          const [identity] = await tx
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, actor.userId));
          if (!identity) throw new ApplicationError("UNAUTHENTICATED");
          const snapshot = subscriptionQuoteSchema.parse({
            id: randomUUID(),
            businessId,
            selection: input,
            currency: billing.currency,
            profile: billing.current,
            billingReview: review,
            pricing: {
              id: pricing.id,
              version: pricing.version,
              effectiveFrom: pricing.effectiveFrom,
              offer,
              reservedCapacity: reserved,
            },
            initial: {
              kind: input.term,
              days: pilot ? offer.pilot!.days : null,
              lines: initialLines,
              subtotalMinor: initialLines.reduce(
                (sum, line) => sum + line.amountMinor,
                0,
              ),
              discovery: pilot ? offer.pilot!.discovery : offer.discovery,
              automation: pilot ? offer.pilot!.automation : offer.automation,
            },
            renewal: {
              interval: "month",
              lines: renewalLines,
              subtotalMinor: renewalLines.reduce(
                (sum, line) => sum + line.amountMinor,
                0,
              ),
              discovery: offer.discovery,
              automation: offer.automation,
              terms: offer.renewalTerms,
            },
            meta: {
              payer: "business_direct",
              includedInPlatformSubtotal: false,
              prepaidCredit: false,
              guaranteedMessages: false,
            },
            tax: {
              status: "not_calculated",
              amountMinor: null,
              totalMinor: null,
            },
            grantsEntitlements: false,
            actorId: actor.userId,
            actorName: identity.name,
            at: at.toISOString(),
          });
          await tx.insert(subscriptionQuote).values({
            id: snapshot.id,
            businessId,
            requestKey: input.requestKey,
            pricingId: pricing.id,
            profileId: billing.current.id,
            reviewId: review.id,
            snapshot,
            actorId: actor.userId,
            at,
          });
          return reviewSubscriptionQuote(snapshot, billing, pricing);
        },
        { lock: true },
      );
    },
  };
}
