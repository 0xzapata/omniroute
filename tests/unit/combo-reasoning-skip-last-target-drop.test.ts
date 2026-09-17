// Bug B: `reasoningTransportFallback: "skip"` on a combo where EVERY target is
// reasoning-incompatible used to hard-fail with 400 on the last target instead of
// dropping the incompatible reasoning and proceeding.
//
// Root cause: `resolveIncompatibleReasoningAction` mapped combo-step "skip" to
// "reject" unconditionally. The combo loop DOES fall through to the next target on a
// reasoning-incompatible 400 (the error text contains none of the #2101 body-specific
// keywords), so non-last targets correctly skip. But when ALL targets are incompatible,
// "skip" exhausts every target and the LAST one hard-fails with 400 instead of dropping
// reasoning and succeeding — the opposite of what "skip" promises.
//
// Fix: thread `hasMoreComboTargets` from combo.ts through the dispatch chain into
// `resolveIncompatibleReasoningAction`. The last target (`hasMoreComboTargets === false`)
// falls through to the default "drop" instead of "reject". Non-last targets keep
// "reject" so they still skip to the next candidate. `hasMoreComboTargets !== false`
// preserves the current behavior for any caller that doesn't thread the field.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-reasoning-skip-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const { handleComboChat } = await import("../../open-sse/services/combo.ts");
const { resolveIncompatibleReasoningAction } =
  await import("../../open-sse/services/reasoningInputPolicy.ts");
type SingleModelTarget = import("../../open-sse/services/combo/types.ts").SingleModelTarget;
const core = await import("../../src/lib/db/core.ts");
const { resetAllComboMetrics } = await import("../../open-sse/services/comboMetrics.ts");
const { resetAllCircuitBreakers } = await import("../../src/shared/utils/circuitBreaker.ts");
const { resetAll: resetAllSemaphores } =
  await import("../../open-sse/services/rateLimitSemaphore.ts");
const { _resetAllDecks } = await import("../../src/shared/utils/shuffleDeck.ts");
const { clearSessions } = await import("../../open-sse/services/sessionManager.ts");

function createLog() {
  const entries: unknown[] = [];
  const push = (level: string) => (tag: unknown, msg: unknown) => entries.push({ level, tag, msg });
  return {
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    debug: push("debug"),
    entries,
  };
}

const okResponse = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const reasoningIncompatible400 = () =>
  new Response(
    JSON.stringify({
      error: { message: "Reasoning continuation is not compatible with the selected target" },
    }),
    { status: 400, headers: { "content-type": "application/json" } }
  );

const MODELS = ["openai/gpt-4o-mini", "deepseek/deepseek-v4-pro"];

function comboOf(strategy: string, name: string) {
  return {
    name,
    strategy,
    models: MODELS,
    config: {
      maxRetries: 0,
      retryDelayMs: 0,
      fallbackDelayMs: 0,
      reasoningTransportFallback: "skip",
    },
  };
}

/** A Responses-API body carrying an inbound reasoning item the target cannot continue. */
function reasoningBody() {
  return {
    model: "openai/gpt-4o-mini",
    input: [
      {
        id: "rs_plaintext",
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "inspect first" }],
      },
      {
        id: "fc_shared",
        type: "function_call",
        call_id: "call_1",
        name: "search",
        arguments: "{}",
      },
    ],
  };
}

function hasReasoningItem(body: Record<string, unknown>): boolean {
  const input = body.input;
  return (
    Array.isArray(input) &&
    input.some((item) => (item as Record<string, unknown>)?.type === "reasoning")
  );
}

test.beforeEach(() => {
  resetAllComboMetrics();
  resetAllCircuitBreakers();
  resetAllSemaphores();
  _resetAllDecks();
  clearSessions();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
});

// ── Unit: the policy logic is the heart of the fix ───────────────────────────
test("resolveIncompatibleReasoningAction: combo-step skip drops on the last target, rejects otherwise", () => {
  // THE FIX: last combo target with "skip" drops instead of rejecting.
  assert.equal(
    resolveIncompatibleReasoningAction({
      reasoningTransportFallback: "skip",
      isComboStep: true,
      hasMoreComboTargets: false,
    }),
    "drop",
    "last combo target with skip must drop reasoning, not reject"
  );

  // Non-last target keeps "reject" so the combo advances to the next candidate.
  assert.equal(
    resolveIncompatibleReasoningAction({
      reasoningTransportFallback: "skip",
      isComboStep: true,
      hasMoreComboTargets: true,
    }),
    "reject",
    "non-last combo target with skip must still reject so the combo advances"
  );

  // Backward compat: a caller that doesn't thread hasMoreComboTargets keeps "reject".
  // `undefined !== false` → the guard fires → reject (current behavior preserved).
  assert.equal(
    resolveIncompatibleReasoningAction({
      reasoningTransportFallback: "skip",
      isComboStep: true,
    }),
    "reject",
    "combo step with skip and no hasMoreComboTargets signal keeps current reject behavior"
  );
});

