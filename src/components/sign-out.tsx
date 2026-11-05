"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";

export function SignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div className="text-right">
      <Button
        variant="ghost"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            const result = await authClient.signOut();
            if (result.error) {
              setError("Could not sign out. Try again.");
              return;
            }
            router.push("/sign-in");
            router.refresh();
          } catch {
            setError("Check your connection and try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      <p
        role="alert"
        className="max-w-56 text-sm text-destructive empty:hidden"
      >
        {error}
      </p>
    </div>
  );
}
