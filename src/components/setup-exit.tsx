"use client";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

export function SetupExit({ businessId }: { businessId?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={() => {
        document.cookie = "lr_setup=; Path=/; SameSite=Lax; Max-Age=0";
        router.push(businessId ? `/businesses/${businessId}` : "/businesses");
        router.refresh();
      }}
    >
      Set up later
    </Button>
  );
}
