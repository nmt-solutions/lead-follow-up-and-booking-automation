import {
  costCategorySchema,
  type CostPlanning,
  type CostProjection,
  type CostRecord,
  type CostSource,
  type CostWorkspace,
} from "../models/costs";

function add(totals: Record<string, string>, currency: string, micros: string) {
  totals[currency] = (
    BigInt(totals[currency] ?? "0") + BigInt(micros)
  ).toString();
}
function convert(amount: CostSource["amount"], planning: CostPlanning | null) {
  if (!amount) return null;
  if (amount.currency === "INR") return BigInt(amount.micros);
  if (!planning?.usdToInr) return null;
  const [whole, fraction = ""] = planning.usdToInr.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction);
  const value = BigInt(amount.micros),
    absolute = value < 0n ? -value : value;
  return (
    (value < 0n ? -1n : 1n) *
    ((absolute * numerator + denominator / 2n) / denominator)
  );
}
function value(source: CostSource, planning: CostPlanning | null) {
  if (source.amount) return { amount: source.amount, pricing: source.status };
  if (source.status === "uncertain")
    return {
      amount: null,
      pricing: "Unresolved provider acceptance; no charge is inferred",
    };
  const rate = planning?.rates
    .filter(
      (r) =>
        r.provider === source.provider &&
        r.unit === source.unit &&
        (r.model === null || r.model === source.details.model) &&
        new Date(r.effectiveAt).getTime() <=
          new Date(source.observedAt).getTime() &&
        new Date(r.freshUntil).getTime() >=
          new Date(source.observedAt).getTime(),
    )
    .sort(
      (a, b) =>
        Number(b.model !== null) - Number(a.model !== null) ||
        new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime(),
    )[0];
  if (!rate)
    return { amount: null, pricing: "Missing rate or provider amount" };
  if (rate.inputPerMillion && rate.outputPerMillion) {
    const input = source.details.inputTokens,
      output = source.details.outputTokens;
    if (
      typeof input !== "number" ||
      !Number.isSafeInteger(input) ||
      input < 0 ||
      typeof output !== "number" ||
      !Number.isSafeInteger(output) ||
      output < 0
    )
      return { amount: null, pricing: "Missing token meters" };
    const micros =
      (BigInt(input) * BigInt(rate.inputPerMillion.micros) +
        BigInt(output) * BigInt(rate.outputPerMillion.micros) +
        500000n) /
      1000000n;
    return {
      amount: {
        currency: rate.inputPerMillion.currency,
        micros: micros.toString(),
      },
      pricing: `Estimated with planning version ${planning!.version}: ${rate.evidence}`,
    };
  }
  if (source.quantity === null)
    return { amount: null, pricing: "Missing usage meter" };
  if (!rate.pricePerUnit) return { amount: null, pricing: "Missing rate" };
  return {
    amount: {
      currency: rate.pricePerUnit.currency,
      micros: (
        BigInt(source.quantity) * BigInt(rate.pricePerUnit.micros)
      ).toString(),
    },
    pricing: `Estimated with planning version ${planning!.version}: ${rate.evidence}`,
  };
}
export function projectCosts(
  month: string,
  history: CostRecord[],
  planningHistory: CostPlanning[],
  now: Date,
  nativeScanAt: string | null,
): CostWorkspace {
  const planning = planningHistory.at(-1) ?? null;
  const latest = [...new Map(history.map((r) => [r.sourceId, r])).values()];
  const asOf = now.toISOString();
  const sources: CostProjection[] = latest.map((row) => {
    const valued = value(row.source, planning);
    const amount = convert(valued.amount, planning);
    const coveredBy =
      (row.origin === "native" &&
      typeof row.source.details.duplicateOf === "string"
        ? row.source.details.duplicateOf
        : null) ??
      latest.find((r) => r.source.coversSourceIds?.includes(row.sourceId))
        ?.sourceId ??
      null;
    const included =
      !coveredBy &&
      !["test", "fixture"].includes(String(row.source.details.mode)) &&
      (row.source.kind === "consumption" || row.source.kind === "commitment") &&
      ![
        "openai_linked_credits",
        "existing_subscription",
        "customer_meta",
      ].includes(row.source.funding);
    return {
      ...row,
      valuedAmount: valued.amount,
      pricing: valued.pricing,
      planningMicros: amount?.toString() ?? null,
      included,
      stale: new Date(row.source.freshUntil).getTime() < now.getTime(),
      coveredBy,
    };
  });
  const totals: CostWorkspace["totals"] = {
    operatorMicros: "0",
    unpriced: 0,
    unconverted: 0,
    operatorByCurrency: {},
    cashTopups: {},
    customerPaid: {},
    linkedCreditConsumption: {},
    subscriptionAllocation: {},
    stale: 0,
  };
  const start = new Date(`${month}-01T00:00:00Z`),
    end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const elapsedSeconds =
    Math.max(
      0,
      Math.min(
        end.getTime() - start.getTime(),
        now.getTime() - start.getTime(),
      ),
    ) / 1000;
  const monthSeconds = (end.getTime() - start.getTime()) / 1000;
  const categories: CostWorkspace["categories"] = {};
  const enabled =
    planning?.forecast === "linear_elapsed_utc" && elapsedSeconds > 0;
  let forecast = 0n;
  for (const category of costCategorySchema.options) {
    let actual = 0n,
      variable = 0n,
      fixed = 0n,
      unpriced = 0;
    for (const row of sources.filter((r) => r.source.category === category)) {
      const s = row.source,
        amount = row.valuedAmount;
      if (row.stale) totals.stale++;
      if (amount && !row.coveredBy) {
        if (s.kind === "cash_topup")
          add(totals.cashTopups, amount.currency, amount.micros);
        if (s.kind === "customer_paid_meta")
          add(totals.customerPaid, amount.currency, amount.micros);
        if (s.funding === "openai_linked_credits")
          add(totals.linkedCreditConsumption, amount.currency, amount.micros);
        if (s.kind === "subscription_allocation")
          add(totals.subscriptionAllocation, amount.currency, amount.micros);
      }
      if (
        s.kind === "plan_change" &&
        !row.coveredBy &&
        row.planningMicros !== null
      )
        fixed += BigInt(row.planningMicros);
      if (s.kind === "plan_change" && !row.coveredBy && !amount) unpriced++;
      if (
        s.kind === "plan_change" &&
        !row.coveredBy &&
        amount &&
        row.planningMicros === null
      )
        totals.unconverted++;
      if (!row.included) continue;
      if (!amount) {
        unpriced++;
        continue;
      }
      if (new Date(s.observedAt).getTime() <= now.getTime())
        add(totals.operatorByCurrency, amount.currency, amount.micros);
      if (row.planningMicros === null) {
        totals.unconverted++;
        continue;
      }
      const micros = BigInt(row.planningMicros);
      if (s.kind === "commitment") fixed += micros;
      // Future dated commitments are in the forecast but have not been incurred.
      if (new Date(s.observedAt).getTime() > now.getTime()) continue;
      actual += micros;
      if (s.kind === "consumption") variable += micros;
    }
    const predicted = enabled
      ? fixed +
        (variable * BigInt(Math.round(monthSeconds * 1000)) +
          BigInt(Math.max(1, Math.round(elapsedSeconds * 1000))) / 2n) /
          BigInt(Math.max(1, Math.round(elapsedSeconds * 1000)))
      : null;
    categories[category] = {
      operatorMicros: actual.toString(),
      forecastMicros: predicted?.toString() ?? null,
      unpriced,
    };
    totals.operatorMicros = (BigInt(totals.operatorMicros) + actual).toString();
    totals.unpriced += unpriced;
    if (predicted !== null) forecast += predicted;
  }
  const expected = [
    "vercel",
    "neon",
    "trigger",
    "r2",
    "resend",
    "openai",
    "ai_gateway",
    "exa",
    "razorpay",
  ];
  const estimatedSourceIds = sources
    .filter(
      (r) =>
        !r.coveredBy &&
        (r.source.status === "estimated" || r.pricing.startsWith("Estimated")),
    )
    .map((r) => r.sourceId);
  const unsettledSourceIds = sources
    .filter((r) => !r.coveredBy && r.source.status === "observed_not_settled")
    .map((r) => r.sourceId);
  const unresolvedFundingSourceIds = sources
    .filter(
      (r) =>
        r.origin === "native" &&
        !r.coveredBy &&
        r.sourceId.startsWith("native:ai:"),
    )
    .map((r) => r.sourceId);
  return {
    operatorId: "",
    delivery: { emailConfigured: false, scheduleConfigured: false },
    month,
    asOf,
    sources,
    history,
    planning,
    planningHistory,
    totals,
    categories,
    budgets: [],
    alerts: [],
    forecast: {
      basis: planning?.forecast ?? "none",
      knownOnly: true,
      operatorMicros: enabled ? forecast.toString() : null,
      elapsedSeconds,
      monthSeconds,
      assumptions: planning?.assumptions ?? "Forecast configuration is missing",
      coverage: `${totals.unpriced} unpriced, ${totals.unconverted} without planning conversion, ${estimatedSourceIds.length} estimates, ${unsettledSourceIds.length} unsettled observations, ${unresolvedFundingSourceIds.length} funding declarations awaiting statement evidence; no assumption of zero cost`,
    },
    coverage: {
      nativeScanAt,
      missingProviderEvidence: expected.filter(
        (p) => !sources.some((r) => r.source.provider === p),
      ),
      unpricedSourceIds: sources
        .filter(
          (r) =>
            !r.coveredBy &&
            (r.included || r.source.kind === "plan_change") &&
            !r.valuedAmount,
        )
        .map((r) => r.sourceId),
      estimatedSourceIds,
      unsettledSourceIds,
      unresolvedFundingSourceIds,
    },
  };
}
