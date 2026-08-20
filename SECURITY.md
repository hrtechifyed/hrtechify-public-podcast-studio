# Security Policy

Security is a core requirement because the studio handles account identity, storage authorization, voice media and background processing.

## Reporting a vulnerability

Please do **not** publish exploitable security details, credentials, tokens or private user data in a public issue.

Until a dedicated security contact is published, open a minimal public issue stating that you found a security concern and avoid including exploit steps or sensitive evidence. Maintainers should then move the discussion to an appropriate private channel.

## Security requirements

The production application must:

- Resolve user identity from the authenticated server-side session.
- Enforce tenant ownership on every protected resource.
- Encrypt long-lived storage-provider refresh credentials at rest.
- Never store long-lived refresh tokens in browser localStorage.
- Keep production secrets outside source control.
- Use least-privilege OAuth scopes.
- Validate uploaded media and template packages.
- Reject executable user template code.
- Rate-limit abusive or suspicious flows.
- Preserve immutable original recording references.
- Delete temporary processing media after completion, cancellation or expiry.
- Ensure stale callbacks cannot resurrect cancelled or superseded jobs.

## Public repository hygiene

The repository must never contain production secrets, real user recordings, private transcripts, database exports or logs containing personal data.

## Dependency and supply-chain expectations

Dependencies should be pinned or locked, regularly updated, and reviewed for known vulnerabilities. Build and deployment workflows should follow least privilege and avoid exposing secrets to untrusted pull requests.
