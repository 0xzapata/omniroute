import { isCodexPaidCreditsEnabled } from "@/lib/providers/codexPaidCredits";

/** Codex paid-credit opt-in, read from a credentials record whose shape is only known at runtime. */
export function hasCodexCreditOptIn(
  provider: string | null | undefined,
  credentials: unknown,
  requestedModel?: string | null
): boolean {
  const providerSpecificData =
    credentials && typeof credentials === "object"
      ? (credentials as { providerSpecificData?: unknown }).providerSpecificData
      : undefined;
  return isCodexPaidCreditsEnabled(provider, providerSpecificData, requestedModel);
}
