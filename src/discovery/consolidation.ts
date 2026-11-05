import { createHash } from "node:crypto";
import type {
  ContactEvidence,
  DiscoveryBrief,
  DiscoveryProspect,
  ObservationView,
  ProspectView,
  SourceCheck,
} from "../models/discovery";
import { prospectView } from "./evidence";

type Snapshot = Omit<DiscoveryProspect, "id">;
const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function companyKey(data: Snapshot) {
  return data.company
    ? [normalize(data.company.name), new URL(data.company.website).origin]
    : null;
}

export function companyIdentity(data: Snapshot) {
  const company = companyKey(data);
  return company ? hash(company) : null;
}

// Exact evidence only: no name-only, shared-mailbox, fuzzy-domain or age thresholds.
export function identityKeys(data: Snapshot, brief: DiscoveryBrief) {
  const need = data.request
    ? [
        "request",
        normalize(data.request.quote),
        data.request.publishedAt,
        data.request.reference?.url ?? data.evidence[0].url,
      ]
    : [
        "fit",
        normalize(brief.offering),
        [
          brief.requirements.specifications,
          brief.requirements.minimumOrder,
          brief.requirements.deliveryConstraints,
          brief.requirements.serviceConstraints,
        ].map(normalize),
      ];
  const scope = [
    data.buyer.identity,
    data.buyer.use,
    normalize(data.market),
    need,
  ];
  const source = hash([
    "source",
    data.evidence[0].url,
    normalize(data.name),
    data.request
      ? [
          data.buyer.identity,
          data.buyer.use,
          normalize(data.market),
          "request",
          normalize(data.request.quote),
          data.request.publishedAt,
        ]
      : scope,
  ]);
  const company = data.buyer.identity !== "individual" && companyKey(data);
  const reference = data.request?.reference
    ? hash(["request_reference", normalize(data.name), scope])
    : null;
  return [
    ...(company ? [hash(["company", company, scope])] : []),
    ...(reference ? [reference] : []),
    source,
  ];
}

export function contactIdentities(
  data: Snapshot,
  businessId: string,
): Snapshot {
  const company = companyKey(data) ?? [
    data.evidence[0].url,
    normalize(data.name),
  ];
  return {
    ...data,
    contacts: data.contacts.map((contact) => ({
      ...contact,
      id:
        contact.id ??
        hash([
          businessId,
          company,
          contact.name ? normalize(contact.name) : null,
          contact.route ? [contact.route.kind, contact.route.value] : null,
        ]),
    })),
  };
}

export type RetainedObservation = Omit<ObservationView, "current"> & {
  prospectId: string;
  order: number;
};
export type OrderedSourceCheck = SourceCheck & { order: number };

const compareChecks = (a: OrderedSourceCheck, b: OrderedSourceCheck) =>
  a.checkedAt.localeCompare(b.checkedAt) || a.order - b.order;

