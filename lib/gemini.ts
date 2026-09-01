import { GoogleGenAI } from "@google/genai";

export function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { "User-Agent": "aistudio-build" },
    },
  });
}

/**
 * Every Gemini call goes through here. The model is pinned on the config
 * object itself, so setting `model` at a call site has no effect — this
 * assignment always wins.
 *
 * Sampling is pinned to greedy decoding for the same reason. This is a scoring
 * tool: the same transcript has to produce the same score. At the default
 * temperature it did not, and two identical requests could land in different
 * grade bands with nothing to explain the difference to the producer.
 *
 * Only 503/429/UNAVAILABLE are retried, with exponential backoff (2s, 4s, 8s).
 * Other errors (400 and friends) are thrown straight through.
 */
export async function generateContentWithRetry(
  aiClient: any,
  config: any,
  maxRetries = 3,
): Promise<any> {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Use gemini-3.6-flash which is the standard reliable model
      config.model = "gemini-3.6-flash";
      config.config = { temperature: 0, ...(config.config ?? {}) };
      return await aiClient.models.generateContent(config);
    } catch (error: any) {
      lastError = error;
      console.error(`Gemini API Error (Attempt ${i + 1}/${maxRetries}):`, error.message);

      if (
        error.message &&
        (error.message.includes("503") ||
          error.message.includes("429") ||
          error.message.includes("UNAVAILABLE"))
      ) {
        const waitTime = Math.pow(2, i + 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
