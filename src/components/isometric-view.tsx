"use client";

import dynamic from "next/dynamic";
import { Component, useSyncExternalStore } from "react";
import { IsometricFallback } from "./isometric-fallback";
import { Skeleton } from "./ui/skeleton";

const Scene = dynamic(() => import("./isometric-scene"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-2xl" />,
});
function subscribe(callback: () => void) {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
class SceneBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <IsometricFallback /> : this.props.children;
  }
}
export function IsometricView() {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false,
  );
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-accent/30">
      <div aria-hidden="true" className="h-52 sm:h-64">
        <SceneBoundary>
          {desktop ? <Scene /> : <IsometricFallback />}
        </SceneBoundary>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-border bg-card/60 px-3 py-4 text-center text-xs text-muted-foreground">
        <span>Find prospects</span>
        <span>Start conversations</span>
        <span>Arrange next steps</span>
      </div>
    </div>
  );
}
