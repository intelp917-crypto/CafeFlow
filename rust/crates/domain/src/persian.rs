//! Persian text normalization shared by search and equality checks.

use unicode_normalization::UnicodeNormalization;

fn fold_char(ch: char) -> char {
    match ch {
        'ي' | 'ى' => 'ی',
        'ك' => 'ک',
        'ة' | 'ۀ' => 'ه',
        'ؤ' => 'و',
        'إ' | 'أ' | 'ٱ' => 'ا',
        other => other,
    }
}

fn is_diacritic(ch: char) -> bool {
    matches!(ch, '\u{064B}'..='\u{0655}' | '\u{0670}' | '\u{0640}')
}

fn is_zero_width(ch: char) -> bool {
    matches!(ch, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{FEFF}')
}

/// Normalizes Persian text for storage, search and comparison.
pub fn normalize_persian(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    let nfc: String = input.nfc().collect();
    let mut text = String::with_capacity(nfc.len());
    for ch in nfc.chars() {
        if is_diacritic(ch) || is_zero_width(ch) {
            continue;
        }
        let folded = fold_char(ch);
        if folded.is_ascii_digit() {
            text.push(folded);
        } else if ('٠'..='٩').contains(&folded) {
            text.push(char::from_digit((folded as u32) - ('٠' as u32), 10).unwrap_or(folded));
        } else if ('۰'..='۹').contains(&folded) {
            text.push(char::from_digit((folded as u32) - ('۰' as u32), 10).unwrap_or(folded));
        } else {
            text.push(folded);
        }
    }

    text = text
        .replace(['٬', ','], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    text.trim().to_string()
}

pub fn normalize_for_search(input: &str) -> String {
    normalize_persian(input).to_lowercase()
}

pub fn persian_equals(a: &str, b: &str) -> bool {
    normalize_persian(a) == normalize_persian(b)
}

/// Approximate the Persian collation used by the web app. ICU's full collation
/// is intentionally not a server dependency; this rank map keeps the common
/// alphabet order stable and the normalized fallback deterministic.
fn persian_rank(ch: char) -> u32 {
    const ALPHABET: &[char] = &[
        'آ', 'ا', 'ب', 'پ', 'ت', 'ث', 'ج', 'چ', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'ژ', 'س', 'ش', 'ص',
        'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی',
    ];
    ALPHABET
        .iter()
        .position(|candidate| *candidate == ch)
        .map_or(1000, |index| index as u32)
}

pub fn compare_persian(a: &str, b: &str) -> std::cmp::Ordering {
    let left = normalize_persian(a);
    let right = normalize_persian(b);
    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    for (left_ch, right_ch) in left_chars.iter().zip(right_chars.iter()) {
        let rank = persian_rank(*left_ch).cmp(&persian_rank(*right_ch));
        if rank != std::cmp::Ordering::Equal {
            return rank;
        }
        let lexical = left_ch.cmp(right_ch);
        if lexical != std::cmp::Ordering::Equal {
            return lexical;
        }
    }
    left_chars.len().cmp(&right_chars.len())
}

pub fn format_phone_fa(phone: &str) -> String {
    normalize_persian(phone)
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '+')
        .collect()
}

pub fn is_valid_iranian_mobile(phone: &str) -> bool {
    let digits: String = normalize_persian(phone)
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect();
    digits.len() == 11 && digits.starts_with("09")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_arabic_letters_and_digits() {
        assert_eq!(normalize_persian("كيك"), "کیک");
        assert_eq!(normalize_persian("علي"), "علی");
        assert_eq!(normalize_persian("۱۲۳"), "123");
        assert_eq!(normalize_persian("٤٥٦"), "456");
        assert_eq!(normalize_persian("  قَهوهٔ  تلخ  "), "قهوه تلخ");
        assert_eq!(normalize_persian("۱۲٬۵۰۰"), "12500");
        assert_eq!(
            normalize_for_search("كيك شکلاتي"),
            normalize_for_search("کیک شکلاتی")
        );
        assert!(persian_equals("كتاب", "کتاب"));
    }

    #[test]
    fn sorts_persian() {
        let mut items = ["پسته", "بادام", "آلبالو"];
        items.sort_by(|a, b| compare_persian(a, b));
        assert_eq!(items[0], "آلبالو");
    }

    #[test]
    fn validates_mobile() {
        assert!(is_valid_iranian_mobile("۰۹۱۲۳۴۵۶۷۸۹"));
        assert!(is_valid_iranian_mobile("09123456789"));
        assert!(!is_valid_iranian_mobile("0912345"));
        assert!(!is_valid_iranian_mobile("12345"));
    }
}
