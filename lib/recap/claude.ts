import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { WeeklyStatsPayload } from "@/lib/recap/payload";
import { RECAP_SYSTEM_PROMPT, buildUserMessage } from "@/lib/recap/prompt";
import { ALL_SECTION_TYPES } from "@/lib/recap/sectionTypes";

const RecapSectionSchema = z.object({
  type: z.enum(ALL_SECTION_TYPES),
  title: z.string(),
  body: z.string(),
});
const RecapOutputSchema = z.object({
  title: z.string(),
  sections: z.array(RecapSectionSchema),
});
export type RecapOutput = z.infer<typeof RecapOutputSchema>;

const EMIT_RECAP_TOOL = {
  name: "emit_recap",
  description: "Emit the finished weekly recap as structured sections.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Newsletter issue title for this week." },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...ALL_SECTION_TYPES] },
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["type", "title", "body"],
        },
      },
    },
    required: ["title", "sections"],
  },
};

/**
 * Calls Claude to narrate a week's pre-computed recap facts. Returns null
 * if ANTHROPIC_API_KEY isn't configured — callers should fall back to
 * lib/recap/templateGenerator.ts in that case.
 */
export async function generateRecapWithClaude(
  payload: WeeklyStatsPayload
): Promise<{ output: RecapOutput; model: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5";
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: RECAP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(payload) }],
    tools: [EMIT_RECAP_TOOL],
    tool_choice: { type: "tool", name: "emit_recap" },
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured recap (no tool_use block).");
  }

  const output = RecapOutputSchema.parse(toolUse.input);
  return { output, model };
}
