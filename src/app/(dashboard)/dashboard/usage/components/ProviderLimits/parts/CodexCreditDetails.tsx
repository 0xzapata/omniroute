"use client";

import { useLocale, useTranslations } from "next-intl";
import { hasCodexPaidCredits, type CodexPaidCredits } from "@/lib/providers/codexPaidCredits";
import { translateUsageOrFallback } from "../i18nFallback";

export default function CodexCreditDetails({
  credits,
  enabled,
}: {
  credits?: CodexPaidCredits;
  enabled: boolean;
}) {
  const t = useTranslations("usage");
  const locale = useLocale();
  const tr = (key: string, fallback: string) => translateUsageOrFallback(t, key, fallback);
  const balance = credits?.balance;
  const status =
    !credits || credits.balanceInvalid
      ? tr("codexCreditUnknown", "Credit availability unknown")
      : credits.overageLimitReached
        ? tr("codexCreditSpendingLimit", "Spending limit reached")
        : hasCodexPaidCredits(credits)
          ? tr("codexCreditAvailable", "Credits available")
          : tr("codexCreditUnavailable", "No usable credits");

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2 text-[11px] text-text-main">
      <div className="flex justify-between gap-2">
        <span>{t("codexPaidCreditsLabel")}</span>
        <span className="font-semibold tabular-nums">
          {balance != null
            ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 }).format(balance)
            : credits?.unlimited
              ? t("codexPaidCreditsUnlimited")
              : tr("codexCreditBalanceUnknown", "Balance not reported")}
        </span>
      </div>
      <span>{status}</span>
      <span className="text-text-muted">
        {enabled
          ? tr("codexCreditRoutingEnabled", "Paid-credit routing enabled")
          : tr("codexCreditRoutingDisabled", "Paid-credit routing disabled")}
      </span>
    </div>
  );
}
