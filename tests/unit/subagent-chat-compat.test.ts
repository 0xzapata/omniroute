import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResponsesInputForChat,
  normalizeCodexResponsesInput,
} from "../../open-sse/utils/responsesInputNormalization.ts";
import { flattenNamespaceToolName } from "../../open-sse/translator/request/openai-responses/namespaceFlatten.ts";

test("opaque agent assignments fail visibly without leaking content", () => {
  const item = {
    type: "agent_message",
    content: [
      { type: "input_text", text: "Message Type: NEW_TASK\nPayload:\n" },
      { type: "encrypted_content", encrypted_content: "secret-assignment" },
    ],
  };
  assert.throws(
    () => normalizeResponsesInputForChat([item]),
    (error: Error & { statusCode?: number; errorType?: string }) =>
      error.statusCode === 400 &&
      error.errorType === "unsupported_feature" &&
      !error.message.includes("secret-assignment")
  );
  const native = { input: [item] };
  normalizeCodexResponsesInput(native);
  assert.deepEqual(native.input, [item]);
});

test("plaintext NEW_TASK is a user assignment and preserves all text", () => {
  const content = "Message Type: NEW_TASK\nPayload:\nReply ACK";
  assert.deepEqual(
    normalizeResponsesInputForChat([
      { type: "agent_message", content: [{ type: "input_text", text: content }] },
    ]),
    [{ type: "message", role: "user", content: [{ type: "input_text", text: content }] }]
  );
});

test("replayed function and custom calls match namespace declarations", () => {
  for (const type of ["function_call", "custom_tool_call"]) {
    for (const namespace of ["agents", "functions", "x".repeat(70)]) {
      const item = {
        type,
        namespace,
        name: "spawn_agent",
        call_id: "call_1",
        arguments: "{}",
        input: "patch",
      };
      const [normalized] = normalizeResponsesInputForChat([item]) as Record<string, unknown>[];
      assert.equal(normalized.name, flattenNamespaceToolName(namespace, item.name));
      assert.equal(normalized.call_id, item.call_id);
      assert.equal(normalized.arguments, item.arguments);
      assert.equal(normalized.input, item.input);
      assert.equal(item.name, "spawn_agent");
    }
  }
  const bare = { type: "function_call", name: "plain", call_id: "c" };
  assert.deepEqual(normalizeResponsesInputForChat([bare]), [bare]);
});
