/**
 * Smoke tests — ADR-135 Track C: GAIA SONA Cross-Run Pattern Memory
 *
 * All SONA/intelligence calls are mocked.  No live network, no AgentDB,
 * no ONNX model.  Tests validate:
 *   1. record → retrieve round-trip for a matching question
 *   2. below-threshold query returns empty hint
 *   3. SONA unavailable → graceful empty result, no crash
 *   4. success/failure tagging filters retrieved patterns
 *   5. deterministic patternSummary format
 *   6. computeCompoundLiftMetrics returns sensible values for empty store
 *   7. computeCompoundLiftMetrics with mixed success/failure patterns
 *   8. malformed metadata in stored patterns does not crash retrieval
 *
 * Run with:
 *   npx tsx src/benchmarks/gaia-sona-memory.smoke.ts
 *
 * Refs: ADR-135, #2156
 */

// ---------------------------------------------------------------------------
// Minimal mock infrastructure (no external test framework required)
// ---------------------------------------------------------------------------

type MockFn = {
  (...args: unknown[]): unknown;
  calls: unknown[][];
  returnValue: unknown;
  setReturnValue: (v: unknown) => void;
  reset: () => void;
};

function makeMock(defaultReturn: unknown = undefined): MockFn {
  const fn = function (...args: unknown[]) {
    fn.calls.push(args);
    return typeof fn.returnValue === 'function'
      ? fn.returnValue(...args)
      : fn.returnValue;
  } as MockFn;
  fn.calls = [] as unknown[][];
  fn.returnValue = defaultReturn;
  fn.setReturnValue = (v: unknown) => {
    fn.returnValue = v;
  };
  fn.reset = () => {
    fn.calls = [];
    fn.returnValue = defaultReturn;
  };
  return fn;
}

// ---------------------------------------------------------------------------
// Mock the intelligence module before importing the unit under test
// ---------------------------------------------------------------------------

// We cannot dynamically replace ES module exports after import, so we
// test the logic directly by re-implementing a thin testable harness.
// This mirrors the pattern used in gaia-attestation.smoke.ts.

// Captured mocks exposed to tests
const mockInitialize = makeMock({ success: true });
const mockRecordStep = makeMock(true);
// PatternMatch array - rich by default, overrideable per test
const mockFindSimilar = makeMock([]);

