import {
  APICallError,
  generateText,
  Output,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createGateway,
  GatewayError,
  type GatewayProviderOptions,
} from "@ai-sdk/gateway";
import { z } from "zod";
import { inquiryOutputSchema } from "../models/inquiries";
import {
  AiProviderFailure,
  draftingOutputSchema,
  extractionOutputSchema,
  unknownAiMetrics,
  type AiMetrics,
  type AiProvider,
} from "../models/ai";

const identifier = z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/);
const metadataSchema = z.object({ generationId: identifier.optional() });
function tokenCount(value: unknown) {
  const result = z.number().int().nonnegative().safeParse(value);
  return result.success ? result.data : null;
}
function classify(error: unknown, knownMetrics: AiMetrics): never {
  if (error instanceof AiProviderFailure) throw error;
  if (NoObjectGeneratedError.isInstance(error))
    throw new AiProviderFailure("invalid_output", {
      ...knownMetrics,
      inputTokens: tokenCount(error.usage?.inputTokens),
      outputTokens: tokenCount(error.usage?.outputTokens),
    });
  if (NoOutputGeneratedError.isInstance(error))
    throw new AiProviderFailure("invalid_output", knownMetrics);
  if (APICallError.isInstance(error) || GatewayError.isInstance(error)) {
    const code = APICallError.isInstance(error)
      ? z
          .object({ error: z.object({ code: z.string() }) })
          .safeParse(error.data)
      : null;
    // Billing errors must not become repeated rate-limit retries.
    if (
      error.statusCode === 402 ||
      (code?.success &&
        [
          "credit_balance_exhausted",
          "insufficient_quota",
          "billing_hard_limit_reached",
        ].includes(code.data.error.code))
    )
      throw new AiProviderFailure("funding", knownMetrics);
    if (error.statusCode === 401 || error.statusCode === 403)
      throw new AiProviderFailure("credentials", knownMetrics);
    if (error.statusCode === 429)
      throw new AiProviderFailure("rate_limited", knownMetrics);
    // Timeouts and server failures may have accepted work. Do not replay them.
    if (
      error.statusCode === 408 ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    )
      throw new AiProviderFailure("uncertain", knownMetrics);
    throw new AiProviderFailure("invalid_output", knownMetrics);
  }
  throw new AiProviderFailure("uncertain", knownMetrics);
}

/** Credentials are injected only by server composition; no implicit SDK env/OIDC defaults. */
export function createSdkAiProvider(options: {
  openaiApiKey?: string;
  gatewayApiKey?: string;
  fetch?: typeof fetch;
}): AiProvider {
  return {
    readiness: () => ({
      primary: Boolean(options.openaiApiKey?.trim()),
      fallback: Boolean(options.gatewayApiKey?.trim()),
    }),
    async generate(input) {
      const primary = input.route === "operator_byok";
      if (!(primary ? options.openaiApiKey : options.gatewayApiKey))
        throw new AiProviderFailure("credentials");
      // Direct BYOK prevents Gateway's automatic BYOK -> system-key fallback.
      // The explicit system route supplies an empty request key set to exclude dashboard BYOK.
      const requestFetch: typeof fetch = (url, init) =>
        (options.fetch ?? fetch)(url, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([input.signal, init.signal])
            : input.signal,
        });
      const model = primary
        ? createOpenAI({
            apiKey: options.openaiApiKey,
            fetch: requestFetch,
          }).responses(input.model.slice("openai/".length))
        : createGateway({ apiKey: options.gatewayApiKey, fetch: requestFetch })(
            input.model,
          );
      const gatewayOptions = {
        only: ["openai"],
        order: ["openai"],
        byok: {},
        models: [],
        has: ["structured-output"],
        disallowPromptTraining: true,
      } satisfies GatewayProviderOptions;
      const knownMetrics: AiMetrics = {
        ...unknownAiMetrics,
        credentialSource: primary ? "operator_api_key" : "unknown",
        provider: primary ? "openai" : null,
        model: null,
      };
      try {
        const result = await generateText({
          model,
          system: input.system,
          prompt: input.input,
          output: Output.object({
            schema:
              input.purpose === "inquiry"
                ? inquiryOutputSchema
                : input.task === "extraction"
                  ? extractionOutputSchema
                  : draftingOutputSchema,
          }),
          maxOutputTokens: input.profile.limits.maxOutputTokens,
          maxRetries: 0,
          abortSignal: input.signal,
          timeout: input.profile.limits.deadlineMs,
          onLanguageModelCallEnd(event) {
            if (primary && event.modelId)
              knownMetrics.model = event.modelId.startsWith("openai/")
                ? event.modelId
                : `openai/${event.modelId}`;
            knownMetrics.inputTokens = tokenCount(event.usage.inputTokens);
            knownMetrics.outputTokens = tokenCount(event.usage.outputTokens);
            const observed = metadataSchema.safeParse(
              event.providerMetadata?.gateway,
            );
            if (observed.success)
              knownMetrics.generationId = observed.data.generationId ?? null;
          },
          providerOptions: {
            openai: { store: false, strictJsonSchema: true },
            ...(primary ? {} : { gateway: gatewayOptions }),
          },
        });
        const metadata = metadataSchema.safeParse(
          result.providerMetadata?.gateway,
        );
        const metrics: AiMetrics = {
          ...knownMetrics,
          inputTokens: tokenCount(result.usage.inputTokens),
          outputTokens: tokenCount(result.usage.outputTokens),
          generationId: metadata.success
            ? (metadata.data.generationId ?? null)
            : null,
        };
        // Generation lookup is reporting I/O, not another generation or an estimated bill.
        // Failure to retrieve it leaves cost/provenance unknown while retaining the generation ID.
        let unexpectedProvider = false;
        if (!primary && metrics.generationId && !input.signal.aborted) {
          try {
            const generation = await createGateway({
              apiKey: options.gatewayApiKey,
              fetch: requestFetch,
            }).getGenerationInfo({ id: metrics.generationId });
            const parsed = z
              .object({
                isByok: z.boolean(),
                providerName: z.string(),
                model: z.string(),
                gatewayCost: z.number().finite().nonnegative().optional(),
              })
              .safeParse(generation);
            if (parsed.success) {
              metrics.credentialSource = parsed.data.isByok
                ? "operator_api_key"
                : "gateway_system";
              unexpectedProvider = parsed.data.providerName !== "openai";
              metrics.provider = unexpectedProvider ? null : "openai";
              metrics.model = parsed.data.model;
              metrics.gatewayCostUsd = parsed.data.gatewayCost ?? null;
            }
          } catch {
            /* Inference already completed. Reporting never retries inference. */
          }
        }
        if (unexpectedProvider)
          throw new AiProviderFailure("invalid_output", {
            ...metrics,
            model: null,
          });
        return { output: result.output, metrics };
      } catch (error: unknown) {
        return classify(error, knownMetrics);
      }
    },
  };
}