test("resolveIncompatibleReasoningAction: explicit drop and single-target defaults are unchanged", () => {
  assert.equal(
    resolveIncompatibleReasoningAction({
      reasoningTransportFallback: "drop",
      isComboStep: true,
      hasMoreComboTargets: false,
    }),
    "drop"
  );
  assert.equal(
    resolveIncompatibleReasoningAction({
      reasoningTransportFallback: "skip",
      isComboStep: false,
      hasMoreComboTargets: false,
    }),
    "drop",
    "single-target skip still defaults to drop"
  );
});

// ── Combo: all-incompatible combo with skip must succeed via last-target drop ─
test("combo with skip fallback drops reasoning on the last target instead of hard-failing", async () => {
  const attempts: { model: string; hasMoreComboTargets: unknown; action: string }[] = [];

  const response = await handleComboChat({
    body: reasoningBody(),
    combo: comboOf("priority", "reasoning-skip-last-drop"),
    handleSingleModel: async (
      received: Record<string, unknown>,
      modelStr: string,
      target?: SingleModelTarget
    ) => {
      // Simulate chatCore: resolve the real policy action, then behave accordingly.
      // "reject" → the upstream returns the reasoning-incompatible 400 (combo advances).
      // "drop"   → the reasoning is dropped and the upstream accepts the payload (200).
      const action = resolveIncompatibleReasoningAction({
        reasoningTransportFallback: "skip",
        isComboStep: true,
        hasMoreComboTargets: target?.hasMoreComboTargets,
      });
      attempts.push({ model: modelStr, hasMoreComboTargets: target?.hasMoreComboTargets, action });
      if (hasReasoningItem(received) && action === "reject") {
        return reasoningIncompatible400();
      }
      return okResponse();
    },
    isModelAvailable: async () => true,
    log: createLog(),
    settings: null,
    allCombos: null,
  });

  assert.equal(
    response.status,
    200,
    "last target must drop reasoning and succeed, not hard-fail 400"
  );
  assert.ok(attempts.length >= 2, `expected at least 2 attempts, got ${attempts.length}`);
  // The last attempted target saw hasMoreComboTargets === false and chose "drop".
  const last = attempts[attempts.length - 1];
  assert.equal(last.hasMoreComboTargets, false, "last target must be flagged as the final one");
  assert.equal(last.action, "drop", "last target must drop, not reject");
});

// ── Combo: a mixed combo still skips an incompatible non-last target ──────────
test("combo with skip fallback still skips an incompatible non-last target", async () => {
  const attempts: { model: string; hasMoreComboTargets: unknown; action: string }[] = [];

  const response = await handleComboChat({
    body: reasoningBody(),
    combo: comboOf("priority", "reasoning-skip-mixed"),
    handleSingleModel: async (
      received: Record<string, unknown>,
      modelStr: string,
      target?: SingleModelTarget
    ) => {
      const action = resolveIncompatibleReasoningAction({
        reasoningTransportFallback: "skip",
        isComboStep: true,
        hasMoreComboTargets: target?.hasMoreComboTargets,
      });
      attempts.push({ model: modelStr, hasMoreComboTargets: target?.hasMoreComboTargets, action });
      // Target 1 (openai) is reasoning-incompatible → reject → 400 → combo advances.
      // Target 2 (deepseek) is compatible → no reasoning issue → 200.
      const isIncompatible = hasReasoningItem(received) && modelStr.startsWith("openai/");
      if (isIncompatible && action === "reject") {
        return reasoningIncompatible400();
      }
      return okResponse();
    },
    isModelAvailable: async () => true,
    log: createLog(),
    settings: null,
    allCombos: null,
  });

  assert.equal(response.status, 200, "mixed combo must fall through to the compatible target");
  assert.ok(attempts.length >= 2, "both targets must be attempted");
  // The first target was non-last and rejected (so the combo advanced).
  const first = attempts[0];
  assert.equal(first.hasMoreComboTargets, true, "first target must see hasMoreComboTargets=true");
  assert.equal(first.action, "reject", "first target must reject so the combo advances");
});
