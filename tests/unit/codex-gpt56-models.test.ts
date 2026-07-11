import test from "node:test";
import assert from "node:assert/strict";

import { codexProvider } from "../../open-sse/config/providers/registry/codex/index.ts";
import { CodexExecutor, getCodexUpstreamModel } from "../../open-sse/executors/codex.ts";
import { getModelSpec } from "../../src/shared/constants/modelSpecs.ts";

const OFFICIAL_GPT_5_6_CONTEXT_WINDOW = 372000;

test("Codex registry exposes the official GPT-5.6 models without an invented output cap", () => {
  const models = new Map(codexProvider.models?.map((model) => [model.id, model]));

  for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    const model = models.get(id);
    assert.ok(model, `${id} should be registered`);
    assert.equal(model.contextLength, OFFICIAL_GPT_5_6_CONTEXT_WINDOW);
    assert.equal(model.maxOutputTokens, undefined);

    const spec = getModelSpec(id);
    assert.ok(spec, `${id} should have a model spec`);
    assert.equal(spec.contextWindow, OFFICIAL_GPT_5_6_CONTEXT_WINDOW);
    assert.equal(spec.maxOutputTokens, undefined);
  }

  assert.ok(models.has("gpt-5.6-sol-ultra"));
  assert.ok(models.has("gpt-5.6-terra-ultra"));
  assert.equal(models.has("gpt-5.6-luna-ultra"), false);
  assert.ok(models.has("gpt-5.6-luna-max"));
});

test("Codex GPT-5.6 compatibility alias resolves upstream to Sol", () => {
  assert.equal(getCodexUpstreamModel("gpt-5.6"), "gpt-5.6-sol");
  assert.equal(getCodexUpstreamModel("gpt-5.6-ultra"), "gpt-5.6-sol");
  assert.equal(getCodexUpstreamModel("gpt-5.6-terra-max"), "gpt-5.6-terra");
});

test("Codex GPT-5.6 preserves supported efforts and caps Luna at max", () => {
  const executor = new CodexExecutor();
  const transform = (model: string, effort: string) =>
    executor.transformRequest(model, { model, input: [], reasoning: { effort } }, false, {
      requestEndpointPath: "/responses",
    });

  const sol = transform("gpt-5.6-sol", "ultra");
  assert.equal(sol.model, "gpt-5.6-sol");
  assert.equal(sol.reasoning.effort, "ultra");

  const terra = transform("gpt-5.6-terra", "max");
  assert.equal(terra.model, "gpt-5.6-terra");
  assert.equal(terra.reasoning.effort, "max");

  const luna = transform("gpt-5.6-luna", "ultra");
  assert.equal(luna.model, "gpt-5.6-luna");
  assert.equal(luna.reasoning.effort, "max");

  const alias = transform("gpt-5.6-ultra", "low");
  assert.equal(alias.model, "gpt-5.6-sol");
  assert.equal(alias.reasoning.effort, "ultra");
});
