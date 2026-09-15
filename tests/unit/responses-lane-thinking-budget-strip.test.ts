/**
 * Heimdall incident 2026-09-15: with the dashboard Thinking-Budget in custom/adaptive
 * mode, `applyThinkingBudget` writes a Claude-shaped `thinking:{type,budget_tokens}`
 * (and, when the client sent `reasoning.effort`, a stray top-level `reasoning_effort`)
 * onto a Responses-API body. OpenCode Go serves muse-spark only on /v1/responses and
 * rejects both with 400 "unknown parameter `thinking`" / "`reasoning_effort`", so the
 * model was unusable from Codex. The Responses-target normalization must drop both.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { translateRequest } from "../../open-sse/translator/index.ts";
import {
  DEFAULT_THINKING_CONFIG,
  setThinkingBudgetConfig,
  ThinkingMode,
} from "../../open-sse/services/thinkingBudget.ts";

const MODEL = "opencode-go/muse-spark-1.3-contributor";

afterEach(() => setThinkingBudgetConfig(DEFAULT_THINKING_CONFIG));

function translate(extra: Record<string, unknown>) {
  const body = { model: MODEL, stream: true, input: "Reply exactly PONG.", ...extra };
  return translateRequest(
    "openai-responses",
    "openai-responses",
    MODEL,
    body,
    true,
    null,
    "opencode-go"
  ) as Record<string, unknown>;
}

for (const mode of [ThinkingMode.CUSTOM, ThinkingMode.ADAPTIVE]) {
  test(`${mode} mode: no Claude thinking object reaches a Responses upstream`, () => {
    setThinkingBudgetConfig({ mode, customBudget: 8000, effortLevel: "medium" });
    const out = translate({});
    assert.equal(out.thinking, undefined);
    assert.equal(out.reasoning_effort, undefined);
  });

  test(`${mode} mode: explicit reasoning.effort wins and no stray reasoning_effort remains`, () => {
    setThinkingBudgetConfig({ mode, customBudget: 8000, effortLevel: "medium" });
    const out = translate({ reasoning: { effort: "low", summary: "auto" } });
    assert.equal(out.thinking, undefined);
    assert.equal(out.reasoning_effort, undefined);
    assert.deepEqual(out.reasoning, { effort: "low", summary: "auto" });
  });
}

test("passthrough mode: stray chat-shaped reasoning_effort is still promoted (#7631)", () => {
  const out = translate({ reasoning_effort: "high" });
  assert.equal(out.reasoning_effort, undefined);
  assert.deepEqual(out.reasoning, { effort: "high" });
});
