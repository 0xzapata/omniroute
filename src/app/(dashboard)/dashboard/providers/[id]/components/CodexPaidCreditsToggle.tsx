"use client";

import { useTranslations } from "next-intl";

export default function CodexPaidCreditsToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations("providers");
  return (
    <>
      <span className="text-text-muted/30 select-none">|</span>
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-all cursor-pointer ${
          enabled
            ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
            : "bg-black/[0.03] dark:bg-white/[0.03] text-text-muted/50 hover:text-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
        }`}
        title={t("codexPaidCreditsToggleTitle")}
        aria-pressed={enabled}
      >
        <span className="material-symbols-outlined text-[13px]">payments</span>
        {t("codexPaidCreditsShort")} {enabled ? t("toggleOnShort") : t("toggleOffShort")}
      </button>
    </>
  );
}
