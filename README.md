# UI Inspector & Hybrid Automated UI Testing Platform

Open-source (MIT) platform that discovers UI elements on public websites, lets you design test
cases, and runs **explicitly approved** Playwright tests (read-only by default).

> **Responsible use:** only scan and test sites you own or have permission to test. The platform
> does not bypass authentication, CAPTCHAs, paywalls or access restrictions, and never will.

## Status

Early development. Implemented and tested: monorepo, Docker setup, URL/SSRF policy, first SQL
migration, installer, optional in-app updater. **Not implemented yet:** ORM/data layer, project
API and UI, crawler, scanner, test builder, runner, reports, network-level egress restriction.
Nothing in this README claims those work.

## Install (Docker host)

Requires Docker Engine with Compose v2.

```bash
curl -fsSLO https://raw.githubusercontent.com/JIRAYUTRPY/automation/main/install.sh
less install.sh                      # read it before running it
bash install.sh                      # prompts about the optional updater
bash install.sh --with-updater --yes # non-interactive, with the Update button
```

Options: `--dir`, `--version X.Y.Z`, `--port`, `--with-updater`, `--no-updater`, `--no-start`,
`--dry-run`, `--yes`, `--uninstall [--purge]`. Run `bash install.sh --help`.

The installer pins the latest published release, writes `docker-compose.yml` and a `.env` with
generated secrets (mode 600) into the install directory, pulls the images and starts the stack.
Re-running it keeps your `.env`. It needs a published GitHub release (images on GHCR); with none,
it falls back to the `latest` tag, which only works once images exist. Otherwise build from source
(below).

## Updating

- **Button:** if you enabled the updater, the home page shows the installed and latest versions
  and an **Update** button. It asks for your `ADMIN_TOKEN` (in `.env`), pulls the new images and
  restarts `web` and `worker`. Running scans/tests are interrupted. If the pull or restart fails,
  the previous version is restored.
- **Command line:** `cd <install dir> && docker compose pull && docker compose up -d`, or re-run
  `install.sh`. Re-running `install.sh` is also how the updater container itself is upgraded.
- **Roll back:** set `AUTOMATION_VERSION=<old version>` in `.env`, then `docker compose up -d`.
- Back up the data volume (`app-data`) before updating if it matters; automatic backup is not
  implemented.

### Updater security

The updater is **off by default** because it mounts the Docker socket, which is root-equivalent on
the host. Mitigations: separate container, no published port (internal network only), bearer token,
takes no user input (the target version comes from this project's GitHub releases and must be a
plain `x.y.z`), commands run without a shell. The web API additionally requires `ADMIN_TOKEN`.
The `worker`, which drives a browser against untrusted sites, receives none of these secrets.
Never expose the updater or put the UI on the public internet without your own access control:
the app has no user authentication yet.

## Develop

```bash
cp .env.example .env
pnpm install            # creates pnpm-lock.yaml on first run - commit it
pnpm format             # first run: normalizes formatting
pnpm check              # typecheck + lint + format check + tests
pnpm dev:web            # http://localhost:3000
pnpm dev:worker         # http://localhost:4001/health
docker compose up --build   # build images from source and run everything
```

Other test suites (no dependencies needed): `node --test "apps/updater/test/*.test.mjs"`,
`bash tests/install.test.sh`, `python3 packages/db/scripts/verify_migration.py packages/db/migrations/0001_init.sql`.

## Layout

| Path              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `apps/web`        | Next.js (App Router) dashboard + API routes                   |
| `apps/worker`     | Node worker that owns Playwright/Chromium (scanner, runner)   |
| `apps/updater`    | Optional zero-dependency self-update service                  |
| `packages/shared` | Zod config, logger, URL redaction, URL/SSRF policy, semver    |
| `packages/db`     | SQL migrations (not yet wired to an ORM)                      |
| `install.sh`      | Installer / uninstaller for Docker hosts                      |

The web app never launches a browser; only the worker does, in its own container.

## Known limitations

- **Egress is not restricted yet.** The worker's `egress` network allows any outbound destination.
  FR-02 needs network-level blocking of loopback/private/link-local/metadata ranges (egress proxy
  or firewall). Do not scan untrusted targets before that exists.
- Playwright is pinned to `1.55.0`; the worker image tag `v1.55.0-noble` must match. Bump together.
- If Chromium fails under Docker's default seccomp profile, use Playwright's recommended profile.
  Do not disable the Chromium sandbox.
- The worker runs TypeScript through `tsx`; there is no compiled output.

## Releasing (maintainers)

Bump `version` in the root `package.json`, then push a matching tag: `git tag v0.1.0 && git push
origin v0.1.0`. The release workflow builds multi-arch `web`, `worker` and `updater` images to
`ghcr.io/<owner>/automation-*`, tags `X.Y.Z` and `latest`, and creates the GitHub Release the
updater and installer look up. After the first publish, make the GHCR packages public so hosts can
pull without logging in.

## Contributing / security / license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Licensed under the [MIT License](LICENSE).
