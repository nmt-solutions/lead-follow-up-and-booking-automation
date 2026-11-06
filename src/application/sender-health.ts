import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import {
  healthEvidenceSchema,
  healthPolicySchema,
} from "../models/sender-health";
import type { WorkIdentity } from "../models/discovery";
import type { createSenderHealthRepository } from "../db/sender-health-repository";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new ApplicationError("INVALID_INPUT");
  return value.data;
}
export function createSenderHealthApplication<C>(d: {
  authenticate(credentials: C): Promise<WorkIdentity>;
  repository: ReturnType<typeof createSenderHealthRepository>;
}) {
  const r = d.repository;
  return {
    async prune(c: C, b: unknown, i: unknown) {
      return r.prune(
        await d.authenticate(c),
        parse(z.uuid(), b),
        parse(z.uuid(), i),
      );
    },
    async workspace(c: C, b: unknown, operator = false) {
      return r.workspace(await d.authenticate(c), parse(z.uuid(), b), operator);
    },
    async configure(c: C, b: unknown, i: unknown, input: unknown) {
      return r.configure(
        await d.authenticate(c),
        parse(z.uuid(), b),
        parse(z.uuid(), i),
        parse(
          z.strictObject({
            expectedVersion: z.number().int().min(0).max(2147483646),
            policy: healthPolicySchema,
          }),
          input,
        ),
      );
    },
    async ingest(c: C, b: unknown, i: unknown, input: unknown) {
      return r.ingest(
        await d.authenticate(c),
        parse(z.uuid(), b),
        parse(z.uuid(), i),
        parse(healthEvidenceSchema, input),
      );
    },
    async alerts(c: C) {
      return r.alerts(await d.authenticate(c));
    },
    async acknowledge(c: C, b: unknown, id: unknown, operator = false) {
      return r.acknowledge(
        await d.authenticate(c),
        parse(z.uuid(), b),
        parse(z.uuid(), id),
        operator,
      );
    },
  };
}
