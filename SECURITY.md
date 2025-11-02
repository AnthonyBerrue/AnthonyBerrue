# Security Policy

## Supported Versions
Only the latest main branch is actively maintained for security.

## Reporting a Vulnerability
- **Do not** open a public issue.
- Email: `security@anthony.dev` (remplace par ton adresse) ou utilise les *Security Advisories* GitHub.
- Donne un maximum de détails (version commit, POC, impact, CVSS si tu peux).

## Best Practices intégrées
- CI bloque sur échec de *CodeQL*.
- Dépendances surveillées via *Dependabot* (security & versions).
- Pas de secrets en clair : `.env` ignorés par Git, secrets via **GitHub Actions Secrets**.
