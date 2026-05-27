import test from "node:test";
import assert from "node:assert/strict";

const { normalizeCodexTools } = await import("../../open-sse/executors/codex.ts");

const { sanitizeResponsesApiResponse } =
  await import("../../open-sse/handlers/responseSanitizer.ts");

const { sanitizeResponsesInputItems } =
  await import("../../open-sse/services/responsesInputSanitizer.ts");

// ── Fix 1: normalizeCodexTools — hosted tool type registered as fallback ──

test("normalizeCodexTools registers hosted tool type as fallback name in validToolNames", () => {
  const body = {
    tools: [
      { type: "web_search" },
      {
        type: "function",
        name: "bash",
        description: "Shell",
        parameters: { type: "object", properties: {} },
      },
    ],
    tool_choice: { type: "function", name: "web_search" },
  };

  normalizeCodexTools(body);

  assert.ok(body.tool_choice, "tool_choice should survive — tool type registered as fallback name");
});

test("normalizeCodexTools registers computer_use_preview with display_name", () => {
  const body = {
    tools: [{ type: "computer_use_preview", display_name: "Computer Use", environment: "browser" }],
    tool_choice: { type: "function", name: "Computer Use" },
  };

  normalizeCodexTools(body);

  assert.ok(body.tool_choice, "tool_choice should survive when display_name is registered");
});

test("normalizeCodexTools registers hosted tool name from display_name field", () => {
  const body = {
    tools: [{ type: "web_search", display_name: "Web Search" }],
    tool_choice: { type: "function", name: "Web Search" },
  };

  normalizeCodexTools(body);

  assert.ok(body.tool_choice, "tool_choice should survive when display_name is registered");
});

test("normalizeCodexTools preserves web_search_preview_2025_03_11 tool", () => {
  const body = {
    tools: [{ type: "web_search_preview_2025_03_11" }],
    tool_choice: { type: "function", name: "web_search_preview_2025_03_11" },
  };

  normalizeCodexTools(body);

  assert.ok(body.tool_choice, "tool_choice should survive for web_search_preview_2025_03_11");
});

test("normalizeCodexTools preserves computer_use tool", () => {
  const body = {
    tools: [{ type: "computer_use" }],
    tool_choice: { type: "function", name: "computer_use" },
  };

  normalizeCodexTools(body);

  assert.ok(body.tool_choice, "tool_choice should survive for computer_use");
});

test("normalizeCodexTools preserves tool_choice for regular function tools", () => {
  const body = {
    tools: [
      {
        type: "function",
        name: "bash",
        description: "Shell",
        parameters: { type: "object", properties: {} },
      },
    ],
    tool_choice: { type: "function", name: "bash" },
  };

  normalizeCodexTools(body);

  assert.ok(body.tool_choice);
  const tc = body.tool_choice as Record<string, unknown>;
  assert.equal(tc.name, "bash");
});

test("normalizeCodexTools handles tool_choice with unknown function name", () => {
  const body = {
    tools: [
      {
        type: "function",
        name: "bash",
        description: "Shell",
        parameters: { type: "object", properties: {} },
      },
    ],
    tool_choice: { type: "function", name: "unknown_tool" },
  };

  normalizeCodexTools(body);

  assert.equal(
    body.tool_choice,
    undefined,
    "tool_choice should be deleted for unknown function names"
  );
});

// ── Fix 2: sanitizeResponsesOutputItem — computer_call and computer_call_output ──

test("sanitizeResponsesApiResponse preserves computer_call output items", () => {
  const input = {
    id: "resp_test_cm",
    object: "response",
    output: [
      {
        id: "cc_abc123",
        type: "computer_call",
        call_id: "call_1",
        action: "screenshot",
        pending_safety_checks: false,
      },
    ],
  };

  const sanitized = sanitizeResponsesApiResponse(input) as Record<string, unknown>;

  assert.ok(sanitized);
  assert.equal(sanitized.id, "resp_test_cm");

  const output = sanitized.output as Array<Record<string, unknown>>;
  assert.equal(output.length, 1);
  assert.equal(output[0].type, "computer_call");
  assert.equal(output[0].call_id, "call_1");
  assert.equal(output[0].action, "screenshot");
  assert.equal(output[0].pending_safety_checks, false);
});

test("sanitizeResponsesApiResponse preserves computer_call_output items", () => {
  const input = {
    id: "resp_test_co",
    object: "response",
    output: [
      {
        id: "cco_xyz",
        type: "computer_call_output",
        call_id: "call_1",
        output: "screenshot captured successfully",
      },
    ],
  };

  const sanitized = sanitizeResponsesApiResponse(input) as Record<string, unknown>;

  const output = sanitized.output as Array<Record<string, unknown>>;
  assert.equal(output.length, 1);
  assert.equal(output[0].type, "computer_call_output");
  assert.equal(output[0].call_id, "call_1");
  assert.equal(output[0].output, "screenshot captured successfully");
});

