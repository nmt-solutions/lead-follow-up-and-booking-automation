import { CalendarCheck, Mail, Users } from "lucide-react";

export function IsometricFallback() {
  return (
    <div className="flex h-full items-center justify-center gap-5 text-primary">
      {[Users, Mail, CalendarCheck].map((Icon, index) => (
        <div
          key={index}
          className="flex size-16 rotate-[-12deg] items-center justify-center rounded-xl border border-border bg-card shadow-sm"
        >
          <Icon className="size-7" />
        </div>
      ))}
    </div>
  );
}
