"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { profileSchema } from "@/models/registration";
import { RegistrationFields } from "./registration-fields";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";

export function CompleteProfileForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1>Tell us about yourself</h1>
        </CardTitle>
        <CardDescription>
          A few details to finish creating your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const profile = profileSchema.safeParse(
              Object.fromEntries(new FormData(event.currentTarget)),
            );
            if (!profile.success) {
              setError("Enter your name and account details.");
              return;
            }
            setPending(true);
            setError("");
            try {
              const response = await fetch("/api/auth/update-user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(profile.data),
              });
              if (!response.ok) {
                setError(
                  response.status === 401
                    ? "Your session expired. Sign in again."
                    : "Unable to save your details. Try again.",
                );
                return;
              }
              router.replace("/security");
              router.refresh();
            } catch {
              setError("Check your connection and try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          <RegistrationFields disabled={pending} />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
