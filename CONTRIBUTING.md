# Contributing

Thanks for helping. This project is MIT licensed; contributions are accepted under the same license.

## Setup

```bash
pnpm install
pnpm check        # typecheck + lint + format check + tests
```

Node 22+, pnpm 10+. Docker is only needed to try the full stack (`docker compose up --build`).

## Ground rules

- **Safety defaults are features.** Read-only execution, the URL/SSRF policy, and the approval
  step must not be weakened. Changes to `packages/shared/src/url-policy.ts`, the action policy, or
  the updater need tests that cover the new behavior and the rejected cases.
- **No bypass features.** We do not accept authentication, CAPTCHA, paywall, or rate-limit
  circumvention, and no mode that runs user-supplied JavaScript or shell commands.
- **Do not claim what is not verified.** PR descriptions should say what you ran and what you did not.
- Keep dependencies minimal. No Redis, queues, or extra services without a measured need.
- Never commit secrets. `.env.example` holds placeholders only.

## Pull requests

1. Open an issue first for anything larger than a small fix.
2. Keep PRs focused; include tests; run `pnpm check`.
3. Use clear commit messages (imperative mood).

## Responsible use

This tool drives a real browser against live websites. Only scan and test sites you own or have
explicit permission to test.
