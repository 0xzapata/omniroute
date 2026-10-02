- **feat(codex):** Add explicit per-account paid-credit opt-in with an Extra credits On/Off button in the provider account list. Accounts with available OpenAI credits can continue after their subscription cutoff; credit availability is shown separately, while Spark limits and upstream cooldowns remain effective ([#13337](https://github.com/diegosouzapw/OmniRoute/pull/13337)) — thanks @feci

- Honor OpenAI spending controls and workspace credit depletion; support credit-only accounts and display reported balances separately from routing consent. Credit balances are units, not dollars or confirmed per-request spending.

- Recheck credit eligibility when rotating Codex accounts after a 429. Preserve credit-only dashboard balances after failed refreshes and show readable errors when a consent update is rejected.
