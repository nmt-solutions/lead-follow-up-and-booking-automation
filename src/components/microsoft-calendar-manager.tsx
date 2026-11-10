"use client";
import { CalendarConnection } from "./calendar-connection";
import type { MicrosoftCalendarView } from "@/models/microsoft-calendar";
export function MicrosoftCalendarManager(props: {
  businessId: string;
  initialState: MicrosoftCalendarView;
}) {
  return <CalendarConnection provider="microsoft" {...props} />;
}
