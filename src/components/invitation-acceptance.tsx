"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { acceptSchema, assignableRoleSchema } from "@/models/team";
import { Button } from "./ui/button";
import { SignInForm } from "./sign-in-form";
import { Alert, AlertDescription } from "./ui/alert";

const previewSchema = z.object({
  success: z.literal(true),
  data: z.object({
    businessName: z.string(),
    role: assignableRoleSchema,
    email: z.email(),
    expiresAt: z.iso.datetime(),
  }),
});
const acceptedSchema = z.object({
  success: z.literal(true),
  data: z.object({ businessId: z.uuid() }),
});
const mfaFailureSchema = z.object({ code: z.literal("MFA_REQUIRED") });
function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function InvitationAcceptance({
  signedIn,
  available,
}: {
  signedIn: boolean;
  available: boolean;
}) {
  const router = useRouter();
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => null,
  );
  const parsedToken = acceptSchema.safeParse({
    token: new URLSearchParams(hash?.slice(1)).get("token"),
  });
  const token = parsedToken.success ? parsedToken.data.token : null;
  const [loaded, setLoaded] = useState<{
    token: string;
    data: z.infer<typeof previewSchema>["data"];
  } | null>(null);
  const preview = loaded?.token === token ? loaded.data : null;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  useEffect(() => {
    if (!token || !signedIn) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/invitations/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal: controller.signal,
        });
        const json: unknown = await response.json();
        const parsed = previewSchema.safeParse(json);
        if (!response.ok || !parsed.success) {
          if (!controller.signal.aborted) {
            const needsMfa = mfaFailureSchema.safeParse(json).success;
            setMfaRequired(needsMfa);
            setError(
              needsMfa
                ? "Verify your account security, then check this invitation again."
                : "This invitation is unavailable. Sign in with the invited email, or ask for a new invitation.",
            );
          }
          return;
        }
        if (!controller.signal.aborted && token) {
          setLoaded({ token, data: parsed.data.data });
          setError("");
          setMfaRequired(false);
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Unable to load this invitation. Check your connection and reload the page.",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [token, signedIn]);

  if (!available)
    return (
      <p role="status">Sign-in is not available yet. Please try again later.</p>
    );
  if (hash === null) return <p role="status">Loading invitation…</p>;
  if (!token)
    return (
      <p role="status">
        Open the invitation link from your email to review and accept it.
      </p>
    );
  if (!signedIn)
    return (
      <div className="space-y-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Sign in with the email that received this invitation. You can review
          the Business and role before joining.
        </p>
        <SignInForm
          linkFailed={false}
          callbackURL={`/invitations#token=${token}`}
        />
      </div>
    );
  return (
    <div className="space-y-6">
      {preview ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight wrap-anywhere">
            Join {preview.businessName}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You are invited as{" "}
            {preview.role === "admin" ? "an Admin" : "a Salesperson"} using{" "}
            <span className="wrap-anywhere">{preview.email}</span>.
          </p>
          <p className="text-sm text-muted-foreground">
            {preview.role === "admin"
              ? "Admins manage this Business’s profile, billing, integrations, commercial authority and salespeople."
              : "Salespeople can view this Business and work on sales."}
          </p>
          <p className="text-sm text-muted-foreground">
            Expires{" "}
            <time dateTime={preview.expiresAt}>
              {preview.expiresAt.slice(0, 16).replace("T", " ")} UTC
            </time>
            .
          </p>
        </div>
      ) : (
        !error && <p role="status">Checking your invitation…</p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {error && mfaRequired && (
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <a href="/security" target="_blank" rel="noopener noreferrer">
              Verify security in a new tab
            </a>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Check invitation again
          </Button>
        </div>
      )}
      {error && !mfaRequired && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Use “Sign out to switch email” above to sign in with the invited
          address. You can reopen the original invitation email to return here.
        </p>
      )}
      {preview && (
        <Button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              const response = await fetch("/api/invitations/accept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
              });
              const json: unknown = await response.json();
              const parsed = acceptedSchema.safeParse(json);
              if (!response.ok || !parsed.success) {
                const needsMfa = mfaFailureSchema.safeParse(json).success;
                setMfaRequired(needsMfa);
                setError(
                  needsMfa
                    ? "Verify your account security, then check this invitation again."
                    : "This invitation could not be accepted. It may have expired or been revoked. Check your Businesses before trying again.",
                );
                return;
              }
              window.history.replaceState(null, "", "/invitations");
              router.push(
                `/businesses/${parsed.data.data.businessId}?joined=1`,
              );
              router.refresh();
            } catch {
              setError(
                "Check your connection. Open your Businesses to see whether the invitation was accepted.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Joining Business…" : "Accept invitation"}
        </Button>
      )}
    </div>
  );
}
