# Contributing

Thank you for your interest in HRTechify Public Podcast Studio.

The repository is public so contributors can inspect the architecture, suggest improvements, fix bugs and help build a transparent multi-user podcast studio.

## Before you contribute

Please read:

- `README.md`
- `HOW_IT_WORKS.md`
- `PRIVACY.md`
- `DATA_HANDLING.md`
- `VOICE_PROCESSING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`

Changes that affect storage, privacy, voice processing, tenant isolation or the mandatory HRTechify platform credit should explain the impact clearly in the pull request.

## Development principles

Contributions must preserve these core rules unless a maintainer explicitly approves a product decision change:

1. Maximum **5 active shows per user**.
2. User-owned permanent media storage.
3. Original recordings are never overwritten.
4. Spoken-content changes require user approval.
5. Logo background removal is opt-in and preserves the original.
6. Every generated podcast video displays **Podcast Powered by HRTechify** in the bottom-right corner.
7. No cross-tenant data access.
8. No production secrets or user media in source control.

## Suggested workflow

1. Fork the repository.
2. Create a focused branch.
3. Make the smallest coherent change.
4. Add or update tests where applicable.
5. Update documentation when behavior changes.
6. Open a pull request explaining what changed and why.

## Good first contributions

Good first issues may include:

- Documentation improvements
- Accessibility fixes
- UI polish
- Test coverage
- Recorder reliability improvements
- Storage adapter tests
- Template validation improvements

Privacy, authentication, OAuth, tenant isolation, media deletion and voice-processing changes require additional review.

## Pull request expectations

A pull request should include:

- Purpose of the change
- User-visible behavior change, if any
- Security/privacy impact, if any
- Testing performed
- Screenshots for meaningful UI changes
- Documentation changes where required

## Contributor content

Do not include real user recordings, private transcripts, credentials or personal data in issues, pull requests or test fixtures. Use synthetic or explicitly authorized test content.
