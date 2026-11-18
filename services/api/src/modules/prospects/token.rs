//! One-time prospect-link tokens: two concatenated UUID v4s in lowercase hex,
//! no separators. The API only ever persists or compares their SHA-256
//! digest; the token itself is returned once and never stored or logged.

use sha2::{Digest, Sha256};
use uuid::Uuid;

const HALF_LEN: usize = 32;
const TOKEN_LEN: usize = HALF_LEN * 2;

pub(super) fn generate() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Strict format: exactly two lowercase-hex UUID v4 halves, no separators.
pub(super) fn is_well_formed(token: &str) -> bool {
    token.len() == TOKEN_LEN
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && [&token[..HALF_LEN], &token[HALF_LEN..]]
            .into_iter()
            .all(|half| Uuid::parse_str(half).is_ok_and(|id| id.get_version_num() == 4))
}

pub(super) fn digest(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Cédulas can be entered with spaces or hyphens. Do not strip other
/// characters, since an unrelated identifier must not match by accident.
pub(super) fn cedula_digits(value: &str) -> Option<String> {
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || byte == b'-' || byte == b' ')
    {
        return None;
    }
    let digits: String = value.chars().filter(char::is_ascii_digit).collect();
    (digits.len() == 11).then_some(digits)
}

pub(super) fn cedula_binding(token: &str, digits: &str) -> Vec<u8> {
    // The public token itself is random and absent from the database. Binding
    // it to the cédula avoids storing the number or a digest of the number alone.
    let mut hash = Sha256::new();
    hash.update(b"prospect-link-cedula:");
    hash.update(token.as_bytes());
    hash.update(digits.as_bytes());
    hash.finalize().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_well_formed_and_digest_is_stable() {
        let token = generate();
        assert!(is_well_formed(&token));
        assert_eq!(digest(&token), digest(&token));
        assert_ne!(digest(&token), digest(&generate()));
    }

    #[test]
    fn rejects_malformed_or_wrong_version_tokens() {
        for token in [
            "too-short",
            &"a".repeat(63),
            &"A".repeat(64),
            &"g".repeat(64),
            // Well-formed length and hex, but neither half is a v4 UUID.
            &"0".repeat(64),
        ] {
            assert!(!is_well_formed(token), "{token}");
        }
    }
}
