# Security Policy

## Supported Versions

KPI Companion is under active development and does not yet publish tagged
releases. Security fixes are applied to the latest `main` branch only.

| Version        | Supported          |
| -------------- | ------------------ |
| `main` (latest) | :white_check_mark: |
| older commits   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately using GitHub's
[Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Fill in the details: affected component (backend / frontend), steps to
   reproduce, impact, and any suggested fix.

### What to expect

- **Acknowledgement:** within 3 business days.
- **Status update:** within 7 business days, including whether the report is
  accepted or declined and a rough remediation timeline.
- **Disclosure:** once a fix is merged to `main`, we will credit the reporter
  (unless anonymity is requested) and publish a security advisory.

### Scope

Issues that are in scope include, but are not limited to:

- Exposure of secrets (API keys, the LLM endpoint credentials in `backend/.env`).
- Authentication / authorization flaws.
- Injection (prompt injection affecting server actions, SQL, command, etc.).
- Cross-site scripting (XSS) in the frontend.

Out of scope: vulnerabilities in third-party dependencies (report those
upstream; dependency updates are handled automatically via Dependabot).
