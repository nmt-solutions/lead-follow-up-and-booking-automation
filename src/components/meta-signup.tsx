"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { z } from "zod";
import { metaIdSchema, type MetaCompletion } from "@/models/whatsapp";
import { Button } from "./ui/button";

export const metaSignupSchema = z.object({
  state: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
  coexistence: z.boolean(),
  login: z.object({
    appId: metaIdSchema,
    configId: metaIdSchema,
    graphVersion: z.string().regex(/^v[0-9]{2,3}\.0$/),
  }),
});
type Signup = z.infer<typeof metaSignupSchema>;
type FacebookSdk = {
  init(options: {
    appId: string;
    version: string;
    xfbml: boolean;
    autoLogAppEvents: boolean;
  }): void;
  login(
    callback: (response: unknown) => void,
    options: Record<string, unknown>,
  ): void;
};
declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}
const sessionSchema = z.object({
  type: z.literal("WA_EMBEDDED_SIGNUP"),
  event: z.enum([
    "FINISH",
    "FINISH_ONLY_WABA",
    "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    "CANCEL",
    "ERROR",
  ]),
  data: z
    .object({
      business_id: metaIdSchema.optional(),
      waba_id: metaIdSchema.optional(),
      phone_number_id: metaIdSchema.optional(),
    })
    .optional(),
});
export function MetaSignup({
  signup,
  complete,
  reportError,
}: {
  signup: Signup;
  complete(input: MetaCompletion): Promise<void>;
  reportError(message: string): void;
}) {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const flow = useRef<{
    active: boolean;
    sent: boolean;
    code: string | null;
    session: z.infer<typeof sessionSchema> | null;
  }>({ active: false, sent: false, code: null, session: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function sendIfComplete() {
      const f = flow.current;
      if (!f.active || f.sent || !f.session) return;
      const event = f.session.event;
      if (event !== "CANCEL" && event !== "ERROR" && !f.code) return;
      f.sent = true;
      f.active = false;
      setActive(false);
      setProcessing(true);
      if (timer.current) clearTimeout(timer.current);
      const d = f.session.data;
      const input: MetaCompletion = {
        state: signup.state,
        event,
        ...(f.code ? { code: f.code } : {}),
        ...(d?.business_id && d.waba_id && d.phone_number_id
          ? {
              assets: {
                portfolioId: d.business_id,
                wabaId: d.waba_id,
                phoneNumberId: d.phone_number_id,
              },
            }
          : {}),
      };
      f.code = null;
      void complete(input).finally(() => setProcessing(false));
    }
    function receive(event: MessageEvent<unknown>) {
      if (
        !["https://www.facebook.com", "https://web.facebook.com"].includes(
          event.origin,
        ) ||
        !flow.current.active
      )
        return;
      let value: unknown = event.data;
      try {
        if (typeof value === "string") {
          if (value.length > 16384) return;
          value = JSON.parse(value);
        }
      } catch {
        return;
      }
      const session = sessionSchema.safeParse(value);
      if (!session.success) return;
      flow.current.session = session.data;
      sendIfComplete();
    }
    window.addEventListener("message", receive);
    // Code and session logging can arrive in either order; the callback dispatches this local event.
    window.addEventListener("meta-signup-code", sendIfComplete);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("meta-signup-code", sendIfComplete);
      if (timer.current) clearTimeout(timer.current);
      flow.current.active = false;
      flow.current.code = null;
    };
  }, [signup.state, complete]);
  function initialize() {
    if (!window.FB) {
      reportError("Meta sign-in could not load. Retry the connection.");
      return;
    }
    try {
      window.FB.init({
        appId: signup.login.appId,
        version: signup.login.graphVersion,
        xfbml: false,
        autoLogAppEvents: false,
      });
    } catch {
      reportError(
        "Meta sign-in could not initialize. Prepare a fresh connection.",
      );
      return;
    }
    setReady(true);
  }
  function launch() {
    if (!window.FB || !ready || active || processing) return;
    setActive(true);
    flow.current = { active: true, sent: false, code: null, session: null };
    timer.current = setTimeout(() => {
      if (!flow.current.active) return;
      flow.current.active = false;
      flow.current.code = null;
      setActive(false);
      reportError(
        "Meta sign-in did not finish. Start a fresh connection; no readiness has been granted.",
      );
    }, 10 * 60000);
    try {
      window.FB.login(
        (response) => {
          if (!flow.current.active) return;
          const code = z
            .object({
              authResponse: z.object({ code: z.string().min(1).max(4096) }),
            })
            .safeParse(response);
          if (!code.success) {
            flow.current.session = {
              type: "WA_EMBEDDED_SIGNUP",
              event: "CANCEL",
            };
          } else {
            flow.current.code = code.data.authResponse.code;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              if (!flow.current.active) return;
              flow.current.active = false;
              flow.current.code = null;
              setActive(false);
              reportError(
                "Meta returned incomplete account details. Start again and finish account and number setup.",
              );
            }, 25000);
          }
          window.dispatchEvent(new Event("meta-signup-code"));
        },
        {
          config_id: signup.login.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            version: "v4",
            sessionInfoVersion: "3",
            ...(signup.coexistence
              ? { featureType: "whatsapp_business_app_onboarding" }
              : {}),
          },
        },
      );
    } catch {
      if (timer.current) clearTimeout(timer.current);
      flow.current.active = false;
      flow.current.code = null;
      setActive(false);
      reportError(
        "Meta sign-in could not open. Allow its popup and prepare a fresh connection.",
      );
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onReady={initialize}
        onError={() =>
          reportError(
            "Meta sign-in could not load. Check your connection and retry.",
          )
        }
      />
      <p className="text-sm text-muted-foreground">
        Continue as an administrator of your own Meta Business portfolio. Meta
        will ask for business management and WhatsApp permissions. Signing in
        does not activate automated messages.
      </p>
      <Button
        type="button"
        disabled={!ready || active || processing}
        onClick={launch}
      >
        {processing
          ? "Checking Meta connection…"
          : active
            ? "Waiting for Meta…"
            : ready
              ? "Continue to Meta"
              : "Loading Meta sign-in…"}
      </Button>
      {active && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!flow.current.active) return;
            flow.current.session = {
              type: "WA_EMBEDDED_SIGNUP",
              event: "CANCEL",
            };
            window.dispatchEvent(new Event("meta-signup-code"));
          }}
        >
          Cancel sign-in
        </Button>
      )}
    </div>
  );
}
