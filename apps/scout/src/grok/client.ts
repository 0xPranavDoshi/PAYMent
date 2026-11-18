import { z } from "zod";

export class GrokOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokOutputError";
  }
}

export interface Grok {
  json<T>(args: { name: string; schema: z.ZodType<T>; system: string; user: string }): Promise<T>;
}

export function createGrok(opts: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}): Grok {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://api.x.ai/v1";

  return {
    async json<T>({ name, schema, system, user }: Parameters<Grok["json"]>[0]): Promise<T> {
      const { $schema: _omit, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
      // Provisional: if xAI rejects structured output for the chosen model, fall back to
      // `response_format: { type: "json_object" }`. Zod validation below applies either way.
      const body = JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name, schema: jsonSchema, strict: true },
        },
      });

      let lastError = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await doFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
          body,
        });
        if (!res.ok) {
          lastError = `xAI returned HTTP ${res.status}`;
          continue;
        }
        try {
          const payload = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== "string") {
            lastError = "xAI response had no message content";
            continue;
          }
          const parsed = schema.safeParse(JSON.parse(content)) as z.ZodSafeParseResult<T>;
          if (parsed.success) return parsed.data;
          lastError = `Grok output failed validation: ${parsed.error.message}`;
        } catch (e) {
          lastError = `Grok output was not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      throw new GrokOutputError(lastError);
    },
  };
}
