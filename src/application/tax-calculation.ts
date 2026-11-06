import type { BillingWorkspace } from "../models/billing";
import type {
  TaxCalculation,
  TaxCalculationInput,
  TaxCatalog,
  TaxMode,
  TaxRule,
} from "../models/tax";

type MatchedRule = TaxCalculation["lines"][number]["rule"];
function rounded(numerator: bigint, denominator: bigint, rule: TaxRule) {
  const quantum = BigInt(rule.rounding.incrementMinor);
  const divisor = denominator * quantum;
  const quotient = numerator / divisor,
    remainder = numerator % divisor;
  const up =
    rule.rounding.mode !== "down" &&
    (remainder * 2n > divisor ||
      (remainder * 2n === divisor &&
        (rule.rounding.mode === "half_up" || quotient % 2n === 1n)));
  return (quotient + (up ? 1n : 0n)) * quantum;
}
/** Real internal tax arithmetic. All legal coverage and treatment are explicit approved inputs. */
export function evaluateTax(
  input: TaxCalculationInput,
  billing: BillingWorkspace,
  catalog: TaxCatalog,
  at: Date,
  mode: TaxMode,
): Pick<TaxCalculation, "status" | "reasons" | "lines" | "totals"> {
  const reasons: TaxCalculation["reasons"] = [];
  const reason = (
    kind: "missing" | "conflicting" | "unsupported",
    code: string,
    lineId: string | null = null,
  ) => reasons.push({ kind, code, lineId });
  if (billing.status !== "reviewed") {
    reason(
      billing.status === "conflicting" ? "conflicting" : "missing",
      "billing_evidence_not_reviewed",
    );
    for (const code of billing.issues)
      reason(
        billing.status === "conflicting" ? "conflicting" : "missing",
        code,
      );
  }
  if (billing.currency !== input.currency)
    reason("conflicting", "billing_currency_mismatch");
  const active = new Map<string, MatchedRule>();
  for (const revision of catalog.revisions) {
    if (
      revision.rule.mode !== mode ||
      new Date(revision.rule.effectiveFrom) > at
    )
      continue;
    const approval = catalog.decisions
      .filter((decision) => decision.revisionId === revision.id)
      .at(-1);
    if (!approval) continue;
    const previous = active.get(revision.key);
    if (!previous || revision.version > previous.revision.version)
      active.set(revision.key, { revision, approval });
  }
  const matched: {
    input: TaxCalculationInput["lines"][number];
    rule: MatchedRule;
    net: bigint;
    taxes: bigint[];
  }[] = [];
  for (const line of input.lines) {
    const candidates = [...active.values()].filter(({ revision, approval }) => {
      const rule = revision.rule,
        profile = billing.current?.profile;
      return (
        approval.outcome === "approved" &&
        (!rule.effectiveUntil || new Date(rule.effectiveUntil) > at) &&
        rule.customerCountry === profile?.address.country &&
        (rule.customerRegion === null ||
          rule.customerRegion === profile.address.region) &&
        rule.buyerStatus === profile.businessStatus &&
        rule.currency === input.currency &&
        rule.productCode === line.productCode
      );
    });
    if (candidates.length !== 1) {
      reason(
        candidates.length ? "conflicting" : "unsupported",
        candidates.length ? "ambiguous_tax_rules" : "unsupported_tax_treatment",
        line.id,
      );
      continue;
    }
    const match = candidates[0],
      rule = match.revision.rule;
    if (
      new Date(rule.registration.effectiveFrom) > at ||
      (rule.registration.effectiveUntil &&
        new Date(rule.registration.effectiveUntil) <= at)
    )
      reason("missing", "registration_not_effective", line.id);
    if (
      rule.requiredEvidence.some(
        (kind) =>
          !billing.current?.profile.evidence.some(
            (evidence) => evidence.kind === kind,
          ),
      )
    )
      reason("missing", "treatment_evidence_missing", line.id);
    matched.push({
      input: line,
      rule: match,
      net: BigInt(line.unitAmountMinor) * BigInt(line.quantity),
      taxes: rule.rates.map(() => 0n),
    });
  }
  if (reasons.length)
    return { status: "review_required", reasons, lines: [], totals: null };
  for (const match of [
    ...new Map(
      matched.map((line) => [line.rule.revision.id, line.rule]),
    ).values(),
  ]) {
    const group = matched.filter(
        (line) => line.rule.revision.id === match.revision.id,
      ),
      rule = match.revision.rule;
    for (const [index, rate] of rule.rates.entries()) {
      const numerator = BigInt(rate.numerator),
        denominator = BigInt(rate.denominator),
        quantum = BigInt(rule.rounding.incrementMinor);
      if (rule.rounding.scope === "per_line") {
        for (const line of group)
          line.taxes[index] = rounded(line.net * numerator, denominator, rule);
        continue;
      }
      const total = rounded(
        group.reduce((sum, line) => sum + line.net, 0n) * numerator,
        denominator,
        rule,
      );
      for (const line of group)
        line.taxes[index] =
          ((line.net * numerator) / (denominator * quantum)) * quantum;
      let remainder =
        total - group.reduce((sum, line) => sum + line.taxes[index], 0n);
      const ordered = [...group].sort((a, b) => {
        const difference =
          ((b.net * numerator) % (denominator * quantum)) -
          ((a.net * numerator) % (denominator * quantum));
        return difference > 0n
          ? 1
          : difference < 0n
            ? -1
            : a.input.id < b.input.id
              ? -1
              : 1;
      });
      for (const line of ordered) {
        if (remainder <= 0n) break;
        line.taxes[index] += quantum;
        remainder -= quantum;
      }
    }
  }
  const lines = matched.map((line) => {
    const tax = line.taxes.reduce((sum, value) => sum + value, 0n);
    return {
      input: line.input,
      netMinor: line.net.toString(),
      taxMinor: tax.toString(),
      totalMinor: (line.net + tax).toString(),
      components: line.rule.revision.rule.rates.map((rate, index) => ({
        name: rate.name,
        amountMinor: line.taxes[index].toString(),
      })),
      rule: line.rule,
    };
  });
  const net = lines.reduce((sum, line) => sum + BigInt(line.netMinor), 0n),
    tax = lines.reduce((sum, line) => sum + BigInt(line.taxMinor), 0n);
  return {
    status: "calculated",
    reasons,
    lines,
    totals: {
      netMinor: net.toString(),
      taxMinor: tax.toString(),
      totalMinor: (net + tax).toString(),
    },
  };
}
