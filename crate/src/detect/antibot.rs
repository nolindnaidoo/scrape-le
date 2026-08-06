//! Header-based vendor matching — the port of `matchHeaders` in the
//! extension's `src/detectors/heuristics.ts`. Detail strings are part
//! of parity: `fixtures/antibot-headers.json` pins them.

use std::collections::HashMap;

use super::signatures::VendorSignature;

/// Returns a human-readable detail when the response headers match the
/// signature, or `None` when they don't. Header keys are expected
/// lowercased, as the browser delivers them; values match
/// case-insensitively. An empty header value is skipped, not matched.
pub(crate) fn match_headers(
    headers: &HashMap<String, String>,
    signature: &VendorSignature,
) -> Option<String> {
    for header in &signature.headers {
        let Some(value) = headers.get(&header.name) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        let Some(contains) = &header.contains else {
            return Some(format!("{} ({} header)", signature.label, header.name));
        };
        if value.to_lowercase().contains(contains) {
            return Some(format!("{} ({} header)", signature.label, header.name));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::signatures::signatures;
    use super::*;

    const FIXTURES: &str = include_str!("../../../fixtures/antibot-headers.json");

    #[test]
    fn every_fixture_case_reproduces() {
        let cases: serde_json::Value = serde_json::from_str(FIXTURES).expect("fixture JSON");
        for case in cases.as_array().expect("array of cases") {
            let name = case["name"].as_str().expect("name");
            let headers: HashMap<String, String> =
                serde_json::from_value(case["headers"].clone()).expect("headers map");
            for signature in signatures() {
                let expected = case["expected"][&signature.key].as_str();
                let actual = match_headers(&headers, signature);
                assert_eq!(
                    actual.as_deref(),
                    expected,
                    "case {name:?}, vendor {}",
                    signature.key
                );
            }
        }
    }
}
