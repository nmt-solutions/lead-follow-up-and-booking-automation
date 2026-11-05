import type { Actor } from "../models/business";
import type { BusinessProfile } from "../models/business";
import type {
  DiscoveryWork,
  DiscoveryPolicy,
  DiscoveryRun,
  DiscoveryWorkspace,
  StartDiscovery,
  WorkIdentity,
  DiscoveryProspect,
  StopReason,
  DiscoveryCommand,
  SearchResult,
} from "../models/discovery";

export type DiscoveryRepository = {
  workspace(actor: Actor, businessId: string): Promise<DiscoveryWorkspace>;
  create(
    actor: WorkIdentity,
    businessId: string,
    input: StartDiscovery,
    at: Date,
  ): Promise<{ run: DiscoveryRun; work: DiscoveryWork }>;
  command(
    actor: WorkIdentity,
    businessId: string,
    input: DiscoveryCommand,
    at: Date,
  ): Promise<{
    id: string;
    status: DiscoveryRun["status"];
    work: DiscoveryWork | null;
  }>;
  claim(work: DiscoveryWork, at: Date): Promise<DiscoveryRun | null>;
  reserve(
    work: DiscoveryWork,
    kind: "search" | "review",
    query: string | null,
    at: Date,
    stepKey: string,
  ): Promise<{
    id: string;
    units: number;
    completed: boolean;
    sources: SearchResult[] | null;
  } | null>;
  record(
    work: DiscoveryWork,
    operationId: string,
    prospect: Omit<DiscoveryProspect, "id"> | null,
    at: Date,
    details?: {
      returnedResults?: number;
      sourceUrl?: string;
      sources?: SearchResult[];
    },
  ): Promise<void>;
  progress(work: DiscoveryWork, at: Date, searchKey: string): Promise<void>;
  failOperation(work: DiscoveryWork, operationId: string): Promise<void>;
  finish(work: DiscoveryWork, reason: StopReason, at: Date): Promise<void>;
};

export function availableMarkets(
  profile: BusinessProfile,
  policy: DiscoveryPolicy | null,
) {
  if (
    !policy ||
    !profile.configuration?.homeMarketConfirmedAt ||
    !profile.configuration.buyersReviewedAt
  )
    return [];
  return [
    profile.homeMarket,
    ...profile.configuration.additionalMarkets,
  ].filter(
    (market) =>
      policy.activeMarkets.includes(market) &&
      policy.coverage.some((coverage) => coverage.market === market),
  );
}
