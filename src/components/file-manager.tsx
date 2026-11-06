"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  fileListingSchema,
  fileGrantSchema,
  uploadGrantSchema,
  fileViewSchema,
  type FileListing,
  type FileState,
} from "@/models/files";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";

const stateNames: Record<FileState, string> = {
  pending: "Awaiting upload",
  uploading: "Confirming upload",
  ready: "Available privately",
  failed: "Upload unconfirmed",
  deleting: "Deletion pending",
  deleted: "Deleted",
};
async function readResult<T>(response: Response, schema: z.ZodType<T>) {
  const value: unknown = await response.json();
  const envelope = z
    .object({
      success: z.boolean(),
      data: z.unknown().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .safeParse(value);
  if (!envelope.success)
    throw new Error("The response could not be read. Refresh and try again.");
  if (!response.ok || !envelope.data.success)
    throw new Error(
      envelope.data.message ?? "The action failed. Refresh and try again.",
    );
  const data = schema.safeParse(envelope.data.data);
  if (!data.success)
    throw new Error("The response could not be read. Refresh and try again.");
  return data.data;
}
const stamp = (value: string) =>
  `${value.slice(0, 10)} ${value.slice(11, 19)} UTC`;

export function FileManager({
  businessId,
  initial,
  purpose,
  apiBase,
  onListingChange,
}: {
  businessId: string;
  initial: FileListing;
  purpose?: "billing";
  apiBase?: string;
  onListingChange?(listing: FileListing): void;
}) {
  const [listing, setListing] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const base = apiBase ?? `/api/businesses/${businessId}/files`;
  const visibleFiles = listing.files.filter(
    (file) => !purpose || file.purpose === purpose,
  );
  const policy = listing.policy;
  async function refresh() {
    const next = await readResult(
      await fetch(base, { cache: "no-store" }),
      fileListingSchema,
    );
    setListing(next);
    onListingChange?.(next);
  }
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      await refresh();
    } catch (error) {
      setStatus("");
      setError(
        error instanceof Error
          ? error.message
          : "The action failed. Try again.",
      );
      try {
        await refresh();
      } catch {
        /* Keep the current list and selected file on session expiry. */
      }
    } finally {
      setBusy(false);
    }
  }
  function post(path: string, data: unknown = {}) {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  }
  const selectedType =
    file?.type ||
    (file?.name.toLowerCase().endsWith(".txt") ? "text/plain" : "");
  const selectionError =
    file &&
    policy &&
    (file.size === 0 ||
      file.size > policy.maxBytes ||
      !policy.allowedTypes.some((type) => type === selectedType))
      ? "Choose a nonempty file within the configured size and type rules."
      : "";
  return (
    <div className="space-y-8" aria-busy={busy}>
      {listing.readiness === "setup_required" && (
        <Alert variant="warning">
          Private files are not activated. The service operator must configure
          private US storage, file limits, retention and the cleanup schedule.
          Existing records remain visible.
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          {error}{" "}
          <Link href="/security" className="underline underline-offset-4">
            Check Security
          </Link>{" "}
          if verification is required.
        </Alert>
      )}
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {status}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>
            {purpose === "billing"
              ? "Private billing evidence"
              : "Upload a Business file"}
          </CardTitle>
          <CardDescription>
            Files belong to this Business. Owners and Admins can upload or
            delete. General files are available to current members. Billing
            evidence is restricted to Owners, Admins and authorized tax
            reviewers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {policy && (
            <p id="file-rules" className="text-sm text-muted-foreground">
              Up to {policy.maxBytes.toLocaleString()} bytes per file. Allowed
              types: {policy.allowedTypes.join(", ")}. Retention:{" "}
              {policy.retentionSeconds.toLocaleString()} seconds from upload
              reservation. Download access expires after at most{" "}
              {policy.accessTtlSeconds.toLocaleString()} seconds.
            </p>
          )}
          {listing.canManage ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!file || selectionError) return;
                void action(async () => {
                  setStatus("Reserving your private upload…");
                  const upload = await readResult(
                    await post(base, {
                      name: file.name,
                      contentType: selectedType,
                      size: file.size,
                      ...(purpose ? { purpose } : {}),
                    }),
                    uploadGrantSchema,
                  );
                  setStatus("Uploading and confirming your file…");
                  await readResult(
                    await fetch(`${base}/${upload.file.id}/content`, {
                      method: "PUT",
                      headers: {
                        "content-type": selectedType,
                        "x-file-token": upload.token,
                      },
                      body: file,
                    }),
                    fileViewSchema,
                  );
                  setFile(null);
                  if (input.current) input.current.value = "";
                  setStatus(
                    "Upload completed. Your file is available privately.",
                  );
                });
              }}
            >
              <Label htmlFor="business-file">Choose a file</Label>
              <Input
                ref={input}
                id="business-file"
                type="file"
                accept={policy?.allowedTypes.join(",")}
                aria-describedby="file-rules file-selection-error"
                disabled={busy || listing.readiness !== "configured"}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <p id="file-selection-error" className="text-sm text-destructive">
                {selectionError}
              </p>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !file ||
                  Boolean(selectionError) ||
                  listing.readiness !== "configured"
                }
              >
                Upload file
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask an Owner or Admin to upload or delete a file.
            </p>
          )}
        </CardContent>
      </Card>
      <section className="space-y-4" aria-labelledby="files-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="files-heading"
            className="text-xl font-semibold tracking-tight"
          >
            {purpose === "billing" ? "Billing documents" : "Business files"}
          </h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setStatus("File list refreshed.");
              })
            }
          >
            Refresh files
          </Button>
        </div>
        {visibleFiles.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
            No files yet. Upload an approved Business document when storage is
            activated.
          </p>
        )}
        <ul className="space-y-4">
          {visibleFiles.map((file) => (
            <li
              key={file.id}
              className="space-y-4 rounded-2xl border border-border bg-card p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="min-w-0 font-semibold wrap-anywhere">
                  {file.name}
                </h3>
                <Badge>
                  {file.purpose === "billing" && "Billing evidence · "}
                  {file.state === "ready" && !file.accessAvailable
                    ? "Access unavailable"
                    : stateNames[file.state]}
                </Badge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Type and size</dt>
                  <dd className="wrap-anywhere">
                    {file.contentType} · {file.size.toLocaleString()} bytes
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Uploaded by</dt>
                  <dd className="wrap-anywhere">{file.ownerId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Retention deadline</dt>
                  <dd>{stamp(file.retentionUntil)}</dd>
                </div>
                {file.cleanupAfter && (
                  <div>
                    <dt className="text-muted-foreground">
                      Next cleanup eligibility
                    </dt>
                    <dd>{stamp(file.cleanupAfter)}</dd>
                  </div>
                )}
                {file.deletedAt && (
                  <div>
                    <dt className="text-muted-foreground">
                      Deletion confirmed
                    </dt>
                    <dd>{stamp(file.deletedAt)}</dd>
                  </div>
                )}
              </dl>
              {file.failure && (
                <p className="text-sm text-warning">
                  {file.failure === "CLEANUP_FAILED"
                    ? "Storage deletion failed. Cleanup will retry; the file cannot be downloaded."
                    : "Upload could not be confirmed. The file cannot be downloaded. Cleanup is pending; upload a new copy."}
                </p>
              )}
              {file.state === "pending" && (
                <p className="text-sm text-muted-foreground">
                  Upload is incomplete and cannot be downloaded. The reservation
                  expires at {stamp(file.uploadExpiresAt)}. Upload a new copy if
                  interrupted.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                {file.state === "ready" && (
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      !file.accessAvailable ||
                      listing.readiness !== "configured"
                    }
                    onClick={() =>
                      void action(async () => {
                        setStatus("Authorizing your download…");
                        const grant = await readResult(
                          await post(`${base}/${file.id}/access`),
                          fileGrantSchema,
                        );
                        const response = await fetch(
                          `${base}/${file.id}/content`,
                          {
                            headers: { "x-file-token": grant.token },
                            cache: "no-store",
                          },
                        );
                        if (!response.ok) {
                          await readResult(response, fileViewSchema);
                          return;
                        }
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob),
                          link = document.createElement("a");
                        link.href = url;
                        link.download = file.name;
                        document.body.append(link);
                        link.click();
                        link.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        setStatus("Your private download is ready.");
                      })
                    }
                  >
                    Download {file.name}
                  </Button>
                )}
                {listing.canManage &&
                  !["deleted", "deleting"].includes(file.state) && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          disabled={busy || listing.readiness !== "configured"}
                        >
                          Delete {file.name}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Download access stops immediately. Storage cleanup
                          removes {file.name} permanently and may need to retry.
                          This cannot be undone.
                        </AlertDialogDescription>
                        <div className="flex flex-wrap justify-end gap-3">
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              void action(async () => {
                                await readResult(
                                  await post(`${base}/${file.id}/delete`),
                                  fileViewSchema,
                                );
                                setStatus(
                                  "Deletion requested. Cleanup status is shown with the file.",
                                );
                              })
                            }
                          >
                            Delete file
                          </AlertDialogAction>
                        </div>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Usage attributed to this Business</CardTitle>
          <CardDescription>
            R2 storage and request allowances are shared across the Cloudflare
            account. These records are not a per-Business free allowance or the
            provider bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            {listing.usage.storedBytes.toLocaleString()} bytes stored or
            awaiting confirmation/deletion. {listing.usage.putAttempts} upload,{" "}
            {listing.usage.getAttempts} download and{" "}
            {listing.usage.deleteAttempts} deletion attempts;{" "}
            {listing.usage.uncertainAttempts} unconfirmed outcomes.
          </p>
          <p>
            Access stops at the retention deadline even if storage cleanup is
            delayed. Deleted metadata and attributed request records are kept
            for the configured record retention period
            {policy
              ? ` (${policy.recordRetentionSeconds.toLocaleString()} seconds after confirmed deletion)`
              : ""}
            , then removed. US jurisdiction does not establish a specific state
            or data center.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
