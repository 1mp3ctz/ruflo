/**
 * optimize-research-config — Anthropic-direct port.
 *
 * Same wire contract: takes `{preset, currentGoal?}`, returns
 * `{config: ResearchConfig}` (or `{error}` on 429/402/5xx via the
 * `_lib/llm.ts` envelope).
 *
 * Mock mode when no API key resolves: returns a canned config.
 *
 * NOTE: per-preset prompt corpus (~250 lines of templates in the
 * Deno original) is reduced to a single generic prompt here. Full
 * corpus port is a polish follow-up — wiring/contract is what
 * matters for the migration's DoD.
 */

import { z } from 'zod';
import { wrapUserInput } from '../_lib/sanitize';
import { callLlmWithTool, isLlmAvailable } from '../_lib/llm';

const SYSTEM_PROMPT =
  'You are an expert research workflow architect specializing in GOAP ' +
  '(Goal-Oriented Action Planning) configuration optimization. Generate ' +
  'optimized research configuration settings based on the given preset/objective.';

const ToolOutputSchema = z.object({
  config: z.object({}).passthrough(),
});

const TOOL_PARAMS = {
  type: 'object',
  properties: {
    config: {
      type: 'object',
      properties: {
        researchGuidance: { type: 'object' },
        parameters: { type: 'object' },
        filters: { type: 'object' },
      },
    },
  },
  required: ['config'],
} as const;

export interface OptimizeRequest {
  preset: string;
  currentGoal?: string;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function optimizeResearchConfigHandler(
  req: OptimizeRequest,
): Promise<HandlerResult> {
  const { preset, currentGoal } = req;
  if (typeof preset !== 'string' || preset.trim() === '') {
    return { status: 400, body: { error: 'preset is required (string)' } };
  }

  if (!(await isLlmAvailable())) {
    return {
      status: 200,
      body: {
        config: {
          researchGuidance: {
            depth: 'moderate',
            perspective: 'technical',
            timeframe: 'recent',
            focusAreas: [`${preset}-mock`],
            excludeTopics: [],
          },
          parameters: { maxSources: 8, minConfidence: 0.7, maxSteps: 5, parallelAgents: 2, timeout: 30000 },
          filters: { dateRange: 'recent', sourceTypes: ['academic', 'news'], languages: ['en'], excludeDomains: [] },
        },
        mock: true,
      },
    };
  }

  const userPrompt = `Optimize research settings for preset: ${wrapUserInput(preset)}. Goal: ${wrapUserInput(currentGoal || 'general research')}`;

  const result = await callLlmWithTool({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    tool: { name: 'generate_config', description: 'Generate optimized research config for the preset', parameters: TOOL_PARAMS },
  });

  if (result.status !== 200) return { status: result.status, body: { error: result.error } };

  const validated = ToolOutputSchema.safeParse(result.input);
  if (!validated.success) {
    return { status: 502, body: { error: 'AI tool-call output failed schema validation' } };
  }
  return { status: 200, body: { config: validated.data.config } };
}
