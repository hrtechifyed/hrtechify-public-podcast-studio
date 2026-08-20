# Tests

Cross-package and end-to-end tests will live here as product functionality is introduced.

Highest-priority test areas are:

1. Cross-user tenant isolation.
2. Maximum 5 active shows per user.
3. Original recording immutability.
4. No speech edit applied without explicit approval.
5. User-selected Google Drive / Dropbox destination isolation.
6. Recording pause, resume, recovery and finalization.
7. Logo background-removal opt-in and preservation of the original.
8. Mandatory `Podcast Powered by HRTechify` bottom-right credit on every valid template and final render.
9. Cancellation, retry and stale-job safety.
10. Temporary-media lifecycle deletion.
