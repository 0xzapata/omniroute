# Upstream PR Review: Hosted Tool `tool_choice` Fix

> **Status**: Ready for submission (3 minor fixes needed)  
> **Branch**: `zeabur` (fork) → needs rebase onto `upstream/main`  
> **Target**: `diegosouzapw/OmniRoute`  
> **Resolves**: #2692, #2695 (both opened May 25, 2026)

---

## Summary

Prevents silent `tool_choice` deletion in `normalizeCodexTools` when the request includes hosted tools (e.g., `computer_use_preview`, `web_search`, `code_interpreter`). The tool type itself is now registered as a fallback name in `validToolNames`, so `tool_choice: { type: "function", name: "web_search" }` survives validation.

Also adds missing OpenAI hosted tool types from the official Responses API spec, explicit `computer_call`/`computer_call_output` handlers in the response sanitizer, and extends input name validation to computer-specific item types.

---

## Must Fix Before Submitting

### 1. Fork-specific `.gitignore` entry (REMOVE)

```
~/  ← REMOVE from .gitignore
```

`~/` was added because the fork's dev server created a `~/` directory in the workspace. This is fork-specific and not relevant upstream (OmniRoute stores runtime data under `DATA_DIR`).

### 2. `console.warn` → `console.debug`

```typescript
// Current in fork:
console.warn(
  `[Codex] dropping tool_choice for "${rawName}": not in validToolNames (known: ${[...validToolNames].join(", ") || "(none)"})`
);

// Should be for upstream:
console.debug(
  `[Codex] dropping tool_choice for "${rawName}": not in validToolNames (known: ${[...validToolNames].join(", ") || "(none)"})`
);
```

The existing pattern at `codex.ts:433` uses `console.debug` for the parallel "dropping unknown hosted tool type" message. `console.warn` in production would generate unnecessary noise.

### 3. Rebase onto `upstream/main`

Per `AGENTS.md`:

> When preparing a PR for upstream, always start the work branch from `upstream/main`, not from this fork's `main`

The current branch `zeabur` contains fork-specific commits (CI/Docker/OAuth config). The fix needs to be extracted onto a clean branch from `upstream/main`.

---

## Changes Summary

| File                                             | +/−    | What                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-sse/executors/codex.ts`                    | +19/−1 | Register hosted tool type as fallback name in `validToolNames`; add `computer_use`, `web_search_preview_2025_03_11` to `CODEX_HOSTED_TOOL_TYPES`; export `normalizeCodexTools` for testability; add `console.debug` when `tool_choice` is dropped |
| `open-sse/handlers/responseSanitizer.ts`         | +23    | Add explicit `computer_call` handler (normalizes `call_id`, `action`, `pending_safety_checks`) and `computer_call_output` handler (normalizes `call_id`, `output`)                                                                                |
| `open-sse/services/responsesInputSanitizer.ts`   | +5/−1  | Extend OpenAI name regex (`^[a-zA-Z0-9_-]{1,128}$`) to `computer_call` and `computer_call_output` types                                                                                                                                           |
| `tests/unit/codex-computer-use-tool-fix.test.ts` | +305   | 19 unit tests: 7 for hosted tool name registration, 6 for response sanitization, 6 for input name validation                                                                                                                                      |

---

## Code Style Compliance

| Check                                                               | Status |
| ------------------------------------------------------------------- | ------ |
| Conventional commit (`fix(codex):`)                                 | ✓      |
| Uses `toString`, `toRecord`, `JsonRecord` helpers                   | ✓      |
| Uses `Record<string, unknown>` for dynamic data                     | ✓      |
| No `any` type — uses `unknown` with narrowing                       | ✓      |
| Tests use `node:test` + `node:assert/strict`                        | ✓      |
| Tests use dynamic imports (`await import()`)                        | ✓      |
| Export for testability (existing pattern: `encodeResponseSseEvent`) | ✓      |

---

## Verification Evidence

### Before/After Server Log Comparison

```
BEFORE (commit 3992a84d):
  [Codex] dropping tool_choice for "web_search": not in validToolNames (known: bash)

AFTER (with fix):
  (no dropping message — tool_choice preserved)
```

### Test Results

```
19 tests, 19 pass, 0 fail
90 regression tests (executor-codex, response-sanitizer, claude-code-parity,
  codex-failover, codex-fast-tier): 0 failures
```

### API End-to-End

Request with `tool_choice: { type: "function", name: "web_search" }`:

- BEFORE fix: tool_choice silently deleted, response missing tool_choice field
- AFTER fix: tool_choice preserved in response: `"tool_choice":{"type":"function","name":"web_search"}`

---

## Hosted Tool Type Verification Against OpenAI Docs

Source: [developers.openai.com/api/reference](https://developers.openai.com/api/reference/resources/responses/methods/retrieve)

| Official OpenAI API             | Before Fix | After Fix |
| ------------------------------- | ---------- | --------- |
| `file_search`                   | ✓          | ✓         |
| `web_search_preview`            | ✓          | ✓         |
| `web_search_preview_2025_03_11` | ✗          | ✓         |
| `computer`                      | ✓          | ✓         |
| `computer_use_preview`          | ✓          | ✓         |
| `computer_use`                  | ✗          | ✓         |
| `image_generation`              | ✓          | ✓         |
| `code_interpreter`              | ✓          | ✓         |

---

## Submission Checklist

- [ ] Remove `~/` from `.gitignore`
- [ ] Change `console.warn` to `console.debug`
- [ ] Create branch from `upstream/main`
- [ ] Cherry-pick fix commit onto clean branch
- [ ] Run `npm run build && npm test`
- [ ] Create PR referencing #2692 and #2695
- [ ] Include before/after server log evidence in PR description
