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
  `robots/*.txt`, evaluated against the generic (`User-agent: *`)
  rules. `path` is a URL pathname.
- `url.json` — `validateUrl` / `normalizeUrl` / `extractUrl` cases from
  `src/utils/url.ts`, including deliberately pinned quirks (regex
  boundary artifacts, blind protocol prefixing). A port reproduces
  them; changing one is a behaviour change for both frontends and needs
  a CHANGELOG entry.

A case with a `divergence` field is a **written-down parity gap**:
`expected` is the extension's answer, and `divergence.cli` records what
the CLI answers instead and why — today that is agent-specific
robots.txt groups, which the extension ignores and the CLI honours via
`--agent`. The extension's dropped `scrape-le.retry.userAgents` setting
is the other deliberate gap; it has no fixture because the CLI never
retries with alternate User-Agents at all.
