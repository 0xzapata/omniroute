import assert from "node:assert/strict";
import { test, after } from "node:test";
import { BaseExecutor, type ExecuteInput } from "../../open-sse/executors/base.ts";
import { OpencodeExecutor } from "../../open-sse/executors/opencode.ts";
import { resolveExecutionCredentials } from "../../open-sse/handlers/chatCore/executionCredentials.ts";

import { resetDbInstance } from "../../src/lib/db/core.ts";
after(() => resetDbInstance());

for (const provider of ["opencode", "opencode-zen", "opencode-go"]) {
  test(`${provider}: resolved custom format controls dispatch and resets between requests`, async () => {
    const original = { apiKey: "test-key", providerSpecificData: { unrelated: true } };
    const executor = new OpencodeExecutor(provider);
    const urls: string[] = [];
    const originalExecute = BaseExecutor.prototype.execute;
    BaseExecutor.prototype.execute = async function (input: ExecuteInput) {
      const url = this.buildUrl(input.model, input.stream, 0, input.credentials);
      urls.push(url);
      return { response: new Response("{}"), url, headers: {}, transformedBody: input.body };
    };
    try {
      for (const [format, suffix] of [
        ["openai-responses", "/responses"],
        ["claude", "/messages"],
        ["openai", "/chat/completions"],
      ]) {
        const credentials = resolveExecutionCredentials({
          credentials: original,
          provider,
          targetFormat: format,
          nativeCodexPassthrough: false,
          endpointPath: "/v1/responses",
          ccSessionId: null,
        });
        await executor.execute({
          model: "custom-protocol-probe",
          body: {},
          stream: false,
          credentials,
        });
        assert.ok(urls.at(-1)?.endsWith(suffix), `${format} dispatched to ${urls.at(-1)}`);
        assert.equal(executor._requestFormat, null);
      }
      await executor.execute({
        model: "unlisted-chat-model",
        body: {},
        stream: false,
        credentials: original,
      });
      assert.ok(urls.at(-1)?.endsWith("/chat/completions"));
      assert.deepEqual(original.providerSpecificData, { unrelated: true });
    } finally {
      BaseExecutor.prototype.execute = originalExecute;
    }
  });
}

test("resolved OpenCode format metadata stays scoped to OpenCode providers", () => {
  const result = resolveExecutionCredentials({
    credentials: { providerSpecificData: {} },
    provider: "openai",
    targetFormat: "openai-responses",
    nativeCodexPassthrough: false,
    endpointPath: "/v1/responses",
    ccSessionId: null,
  });
  assert.deepEqual(result.providerSpecificData, {});
});
