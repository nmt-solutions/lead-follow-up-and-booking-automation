import { createHash } from "node:crypto";
import type { createReconciliationRepository } from "../db/reconciliation-repository";
import type {
  ReconciliationPeriod,
  ReconciliationLine,
  ReconciliationSource,
} from "../models/reconciliation";

type Snapshot = Awaited<
  ReturnType<ReturnType<typeof createReconciliationRepository>["snapshot"]>
>;
const sum = (values: string[]) =>
  String(values.reduce((a, b) => a + BigInt(b), 0n));
const difference = (a: string | null, b: string | null) =>
  a === null || b === null ? null : String(BigInt(a) - BigInt(b));
function fees(amount: string | null, tax: string | null, presentation: string) {
  if (
    amount === null ||
    tax === null ||
    presentation === "unavailable" ||
    (presentation === "inclusive" && BigInt(tax) > BigInt(amount))
  )
    return null;
  return {
    total: String(
      BigInt(amount) + (presentation === "exclusive" ? BigInt(tax) : 0n),
    ),
    cost: String(
      BigInt(amount) - (presentation === "inclusive" ? BigInt(tax) : 0n),
    ),
    tax,
  };
}
function converted(
  line: ReconciliationLine,
  source: ReconciliationSource | undefined,
  currency: string,
) {
  if (!line.original || line.kind === "unclassified")
    return { amount: null, reason: "unclassified_provider_movement" };
  let actual: string | null = null;
  if (line.original.currency === currency) actual = line.original.minor;
  else if (line.kind === "capture" && source?.baseCurrency === currency)
    actual = source.baseAmountMinor;
  if (line.conversion) {
    const n = BigInt(line.original.minor) * BigInt(line.conversion.numerator),
      d = BigInt(line.conversion.denominator);
    const rounded = String(
      (n + (line.conversion.rounding === "half_up" ? d / 2n : 0n)) / d,
    );
    if (actual !== null && rounded !== actual)
      return {
        amount: null,
        reason: "conversion_conflicts_with_native_amount",
      };
    actual = rounded;
  }
  if (actual === null) return { amount: null, reason: "actual_fx_unavailable" };
  if (line.convertedMinor !== null && line.convertedMinor !== actual)
    return { amount: null, reason: "converted_amount_mismatch" };
  return { amount: actual, reason: null };
}
export function reconciliationReport(
  snapshot: Snapshot,
  period: ReconciliationPeriod,
) {
  const inPeriod = (at: string) => at >= period.from && at < period.until;
  const superseded = new Set(
    snapshot.records.flatMap((r) => [
      ...(r.supersedes ? [r.supersedes] : []),
      ...r.data.supersedesAlso,
    ]),
  );
  const active = snapshot.records.filter((r) => !superseded.has(r.id));
  const duplicates = new Set(
    active
      .filter((r) => active.filter((x) => x.identity === r.identity).length > 1)
      .map((r) => r.id),
  );
  const sources = snapshot.sources.filter((s) => inPeriod(s.paidAt));
  const selected = active.filter(
    (r) => r.data.kind === "settlement" && inPeriod(r.data.observedAt),
  );
  const settlements = selected.map((record) => {
    const data = record.data;
    if (data.kind !== "settlement")
      throw Error("Invalid settlement projection");
    const reasons: string[] = [];
    if (duplicates.has(record.id))
      reasons.push("duplicate_settlement_identity");
    if (data.status !== "processed") reasons.push("transfer_not_processed");
    const movements = data.lines.map((line) => {
      const source = snapshot.sources.find((s) =>
        line.kind === "capture"
          ? s.periodId === line.sourceId
          : s.effects.some((e) => e.id === line.sourceId),
      );
      const conversion = converted(line, source, data.money.currency);
      if (conversion.reason) reasons.push(conversion.reason);
      if (
        line.sourceId &&
        active.filter(
          (r) =>
            r.data.kind === "settlement" &&
            r.data.lines.some((l) => l.sourceId === line.sourceId),
        ).length > 1
      )
        reasons.push("source_allocated_multiple_times");
      if (
        line.sourceId &&
        data.lines.filter((l) => l.sourceId === line.sourceId).length > 1
      )
        reasons.push("duplicate_transaction_source");
      const fee = fees(line.feeMinor, line.feeTaxMinor, line.feePresentation);
      if (
        line.kind === "capture" &&
        source &&
        fee &&
        source.feeCurrency === data.money.currency &&
        source.feeMinor !== null &&
        (fee.total !== source.feeMinor ||
          (source.feeTaxMinor !== null && fee.tax !== source.feeTaxMinor))
      )
        reasons.push("fee_conflicts_with_native_capture");
      if (data.fees.coverage === "lines" && !fee)
        reasons.push("actual_fee_unavailable");
      const net =
        conversion.amount === null || (data.fees.coverage === "lines" && !fee)
          ? null
          : String(
              (line.kind === "capture" ? 1n : -1n) * BigInt(conversion.amount) -
                (data.fees.coverage === "lines" && fee
                  ? BigInt(fee.total)
                  : 0n),
            );
      const observed = String(
        BigInt(line.creditMinor) - BigInt(line.debitMinor),
      );
      if (data.fees.coverage === "lines" && difference(observed, net) !== "0")
        reasons.push("transaction_difference");
      return {
        ...line,
        source: source ?? null,
        observedConversion:
          line.original?.currency === data.money.currency
            ? null
            : line.kind === "capture" &&
                source?.baseCurrency === data.money.currency &&
                source.baseAmountMinor !== null
              ? {
                  kind: "realized_native_amount_ratio",
                  numerator: source.baseAmountMinor,
                  denominator: line.original?.minor ?? null,
                  units: "target_minor_per_source_minor",
                  effectiveAt: source.paidAt,
                  rounding: "native_amount_authoritative_no_rounding_inferred",
                  source: {
                    provider: source.provider,
                    account: source.account,
                    mode: source.mode,
                    paymentId: source.paymentId,
                  },
                }
              : line.conversion
                ? {
                    kind: "operator_asserted_authoritative_conversion",
                    ...line.conversion,
                  }
                : null,
        conversionSource:
          line.original?.currency === data.money.currency
            ? "same_currency"
            : line.kind === "capture" &&
                source?.baseCurrency === data.money.currency
              ? "native_base_amount"
              : line.conversion
                ? "operator_conversion_evidence"
                : "unavailable",
        expectedNetMinor: net,
        observedNetMinor: observed,
        differenceMinor: difference(observed, net),
        fee,
      };
    });
    const aggregate = fees(
      data.fees.amountMinor,
      data.fees.taxMinor,
      data.fees.presentation,
    );
    const lineFees = movements.map((l) => l.fee);
    let fee =
      data.fees.coverage === "aggregate"
        ? aggregate
        : data.fees.coverage === "lines" && lineFees.every((f) => f !== null)
          ? {
              total: sum(lineFees.map((f) => f!.total)),
              cost: sum(lineFees.map((f) => f!.cost)),
              tax: sum(lineFees.map((f) => f!.tax)),
            }
          : null;
    const knownNativeFees = movements
      .filter(
        (l) =>
          l.kind === "capture" && l.source?.feeCurrency === data.money.currency,
      )
      .flatMap((l) => (l.source?.feeMinor ? [l.source.feeMinor] : []));
    if (
      data.fees.coverage === "aggregate" &&
      aggregate &&
      BigInt(aggregate.total) < BigInt(sum(knownNativeFees))
    ) {
      reasons.push("aggregate_omits_native_processing_fees");
      fee = null;
    }
    if (!fee) reasons.push("actual_fee_unavailable");
    // Aggregate and included lines are alternative coverage of the same cost.
    // Retain both presentations; deduct only the selected authoritative coverage.
    if (
      data.fees.coverage === "aggregate" &&
      aggregate &&
      lineFees.every((f) => f !== null) &&
      (sum(lineFees.map((f) => f!.total)) !== aggregate.total ||
        sum(lineFees.map((f) => f!.tax)) !== aggregate.tax)
    )
      reasons.push("fee_coverage_difference");
    const expectedNetMinor =
      movements.every((l) => l.expectedNetMinor !== null) && fee
        ? String(
            movements.reduce((a, l) => a + BigInt(l.expectedNetMinor!), 0n) -
              (data.fees.coverage === "aggregate" ? BigInt(fee.total) : 0n),
          )
        : null;
    const observedNetMinor =
      data.creditMinor === null || data.debitMinor === null
        ? null
        : String(BigInt(data.creditMinor) - BigInt(data.debitMinor));
    if (observedNetMinor === null)
      reasons.push("provider_debit_credit_unavailable");
    const lineObservedMinor = sum(movements.map((l) => l.observedNetMinor));
    if (difference(lineObservedMinor, observedNetMinor) !== "0")
      reasons.push("provider_line_coverage_difference");
    const providerDifferenceMinor = difference(
      observedNetMinor,
      expectedNetMinor,
    );
    const transferDifferenceMinor = difference(
      data.money.minor,
      observedNetMinor,
    );
    if (providerDifferenceMinor !== "0") reasons.push("provider_difference");
    if (transferDifferenceMinor !== "0") reasons.push("transfer_difference");
    const receipts = active.filter(
      (r) =>
        r.data.kind === "bank_receipt" &&
        r.data.provider === data.provider &&
        r.data.account === data.account &&
        r.data.mode === data.mode &&
        r.data.settlementId === data.settlementId,
    );
    const matching = receipts.filter((r) => {
      const b = r.data;
      if (b.kind !== "bank_receipt") return false;
      const bound =
        !duplicates.has(r.id) &&
        !!data.transferReference &&
        b.transferReference === data.transferReference &&
        b.bankAccountRef === data.bankAccountRef &&
        b.money.currency === data.money.currency &&
        b.money.precision === data.money.precision &&
        !!data.transferAt &&
        b.valueAt >=
          (b.valueAt.length === 10
            ? data.transferAt.slice(0, 10)
            : data.transferAt);
      if (!bound)
        reasons.push(
          duplicates.has(r.id)
            ? "duplicate_bank_transaction"
            : "bank_identity_currency_or_date_mismatch",
        );
      return bound;
    });
    const bankObservedMinor = matching.length
      ? sum(matching.map((r) => r.data.money.minor))
      : null;
    const bankDifferenceMinor = difference(bankObservedMinor, data.money.minor);
    if (bankObservedMinor === null) reasons.push("bank_evidence_unavailable");
    else if (bankDifferenceMinor !== "0") reasons.push("bank_difference");
    const core = {
      id: record.id,
      identity: record.identity,
      actorId: record.actorId,
      at: record.at,
      provenance: record.provenance,
      data,
      movements,
      expectedNetMinor,
      observedNetMinor,
      lineObservedMinor,
      providerDifferenceMinor,
      transferDifferenceMinor,
      processingCostMinor: fee?.cost ?? null,
      feeTaxMinor: fee?.tax ?? null,
      feeTotalMinor: fee?.total ?? null,
      bankObservedMinor,
      bankDifferenceMinor,
      receipts: receipts.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        at: r.at,
        data: r.data,
        matched: matching.some((m) => m.id === r.id),
      })),
      reasons: [...new Set(reasons)].sort(),
    };
    const reportHash = createHash("sha256")
      .update(JSON.stringify(core))
      .digest("hex");
    const reviews = snapshot.reviews
      .filter((r) => r.recordId === record.id)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const resolved = reviews.some(
      (r) => r.reportHash === reportHash && r.outcome === "resolved",
    );
    return {
      ...core,
      reportHash,
      reviews,
      status: core.reasons.length
        ? "review_required"
        : resolved
          ? "resolved_operator_assertion"
          : "ready_for_review",
    };
  });
  const currencies = [...new Set(sources.map((s) => s.currency))].sort();
  const expected = currencies.map((currency) => {
    const group = sources.filter((s) => s.currency === currency);
    return {
      currency,
      precision: 2,
      grossMinor: sum(group.map((s) => s.totals.totalMinor)),
      salesTaxMinor: sum(group.map((s) => s.totals.taxMinor)),
      revenueMinor: sum(group.map((s) => s.totals.netMinor)),
      refundCashMinor: sum(
        group.flatMap((s) =>
          s.effects
            .filter((e) => e.source === "refund")
            .map((e) => e.actualMinor),
        ),
      ),
      disputeDeductionMinor: sum(
        group.flatMap((s) =>
          s.effects
            .filter((e) => e.source === "dispute")
            .map((e) => e.actualMinor),
        ),
      ),
      creditGrossMinor: sum(
        group.flatMap((s) => s.credits.map((c) => c.totals.totalMinor)),
      ),
      creditTaxMinor: sum(
        group.flatMap((s) => s.credits.map((c) => c.totals.taxMinor)),
      ),
    };
  });
  const unresolved = sources.flatMap((s) => {
    const result: { sourceId: string; reason: string }[] = [];
    if (!s.invoice)
      result.push({
        sourceId: s.periodId,
        reason: "seller_invoice_unavailable",
      });
    if (
      !active.some(
        (r) =>
          r.data.kind === "settlement" &&
          r.data.lines.some(
            (l) => l.kind === "capture" && l.sourceId === s.periodId,
          ),
      )
    )
      result.push({ sourceId: s.periodId, reason: "settlement_unavailable" });
    for (const e of s.effects)
      if (
        !active.some(
          (r) =>
            r.data.kind === "settlement" &&
            r.data.lines.some((l) => l.sourceId === e.id),
        )
      )
        result.push({ sourceId: e.id, reason: "actual_deduction_not_linked" });
    for (const c of s.pendingCases)
      result.push({ sourceId: c.id, reason: "native_outcome_not_money_proof" });
    return result;
  });
  const linkedIds = new Set(
    settlements.flatMap((s) =>
      s.movements.flatMap((l) => (l.source ? [l.source.periodId] : [])),
    ),
  );
  const identities = new Set(selected.map((r) => r.identity));
  const history = snapshot.records.filter(
    (r) =>
      identities.has(r.identity) ||
      (r.data.kind === "bank_receipt" &&
        selected.some(
          (s) =>
            s.data.provider === r.data.provider &&
            s.data.account === r.data.account &&
            s.data.mode === r.data.mode &&
            s.data.settlementId === r.data.settlementId,
        )),
  );
  const reviews = snapshot.reviews.filter((r) =>
    history.some((h) => h.id === r.recordId),
  );
  const unlinkedReceipts = active.filter(
    (r) =>
      r.data.kind === "bank_receipt" &&
      inPeriod(r.data.observedAt) &&
      !settlements.some((s) => s.receipts.some((b) => b.id === r.id)),
  );
  const evidenceIds = new Set(
    [...history, ...unlinkedReceipts]
      .flatMap((r) => [
        r.data.evidenceId,
        ...(r.data.kind === "settlement"
          ? r.data.lines.flatMap((l) =>
              l.conversion ? [l.conversion.evidenceId] : [],
            )
          : []),
      ])
      .concat(reviews.flatMap((r) => r.evidenceIds)),
  );
  const groups = [
    ...new Set(
      settlements.map((s) =>
        JSON.stringify([
          s.data.provider,
          s.data.account,
          s.data.mode,
          s.data.money.currency,
          s.data.money.precision,
        ]),
      ),
    ),
  ];
  const observed = groups.map((key) => {
    const group = settlements.filter(
        (s) =>
          JSON.stringify([
            s.data.provider,
            s.data.account,
            s.data.mode,
            s.data.money.currency,
            s.data.money.precision,
          ]) === key,
      ),
      first = group[0].data;
    const total = (values: (string | null)[]) =>
      values.some((v) => v === null)
        ? null
        : sum(values.filter((v): v is string => v !== null));
    const duplicate = group.some((s) =>
      s.reasons.includes("duplicate_settlement_identity"),
    );
    const expectedNetMinor = duplicate
        ? null
        : total(group.map((s) => s.expectedNetMinor)),
      providerNetMinor = duplicate
        ? null
        : total(group.map((s) => s.observedNetMinor)),
      bankMinor = duplicate
        ? null
        : total(group.map((s) => s.bankObservedMinor));
    return {
      provider: first.provider,
      account: first.account,
      mode: first.mode,
      currency: first.money.currency,
      precision: first.money.precision,
      recordIds: group.map((s) => s.id),
      expectedNetMinor,
      providerNetMinor,
      transferMinor: duplicate
        ? null
        : sum(group.map((s) => s.data.money.minor)),
      bankMinor,
      providerDifferenceMinor: difference(providerNetMinor, expectedNetMinor),
      bankDifferenceMinor: duplicate
        ? null
        : difference(bankMinor, sum(group.map((s) => s.data.money.minor))),
      processingCostMinor: duplicate
        ? null
        : total(group.map((s) => s.processingCostMinor)),
      feeTaxMinor: duplicate ? null : total(group.map((s) => s.feeTaxMinor)),
      coverage: duplicate
        ? "duplicate_identity_unresolved"
        : group.some((s) => s.reasons.length)
          ? "review_required"
          : "evidenced_operator_assertions",
    };
  });
  return {
    version: 1,
    period,
    coverage: {
      charges: "captured_at_in_period",
      adjustments:
        "lifetime_actual_effects_and_permanent_credits_for_charge_cohort",
      settlements: "active_observed_at_in_period",
      bank: "all_retained_receipts_for_selected_settlements",
      pagination: "complete",
      currencyPrecision: "original_minor_units",
      provenance: "operator_assertions_not_native_bank_verification",
    },
    sources,
    linkedSources: snapshot.sources.filter((s) => linkedIds.has(s.periodId)),
    expected,
    observed,
    settlements,
    unresolved,
    history,
    reviews,
    evidence: snapshot.evidence.filter((e) => evidenceIds.has(e.id)),
    unlinkedReceipts,
  };
}
