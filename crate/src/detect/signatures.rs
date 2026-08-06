//! The anti-bot vendor corpus, embedded from `../signatures/*.toml` at
//! compile time. The extension holds the same table in
//! `src/detectors/heuristics.ts`; `scripts/check-signature-parity.ts`
//! fails CI when the two disagree, so this module never re-states a
//! signature — it only parses the shared files.

use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct HeaderSignature {
    /// lowercased header name
    pub(crate) name: String,
    /// when set, the header value must contain this substring (lowercased)
    pub(crate) contains: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct VendorSignature {
    pub(crate) key: String,
    pub(crate) label: String,
    /// Defaulted so a caller-supplied signature may omit a field it
    /// does not use; the embedded corpus always states all four.
    #[serde(default)]
    pub(crate) headers: Vec<HeaderSignature>,
    #[serde(default)]
    pub(crate) script_substrings: Vec<String>,
    #[serde(default)]
    pub(crate) selectors: Vec<String>,
    #[serde(default)]
    pub(crate) globals: Vec<String>,
}

/// Vendor order matches the extension's `ANTI_BOT_SIGNATURES` — the
/// first matching header signature is the one reported, so order is
/// part of parity.
const CORPUS: [&str; 5] = [
    include_str!("../../signatures/cloudflare.toml"),
    include_str!("../../signatures/recaptcha.toml"),
    include_str!("../../signatures/hcaptcha.toml"),
    include_str!("../../signatures/datadome.toml"),
    include_str!("../../signatures/perimeterx.toml"),
];

static SIGNATURES: OnceLock<Vec<VendorSignature>> = OnceLock::new();

/// Parses once, on first use. A malformed embedded corpus file is a
/// programmer error caught by the first test that runs, not a runtime
/// condition.
pub(crate) fn signatures() -> &'static [VendorSignature] {
    SIGNATURES.get_or_init(built_in)
}

fn built_in() -> Vec<VendorSignature> {
    CORPUS
        .iter()
        .map(|raw| toml::from_str(raw).expect("signatures/*.toml must parse"))
        .collect()
}

/// Adds or replaces signatures from a caller's TOML file — a vendor
/// changing a script URL should be a data edit, not a release. A file
/// whose `key` matches a built-in replaces it; a new key extends the
/// corpus. Must be called before the first `signatures()`.
///
/// The file is either one signature table or `[[signature]]` entries.
pub(crate) fn load_extra(path: &std::path::Path) -> Result<usize, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let extra = parse_extra(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
    let count = extra.len();
    let merged = merge(built_in(), extra);
    SIGNATURES
        .set(merged)
        .map_err(|_| "signatures were already loaded".to_string())?;
    Ok(count)
}

/// A signature whose `key` matches a built-in replaces it; a new key
/// extends the corpus. Split from `load_extra` so the merge rule is
/// testable without setting the process-wide corpus.
fn merge(mut base: Vec<VendorSignature>, extra: Vec<VendorSignature>) -> Vec<VendorSignature> {
    for signature in extra {
        match base.iter().position(|s| s.key == signature.key) {
            Some(index) => base[index] = signature,
            None => base.push(signature),
        }
    }
    base
}

