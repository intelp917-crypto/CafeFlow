//! Money helpers. All amounts are integer Iranian rial; never floats.

const PERSIAN_DIGITS: [char; 10] = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_INDIC_DIGITS: [char; 10] = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DigitMode {
    Fa,
    Latin,
}

pub fn to_persian_digits(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_digit() {
                PERSIAN_DIGITS[ch as usize - '0' as usize]
            } else {
                ch
            }
        })
        .collect()
}

pub fn to_latin_digits(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if let Some(index) = PERSIAN_DIGITS.iter().position(|candidate| *candidate == ch) {
                char::from_digit(index as u32, 10).unwrap_or(ch)
            } else if let Some(index) = ARABIC_INDIC_DIGITS
                .iter()
                .position(|candidate| *candidate == ch)
            {
                char::from_digit(index as u32, 10).unwrap_or(ch)
            } else {
                ch
            }
        })
        .collect()
}

pub fn assert_integer_amount(value: i64, _label: &str) -> Result<i64, String> {
    Ok(value)
}

/// Groups thousands with the Persian thousands separator (٬).
pub fn group_digits(value: i64) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let digits = value.abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    let offset = digits.len() % 3;
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (index + 3 - offset).is_multiple_of(3) {
            grouped.push('٬');
        }
        grouped.push(ch);
    }
    format!("{sign}{grouped}")
}

pub fn format_rial(amount: i64, digits: DigitMode, unit: Option<&str>) -> Result<String, String> {
    assert_integer_amount(amount, "مبلغ")?;
    let grouped = group_digits(amount);
    let rendered = match digits {
        DigitMode::Fa => to_persian_digits(&grouped),
        DigitMode::Latin => grouped,
    };
    Ok(match unit {
        Some("") | None => rendered,
        Some(unit) => format!("{rendered} {unit}"),
    })
}

/// Parses user input ("۱۲٬۵۰۰", "12,500", "12 500") into an integer amount.
pub fn parse_amount_input(input: &str) -> Option<i64> {
    let cleaned: String = to_latin_digits(input)
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '-')
        .collect();
    if cleaned.is_empty() || cleaned == "-" {
        return None;
    }
    cleaned.parse::<i64>().ok()
}

/// Rounds a percentage-based computation to the nearest rial.
pub fn percent_of(amount_rial: i64, percent: f64) -> Result<i64, String> {
    assert_integer_amount(amount_rial, "مبلغ")?;
    if !percent.is_finite() || percent.is_sign_negative() {
        return Err("درصد نامعتبر است.".to_string());
    }
    Ok(((amount_rial as f64 * percent) / 100.0).round() as i64)
}

pub fn sum_rial(amounts: &[i64]) -> Result<i64, String> {
    amounts.iter().try_fold(0i64, |total, amount| {
        assert_integer_amount(*amount, "مبلغ").map(|value| total + value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digit_conversion() {
        assert_eq!(to_persian_digits("1405/08/27"), "۱۴۰۵/۰۸/۲۷");
        assert_eq!(to_latin_digits("۱۲۳۴۵۶۷۸۹۰"), "1234567890");
        assert_eq!(to_latin_digits("٠١٢٣"), "0123");
    }

    #[test]
    fn groups_and_formats_rial() {
        assert_eq!(group_digits(125000), "125٬000");
        assert_eq!(group_digits(0), "0");
        assert_eq!(group_digits(999), "999");
        assert_eq!(
            format_rial(125000, DigitMode::Fa, Some("ریال")).unwrap(),
            "۱۲۵٬۰۰۰ ریال"
        );
        assert_eq!(
            format_rial(125000, DigitMode::Latin, Some("ریال")).unwrap(),
            "125٬000 ریال"
        );
        assert_eq!(format_rial(4200, DigitMode::Fa, None).unwrap(), "۴٬۲۰۰");
        assert_eq!(format_rial(4200, DigitMode::Fa, Some("")).unwrap(), "۴٬۲۰۰");
    }

    #[test]
    fn parses_input() {
        assert_eq!(parse_amount_input("۱۲٬۵۰۰"), Some(12500));
        assert_eq!(parse_amount_input("12,500"), Some(12500));
        assert_eq!(parse_amount_input(" 12 500 ریال"), Some(12500));
        assert_eq!(parse_amount_input(""), None);
        assert_eq!(parse_amount_input("ریال"), None);
    }

    #[test]
    fn percentages_round_deterministically() {
        assert_eq!(percent_of(100000, 9.0).unwrap(), 9000);
        assert_eq!(percent_of(99999, 9.0).unwrap(), 9000);
        assert_eq!(percent_of(12345, 10.0).unwrap(), 1235);
        assert!(percent_of(1000, -1.0).is_err());
    }
}
