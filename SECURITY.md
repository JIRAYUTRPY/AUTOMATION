# Security Policy

## Reporting a vulnerability

Please report privately via GitHub: **Security -> Report a vulnerability** on this repository
(https://github.com/JIRAYUTRPY/automation/security/advisories/new). Do not open a public issue
for security problems. There is no guaranteed response time; this is a community project.

## Areas of particular concern

- SSRF / navigation-scope bypass (`packages/shared/src/url-policy.ts`, worker egress).
- Anything that lets a user run arbitrary code or bypass the read-only action policy.
- The **optional updater** (`apps/updater`): it mounts the Docker socket, which is root-equivalent
  on the host. It is disabled unless you opt in, accepts no user-supplied arguments, and is only
  reachable on the internal Compose network with a bearer token. Do not expose it publicly.

## Supported versions

Only the latest release receives fixes.
