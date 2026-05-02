/**
 * llm.ts — Anthropic-direct adapter for tool-call requests.
 *
 * The four wired RuFlo handlers all share the same upstream pattern:
 *   - one system prompt
 *   - one user prompt (already wrapped via wrapUserInput where needed)
 *   - one strict tool schema
 *   - exactly one tool_use response → JSON object → Zod validation
 *
 * This module centralizes the call so we can:
 *   - swap providers without touching handlers
 *   - translate provider-specific status codes consistently
 *   - keep secret resolution + caching in one place
 *
 * Provider: Anthropic Messages API (no Lovable Gateway, no OpenAI).
 * Credentials come from `secrets.ts` (env var or gcloud Secret Manager).
 */

import { getAnthropicApiKey } from './secrets';

export interface LlmToolDef {
  name: string;
  description: string;
  /** JSON-schema object describing the tool input shape. */
  parameters: Record<string, unknown>;
}

export interface LlmToolCallRequest {
  system: string;
  user: string;
  tool: LlmToolDef;
  /** Override `RUFLO_LLM_MODEL`. Default: claude-haiku-4-5-20251001. */
  model?: string;
  /** Default 4096. */
  maxTokens?: number;
}

export type LlmToolCallResult =
  | { status: 200; input: unknown }
  | { status: 401 | 402 | 429 | 502 | 503; error: string };

/**
 * Whether the LLM upstream is reachable in the current process. When
 * false, callers should serve their mock-mode branch.
 */
export async function isLlmAvailable(): Promise<boolean> {
  return (await getAnthropicApiKey()) !== null;
}

/**
 * Translate an Anthropic API HTTP status to our normalized envelope.
 * Anthropic doesn't use 402 — quota issues surface as 429 or 401-style
 * billing errors. We surface 402 specifically when the body string looks
 * like a billing exhaustion so the UI's existing 402 handler still fires.
 */
function classifyError(status: number, body: string): LlmToolCallResult {
  if (status === 401) return { status: 401, error: 'AI authentication failed (check ANTHROPIC_API_KEY or Secret Manager).' };
  if (status === 429) {
    if (/credit|quota|usage limit|insufficient|billing/i.test(body)) {
      return { status: 402, error: 'AI usage limit reached. Please add credits to continue.' };
    }
    return { status: 429, error: 'Rate limits exceeded. Please try again later.' };
  }
  if (status >= 500 && status <= 599) return { status: 503, error: `AI provider unavailable (HTTP ${status}).` };
  return { status: 502, error: `AI gateway error: ${status}` };
}

/**
 * Send a single tool-forced request to Anthropic and return the model's
 * tool input as a parsed JSON object. The caller is responsible for Zod
 * validation of `input`.
 */
export async function callLlmWithTool(req: LlmToolCallRequest): Promise<LlmToolCallResult> {
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    return { status: 401, error: 'No API key resolved (set ANTHROPIC_API_KEY or configure Secret Manager).' };
  }

  const model =
    req.model ||
    process.env.RUFLO_LLM_MODEL ||
    'claude-haiku-4-5-20251001';
  const maxTokens = req.maxTokens ?? 4096;

  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        tools: [{
          name: req.tool.name,
          description: req.tool.description,
          input_schema: req.tool.parameters,
        }],
        tool_choice: { type: 'tool', name: req.tool.name },
      }),
    });
  } catch (err) {
    return { status: 503, error: `AI provider unreachable: ${(err as Error).message}` };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return classifyError(resp.status, text);
  }

  const body = (await resp.json().catch(() => null)) as
    | { content?: Array<{ type?: string; name?: string; input?: unknown }> }
    | null;
  if (!body) return { status: 502, error: 'AI response was not JSON.' };

  // Find the tool_use block matching the requested tool name.
  const toolUse = (body.content ?? []).find(
    (b) => b && b.type === 'tool_use' && b.name === req.tool.name,
  );
  if (!toolUse || toolUse.input === undefined) {
    return { status: 502, error: 'No tool call in AI response.' };
  }

  return { status: 200, input: toolUse.input };
}
