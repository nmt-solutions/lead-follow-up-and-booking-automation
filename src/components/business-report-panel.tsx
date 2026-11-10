"use client";
import { WorkspaceTabs } from "./workspace-tabs";
import { Field, FieldGroup } from "./ui/field";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { z } from "zod";
import {
  businessReportSchema,
  type BusinessReport,
  type ReportMetric,
} from "@/models/reporting";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const responseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: businessReportSchema }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
const groups = [
  ["discovery", "Prospect searches"],
  ["sales", "Sales results"],
  ["communication", "Messages"],
  ["activity", "Team activity"],
  ["cost", "Usage and cost"],
] as const;
const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
function MetricRow({ metric }: { metric: ReportMetric }) {
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="min-h-11 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
        <span className="mr-3 font-medium">{metric.label}</span>
        <span className="font-semibold tabular-nums">
          {metric.value === null
            ? "Unavailable"
            : `${number(metric.value)} ${metric.unit}`}
        </span>
        <span className="ml-3 inline-block">
          <Badge>{metric.status}</Badge>
        </span>
        {metric.denominator !== null && (
          <span className="mt-2 block text-sm text-muted-foreground">
            Total included: {number(metric.denominator)} ·{" "}
            {metric.ratio === null
              ? "No total available for this rate"
              : `${number(metric.ratio * 100)}% of this population`}
          </span>
        )}
      </summary>
      <div className="flex flex-col mt-3 gap-2 text-sm leading-relaxed">
        <p>{metric.definition}</p>
        <p className="text-muted-foreground">Includes: {metric.cohort}</p>
      </div>
    </details>
  );
}

