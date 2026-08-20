# Authentication

HRTechify Public Podcast Studio separates **signing in to the application** from **authorizing a storage provider**.

A user may sign in with Google and later choose Dropbox for a show, or sign in by email and later choose Google Drive. Storage authorization is a separate phase and must use separate OAuth credentials and scopes.

## Supported sign-in methods

### Google Sign-In

The Worker implements an OAuth 2.0 Authorization Code flow with PKCE and state protection.

1. The user selects **Continue with Google**.
2. The Worker generates a random state value and PKCE verifier.
3. Only the hash of the state is persisted in D1 together with the verifier and short expiry.
4. Google redirects back to `/api/auth/google/callback`.
5. The Worker consumes the one-time state, exchanges the code, and reads the verified Google OpenID profile.
6. The Google subject is linked to an internal HRTechify Podcast Studio user.
7. The Worker issues a signed, HttpOnly session cookie.

Google authentication uses `GOOGLE_AUTH_CLIENT_ID` and `GOOGLE_AUTH_CLIENT_SECRET`. These are deliberately separate from future Google Drive storage OAuth credentials.

### Email magic link

The user may request a passwordless sign-in link.

1. The Worker normalizes and validates the email address.
2. A cryptographically random one-time token is created.
3. Only the SHA-256 hash of the token is stored in D1.
4. The raw token is sent in a link that expires after 15 minutes.
5. Successful verification consumes the token atomically and issues a signed session cookie.
6. Requests are rate-limited at the persistence layer with a short per-address cooldown.

The reference email delivery adapter uses Resend and expects `RESEND_API_KEY` plus `AUTH_EMAIL_FROM`. The adapter boundary can be extended for other email delivery providers.

## Account linking

Provider identities are stored separately from the internal user record.

- A verified Google identity is keyed by Google's stable `sub` value.
- An email magic-link identity is keyed by the normalized verified email address.
- When a newly verified identity uses an email already belonging to an existing internal user, the identity is linked to that user instead of creating a duplicate account.

This allows one person to use either supported sign-in method while retaining the same shows.

## Session security

Sessions are signed server-side with `SESSION_SIGNING_KEY` and stored in the `__Host-hrtechify_session` cookie.

The cookie is:

- HttpOnly
- Secure
- SameSite=Lax
- host-only through the `__Host-` prefix
- time-limited

No browser-supplied `user_id` is trusted for authorization. Protected APIs resolve the internal user from the signed session and then scope every query to that user.

## My Shows behavior

After authentication, the app loads `/api/account` and `/api/shows`.

The My Shows screen supports:

- viewing active and archived shows
- creating a show
- editing show name, host name and description
- archiving a show
- restoring an archived show
- displaying the active show count as `X of 5`
- disabling new-show creation when five active shows already exist

The five-show limit is enforced in the user interface, Worker application logic, and D1 database triggers.

## Secrets

The following values are deployment secrets/configuration and must never be committed:

- `SESSION_SIGNING_KEY`
- `GOOGLE_AUTH_CLIENT_ID`
- `GOOGLE_AUTH_CLIENT_SECRET`
- `RESEND_API_KEY`
- production `AUTH_EMAIL_FROM`

Future Google Drive and Dropbox credentials remain separate from these application-authentication credentials.
