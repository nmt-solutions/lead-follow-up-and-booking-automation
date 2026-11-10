"use client";
import { CalendarConnection } from "./calendar-connection";
import type { GoogleCalendarView } from "@/models/google-calendar";
export function GoogleCalendarManager(props: {
  businessId: string;
  initialState: GoogleCalendarView;
}) {
  return <CalendarConnection provider="google" {...props} />;
}
