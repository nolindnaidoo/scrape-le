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
    pub(crate) headers: Vec<HeaderSignature>,
    pub(crate) script_substrings: Vec<String>,
    pub(crate) selectors: Vec<String>,
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

/// Parses once, on first use. A malformed corpus file is a programmer
/// error caught by the first test that runs, not a runtime condition.
pub(crate) fn signatures() -> &'static [VendorSignature] {
    static SIGNATURES: OnceLock<Vec<VendorSignature>> = OnceLock::new();
    SIGNATURES.get_or_init(|| {
        CORPUS
            .iter()
            .map(|raw| toml::from_str(raw).expect("signatures/*.toml must parse"))
            .collect()
    })
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
