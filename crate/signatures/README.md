# Anti-bot signature corpus

The single source of truth for vendor signatures, shared by the two
frontends: the VS Code extension (`src/detectors/heuristics.ts`) and the
Rust CLI (`crate/`). Neither side reads these files at runtime — the
extension keeps its table in code — and CI fails when code and corpus
disagree (`scripts/check-signature-parity.ts`).

One file per vendor, filename = `key`. Fields mirror `VendorSignature`:
`key`, `label`, `script_substrings`, `selectors`, `globals`, and
`[[headers]]` entries (`name`, optional `contains`). Header names and
`contains` values are lowercase; value matching is case-insensitive.

Signatures are best-effort fingerprints of public integration patterns.
Never add ambiguous markers that fingerprint more than one vendor —
bare `[data-sitekey]` is used by reCAPTCHA, hCaptcha and Turnstile, and
`gstatic.com` hosts fonts as well as captcha assets.
