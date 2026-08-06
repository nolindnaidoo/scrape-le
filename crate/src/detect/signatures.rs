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
    include_str!("../../../signatures/cloudflare.toml"),
    include_str!("../../../signatures/recaptcha.toml"),
    include_str!("../../../signatures/hcaptcha.toml"),
    include_str!("../../../signatures/datadome.toml"),
    include_str!("../../../signatures/perimeterx.toml"),
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

    let mut merged = built_in();
    for signature in extra {
        match merged.iter().position(|s| s.key == signature.key) {
            Some(index) => merged[index] = signature,
            None => merged.push(signature),
        }
    }
    SIGNATURES
        .set(merged)
        .map_err(|_| "signatures were already loaded".to_string())?;
    Ok(count)
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
