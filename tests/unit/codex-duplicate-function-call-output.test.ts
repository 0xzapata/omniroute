/**
 * Bug: "Duplicate function_call_output for call_id" (HTTP 400) from upstream.
 *
 * Observed in production (heimdall.kartel.sh) against
 * `command-code/meta/muse-spark-1.3-contributor`: OmniRoute dispatched a
 * Responses-API `input` array containing two `function_call_output` items for
 * the same `call_id`. The upstream rejects this with:
 *   "Duplicate function_call_output for call_id '<id>'. Each function_call must
 *    have exactly one matching function_call_output"
 * That error string does not exist anywhere in OmniRoute source — it is the
 * upstream's rejection of a malformed payload OmniRoute produced.
 *
 * The pre-dispatch repair pipeline in `open-sse/executors/codex.ts` runs
 * `stripOrphanedCodexFunctionCallOutputs` (removes FCO with no matching
 * function_call) and `repairMissingCodexToolCallOutputs` (inserts an empty FCO
 * for a function_call missing one). Neither deduplicates two FCO items sharing
 * the same `call_id`, so both survive to the upstream and trigger the 400.
 *
 * This test reproduces the bug through `CodexExecutor.transformRequest` — the
 * same chokepoint the orphan-stripping test (#2928) uses — so it proves the
 * dedup is wired into the real dispatch path, not just an isolated helper.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "omniroute-codex-dup-fco-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { CodexExecutor } = await import("../../open-sse/executors/codex.ts");

type InputItem = Record<string, unknown>;

function transform(input: InputItem[]): InputItem[] {
  const executor = new CodexExecutor();
  const result = executor.transformRequest(
    "gpt-5.6-sol",
    {
      _nativeCodexPassthrough: true,
      model: "gpt-5.6-sol",
      input,
      stream: true,
    },
    true,
    { requestEndpointPath: "/responses" }
  );

  assert.ok(Array.isArray(result.input));
  return result.input as InputItem[];
}

function fcoFor(input: InputItem[], callId: string): InputItem[] {
  return input.filter((item) => item.type === "function_call_output" && item.call_id === callId);
}

function customToolOutputsFor(input: InputItem[], callId: string): InputItem[] {
  return input.filter((item) => item.type === "custom_tool_call_output" && item.call_id === callId);
}

test.after(() => {
  core.resetDbInstance();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("Codex deduplicates function_call_output items sharing the same call_id", () => {
  // One function_call, TWO function_call_output items for the same call_id —
  // the exact shape the upstream rejected with "Duplicate function_call_output".
  const result = transform([
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    { type: "function_call", call_id: "call_dup", name: "search", arguments: "{}" },
    { type: "function_call_output", call_id: "call_dup", output: "first result" },
    { type: "function_call_output", call_id: "call_dup", output: "second result" },
  ]);

  const outputs = fcoFor(result, "call_dup");
  assert.equal(outputs.length, 1, "duplicate function_call_output must be removed");
  // The first (canonical, client-provided) output is kept.
  assert.equal(outputs[0].output, "first result");
});

test("Codex keeps the function_call alongside its single surviving output", () => {
  const result = transform([
    { type: "function_call", call_id: "call_dup2", name: "search", arguments: "{}" },
    { type: "function_call_output", call_id: "call_dup2", output: "kept" },
    { type: "function_call_output", call_id: "call_dup2", output: "dropped" },
  ]);

  const calls = result.filter((i) => i.type === "function_call" && i.call_id === "call_dup2");
  assert.equal(calls.length, 1, "function_call itself must not be removed");
  assert.equal(fcoFor(result, "call_dup2").length, 1);
});

test("Codex deduplicates custom_tool_call_output items sharing the same call_id", () => {
  const result = transform([
    { type: "custom_tool_call", call_id: "call_custom", name: "my_tool", input: {} },
    { type: "custom_tool_call_output", call_id: "call_custom", output: "first" },
    { type: "custom_tool_call_output", call_id: "call_custom", output: "second" },
  ]);

  assert.equal(customToolOutputsFor(result, "call_custom").length, 1);
});

test("Codex leaves well-formed input (one output per call_id) untouched", () => {
  const result = transform([
    { type: "function_call", call_id: "call_a", name: "search", arguments: "{}" },
    { type: "function_call_output", call_id: "call_a", output: "a result" },
    { type: "function_call", call_id: "call_b", name: "search", arguments: "{}" },
    { type: "function_call_output", call_id: "call_b", output: "b result" },
  ]);

  assert.equal(fcoFor(result, "call_a").length, 1);
  assert.equal(fcoFor(result, "call_b").length, 1);
  // No function_call was removed either.
  assert.equal(result.filter((i) => i.type === "function_call").length, 2);
});

test("Codex still strips orphans alongside dedup (the two passes compose)", () => {
  // call_keep: one call, two outputs (one kept). call_orphan: no call, one output (stripped).
  const result = transform([
    { type: "function_call", call_id: "call_keep", name: "search", arguments: "{}" },
    { type: "function_call_output", call_id: "call_keep", output: "keep1" },
    { type: "function_call_output", call_id: "call_keep", output: "keep2" },
    { type: "function_call_output", call_id: "call_orphan", output: "orphan" },
  ]);

  assert.equal(fcoFor(result, "call_keep").length, 1, "duplicate deduped");
  assert.equal(fcoFor(result, "call_orphan").length, 0, "orphan stripped");
});
