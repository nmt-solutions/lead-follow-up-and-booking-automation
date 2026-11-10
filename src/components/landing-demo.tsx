"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  FileSearch,
  Inbox,
  Mail,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Badge } from "./ui/badge";
import { ProviderMark } from "./provider-mark";

export function LandingDemo() {
  const [tab, setTab] = useState("find");
  const reduced = useReducedMotion();
  return (
    <div className="relative min-w-0">
      <div
        className="pointer-events-none absolute -inset-5 rounded-full bg-primary/5 blur-3xl"
        aria-hidden="true"
      />
      <div className="glass-panel nmt-workbench relative overflow-hidden rounded-[24px]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <span className="font-brand text-sm font-medium">Lead Relay</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            PRODUCT WALKTHROUGH
          </span>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col">
          <div className="px-5 pt-5">
            <TabsList className="w-full">
              <TabsTrigger value="find">Find buyers</TabsTrigger>
              <TabsTrigger value="outreach">Prepare outreach</TabsTrigger>
              <TabsTrigger value="reply">Handle replies</TabsTrigger>
            </TabsList>
          </div>
          <motion.div
            key={tab}
            initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: "spring",
              bounce: 0,
              duration: reduced ? 0 : 0.25,
            }}
            className="min-h-[370px] p-5 sm:p-7"
          >
            <TabsContent value="find" className="mt-0 flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-primary">
                  Start with what you sell
                </p>
                <h3 className="text-2xl font-medium tracking-tight">
                  Find the right businesses.
                </h3>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-input bg-card px-4 py-3 text-sm">
                <Search
                  className="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>Office furniture for growing teams</span>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <FileSearch
                    className="size-5 text-primary"
                    aria-hidden="true"
                  />
                  <Badge variant="outline">Illustrative example</Badge>
                </div>
                <h4 className="text-sm font-semibold">
                  A business opening a new office
                </h4>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Review its public source and buying signals before deciding
                  whether to reach out.
                </p>
                <p className="mt-4 flex items-center gap-2 text-xs text-primary">
                  <Check className="size-4" aria-hidden="true" />
                  Source evidence stays with the prospect
                </p>
              </div>
            </TabsContent>
            <TabsContent value="outreach" className="mt-0 flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-primary">
                  AI helps with the first draft
                </p>
                <h3 className="text-2xl font-medium tracking-tight">
                  Your message. Your approval.
                </h3>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <Mail className="size-5 text-primary" aria-hidden="true" />
                  <Badge variant="outline">Example draft</Badge>
                </div>
                <p className="border-b border-border pb-3 text-xs text-muted-foreground">
                  Subject: Furniture for your new office
                </p>
                <p className="py-4 text-sm leading-7">
                  Hello, we supply desks and seating for growing teams. Could we
                  help with the furniture for your new office?
                </p>
                <p className="flex items-center gap-2 text-xs font-medium text-primary">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  Review recipients, wording, and timing
                </p>
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                AI-generated content needs review before use. A draft does not
                send itself.
              </p>
            </TabsContent>
            <TabsContent value="reply" className="mt-0 flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-primary">
                  Keep the conversation moving
                </p>
                <h3 className="text-2xl font-medium tracking-tight">
                  Make the next step clear.
                </h3>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <MessageSquareText
                    className="size-5 text-primary"
                    aria-hidden="true"
                  />
                  <Badge variant="outline">Example conversation</Badge>
                </div>
                <div className="rounded-xl bg-muted/70 p-4 text-sm leading-7">
                  Can you share your delivery options and arrange a call?
                </div>
                <div className="mt-4 flex items-center gap-3 text-sm">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/10">
                    <Inbox className="size-4 text-primary" aria-hidden="true" />
                  </span>
                  <span>Your team reviews the request</span>
                  <ArrowRight
                    className="ml-auto size-4 text-primary"
                    aria-hidden="true"
                  />
                </div>
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                Take over a conversation whenever a person needs to handle it.
              </p>
            </TabsContent>
          </motion.div>
        </Tabs>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <span className="text-xs text-muted-foreground">
            Works with your email
          </span>
          <span className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-2">
              <ProviderMark provider="google" className="size-4" />
              Google
            </span>
            <span className="flex items-center gap-2">
              <ProviderMark provider="microsoft" className="size-4" />
              Microsoft
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
