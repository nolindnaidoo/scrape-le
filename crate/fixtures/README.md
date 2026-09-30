# Parity corpus

Detection cases both frontends must answer identically: the VS Code
extension (`src/`) and the Rust CLI (`crate/`). Inputs and expected
results are framework-neutral JSON; robots.txt bodies live beside their
cases as plain text. CI runs the extension over every case
(`scripts/check-signature-parity.ts`); the crate embeds the same files
in its tests.

- `antibot-headers.json` — response-header matching per vendor
  (`matchHeaders` in `src/detectors/heuristics.ts`). Header keys are
  lowercase, as the browser delivers them; `expected` maps every vendor
  key to the reported detail string or `null`.
- `robots/cases.json` — `parseRobotsTxt` results for the bodies in
  `robots/*.txt`, evaluated as the case's `agent`, or against the
  generic (`User-agent: *`) rules when it has none; `expected.agent`
  names the group that answered. `path` is a URL pathname, and `robots/encoded.txt` carries the
  RFC 9309 §2.2.2 cases: a rule and a path naming one resource must
  answer the same however either is spelled, and longest-match is
  measured on the encoded form.
- `url.json` — `validateUrl` / `normalizeUrl` / `extractUrl` cases from
  `src/utils/url.ts`, including deliberately pinned quirks (regex
  boundary artifacts, blind protocol prefixing). A port reproduces
  them; changing one is a behaviour change for both frontends and needs
  a CHANGELOG entry.

The extension's dropped `scrape-le.retry.userAgents` setting is a
written-down parity gap; it has no fixture because the CLI never
retries with alternate User-Agents at all. Agent-specific robots.txt
groups used to be one, and are now answered the same by both sides.
