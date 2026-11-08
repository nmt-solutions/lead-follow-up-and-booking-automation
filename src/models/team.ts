import { z } from "zod";

export const roleSchema = z.enum(["owner", "admin", "salesperson"]);
export const assignableRoleSchema = z.enum(["admin", "salesperson"]);
export type BusinessRole = z.infer<typeof roleSchema>;
export const inviteSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  role: assignableRoleSchema,
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export const changeRoleSchema = z.strictObject({
  userId: z.string().min(1).max(256),
  role: assignableRoleSchema,
});
export const memberSchema = z.strictObject({
  userId: z.string().min(1).max(256),
});
export const invitationIdSchema = z.strictObject({ invitationId: z.uuid() });
export const acceptSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const capabilitySchema = z.enum([
  "profile.read",
  "profile.manage",
  "team.manage",
  "billing.read",
  "billing.manage",
  "integrations.manage",
  "commercial-authority.manage",
  "sales.work",
  "files.read",
  "files.manage",
]);
export type BusinessCapability = z.infer<typeof capabilitySchema>;
export const capabilities: Record<BusinessRole, readonly BusinessCapability[]> =
  {
    owner: capabilitySchema.options,
    admin: capabilitySchema.options,
    salesperson: ["profile.read", "sales.work", "files.read"],
  };
export const platformCapabilitySchema = z.enum([
  "refunds.manage",
  "notifications.manage",
  "operations.manage",
  "recovery.manage",
  "pilots.manage",
  "costs.manage",
  "documents.manage",
  "sender-health.manage",
  "whatsapp.review",
  "pricing.manage",
  "tax.manage",
  "reconciliation.manage",
]);
export type PlatformCapability = z.infer<typeof platformCapabilitySchema>;
export type Invitation = {
  id: string;
  businessId: string;
  email: string;
  role: "admin" | "salesperson";
  status: "pending" | "accepted" | "revoked" | "expired";
  delivery: "pending" | "sending" | "sent" | "unconfirmed";
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
};
export type TeamMember = {
  userId: string;
  email: string;
  role: BusinessRole;
  mfaEnrolled: boolean;
};
export type Team = {
  actorId: string;
  role: BusinessRole;
  members: TeamMember[];
  invitations: Invitation[];
};
export type AuditEntry = {
  id: string;
  businessId: string;
  actorId: string;
  action: string;
  subjectId: string;
  detail: string;
  at: Date;
};
export type InvitationMail = {
  businessId: string;
  actorId: string;
  invitationId: string;
  email: string;
  businessName: string;
  role: "admin" | "salesperson";
  url: string;
  expiresAt: Date;
};
export type InvitationMailer = { send(message: InvitationMail): Promise<void> };
export type InvitationTokens = {
  issue(id: string): string;
  hash(token: string): string;
};
