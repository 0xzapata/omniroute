// Known working Codex identity for GPT-6.1 Sol. CODEX_CLIENT_VERSION overrides
// this fallback; the fork runner image independently installs the latest CLI.
export const DEFAULT_CODEX_CLIENT_VERSION = "0.159.2";
export const CODEX_CLI_RS_ORIGINATOR = "codex_cli_rs";

export function getCodexCliRsHeaders(
  version = DEFAULT_CODEX_CLIENT_VERSION
): Record<string, string> {
  return {
    "User-Agent": `${CODEX_CLI_RS_ORIGINATOR}/${version}`,
    originator: CODEX_CLI_RS_ORIGINATOR,
  };
}