export function BusinessReportPanel({
  businessId,
  initialReport,
}: {
  businessId: string;
  initialReport: BusinessReport;
}) {
  const [report, setReport] = useState<BusinessReport | null>(initialReport);
  const [from, setFrom] = useState(initialReport.from.slice(0, 16));
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("all");
  const [appliedCategory, setAppliedCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [security, setSecurity] = useState(false);
  const [loaded, setLoaded] = useState(false);
  async function load(offset: number, paging = false) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    setSecurity(false);
    try {
      const fromDate = new Date(`${from}:00Z`);
      const toDate = to ? new Date(`${to}:00Z`) : null;
      if (
        !paging &&
        (!Number.isFinite(fromDate.getTime()) ||
          (toDate &&
            (!Number.isFinite(toDate.getTime()) || fromDate >= toDate)))
      ) {
        setError("Choose a valid start and a later end in UTC.");
        return;
      }
      const params = new URLSearchParams({
        from: paging && report ? report.from : fromDate.toISOString(),
        category: paging ? appliedCategory : category,
        offset: String(offset),
        limit: "25",
      });
      if (paging && report) params.set("to", report.to);
      else if (toDate) params.set("to", toDate.toISOString());
      const response = await fetch(
        `/api/businesses/${businessId}/reports?${params}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const result = responseSchema.parse(await response.json());
      if (!result.success) {
        if (
          [
            "UNAUTHENTICATED",
            "MFA_REQUIRED",
            "NOT_FOUND",
            "FORBIDDEN",
          ].includes(result.code)
        ) {
          setReport(null);
          setSecurity(true);
          setError(
            "Your current session or Business access could not be verified. Sign in or verify your authenticator, then update the report.",
          );
          return;
        }
        setError(
          result.code === "INVALID_INPUT"
            ? "Check the UTC interval. Its end must not be in the future."
            : "The report could not be loaded. Try again.",
        );
        return;
      }
      if (result.data.businessId !== businessId)
        throw new Error("Unexpected Business");
      setReport(result.data);
      if (!paging) setAppliedCategory(category);
      setLoaded(true);
    } catch {
      setError("The report could not be loaded. Try again.");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void load(0);
  }
  return (
    <div className="flex flex-col gap-8" aria-busy={busy}>
      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="report-from">From, UTC</Label>
                  <Input
                    id="report-from"
                    type="datetime-local"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    required
                  />
                </Field>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="report-to">To, UTC, optional</Label>
                  <Input
                    id="report-to"
                    type="datetime-local"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </Field>
              </div>
              <Field className="flex flex-col gap-2">
                <Label htmlFor="report-detail-category">Show details for</Label>
                <NativeSelect
                  id="report-detail-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">All activity</option>
                  <option value="discovery">Discovery</option>
                  <option value="sales">Sales</option>
                  <option value="communication">Communication</option>
                  <option value="activity">Human activity</option>
                </NativeSelect>
              </Field>
              <Button disabled={busy}>
                {busy ? "Loading report…" : "Update report"}
              </Button>
              <p className="text-sm text-muted-foreground">
                The dates apply to the results below. The activity filter
                changes the activity records only.
              </p>
              {error && (
                <Alert role="alert">
                  {error}
                  {security && (
                    <span className="ml-2">
                      <RecoveryLink
                        className="text-primary underline"
                        href="/security"
                      >
                        Security
                      </RecoveryLink>{" "}
                      ·{" "}
                      <RecoveryLink
                        className="text-primary underline"
                        href="/sign-in"
                      >
                        Sign in
                      </RecoveryLink>
                    </span>
                  )}
                </Alert>
              )}
              <p role="status" className="text-sm text-muted-foreground">
                {busy
                  ? "Reading retained Business records…"
                  : loaded
                    ? "Report updated."
                    : "Report loaded."}
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {report && (
        <WorkspaceTabs
          tabs={[
            {
              id: "results",
              label: "Results",
              description:
                "Review searches, sales and communication results for the selected dates.",
              content: (
                <>
                  <Tabs
                    defaultValue="discovery"
                    className="flex flex-col gap-5"
                  >
                    <TabsList className="h-auto flex-wrap justify-start">
                      {groups.map(([id, label]) => (
                        <TabsTrigger key={id} value={id}>
                          {label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {groups.map(([id, label]) => (
                      <TabsContent key={id} value={id}>
                        <Card>
                          <CardHeader>
                            <CardTitle>{label}</CardTitle>
                            <p className="text-sm text-muted-foreground">
                              Open a result to see how it is counted. Outcomes
                              can overlap; these sections are not a single
                              conversion funnel.
                            </p>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-3">
                            {report.metrics
                              .filter((m) => m.group === id)
                              .map((m) => (
                                <MetricRow key={m.id} metric={m} />
                              ))}
                          </CardContent>
                        </Card>
                      </TabsContent>
                    ))}
                  </Tabs>
                </>
              ),
            },
            {
              id: "records",
              label: "Activity records",
              description:
                "Review the records behind the counts. These records explain individual events and outcomes.",
              content: (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Source details</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {report.details.total === 0
                          ? "No retained source details in this interval. Try a wider interval or record sales activity through its normal workflow."
                          : `Showing ${report.details.offset + 1}–${report.details.offset + report.details.items.length} of ${report.details.total} retained source details. Aggregates cover the complete populations described above.`}
                      </p>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <ol className="flex flex-col gap-3">
                        {report.details.items.map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-col gap-2 rounded-xl border border-border p-4 text-sm wrap-anywhere"
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <Link
                                className="inline-flex min-h-11 items-center font-medium text-primary underline"
                                href={item.link}
                              >
                                {item.kind.replaceAll("_", " ")}
                              </Link>
                              <Badge>{item.state}</Badge>
                              <span>
                                {item.channel ?? "Shared sales context"}
                              </span>
                            </div>
                            <p>{item.note}</p>
                            <p className="text-muted-foreground">
                              Source time: {item.at}
                              {item.version !== null
                                ? ` · Version ${item.version}`
                                : ""}
                            </p>
                            <details>
                              <summary className="min-h-11 cursor-pointer content-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
                                Records behind these results
                              </summary>
                              <p className="mt-2 font-mono text-xs">
                                {item.sourceIds.join(" · ")}
                              </p>
                            </details>
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="outline"
                          disabled={busy || report.details.offset === 0}
                          onClick={() =>
                            void load(
                              Math.max(
                                0,
                                report.details.offset - report.details.limit,
                              ),
                              true,
                            )
                          }
                        >
                          Previous source page
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || report.details.nextOffset === null}
                          onClick={() =>
                            report.details.nextOffset !== null &&
                            void load(report.details.nextOffset, true)
                          }
                        >
                          Next source page
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ),
            },
            {
              id: "definitions",
              label: "How results are counted",
              description:
                "Check which records each measure includes and what has not been measured.",
              content: (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>How to read these results</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Generated {report.asOf} · Interval {report.from} through{" "}
                        {report.to}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <ul className="flex flex-col list-disc gap-2 pl-5 text-sm leading-relaxed">
                        {report.coverage.map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                      <p className="mt-4 text-sm">
                        Contact accuracy and human hours need measurements that
                        are not currently recorded. Named-role coverage and
                        written activity remain visible separately.
                      </p>
                    </CardContent>
                  </Card>
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
