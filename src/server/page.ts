import "server-only";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { ApplicationError } from "../models/application-error";
import { publicFailure } from "../models/api";
import { reportFailure } from "./services";

export function pageFailure(error: unknown): never {
  if (error instanceof ApplicationError) {
    if (error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error.code === "MFA_REQUIRED") redirect("/security");
    if (
      error.code === "NOT_FOUND" ||
      error.code === "INVALID_INPUT" ||
      error.code === "FORBIDDEN"
    )
      notFound();
    if (error.code === "SETUP_REQUIRED") redirect("/sign-in");
  }
  reportFailure({ requestId: randomUUID(), code: publicFailure(error).code });
  throw new Error("Unable to load your Business. Please try again.");
}
