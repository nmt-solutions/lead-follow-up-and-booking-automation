import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col mx-auto max-w-lg gap-5 px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        Business not found
      </h1>
      <p className="leading-relaxed text-muted-foreground">
        Choose one of your Businesses to continue.
      </p>
      <Button asChild>
        <Link href="/businesses">Your Businesses</Link>
      </Button>
    </div>
  );
}