test("sanitizeResponsesApiResponse normalizes computer_call with missing optional fields", () => {
  const input = {
    id: "resp_min",
    object: "response",
    output: [{ type: "computer_call" }],
  };

  const sanitized = sanitizeResponsesApiResponse(input) as Record<string, unknown>;
  const output = sanitized.output as Array<Record<string, unknown>>;

  assert.equal(output.length, 1);
  assert.equal(output[0].type, "computer_call");
  assert.equal(typeof output[0].call_id, "string", "call_id should default to a string");
  assert.equal(output[0].action, "");
  assert.equal(output[0].pending_safety_checks, false);
});

test("sanitizeResponsesApiResponse preserves existing call_id on computer_call", () => {
  const input = {
    id: "resp_call",
    object: "response",
    output: [{ type: "computer_call", call_id: "existing_call_42" }],
  };

  const sanitized = sanitizeResponsesApiResponse(input) as Record<string, unknown>;
  const output = sanitized.output as Array<Record<string, unknown>>;

  assert.equal(output[0].call_id, "existing_call_42");
});

test("sanitizeResponsesApiResponse preserves boolean pending_safety_checks", () => {
  const input = {
    id: "resp_safety",
    object: "response",
    output: [{ type: "computer_call", call_id: "c1", pending_safety_checks: true }],
  };

  const sanitized = sanitizeResponsesApiResponse(input) as Record<string, unknown>;
  const output = sanitized.output as Array<Record<string, unknown>>;

  assert.equal(output[0].pending_safety_checks, true);
});

test("sanitizeResponsesApiResponse handles mixed output containing computer_call, message, and reasoning items", () => {
  const input = {
    id: "resp_mixed",
    object: "response",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "Thinking step" }] },
      {
        type: "computer_call",
        call_id: "call_1",
        action: "screenshot",
        pending_safety_checks: false,
      },
      { type: "message", role: "assistant", content: "I took a screenshot" },
      { type: "computer_call_output", call_id: "call_1", output: "base64encoded..." },
    ],
  };

  const sanitized = sanitizeResponsesApiResponse(input) as Record<string, unknown>;
  const output = sanitized.output as Array<Record<string, unknown>>;

  assert.equal(output.length, 4);
  assert.equal(output[0].type, "reasoning");
  assert.equal(output[1].type, "computer_call");
  assert.equal(output[2].type, "message");
  assert.equal(output[3].type, "computer_call_output");
});

// ── Fix 3: truncateInputItemName — computer types added to name sanitization ──

test("sanitizeResponsesInputItems sanitizes computer_call names with invalid characters", () => {
  const items = [{ type: "computer_call", call_id: "call_1", name: "computer use tool" }];

  const sanitized = sanitizeResponsesInputItems(items) as Array<Record<string, unknown>>;

  assert.equal(sanitized.length, 1);
  assert.equal(
    sanitized[0].name,
    "computer_use_tool",
    "spaces should be replaced with underscores"
  );
});

test("sanitizeResponsesInputItems sanitizes computer_call_output names", () => {
  const items = [{ type: "computer_call_output", call_id: "call_1", name: "screen[shot]result!" }];

  const sanitized = sanitizeResponsesInputItems(items) as Array<Record<string, unknown>>;

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].name, "screen_shot_result_", "special chars replaced with underscore");
});

test("sanitizeResponsesInputItems truncates long computer_call names to 128 chars", () => {
  const longName = "a".repeat(200);
  const items = [{ type: "computer_call", call_id: "call_1", name: longName }];

  const sanitized = sanitizeResponsesInputItems(items) as Array<Record<string, unknown>>;

  assert.ok((sanitized[0].name as string).length <= 128);
  assert.ok((sanitized[0].name as string).startsWith("aaaa"));
});

test("sanitizeResponsesInputItems preserves valid computer_call names", () => {
  const items = [{ type: "computer_call", call_id: "call_1", name: "computer_use_preview_2024" }];

  const sanitized = sanitizeResponsesInputItems(items) as Array<Record<string, unknown>>;

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].name, "computer_use_preview_2024", "valid names should be preserved");
});

test("sanitizeResponsesInputItems still sanitizes function_call names (regression check)", () => {
  const items = [{ type: "function_call", call_id: "call_1", name: "my function!" }];

  const sanitized = sanitizeResponsesInputItems(items) as Array<Record<string, unknown>>;

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].name, "my_function_", "function_call sanitization must still work");
});

test("sanitizeResponsesInputItems still sanitizes function_call_output names (regression check)", () => {
  const items = [{ type: "function_call_output", call_id: "call_1", name: "result: ok!" }];

  const sanitized = sanitizeResponsesInputItems(items) as Array<Record<string, unknown>>;

  assert.equal(sanitized.length, 1);
  assert.equal(
    sanitized[0].name,
    "result__ok_",
    "function_call_output sanitization must still work"
  );
});
