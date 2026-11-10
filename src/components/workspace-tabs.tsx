"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export type WorkspaceTab = {
  id: string;
  label: string;
  description: string;
  content: ReactNode;
};

/** Keep each form mounted so moving between tasks preserves unsaved edits. */
export function WorkspaceTabs({
  tabs,
  defaultValue,
  label = "Page sections",
}: {
  tabs: WorkspaceTab[];
  defaultValue?: string;
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? tabs[0]?.id);
  return (
    <Tabs
      value={tabs.some((tab) => tab.id === value) ? value : tabs[0]?.id}
      onValueChange={setValue}
      className="min-w-0"
    >
      <TabsList
        aria-label={label}
        className="h-auto w-full justify-start sm:w-auto"
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.id}
          value={tab.id}
          forceMount
          className="data-[state=inactive]:hidden"
        >
          <div className="flex min-w-0 flex-col gap-6">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {tab.description}
            </p>
            {tab.content}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
