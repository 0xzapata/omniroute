"use client";

import { useRef, type Dispatch, type SetStateAction } from "react";
import { extractApiErrorMessage } from "@/shared/http/apiErrorMessage";
import type { ConnectionRowConnection } from "../components/ConnectionRow";
import { providerText, type ProviderMessageTranslator } from "../providerCredentialText";

/** Minimal surface of the notification store this hook needs. */
interface CodexPaidCreditsToggleNotifier {
  success: (message: string) => void;
  error: (message: string) => void;
}

export interface UseCodexPaidCreditsToggleParams {
  connections: ConnectionRowConnection[];
  setConnections: Dispatch<SetStateAction<ConnectionRowConnection[]>>;
  notify: CodexPaidCreditsToggleNotifier;
  t: ProviderMessageTranslator;
}

/** Persist billing consent once per account while a save is pending. */
export function useCodexPaidCreditsToggle({
  connections,
  setConnections,
  notify,
  t,
}: UseCodexPaidCreditsToggleParams) {
  const saving = useRef(new Set<string>());
  const handleToggleCodexPaidCredits = async (connectionId: string, enabled: boolean) => {
    if (saving.current.has(connectionId)) return;
    saving.current.add(connectionId);
    try {
      const target = connections.find((connection) => connection.id === connectionId);
      if (!target) return;

      const res = await fetch(`/api/providers/${connectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerSpecificData: { allowPaidCredits: enabled },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notify.error(
          extractApiErrorMessage(
            data,
            providerText(
              t,
              "failedUpdateCodexPaidCredits",
              "Failed to update Codex paid-credit policy"
            )
          )
        );
        return;
      }

      setConnections((prev) =>
        prev.map((connection) =>
          connection.id === connectionId
            ? {
                ...connection,
                providerSpecificData: {
                  ...(connection.providerSpecificData || {}),
                  allowPaidCredits: enabled,
                },
              }
            : connection
        )
      );
      notify.success(
        enabled
          ? providerText(
              t,
              "codexPaidCreditsEnabled",
              "Codex paid credits enabled (additional charges may apply)"
            )
          : providerText(t, "codexPaidCreditsDisabled", "Codex paid credits disabled")
      );
    } catch (error) {
      console.error("Error toggling Codex paid-credit policy:", error);
      notify.error(
        providerText(t, "failedUpdateCodexPaidCredits", "Failed to update Codex paid-credit policy")
      );
    } finally {
      saving.current.delete(connectionId);
    }
  };

  return { handleToggleCodexPaidCredits };
}
