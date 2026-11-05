"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { AuditEntry, Team } from "@/models/team";
import { inviteSchema } from "@/models/team";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

const resultSchema = z.object({ success: z.literal(true) });
const roleNames = {
  owner: "Owner",
  admin: "Admin",
  salesperson: "Salesperson",
};
function timestamp(date: Date) {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
const auditNames: Record<string, string> = {
  "invitation.created": "Invitation created",
  "invitation.accepted": "Invitation accepted",
  "invitation.revoked": "Invitation revoked",
  "invitation.expired": "Invitation expired",
  "invitation.delivery_sent": "Invitation email sent",
  "invitation.delivery_unconfirmed": "Invitation email delivery unconfirmed",
  "membership.role_changed": "Role changed",
  "membership.removed": "Member removed",
};

export function TeamManager({
  businessId,
  team,
  audit,
}: {
  businessId: string;
  team: Team;
  audit: AuditEntry[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const focusAfterCommand = useRef<HTMLElement | null>(null);
  const base = `/api/businesses/${businessId}/team`;
  useEffect(() => {
    if (removing)
      document.getElementById(`confirm-remove-${removing}`)?.focus();
  }, [removing]);
  useEffect(() => {
    if (!pending && focusAfterCommand.current?.isConnected) {
      focusAfterCommand.current.focus();
      focusAfterCommand.current = null;
    }
  }, [pending]);

  async function command(
    path: string,
    method: string,
    input: unknown,
    success: string,
  ) {
    focusAfterCommand.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Your session has ended. Sign in again, then refresh this page."
            : response.status === 403 || response.status === 404
              ? "Your access has changed. Refresh this page to check your permissions."
              : response.status === 409
                ? "A pending invitation or membership may already exist. Refresh the team before trying again."
                : "This change could not be confirmed. Refresh the team to check its status.",
        );
        return false;
      }
      const json: unknown = await response.json();
      if (!resultSchema.safeParse(json).success)
        throw new Error("Invalid response");
      setMessage(success);
      setRemoving(null);
      if (method === "DELETE" && path === base)
        focusAfterCommand.current = document.getElementById("members-title");
      router.refresh();
      return true;
    } catch {
      setError(
        "Check your connection, then refresh the team to check whether your change was saved.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8" aria-busy={pending}>
      <section
        className="rounded-2xl border border-border bg-card p-5 sm:p-8"
        aria-labelledby="invite-title"
      >
        <h2 id="invite-title" className="text-xl font-semibold tracking-tight">
          Invite a teammate
        </h2>
        <p
          id="role-hint"
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        >
          Salespeople can view the Business and work on sales. Admins also
          manage the profile, billing, integrations, commercial authority and
          salespeople. Only the Owner can grant or change Admin access.
        </p>
        <form
          className="mt-6"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            const parsed = inviteSchema.safeParse({
              email: fields.get("email"),
              role: fields.get("role"),
              expiresInDays: Number(fields.get("expiresInDays")),
            });
            if (!parsed.success) {
              setError(
                "Enter a valid email and an expiry between 1 and 30 days.",
              );
              return;
            }
            if (
              await command(
                `${base}/invitations`,
                "POST",
                parsed.data,
                "Invitation saved. Check its delivery status below.",
              )
            )
              form.reset();
          }}
        >
          <fieldset
            disabled={pending}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
          >
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="invite-email">Teammate email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <NativeSelect
                id="invite-role"
                name="role"
                defaultValue="salesperson"
                aria-describedby="role-hint"
              >
                <option value="salesperson">Salesperson</option>
                {team.role === "owner" && <option value="admin">Admin</option>}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-expiry">Expires in days</Label>
              <Input
                id="invite-expiry"
                name="expiresInDays"
                type="number"
                min={1}
                max={30}
                required
                defaultValue={7}
              />
            </div>
            <Button
              type="submit"
              className="sm:col-span-2 sm:justify-self-start"
            >
              {pending ? "Saving…" : "Send invitation"}
            </Button>
          </fieldset>
        </form>
      </section>
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive empty:hidden">
          {error}
        </p>
        {error && (
          <div className="flex flex-wrap gap-4">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => router.refresh()}
            >
              Refresh team
            </Button>
            <a
              className="inline-flex min-h-11 items-center text-sm text-primary underline"
              href="/sign-in"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sign in in a new tab
            </a>
          </div>
        )}
        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {pending ? "Saving team changes…" : message}
        </p>
      </div>
      <section aria-labelledby="members-title">
        <h2
          id="members-title"
          tabIndex={-1}
          className="mb-4 text-xl font-semibold tracking-tight"
        >
          Team members
        </h2>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {team.members.map((member) => {
            const editable =
              member.role !== "owner" &&
              (team.role === "owner" || member.role === "salesperson");
            return (
              <li key={member.userId} className="space-y-4 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium wrap-anywhere">
                      {member.email}
                      {member.userId === team.actorId && " (you)"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {roleNames[member.role]}
                    </p>
                  </div>
                  {editable && (
                    <Button
                      variant="outline"
                      id={`remove-${member.userId}`}
                      disabled={pending}
                      onClick={() => setRemoving(member.userId)}
                      aria-label={`Remove ${member.email}`}
                    >
                      Remove member
                    </Button>
                  )}
                </div>
                {editable && team.role === "owner" && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void command(
                        base,
                        "PATCH",
                        {
                          userId: member.userId,
                          role: new FormData(event.currentTarget).get("role"),
                        },
                        "Role saved. The new permissions apply immediately.",
                      );
                    }}
                  >
                    <fieldset
                      disabled={pending}
                      className="flex min-w-0 flex-wrap items-end gap-3"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <Label
                          htmlFor={`role-${member.userId}`}
                          className="wrap-anywhere"
                        >
                          Role for {member.email}
                        </Label>
                        <NativeSelect
                          key={member.role}
                          id={`role-${member.userId}`}
                          name="role"
                          defaultValue={member.role}
                        >
                          <option value="salesperson">Salesperson</option>
                          <option value="admin">Admin</option>
                        </NativeSelect>
                      </div>
                      <Button type="submit" variant="outline">
                        Save role
                      </Button>
                    </fieldset>
                  </form>
                )}
                {removing === member.userId && (
                  <div
                    className="space-y-3 rounded-lg border border-border bg-muted p-4"
                    role="group"
                    aria-label={`Confirm removal of ${member.email}`}
                  >
                    <p className="text-sm leading-relaxed">
                      Remove {member.email}? They will lose access immediately.
                      Their pending invitations will be revoked. You can invite
                      them again.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        id={`confirm-remove-${member.userId}`}
                        disabled={pending}
                        onClick={() =>
                          void command(
                            base,
                            "DELETE",
                            { userId: member.userId },
                            "Member removed. Access has ended.",
                          )
                        }
                      >
                        Confirm removal
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          setRemoving(null);
                          document
                            .getElementById(`remove-${member.userId}`)
                            ?.focus();
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="invitations-title">
        <h2
          id="invitations-title"
          className="mb-4 text-xl font-semibold tracking-tight"
        >
          Invitations
        </h2>
        {team.invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invitations yet. Invite a teammate using their work email above.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {team.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium wrap-anywhere">
                    {invitation.email}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {roleNames[invitation.role]} · {invitation.status}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Expires{" "}
                    <time dateTime={invitation.expiresAt.toISOString()}>
                      {timestamp(invitation.expiresAt)}
                    </time>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Email:{" "}
                    {invitation.delivery === "unconfirmed"
                      ? "delivery unconfirmed"
                      : invitation.delivery}
                  </p>
                </div>
                {invitation.status === "pending" &&
                  (team.role === "owner" ||
                    invitation.role === "salesperson") && (
                    <div className="flex flex-wrap gap-3">
                      {invitation.delivery !== "sent" && (
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            void command(
                              `${base}/invitations`,
                              "PATCH",
                              { invitationId: invitation.id },
                              "Notification checked. Review its delivery status.",
                            )
                          }
                        >
                          Retry email
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void command(
                            `${base}/invitations`,
                            "DELETE",
                            { invitationId: invitation.id },
                            "Invitation revoked. The link can no longer be accepted.",
                          )
                        }
                      >
                        Revoke invitation
                      </Button>
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          If email delivery is unconfirmed, retry within 24 hours of inviting.
          After that, revoke the invitation and create a new one.
        </p>
      </section>
      <section aria-labelledby="audit-title">
        <h2
          id="audit-title"
          className="mb-4 text-xl font-semibold tracking-tight"
        >
          Access history
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Team changes will appear here.
          </p>
        ) : (
          <ol className="space-y-4">
            {audit.map((entry) => (
              <li
                key={entry.id}
                className="border-l-2 border-border pl-4 text-sm"
              >
                <p className="font-medium">
                  {auditNames[entry.action] ?? "Team access updated"}
                  {entry.detail && ` · ${entry.detail}`}
                </p>
                <p className="mt-1 text-muted-foreground">
                  <time dateTime={entry.at.toISOString()}>
                    {timestamp(entry.at)}
                  </time>
                </p>
                <p className="mt-1 text-muted-foreground wrap-anywhere">
                  Changed by:{" "}
                  {team.members.find((m) => m.userId === entry.actorId)
                    ?.email ?? "Former teammate"}
                </p>
                <p className="text-muted-foreground wrap-anywhere">
                  For:{" "}
                  {team.invitations.find((i) => i.id === entry.subjectId)
                    ?.email ??
                    team.members.find((m) => m.userId === entry.subjectId)
                      ?.email ??
                    "Former teammate"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