// Inline reimplementation of the module logic against injected mocks
// so we don't need Jest module mocking.
// -----------------------------------------------------------------------
type IntelligenceDeps = {
  initializeIntelligence: () => Promise<{ success: boolean }>;
  findSimilarPatterns: (
    query: string,
    opts: { k?: number; threshold?: number; type?: string },
  ) => Promise<
    Array<{
      id: string;
      type: string;
      content: string;
      confidence: number;
      metadata?: Record<string, unknown>;
      similarity: number;
      embedding: number[];
      usageCount: number;
      createdAt: number;
      lastUsedAt: number;
    }>
  >;
  recordStep: (step: {
    type: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) => Promise<boolean>;
};

// Re-implement module under test with injectable deps so tests can mock
import type { GaiaQuestion } from './gaia-loader.js';
import type { GaiaAgentResult } from './gaia-agent.js';
import type { SonaMemoryOptions, SonaTrajectoryPattern } from './gaia-sona-memory.js';

async function recordTrajectoryPatternWith(
  deps: IntelligenceDeps,
  question: GaiaQuestion,
  result: GaiaAgentResult,
  wasCorrect: boolean,
  options?: SonaMemoryOptions,
): Promise<{ recorded: boolean; patternId?: string }> {
  let available: boolean;
  try {
    const r = await deps.initializeIntelligence();
    available = r.success;
  } catch {
    available = false;
  }
  if (!available) return { recorded: false };

  const namespace = options?.namespace ?? 'gaia:trajectories';
  const verdict: 'success' | 'failure' = wasCorrect ? 'success' : 'failure';
  const toolsList = Object.keys(result.toolCallsByName ?? {}).join(',');
  const tag = wasCorrect ? 'SUCCESS' : 'FAILURE';
  const patternSummary =
    `Question: ${question.question.slice(0, 200)} | ` +
    `Tools: [${toolsList}] | ` +
    `Answer: ${result.finalAnswer ?? 'null'} | ` +
    `Tag: ${tag}`;
  const patternId = `gaia-${namespace}-${question.task_id}-stub`;

  try {
    const recorded = await deps.recordStep({
      type: 'result',
      content: patternSummary,
      metadata: {
        questionId: question.task_id,
        questionText: question.question,
        finalAnswer: result.finalAnswer ?? '',
        wasCorrect,
        toolsUsed: Object.keys(result.toolCallsByName ?? {}),
        turns: result.turns,
        namespace,
        verdict,
        patternId,
      },
    });
    return { recorded: Boolean(recorded), patternId: recorded ? patternId : undefined };
  } catch {
    return { recorded: false };
  }
}

async function retrievePriorTrajectoriesWith(
  deps: IntelligenceDeps,
  question: GaiaQuestion,
  options?: SonaMemoryOptions,
): Promise<{ hint: string; matched: number; patterns: SonaTrajectoryPattern[] }> {
  const empty = { hint: '', matched: 0, patterns: [] as SonaTrajectoryPattern[] };
  let available: boolean;
  try {
    const r = await deps.initializeIntelligence();
    available = r.success;
  } catch {
    available = false;
  }
  if (!available) return empty;

  const topK = options?.topK ?? 3;
  const minSimilarity = options?.minSimilarity ?? 0.6;

  try {
    const matches = await deps.findSimilarPatterns(question.question, {
      k: topK,
      threshold: minSimilarity,
      type: 'result',
    });
    if (matches.length === 0) return empty;

    const patterns: SonaTrajectoryPattern[] = matches
      .filter(m => m.metadata?.wasCorrect === true)
      .map(m => {
        const meta = m.metadata ?? {};
        return {
          questionId: String(meta.questionId ?? ''),
          questionText: String(meta.questionText ?? ''),
          finalAnswer: String(meta.finalAnswer ?? ''),
          wasCorrect: meta.wasCorrect === true,
          toolsUsed: Array.isArray(meta.toolsUsed) ? (meta.toolsUsed as string[]) : [],
          turns: typeof meta.turns === 'number' ? meta.turns : 0,
          patternSummary: m.content,
        };
      });

    if (patterns.length === 0) return empty;

    const lines = patterns.map((p, i) => {
      const toolStr = p.toolsUsed.length > 0 ? p.toolsUsed.join(', ') : 'no tools';
      const snippet = p.questionText.slice(0, 100).replace(/\n/g, ' ');
      return `  ${i + 1}. Question: "${snippet}..." → Tools: [${toolStr}] → Answer: "${p.finalAnswer}"`;
    });
    const hint =
      '[PRIOR SUCCESSES] On similar questions, these approaches worked:\n' +
      lines.join('\n');

    return { hint, matched: patterns.length, patterns };
  } catch {
    return empty;
  }
}

async function computeCompoundLiftMetricsWith(
  deps: IntelligenceDeps,
): Promise<{ runsAccumulated: number; patternsStored: number; estimatedLift: number }> {
  const zero = { runsAccumulated: 0, patternsStored: 0, estimatedLift: 0 };
  let available: boolean;
  try {
    const r = await deps.initializeIntelligence();
    available = r.success;
  } catch {
    available = false;
  }
  if (!available) return zero;

  try {
    const all = await deps.findSimilarPatterns('GAIA question trajectory result', {
      k: 500,
      threshold: 0.0,
      type: 'result',
    });
    if (all.length === 0) return zero;

    const gaiaPatterns = all.filter(p => typeof p.metadata?.questionId === 'string' && (p.metadata.questionId as string).length > 0);
    const patternsStored = gaiaPatterns.length;
    const uniqueQs = new Set(gaiaPatterns.map(p => String(p.metadata?.questionId ?? '')));
    const runsAccumulated = uniqueQs.size;
    const successCount = gaiaPatterns.filter(p => p.metadata?.wasCorrect === true).length;
    const successRatio = patternsStored > 0 ? successCount / patternsStored : 0;
    const estimatedLift = Math.round(successRatio * 8 * 100) / 100;
    return { runsAccumulated, patternsStored, estimatedLift };
  } catch {
    return zero;
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const QUESTION_1: GaiaQuestion = {
  task_id: 'q-001',
  level: 1,
  question: 'What is the capital of France?',
  final_answer: 'Paris',
  file_name: null,
  file_path: null,
};

const QUESTION_2: GaiaQuestion = {
  task_id: 'q-002',
  level: 1,
  question: 'Who wrote Hamlet?',
  final_answer: 'Shakespeare',
  file_name: null,
  file_path: null,
};

const RESULT_1: GaiaAgentResult = {
  questionId: 'q-001',
  finalAnswer: 'Paris',
  turns: 2,
  toolCallsByName: { grounded_query: 1 },
  totalInputTokens: 100,
  totalOutputTokens: 50,
  wallMs: 1200,
};

const RESULT_2: GaiaAgentResult = {
  questionId: 'q-001',
  finalAnswer: 'Berlin',   // wrong answer
  turns: 3,
  toolCallsByName: { web_search: 2 },
  totalInputTokens: 150,
  totalOutputTokens: 80,
  wallMs: 2000,
};

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: record one pattern, retrieve same-question → hint includes pattern
// ---------------------------------------------------------------------------

async function test1(): Promise<void> {
  console.log('\nTest 1: record → retrieve round-trip for matching question');

  const storedMeta = {
    questionId: 'q-001',
    questionText: 'What is the capital of France?',
    finalAnswer: 'Paris',
    wasCorrect: true,
    toolsUsed: ['grounded_query'],
    turns: 2,
    namespace: 'gaia:trajectories',
    verdict: 'success',
    patternId: 'gaia-gaia:trajectories-q-001-stub',
  };

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    findSimilarPatterns: async () => [
      {
        id: 'pat-1',
        type: 'result',
        content: 'Question: What is the capital of France? | Tools: [grounded_query] | Answer: Paris | Tag: SUCCESS',
        confidence: 0.9,
        metadata: storedMeta,
        similarity: 0.9,
        embedding: [],
        usageCount: 1,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
    ],
  };

  const recorded = await recordTrajectoryPatternWith(deps, QUESTION_1, RESULT_1, true);
  assert(recorded.recorded === true, 'pattern was recorded');
  assert(typeof recorded.patternId === 'string', 'patternId is a string');

  const retrieved = await retrievePriorTrajectoriesWith(deps, QUESTION_1);
  assert(retrieved.matched === 1, 'one pattern matched');
  assert(retrieved.hint.includes('[PRIOR SUCCESSES]'), 'hint starts with PRIOR SUCCESSES header');
  assert(retrieved.hint.includes('Paris'), 'hint contains the correct answer');
  assert(retrieved.hint.includes('grounded_query'), 'hint contains tool name');
  assert(retrieved.patterns[0]?.wasCorrect === true, 'retrieved pattern is marked correct');
}

// ---------------------------------------------------------------------------
// Test 2: below-threshold query returns empty hint
// ---------------------------------------------------------------------------

async function test2(): Promise<void> {
  console.log('\nTest 2: below-threshold query returns empty hint');

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    findSimilarPatterns: async () => [],   // no matches above threshold
  };

  const retrieved = await retrievePriorTrajectoriesWith(deps, QUESTION_2, { minSimilarity: 0.9 });
  assert(retrieved.hint === '', 'hint is empty string');
  assert(retrieved.matched === 0, 'matched count is zero');
  assert(retrieved.patterns.length === 0, 'patterns array is empty');
}

// ---------------------------------------------------------------------------
// Test 3: SONA unavailable → graceful empty result, no crash
// ---------------------------------------------------------------------------

async function test3(): Promise<void> {
  console.log('\nTest 3: SONA unavailable → graceful degradation');

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => { throw new Error('SONA not available in this env'); },
    recordStep: async () => false,
    findSimilarPatterns: async () => [],
  };

  const recorded = await recordTrajectoryPatternWith(deps, QUESTION_1, RESULT_1, true);
  assert(recorded.recorded === false, 'record returns false when SONA unavailable');
  assert(recorded.patternId === undefined, 'no patternId when SONA unavailable');

  const retrieved = await retrievePriorTrajectoriesWith(deps, QUESTION_1);
  assert(retrieved.hint === '', 'retrieve returns empty hint when SONA unavailable');
  assert(retrieved.matched === 0, 'retrieve returns matched=0 when SONA unavailable');

  const metrics = await computeCompoundLiftMetricsWith(deps);
  assert(metrics.patternsStored === 0, 'metrics return zero when SONA unavailable');
}

// ---------------------------------------------------------------------------
// Test 4: success/failure tagging — filter by wasCorrect works
// ---------------------------------------------------------------------------

async function test4(): Promise<void> {
  console.log('\nTest 4: success/failure tagging');

  const successMeta = {
    questionId: 'q-001',
    questionText: 'What is the capital of France?',
    finalAnswer: 'Paris',
    wasCorrect: true,
    toolsUsed: ['grounded_query'],
    turns: 2,
    namespace: 'gaia:trajectories',
    verdict: 'success',
    patternId: 'pat-success',
  };

  const failureMeta = {
    questionId: 'q-001',
    questionText: 'What is the capital of France?',
    finalAnswer: 'Berlin',
    wasCorrect: false,
    toolsUsed: ['web_search'],
    turns: 3,
    namespace: 'gaia:trajectories',
    verdict: 'failure',
    patternId: 'pat-failure',
  };

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    findSimilarPatterns: async () => [
      // Both success and failure returned by find
      {
        id: 'pat-success',
        type: 'result',
        content: 'Question: ... | Answer: Paris | Tag: SUCCESS',
        confidence: 0.9,
        metadata: successMeta,
        similarity: 0.9,
        embedding: [],
        usageCount: 1,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
      {
        id: 'pat-failure',
        type: 'result',
        content: 'Question: ... | Answer: Berlin | Tag: FAILURE',
        confidence: 0.85,
        metadata: failureMeta,
        similarity: 0.85,
        embedding: [],
        usageCount: 1,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
    ],
  };

  // Record success
  const recSuccess = await recordTrajectoryPatternWith(deps, QUESTION_1, RESULT_1, true);
  assert(recSuccess.recorded === true, 'success pattern recorded');

  // Record failure
  const recFailure = await recordTrajectoryPatternWith(deps, QUESTION_1, RESULT_2, false);
  assert(recFailure.recorded === true, 'failure pattern recorded');

  // Retrieve: only SUCCESS patterns should appear in hint
  const retrieved = await retrievePriorTrajectoriesWith(deps, QUESTION_1);
  assert(retrieved.patterns.every(p => p.wasCorrect === true), 'only correct patterns in hint');
  assert(retrieved.patterns.length === 1, 'exactly one success pattern returned');
  assert(retrieved.hint.includes('Paris'), 'hint shows success answer');
  assert(!retrieved.hint.includes('Berlin'), 'hint does not include failure answer');
}

// ---------------------------------------------------------------------------
// Test 5: deterministic patternSummary format
// ---------------------------------------------------------------------------

async function test5(): Promise<void> {
  console.log('\nTest 5: deterministic patternSummary format');

  let capturedContent = '';
  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async (step) => {
      capturedContent = step.content;
      return true;
    },
    findSimilarPatterns: async () => [],
  };

  await recordTrajectoryPatternWith(deps, QUESTION_1, RESULT_1, true);

  assert(
    capturedContent.startsWith('Question: What is the capital of France?'),
    'patternSummary starts with Question:',
  );
  assert(capturedContent.includes('Tools: [grounded_query]'), 'patternSummary includes Tools:');
  assert(capturedContent.includes('Answer: Paris'), 'patternSummary includes Answer:');
  assert(capturedContent.includes('Tag: SUCCESS'), 'patternSummary includes Tag: SUCCESS for correct');

  // Now test failure tag
  let capturedFailure = '';
  const deps2: IntelligenceDeps = {
    ...deps,
    recordStep: async (step) => {
      capturedFailure = step.content;
      return true;
    },
  };
  await recordTrajectoryPatternWith(deps2, QUESTION_1, RESULT_2, false);
  assert(capturedFailure.includes('Tag: FAILURE'), 'patternSummary includes Tag: FAILURE for incorrect');
}

// ---------------------------------------------------------------------------
// Test 6: computeCompoundLiftMetrics returns zeros for empty store
// ---------------------------------------------------------------------------

async function test6(): Promise<void> {
  console.log('\nTest 6: computeCompoundLiftMetrics with empty store');

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    findSimilarPatterns: async () => [],
  };

  const metrics = await computeCompoundLiftMetricsWith(deps);
  assert(metrics.runsAccumulated === 0, 'runsAccumulated=0 for empty store');
  assert(metrics.patternsStored === 0, 'patternsStored=0 for empty store');
  assert(metrics.estimatedLift === 0, 'estimatedLift=0 for empty store');
}