fn parse_extra(raw: &str) -> Result<Vec<VendorSignature>, String> {
    #[derive(Deserialize)]
    struct Multi {
        signature: Vec<VendorSignature>,
    }
    if let Ok(multi) = toml::from_str::<Multi>(raw) {
        return Ok(multi.signature);
    }
    toml::from_str::<VendorSignature>(raw)
        .map(|one| vec![one])
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpus_parses_and_matches_the_extension_shape() {
        let all = signatures();
        assert_eq!(all.len(), 5);
        let keys: Vec<&str> = all.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "cloudflare",
                "recaptcha",
                "hcaptcha",
                "datadome",
                "perimeterx"
            ]
        );
    }

    #[test]
    fn cloudflare_carries_the_contains_header() {
        let cloudflare = &signatures()[0];
        assert_eq!(cloudflare.label, "Cloudflare");
        let server = cloudflare
            .headers
            .iter()
            .find(|h| h.name == "server")
            .expect("server header signature");
        assert_eq!(server.contains.as_deref(), Some("cloudflare"));
    }

    /// Every vendor must carry at least one way to be found. A
    /// signature with no signal can never fire and is dead corpus.
    #[test]
    fn a_single_signature_table_parses() {
        let extra = parse_extra(
            r#"
key = "kasada"
label = "Kasada"
script_substrings = ["kasada.io"]
"#,
        )
        .expect("parses");
        assert_eq!(extra.len(), 1);
        assert_eq!(extra[0].key, "kasada");
        // Omitted fields default rather than failing: a caller's
        // signature need only state the signals it actually has.
        assert!(extra[0].headers.is_empty());
        assert!(extra[0].selectors.is_empty());
    }

    #[test]
    fn several_signatures_parse_from_one_file() {
        let extra = parse_extra(
            r#"
[[signature]]
key = "kasada"
label = "Kasada"
globals = ["KPSDK"]

[[signature]]
key = "arkose"
label = "Arkose Labs"
script_substrings = ["arkoselabs.com"]
"#,
        )
        .expect("parses");
        assert_eq!(extra.len(), 2);
    }

    #[test]
    fn a_malformed_signature_file_is_an_error_not_a_default() {
        let error = parse_extra("this is not toml at all = = =").expect_err("must fail");
        assert!(!error.is_empty());
    }

    #[test]
    fn a_matching_key_replaces_and_a_new_key_extends() {
        let base = built_in();
        let base_count = base.len();
        let extra = parse_extra(
            r#"
[[signature]]
key = "cloudflare"
label = "Cloudflare (patched)"
script_substrings = ["challenges.example.com"]

[[signature]]
key = "kasada"
label = "Kasada"
globals = ["KPSDK"]
"#,
        )
        .expect("parses");

        let merged = merge(base, extra);
        assert_eq!(merged.len(), base_count + 1, "one replaced, one added");
        let cloudflare = merged
            .iter()
            .find(|s| s.key == "cloudflare")
            .expect("cloudflare");
        assert_eq!(cloudflare.label, "Cloudflare (patched)");
        assert_eq!(cloudflare.script_substrings, ["challenges.example.com"]);
        assert!(merged.iter().any(|s| s.key == "kasada"));
    }

    #[test]
    fn a_missing_file_names_the_path() {
        let error = load_extra(std::path::Path::new("/nonexistent/signatures.toml"))
            .expect_err("must fail");
        assert!(error.contains("/nonexistent/signatures.toml"), "{error}");
    }

    #[test]
    fn every_vendor_has_at_least_one_signal() {
        for signature in signatures() {
            let signals = signature.headers.len()
                + signature.script_substrings.len()
                + signature.selectors.len()
                + signature.globals.len();
            assert!(signals > 0, "{} has no signals", signature.key);
        }
    }

    /// **The negative case, enforced for every rule.** A signal that
    /// fingerprints more than one vendor is a false-positive
    /// generator: `[data-sitekey]` is used by reCAPTCHA, hCaptcha AND
    /// Turnstile, and `gstatic.com` hosts fonts as well as captcha
    /// assets. This fails the build if such a signal is ever added.
    #[test]
    fn no_signal_fingerprints_two_vendors() {
        for (index, signature) in signatures().iter().enumerate() {
            for other in signatures().iter().skip(index + 1) {
                for selector in &signature.selectors {
                    assert!(
                        !other.selectors.contains(selector),
                        "selector {selector} claims both {} and {}",
                        signature.key,
                        other.key
                    );
                }
                for global in &signature.globals {
                    assert!(
                        !other.globals.contains(global),
                        "global {global} claims both {} and {}",
                        signature.key,
                        other.key
                    );
                }
                // Substring containment matters, not just equality: a
                // script URL matching "recaptcha" would also match a
                // vendor claiming "captcha".
                for mine in &signature.script_substrings {
                    for theirs in &other.script_substrings {
                        assert!(
                            !mine.contains(theirs.as_str()) && !theirs.contains(mine.as_str()),
                            "script substrings {mine} and {theirs} overlap across {} and {}",
                            signature.key,
                            other.key
                        );
                    }
                }
            }
        }
    }

    /// Each header rule must name exactly one vendor when it fires.
    /// The shared `server` header is the case that makes this real:
    /// two vendors both watch it, and only the `contains` value keeps
    /// them apart.
    #[test]
    fn every_header_rule_matches_exactly_one_vendor() {
        use super::super::antibot::match_headers;
        use std::collections::HashMap;

        for signature in signatures() {
            for header in &signature.headers {
                let value = header
                    .contains
                    .clone()
                    .unwrap_or_else(|| "probe-value".to_string());
                let headers: HashMap<String, String> =
                    [(header.name.clone(), value)].into_iter().collect();

                let matched: Vec<&str> = signatures()
                    .iter()
                    .filter(|candidate| match_headers(&headers, candidate).is_some())
                    .map(|candidate| candidate.key.as_str())
                    .collect();
                assert_eq!(
                    matched,
                    [signature.key.as_str()],
                    "header {} ({:?}) should name only {}",
                    header.name,
                    header.contains,
                    signature.key
                );
            }
        }
    }

    #[test]
    fn header_free_vendors_have_empty_header_lists() {
        for key in ["recaptcha", "hcaptcha", "perimeterx"] {
            let signature = signatures().iter().find(|s| s.key == key).expect(key);
            assert!(
                signature.headers.is_empty(),
                "{key} should match no headers"
            );
        }
    }
}