export function consolidateViews(
  observations: RetainedObservation[],
  businessId: string,
  at: Date,
  checks: OrderedSourceCheck[] = [],
): ProspectView[] {
  const allChecks = [
    ...checks,
    ...observations.map((o) => ({
      runId: o.runId,
      url: o.data.evidence[0].url,
      checkedAt: o.checkedAt,
      order: o.order,
    })),
  ];
  const runChecks = new Map<string, OrderedSourceCheck>();
  const latest = new Map<string, OrderedSourceCheck>();
  for (const check of allChecks) {
    const key = `${check.runId}:${check.url}`;
    const previousRun = runChecks.get(key);
    const previousSource = latest.get(check.url);
    if (!previousRun || compareChecks(previousRun, check) < 0)
      runChecks.set(key, check);
    if (!previousSource || compareChecks(previousSource, check) < 0)
      latest.set(check.url, check);
  }
  const groups = new Map<string, RetainedObservation[]>();
  for (const observation of observations) {
    const group = groups.get(observation.prospectId) ?? [];
    group.push(observation);
    groups.set(observation.prospectId, group);
  }
  const isCurrent = (observation: RetainedObservation) => {
    const url = observation.data.evidence[0].url;
    const runCheck = runChecks.get(`${observation.runId}:${url}`);
    const sourceCheck = latest.get(url);
    return (
      !!runCheck && !!sourceCheck && compareChecks(runCheck, sourceCheck) === 0
    );
  };
  return [...groups]
    .map(([id, group]) => {
      group.sort(
        (a, b) =>
          a.checkedAt.localeCompare(b.checkedAt) ||
          a.order - b.order ||
          a.id.localeCompare(b.id),
      );
      const history: ObservationView[] = group.map((observation) => ({
        id: observation.id,
        runId: observation.runId,
        checkedAt: observation.checkedAt,
        outcome: observation.outcome,
        data: contactIdentities(observation.data, businessId),
        current: isCurrent(observation),
      }));
      const current = history.filter((observation) => observation.current);
      const sourceUrls = new Set(
        history.flatMap((o) => o.data.evidence.map((e) => e.url)),
      );
      const sourceChecks = allChecks
        .filter(
          (c, i, all) =>
            sourceUrls.has(c.url) &&
            all.findIndex(
              (other) =>
                other.url === c.url &&
                other.runId === c.runId &&
                other.checkedAt === c.checkedAt,
            ) === i,
        )
        .sort(compareChecks)
        .map(({ runId, url, checkedAt }) => ({ runId, url, checkedAt }));
      const selected = (current.at(-1) ?? history.at(-1))!;
      const reviewReasons: string[] = [];
      const identityConflict = current.some((o) => o.data.identityConflict);
      if (identityConflict)
        reviewReasons.push(
          "Identity evidence overlaps separate retained records. Review required; those records were not automatically merged.",
        );
      if (!current.length)
        reviewReasons.push(
          "This need is no longer established by the latest observation of its source. Review the history.",
        );
      const requests = current.map((o) => o.data.request);
      const requestConflict =
        new Set(
          requests.map((r) =>
            JSON.stringify(r && [r.status, r.publishedAt, r.expiresAt]),
          ),
        ).size > 1;
      if (requestConflict)
        reviewReasons.push(
          "Sources disagree about request status, dates or expiry. Open demand is unconfirmed.",
        );
      const contacts = new Map<string, ContactEvidence>();
      const roles = new Map<string, Set<string>>();
      const routes = new Map<string, Set<string>>();
      for (const observation of current)
        for (const contact of observation.data.contacts) {
          // Identical contact evidence is shown once; history retains every check.
          const key = contact.id!;
          contacts.set(key, contact);
          if (!contact.name) continue;
          const name = normalize(contact.name);
          const roleSet = roles.get(name) ?? new Set<string>();
          roleSet.add(contact.roleEvidence?.role ?? "unverified");
          roles.set(name, roleSet);
          const routeSet = routes.get(name) ?? new Set<string>();
          if (contact.route)
            routeSet.add(
              JSON.stringify([contact.route.kind, contact.route.value]),
            );
          routes.set(name, routeSet);
        }
      const conflictingNames = new Set(
        [...roles]
          .filter(([, values]) => values.size > 1)
          .map(([name]) => name),
      );
      if (conflictingNames.size)
        reviewReasons.push(
          "Sources disagree about a named contact's purchasing responsibility. Review original role evidence.",
        );
      if ([...routes.values()].some((values) => values.size > 1))
        reviewReasons.push(
          "Sources publish different routes for a named contact. Review their provenance before use.",
        );
      const view = prospectView(
        {
          ...selected.data,
          id,
          contacts: [...contacts.values()].map((c) =>
            identityConflict ||
            (c.name && conflictingNames.has(normalize(c.name)))
              ? { ...c, roleEvidence: null }
              : c,
          ),
          evidence: current.length
            ? current
                .flatMap((o) => o.data.evidence)
                .filter(
                  (e, i, all) =>
                    all.findIndex(
                      (other) => JSON.stringify(other) === JSON.stringify(e),
                    ) === i,
                )
            : selected.data.evidence,
        },
        at,
      );
      if (
        view.request &&
        (requestConflict || !current.length) &&
        view.requestState !== "expired"
      )
        view.requestState = "uncertain";
      if (requestConflict || (identityConflict && view.request))
        view.requestState = "uncertain";
      return {
        ...view,
        companyId: companyKey(selected.data)
          ? hash([businessId, companyKey(selected.data)])
          : null,
        firstCheckedAt: history[0].checkedAt,
        lastCheckedAt:
          sourceChecks.at(-1)?.checkedAt ?? history.at(-1)!.checkedAt,
        reviewReasons,
        history,
        sourceChecks,
      };
    })
    .sort(
      (a, b) =>
        b.lastCheckedAt.localeCompare(a.lastCheckedAt) ||
        a.id.localeCompare(b.id),
    );
}
