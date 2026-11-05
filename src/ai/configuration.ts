import { aiConfigurationSchema } from "../models/ai";
import { createSdkAiProvider } from "./sdk-provider";

export function configuredAi(environment: NodeJS.ProcessEnv) {
  let value: unknown = null;
  try {
    value = JSON.parse(environment.AI_CONFIGURATION_JSON ?? "null");
  } catch {
    /* Safe missing setup; never log environment values. */
  }
  const configuration = aiConfigurationSchema.safeParse(value);
  return {
    configuration: configuration.success ? configuration.data : null,
    provider: createSdkAiProvider({
      openaiApiKey: environment.OPERATOR_OPENAI_API_KEY,
      gatewayApiKey: environment.OPERATOR_AI_GATEWAY_API_KEY,
    }),
  };
}
