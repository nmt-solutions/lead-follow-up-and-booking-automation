import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import type { Transaction } from "./scope";
import { business, discoveryConfiguration, session } from "./schema";
import { hasMfa } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import {
  discoveryPolicySchema,
  type DiscoveryRun,
  type DiscoveryBrief,
  type WorkIdentity,
} from "../models/discovery";
import type { BusinessProfile } from "../models/business";
import { availableMarkets } from "../discovery/repository";
import { paidAllowance } from "./paid-access";

export async function requireWorkSession(
  tx: Transaction,
  identity: WorkIdentity,
  at: Date,
) {
  const [current] = await tx
    .select({ token: session.token, expiresAt: session.expiresAt })
    .from(session)
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(session.userId, identity.userId),
      ),
    );
  if (!current || current.expiresAt <= at)
    throw new ApplicationError("UNAUTHENTICATED");
  // Run authorizers are Owners/Admins, so queued spend always requires MFA.
  if (!(await hasMfa(tx, current.token, at)))
    throw new ApplicationError("MFA_REQUIRED");
}

export function briefFor(
  profile: BusinessProfile,
  markets: string[],
  publicOffering: string,
): DiscoveryBrief {
  const configuration = profile.configuration;
  if (!configuration?.homeMarketConfirmedAt || !configuration.buyersReviewedAt)
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
  return {
    offering: profile.offering,
    publicOffering,
    requirements: {
      specifications: configuration.specifications,
      minimumOrder: configuration.minimumOrder,
      deliveryConstraints: configuration.deliveryConstraints,
      serviceConstraints: configuration.serviceConstraints,
    },
    buyers: configuration.buyerCategories,
    markets,
    exclusions: configuration.exclusions,
    homeMarket: profile.homeMarket,
  };
}

export async function settings(tx: Transaction, businessId: string, at: Date) {
  const [profile] = await tx
    .select()
    .from(business)
    .where(eq(business.id, businessId));
  if (!profile) throw new ApplicationError("NOT_FOUND");
  const [configuration] = await tx
    .select()
    .from(discoveryConfiguration)
    .where(eq(discoveryConfiguration.businessId, businessId));
  const parsed = discoveryPolicySchema.safeParse(configuration?.policy);
  const paid = await paidAllowance(tx, businessId, "discovery", at);
  const configured = parsed.success ? parsed.data : null;
  const markets = paid?.period.markets ?? [];
  const policy = configured
    ? {
        ...configured,
        activeMarkets:
          paid &&
          paid.allowance.quantity > 0 &&
          paid.allowance.unit === configured.allowanceUnit
            ? configured.activeMarkets.filter((m) => markets.includes(m))
            : [],
      }
    : null;
  return {
    profile,
    policy: policy?.activeMarkets.length ? policy : null,
    configuredPolicy: configured,
  };
}

export async function checkCurrent(
  tx: Transaction,
  run: DiscoveryRun,
  at: Date,
) {
  const { profile, policy } = await settings(tx, run.businessId, at);
  if (
    !policy ||
    !isDeepStrictEqual(policy, run.policy) ||
    !run.brief.markets.every((market) =>
      availableMarkets(profile, policy).includes(market),
    ) ||
    !isDeepStrictEqual(
      briefFor(profile, run.brief.markets, run.brief.publicOffering),
      run.brief,
    )
  )
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
}