// ---------------------------------------------------------------------------
// Test 7: computeCompoundLiftMetrics with mixed success/failure patterns
// ---------------------------------------------------------------------------

async function test7(): Promise<void> {
  console.log('\nTest 7: computeCompoundLiftMetrics with mixed patterns');

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    findSimilarPatterns: async () => [
      {
        id: 'p1', type: 'result', content: 'q1 success', confidence: 0.9,
        metadata: { questionId: 'q-001', wasCorrect: true },
        similarity: 0.9, embedding: [], usageCount: 1, createdAt: 0, lastUsedAt: 0,
      },
      {
        id: 'p2', type: 'result', content: 'q2 failure', confidence: 0.8,
        metadata: { questionId: 'q-002', wasCorrect: false },
        similarity: 0.8, embedding: [], usageCount: 1, createdAt: 0, lastUsedAt: 0,
      },
      {
        id: 'p3', type: 'result', content: 'q3 success', confidence: 0.85,
        metadata: { questionId: 'q-003', wasCorrect: true },
        similarity: 0.85, embedding: [], usageCount: 1, createdAt: 0, lastUsedAt: 0,
      },
    ],
  };

  const metrics = await computeCompoundLiftMetricsWith(deps);
  assert(metrics.patternsStored === 3, 'patternsStored=3');
  assert(metrics.runsAccumulated === 3, 'runsAccumulated=3 unique question IDs');
  // 2 successes / 3 total = 0.667 * 8 = 5.33
  assert(metrics.estimatedLift > 0, 'estimatedLift > 0 with successes');
  assert(metrics.estimatedLift <= 8, 'estimatedLift bounded by 8pp max');
}

