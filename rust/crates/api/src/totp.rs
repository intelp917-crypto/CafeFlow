//! Dependency-light TOTP (RFC 6238) compatible with the existing accounts.

use hmac::{Hmac, Mac};
use rand::RngCore;
use rand::rngs::OsRng;
use sha1::Sha1;
use subtle::ConstantTimeEq;
use time::OffsetDateTime;

const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS: i64 = 30;
const DIGITS: u32 = 6;

pub fn base32_encode(bytes: &[u8]) -> String {
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut output = String::new();
    for byte in bytes {
        value = (value << 8) | (*byte as u32);
        bits += 8;
        while bits >= 5 {
            output.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }
    output
}

pub fn base32_decode(input: &str) -> Result<Vec<u8>, String> {
    let clean = input
        .replace(char::is_whitespace, "")
        .trim_end_matches('=')
        .to_ascii_uppercase();
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut bytes = Vec::new();
    for character in clean.chars() {
        let index = ALPHABET
            .iter()
            .position(|candidate| *candidate as char == character)
            .ok_or_else(|| "کد base32 نامعتبر است.".to_string())?;
        value = (value << 5) | index as u32;
        bits += 5;
        if bits >= 8 {
            bytes.push(((value >> (bits - 8)) & 0xff) as u8);
            bits -= 8;
        }
    }
    Ok(bytes)
}

pub fn generate_secret(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buffer);
    base32_encode(&buffer)
}

pub fn code_at(secret: &str, timestamp_ms: i64) -> Result<String, String> {
    let key = base32_decode(secret)?;
    let counter = timestamp_ms / 1000 / STEP_SECONDS;
    let mut mac = Hmac::<Sha1>::new_from_slice(&key).map_err(|error| error.to_string())?;
    mac.update(&(counter as u64).to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let binary = ((digest[offset] as u32 & 0x7f) << 24)
        | ((digest[offset + 1] as u32) << 16)
        | ((digest[offset + 2] as u32) << 8)
        | (digest[offset + 3] as u32);
    Ok(format!("{:06}", binary % 10u32.pow(DIGITS)))
}

pub fn verify(secret: &str, code: &str) -> bool {
    let normalized: String = code.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if normalized.len() != DIGITS as usize {
        return false;
    }
    let now = OffsetDateTime::now_utc().unix_timestamp() * 1000;
    for step in -1..=1 {
        let Ok(candidate) = code_at(secret, now + step * STEP_SECONDS * 1000) else {
            continue;
        };
        if candidate.as_bytes().ct_eq(normalized.as_bytes()).into() {
            return true;
        }
    }
    false
}

pub fn otpauth_url(secret: &str, account: &str, issuer: &str) -> String {
    format!(
        "otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits=6&period=30",
        urlencoding(issuer),
        urlencoding(account),
        secret,
        urlencoding(issuer)
    )
}

fn urlencoding(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn known_totp_vector() {
        // RFC 6238 test secret (base32 of "12345678901234567890").
        let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        let at = datetime!(1970-01-01 00:00:59 UTC).unix_timestamp() * 1000;
        assert_eq!(code_at(secret, at).unwrap(), "287082");
    }

    #[test]
    fn generates_and_verifies() {
        let secret = generate_secret(20);
        let code = code_at(&secret, OffsetDateTime::now_utc().unix_timestamp() * 1000).unwrap();
        assert!(verify(&secret, &code));
        assert!(!verify(&secret, "000000"));
        assert_eq!(base32_decode(&secret).unwrap().len(), 20);
    }
}
