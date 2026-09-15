# ADR-003: Auth and Security Model

- Status: Accepted
- Date: 2026-03-09

## Context

Waypoint must replay authenticated browser workflows without storing plaintext passwords and without cloud services. The product also captures potentially sensitive artifacts such as DOM snapshots, screenshots, traces, URLs, and browser state. Security must be practical for a local-first single-user v1 while remaining explicit about what the product does and does not protect.

## Decision

Adopt the following model:

- The product never stores plaintext passwords, OTP seeds, or copied credential values.
- Authenticated automation uses dedicated Playwright-managed profiles created by explicit user action.
- Stored auth state remains local on disk, outside the repo, under restrictive file permissions.
- Workflow JSON exports do not include auth state, cookies, local storage, screenshots, traces, or raw artifact blobs.
- The extension uses minimal permissions and does not execute remotely hosted code.
- Sensitive inputs are redacted during recording before persistence.

## Auth Capture Model

### Supported Flow

1. User creates or refreshes a named profile from the Waypoint UI.
2. Runner launches a dedicated Playwright-managed browser profile.
3. User signs into target sites manually inside that managed profile.
4. Runner saves the resulting authenticated state for later replay.

### Unsupported Flow

- Importing plaintext passwords into the product.
- Capturing passwords from recorded typing.
- Attaching automation to the user's default Chrome profile.

The product stores reusable session state, not user credentials.

## Storage Rules

- Auth profiles are stored in per-profile directories under the app's local data directory.
- Files must be created with restrictive permissions for the current OS user.
- The repo must ignore all runtime state, database files, traces, screenshots, and profiles.
- Exported workflow files must reference profiles by logical id only, never inline profile contents.

## Threat Model

### In Scope Threats

- Secrets accidentally captured in recordings or logs.
- Sensitive auth state leaked through exports.
- Overprivileged extension permissions.
- Malicious or malformed DOM data crossing into trusted code.
- Local artifact sprawl exposing more user data than necessary.

### Out of Scope Threats for v1

- Full protection against malware or an attacker with control of the user's OS account.
- Enterprise-grade secret management.
- Multi-user isolation on a shared machine.

## Controls

### Recording Controls

- Detect `password` inputs and redact values before they leave the content script.
- Treat fields with secret-like names such as `token`, `apiKey`, `secret`, and `otp` as redact-by-default unless user overrides are added in a future release.
- Exclude clipboard contents from recording.

### Logging and Artifact Controls

- Pino logs must avoid request bodies and form values by default.
- Screenshot capture on failure is allowed, but the UI must warn that screenshots may contain sensitive visible content.
- Trace capture is enabled for debug value, but traces remain local and are deletable.
- Artifact retention must be configurable with a conservative default.

### Boundary Controls

- Validate every bridge and API payload with Zod.
- Sanitize DOM-derived strings before rendering them in extension UI.
- Keep the native host narrow and free of business state.

### Permission Controls

- Prefer `activeTab`, `scripting`, `storage`, `tabs`, `sidePanel`, `alarms`, and `nativeMessaging`.
- Avoid broad always-on host permissions where possible.
- Do not require `debugger`, `webRequest`, or remote code loading in v1.

## Privacy Model

- All user data stays local in v1.
- No telemetry, analytics, or cloud sync.
- Users can delete workflows, runs, artifacts, and profiles locally.
- Artifact exports, if introduced later, must be explicit opt-in and separate from workflow export.

## Consequences

### Positive

- The product can support authenticated workflows without acting as a password manager.
- The exported workflow format stays portable and low-risk.
- The extension attack surface stays narrower than broad host-access designs.

### Negative

- Users must occasionally refresh expired sessions manually.
- Local filesystem access by the same OS user can expose auth state.
- Some workflows will need profile-specific setup that cannot be shared by simple JSON export.

## Rejected Alternatives

### Storing Credentials for Re-Login

Rejected because it increases risk and conflicts with the no-plaintext-password constraint.

### Using the User's Default Chrome Profile

Rejected because it is fragile, overprivileged, and incompatible with modern Chrome automation constraints.

### Cloud-Synced Auth State

Rejected because it violates the local-first v1 product boundary.

## Implementation Notes

- The first runner milestone must include explicit path handling for local runtime data outside the repo.
- The first recording milestone must include redaction tests.
- Import/export tests must prove that auth state is never included in workflow JSON.
