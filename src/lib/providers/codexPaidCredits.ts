import { getCodexModelScope } from "@omniroute/open-sse/config/codexQuotaScopes.ts";
import { isCodexQuotaFilteringDisabled } from "@/lib/providers/codexQuotaFiltering";

export interface CodexPaidCredits {
  hasCredits: boolean;
  unlimited: boolean;
  overageLimitReached: boolean;
  /** Credit units, not a currency amount. Business accounts may omit the balance. */
  balance: number | null;
  balanceInvalid?: boolean;
  depleted?: boolean;
}

export function parseCodexPaidCredits(
  value: unknown,
  usageValue?: unknown
): CodexPaidCredits | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usage = (usageValue ?? {}) as Record<string, unknown>;
  const spendControl = usage.spend_control as Record<string, unknown> | undefined;
  const reached = usage.rate_limit_reached_type;
  const reason =
    typeof reached === "string" ? reached : (reached as Record<string, unknown> | null)?.type;
  const spendingBlocked =
    spendControl?.reached === true ||
    reason === "workspace_owner_usage_limit_reached" ||
    reason === "workspace_member_usage_limit_reached";
  const depleted =
    record.depleted === true ||
    reason === "workspace_owner_credits_depleted" ||
    reason === "workspace_member_credits_depleted";
  const balance =
    typeof record.balance === "number" ||
    (typeof record.balance === "string" && record.balance.trim() !== "")
      ? Number(record.balance)
      : NaN;
  const balanceInvalid =
    record.balanceInvalid === true || (record.balance != null && !Number.isFinite(balance));
  return {
    hasCredits: (record.has_credits ?? record.hasCredits) === true,
    unlimited: record.unlimited === true,
    overageLimitReached:
      spendingBlocked || (record.overage_limit_reached ?? record.overageLimitReached) === true,
    balance: Number.isFinite(balance) ? balance : null,
    ...(balanceInvalid ? { balanceInvalid: true } : {}),
    ...(depleted ? { depleted: true } : {}),
  };
}

/**
 * Explicit billing consent (default off); Spark has a separate quota and is not covered here.
 * The full local quota-filtering opt-out (#15574: quotaPreflightEnabled=false AND
 * limitPolicy.enabled=false) takes precedence — that account is served unfiltered and the
 * upstream decides, so the credit-aware gate must not force a preflight on it.
 */
export function isCodexPaidCreditsEnabled(
  provider: string | null | undefined,
  providerSpecificData: unknown,
  requestedModel?: string | null
): boolean {
  const data = providerSpecificData as Record<string, unknown> | null | undefined;
  return (
    provider === "codex" &&
    data?.allowPaidCredits === true &&
    getCodexModelScope(requestedModel) !== "spark" &&
    !isCodexQuotaFilteringDisabled(provider, providerSpecificData)
  );
}

export function hasCodexPaidCredits(credits: CodexPaidCredits | undefined): boolean {
  if (
    !credits ||
    credits.overageLimitReached ||
    credits.depleted ||
    credits.balanceInvalid
  )
    return false;
  return (
    credits.unlimited || (credits.hasCredits && (credits.balance === null || credits.balance > 0))
  );
}
