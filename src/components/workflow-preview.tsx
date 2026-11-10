"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  FileSearch,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Badge } from "./ui/badge";
import { IsometricView } from "./isometric-view";

const stages = [
  {
    value: "discover",
    label: "Find buyers",
    icon: FileSearch,
    title: "Start with a relevant prospect.",
    description:
      "Search the markets you choose and review the public sources behind each match.",
    detail:
      "Your products, customer types, and search area guide the research.",
  },
  {
    value: "draft",
    label: "Prepare a reply",
    icon: MessageSquareText,
    title: "Give your team a starting point.",
    description:
      "Supported AI workflows use approved business information to prepare a draft for review.",
    detail:
      "Check the facts, wording, and promises before approving a sales action.",
  },
  {
    value: "follow-up",
    label: "Follow up",
    icon: Send,
    title: "Keep the next step clear.",
    description:
      "Approve your recipients, messages, and timing before starting supported follow-ups.",
    detail:
      "Replies, opt-outs, and human takeover stop the affected automation.",
  },
];
export function WorkflowPreview() {
  const [value, setValue] = useState("discover");
  const stage = stages.find((stage) => stage.value === value) ?? stages[0];
  const reduced = useReducedMotion();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>How LeadRelay works</CardTitle>
        <Badge variant="primary">
          <Sparkles aria-hidden="true" />
          AI-assisted
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <IsometricView />
        <ToggleGroup
          type="single"
          value={value}
          onValueChange={(next) => {
            if (next) setValue(next);
          }}
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-3"
          aria-label="Explore the sales workflow"
        >
          {stages.map((item) => (
            <ToggleGroupItem
              value={item.value}
              key={item.value}
              className="min-h-12 px-2 text-xs"
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <motion.div
          key={value}
          initial={
            value === "discover" ? false : { opacity: 0, x: reduced ? 0 : 6 }
          }
          animate={{ opacity: 1, x: 0 }}
          transition={{
            type: "spring",
            bounce: 0,
            duration: reduced ? 0 : 0.2,
          }}
          className="flex min-h-36 flex-col gap-3"
        >
          <h3 className="text-xl font-medium tracking-tight">{stage.title}</h3>
          <p className="text-sm leading-7 text-muted-foreground">
            {stage.description}
          </p>
          <p className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
            <ShieldCheck
              className="mt-1 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            {stage.detail}
          </p>
        </motion.div>
      </CardContent>
    </Card>
  );
}
