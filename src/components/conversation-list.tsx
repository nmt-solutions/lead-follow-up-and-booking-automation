"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox, Search } from "lucide-react";
import { Badge } from "./ui/badge";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "./ui/empty";

type Conversation = {
  id: string;
  subject: string;
  buyerName: string;
  channel: string;
  needsReview: boolean;
  lastReceivedAt: string;
};
export function ConversationList({
  businessId,
  conversations,
}: {
  businessId: string;
  conversations: Conversation[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = conversations
    .filter(
      (item) =>
        (filter === "all" ||
          (filter === "review" && item.needsReview) ||
          item.channel === filter) &&
        `${item.buyerName} ${item.subject}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) => Date.parse(b.lastReceivedAt) - Date.parse(a.lastReceivedAt),
    );
  const needsReview = conversations.filter((item) => item.needsReview).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Customer conversations</CardTitle>
            <CardDescription>
              Inquiries and supported replies received by this business.
            </CardDescription>
          </div>
          <Badge variant={needsReview ? "warning" : "default"}>
            {needsReview
              ? `${needsReview} need review`
              : `${conversations.length} conversations loaded`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value);
            }}
            variant="outline"
            spacing={1}
            className="flex-wrap"
            aria-label="Filter conversations"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="review">Needs review</ToggleGroupItem>
            <ToggleGroupItem value="email">Email</ToggleGroupItem>
            <ToggleGroupItem value="whatsapp">WhatsApp</ToggleGroupItem>
          </ToggleGroup>
          <Field className="w-full sm:max-w-64">
            <FieldLabel htmlFor="conversation-search" className="sr-only">
              Search loaded conversations
            </FieldLabel>
            <Input
              id="conversation-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or subject"
            />
          </Field>
        </div>
        {visible.length ? (
          <ul className="divide-y divide-border">
            {visible.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/businesses/${businessId}/inbox/${item.id}`}
                  className="flex min-h-24 items-start gap-4 rounded-lg px-2 py-5 transition-colors hover:bg-muted/60"
                >
                  <Avatar className="size-10">
                    <AvatarFallback>
                      {item.buyerName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {item.buyerName}
                      </span>
                      <time
                        dateTime={item.lastReceivedAt}
                        className="text-xs text-muted-foreground"
                      >
                        {new Date(item.lastReceivedAt).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}{" "}
                        UTC
                      </time>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {item.subject}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {item.channel === "whatsapp" ? "WhatsApp" : "Email"}
                      </Badge>
                      {item.needsReview && (
                        <Badge variant="warning">Needs review</Badge>
                      )}
                    </div>
                  </div>
                  <ArrowUpRight
                    className="mt-1 hidden size-4 text-muted-foreground sm:block"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {conversations.length ? (
                  <Search aria-hidden="true" />
                ) : (
                  <Inbox aria-hidden="true" />
                )}
              </EmptyMedia>
              <EmptyTitle>
                {conversations.length
                  ? "No matching conversations"
                  : "No conversations yet"}
              </EmptyTitle>
              <EmptyDescription>
                {conversations.length
                  ? "Try another name, subject, or filter. Search covers the conversations currently loaded."
                  : "Replies to your Lead Relay outreach appear here. Start with a prospect search, or add a received inquiry from the section below."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {conversations.length ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link href={`/businesses/${businessId}/discovery`}>
                    Find prospects
                  </Link>
                </Button>
              )}
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
