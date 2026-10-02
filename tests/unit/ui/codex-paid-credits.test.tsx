import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

import QuotaCardExpanded from "../../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/parts/QuotaCardExpanded";

const credits = { hasCredits: true, unlimited: false, overageLimitReached: false, balance: null };

function renderCredits(paidCredits = credits, enabled = false) {
  return renderToStaticMarkup(
    <QuotaCardExpanded
      providerId="codex"
      quotas={[{ name: "session", used: 100, total: 100, remainingPercentage: 0 }]}
      paidCredits={paidCredits}
      allowPaidCredits={enabled}
      loading={false}
      error={null}
      hasStaleData={false}
      canEditCutoff={true}
      hasCutoffOverrides={false}
      onRefresh={() => {}}
      onOpenCutoff={() => {}}
      onOpenCost={() => {}}
    />
  );
}

describe("Codex paid credit display", () => {
  it("shows availability separately from an exhausted subscription without inventing a balance", () => {
    const html = renderCredits();
    expect(html).toContain("codexPaidCreditsLabel");
    expect(html).toContain("Credits available");
    expect(html).toContain("0%");
  });

  it("keeps zero and blocked positive balances visible separately from consent", () => {
    expect(renderCredits({ ...credits, balance: 0 })).toContain(">0<");
    const blocked = renderCredits({ ...credits, balance: 12.5, overageLimitReached: true }, true);
    expect(blocked).toContain("12.5");
    expect(blocked).toContain("Spending limit reached");
    expect(blocked).toContain("Paid-credit routing enabled");
    expect(renderCredits()).toContain("Paid-credit routing disabled");
    expect(renderCredits({ ...credits, balance: 0.00001 })).toContain("0.00001");
  });

  it("shows the spending limit instead of claiming credits remain usable", () => {
    const html = renderCredits({ ...credits, overageLimitReached: true });
    expect(html).toContain("Spending limit reached");
    expect(html).not.toContain("Credits available");
  });
});
