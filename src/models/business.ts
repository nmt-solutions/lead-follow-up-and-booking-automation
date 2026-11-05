import { z } from "zod";

export const businessIdSchema = z.uuid();
export const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  offering: z.string().trim().min(1).max(4000),
  homeMarket: z.string().trim().max(200),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2048)]),
});

export type BusinessProfileInput = z.infer<typeof profileSchema>;
export type BusinessProfile = BusinessProfileInput & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

// Created by a trusted identity adapter, never by parsing an HTTP body.
export type Actor = { userId: string };
export type Clock = { now(): Date };
