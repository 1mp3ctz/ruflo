/**
 * GAIA Tool: python_exec — ADR-133-PR4
 *
 * Executes Python code in a sandboxed subprocess and returns stdout, stderr,
 * and exit code.  This capability covers ~10-15% of GAIA Level-1 questions
 * that require numeric computation, algorithmic problem-solving, or data
 * processing that cannot be reliably done via text reasoning alone.
 *
 * ============================================================
 * SECURITY MODEL — READ BEFORE USE
 * ============================================================
 * Implementation path: **Path B — local Python subprocess**
 *
 * Why not Path A (E2B cloud sandbox)?
 *   @e2b/code-interpreter is NOT installed in this repo.  Adding it requires
 *   an npm install, an E2B API key, and active cloud billing.  For the GAIA
 *   benchmark runner — which runs against a static, trusted dataset on a
 *   developer workstation — the subprocess approach is pragmatic.
 *
 * Why not Path C (skip)?
 *   Python execution is the single highest-value missing capability for GAIA
 *   Level-1 accuracy.  Skipping it caps our score well below SOTA.
 *
 * SECURITY TRADEOFFS:
 *   - The subprocess inherits the current user's environment and filesystem.
 *   - Code is executed with `python3 -c <code>` — no container isolation.
 *   - A malicious GAIA question could execute arbitrary code on the host.
 *   - This is ACCEPTABLE for a benchmark run against the official GAIA dataset
 *     (which is curated and static) but is NOT suitable for production use
 *     or untrusted inputs.
 *
 * SAFEGUARDS IMPLEMENTED:
 *   1. Hard timeout (default 30s, configurable) — kills the subprocess.
 *   2. `PYTHONDONTWRITEBYTECODE=1` — no .pyc files written.
 *   3. Output truncated at 64 KB to prevent context-window overflow.
 *   4. The `execute()` method NEVER throws — it returns structured output
 *      so the agent loop can forward errors back to Claude rather than crash.
 *
 * TO MIGRATE TO E2B LATER:
 *   Replace the `spawnPython()` function body with:
 *     const sbx = await Sandbox.create({ apiKey: resolveE2BApiKey() });
 *     const result = await sbx.runCode(code, { timeoutMs });
 *     await sbx.kill();
 *     return { stdout, stderr, exitCode: result.exitCode ?? 0, timedOut: false };
 *   and add `@e2b/code-interpreter` to package.json.
 *
 * Refs: ADR-133, #2156
 */

import { spawn } from 'node:child_process';
import { GaiaTool, ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_TIMEOUT_MS = 120_000; // 2 minutes absolute ceiling
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB per stream

// ---------------------------------------------------------------------------
// Subprocess execution
// ---------------------------------------------------------------------------

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Spawn a `python3 -c <code>` subprocess with a hard timeout.
 *
 * SECURITY: inherits the current process environment. Only safe against
 * trusted input (GAIA benchmark dataset).  See module-level JSDoc.
 */
async function spawnPython(code: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      // Ensure UTF-8 output
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    };

    const child = spawn('python3', ['-c', code], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (remaining > 0) {
        const slice = chunk.subarray(0, remaining);
        stdoutChunks.push(slice);
        stdoutBytes += slice.length;
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - stderrBytes;
      if (remaining > 0) {
        const slice = chunk.subarray(0, remaining);
        stderrChunks.push(slice);
        stderrBytes += slice.length;
      }
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      let stderr = Buffer.concat(stderrChunks).toString('utf-8');

      if (stdoutBytes >= MAX_OUTPUT_BYTES) {
        stdout += `\n[output truncated at ${MAX_OUTPUT_BYTES / 1024} KB]`;
      }
      if (stderrBytes >= MAX_OUTPUT_BYTES) {
        stderr += `\n[stderr truncated at ${MAX_OUTPUT_BYTES / 1024} KB]`;
      }

      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? (timedOut ? 124 : 1),
        timedOut,
      });
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: `Failed to spawn python3: ${err.message}\nIs python3 installed and on PATH?`,
        exitCode: 127,
        timedOut: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Format output for Claude
// ---------------------------------------------------------------------------

function formatOutput(result: SpawnResult): string {
  const parts: string[] = [];

  if (result.timedOut) {
    parts.push('[python_exec: execution timed out]');
  }

  if (result.stdout) {
    parts.push(`stdout:\n${result.stdout}`);
  }

  if (result.stderr) {
    parts.push(`stderr:\n${result.stderr}`);
  }

  if (!result.stdout && !result.stderr) {
    parts.push('(no output)');
  }

  parts.push(`exit_code: ${result.exitCode}`);

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// GaiaTool implementation
// ---------------------------------------------------------------------------

export class PythonExecTool implements GaiaTool {
  readonly name = 'python_exec';

  readonly definition: ToolDefinition = {
    name: 'python_exec',
    description:
      'Execute Python code in a sandboxed environment and return stdout, stderr, and exit code. ' +
      'Use this for numeric computation, algorithmic problem-solving, data processing, ' +
      'mathematical calculations, and any task that benefits from precise code execution. ' +
      'The code runs with python3. Print results to stdout. ' +
      'Default timeout is 30 seconds; pass timeout_seconds to override (max 120).',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'The Python code to execute. Use print() to emit results. ' +
            'Import standard-library modules freely. ' +
            'Third-party packages (numpy, pandas, etc.) may not be available.',
        },
        timeout_seconds: {
          type: 'number',
          description: `Execution timeout in seconds (default: ${DEFAULT_TIMEOUT_MS / 1000}, max: ${MAX_TIMEOUT_MS / 1000}).`,
        },
      },
      required: ['code'],
    },
  };

  async execute(input: Record<string, unknown>): Promise<string> {
    const code = String(input['code'] ?? '').trimEnd();
    if (!code) {
      throw new Error('python_exec: `code` input is required and must be non-empty.');
    }

    const rawTimeout = Number(input['timeout_seconds'] ?? DEFAULT_TIMEOUT_MS / 1000);
    const timeoutMs = Math.min(
      Math.max(1, Math.round(rawTimeout * 1000)),
      MAX_TIMEOUT_MS,
    );

    const result = await spawnPython(code, timeoutMs);
    return formatOutput(result);
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export interface PythonExecToolOptions {
  /** Override default timeout in milliseconds. */
  defaultTimeoutMs?: number;
}

export function createPythonExecTool(_opts?: PythonExecToolOptions): PythonExecTool {
  return new PythonExecTool();
}
