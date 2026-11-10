import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export function SearchSetupNotice({
  businessId,
  issues,
}: {
  businessId: string;
  issues: string[];
}) {
  const tasks = new Map<string, { label: string; href: string }>();
  for (const issue of issues) {
    if (/connections are stopped/i.test(issue))
      tasks.set("data", {
        label: "Allow this business to connect services again",
        href: `/businesses/${businessId}/data`,
      });
    else if (/targeting|confirm.*brief|buyer.*review|home market/i.test(issue))
      tasks.set("setup", {
        label: "Confirm your products, customers and search areas",
        href: `/businesses/${businessId}/configuration`,
      });
    else if (/active paid discovery scope/i.test(issue))
      tasks.set("plan", {
        label: "Check your subscription and search allowance",
        href: `/businesses/${businessId}/plan`,
      });
    else
      tasks.set("support", {
        label: "Contact Lead Relay support to finish search service setup",
        href: "/contact",
      });
  }
  return (
    <Alert variant="warning">
      <AlertTitle>Search setup needs attention</AlertTitle>
      <AlertDescription>
        <p>
          Complete these steps before starting a search. You can still review
          saved prospects.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {Array.from(tasks, ([key, task]) => (
            <li key={key}>
              <Link
                className="inline-flex min-h-11 items-center underline underline-offset-4"
                href={task.href}
              >
                {task.label}
              </Link>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
