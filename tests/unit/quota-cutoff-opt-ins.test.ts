import test from "node:test";
import assert from "node:assert/strict";
import { hasCodexCreditOptIn } from "../../src/lib/providers/quotaCutoffOptIns.ts";

test("the Codex credit opt-in is read from runtime credentials without trusting their shape", () => {
  const credentials = { providerSpecificData: { allowPaidCredits: true } };
  assert.equal(hasCodexCreditOptIn("codex", credentials, "codex/gpt-5.5"), true);
  assert.equal(hasCodexCreditOptIn("claude", credentials, "claude-opus-5"), false);
  assert.equal(hasCodexCreditOptIn("codex", null, "codex/gpt-5.5"), false);
  assert.equal(hasCodexCreditOptIn("codex", "not-an-object", "codex/gpt-5.5"), false);
  assert.equal(hasCodexCreditOptIn("codex", {}, "codex/gpt-5.5"), false);
});