// ---------------------------------------------------------------------------
// Test 8: malformed metadata does not crash retrieval
// ---------------------------------------------------------------------------

async function test8(): Promise<void> {
  console.log('\nTest 8: malformed metadata does not crash retrieval');

  const deps: IntelligenceDeps = {
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    findSimilarPatterns: async () => [
      // No metadata at all
      {
        id: 'p-malformed-1', type: 'result', content: 'some content',
        confidence: 0.8, metadata: undefined,
        similarity: 0.8, embedding: [], usageCount: 1, createdAt: 0, lastUsedAt: 0,
      },
      // metadata present but wasCorrect missing
      {
        id: 'p-malformed-2', type: 'result', content: 'other content',
        confidence: 0.75, metadata: { questionId: 'q-bad' },
        similarity: 0.75, embedding: [], usageCount: 1, createdAt: 0, lastUsedAt: 0,
      },
      // valid success pattern — should still appear
      {
        id: 'p-valid', type: 'result', content: 'valid success',
        confidence: 0.9,
        metadata: {
          questionId: 'q-good',
          questionText: 'A real question?',
          finalAnswer: 'Yes',
          wasCorrect: true,
          toolsUsed: ['grounded_query'],
          turns: 1,
        },
        similarity: 0.9, embedding: [], usageCount: 1, createdAt: 0, lastUsedAt: 0,
      },
    ],
  };

  let threw = false;
  let retrieved;
  try {
    retrieved = await retrievePriorTrajectoriesWith(deps, QUESTION_1);
  } catch {
    threw = true;
  }

  assert(threw === false, 'no exception thrown for malformed metadata');
  assert(retrieved !== undefined, 'retrieved result is defined');
  assert(retrieved!.patterns.length === 1, 'only the valid pattern surfaces');
  assert(retrieved!.patterns[0]?.questionId === 'q-good', 'valid pattern has correct questionId');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runAll(): Promise<void> {
  console.log('=== ADR-135 Track C: GAIA SONA Cross-Run Pattern Memory — Smoke Tests ===');
  console.log(`Running ${new Date().toISOString()}\n`);

  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Smoke test runner crashed:', err);
  process.exit(1);
});
