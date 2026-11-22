//! Tehran calendar-day helpers.
//!
//! Every timestamp column stores UTC text (`2026-11-22T10:00:00.000Z`) and the
//! SQLite/PostgreSQL drivers compare those columns as text. Day ranges must
//! therefore also be built as UTC text: comparing a stored `...Z` value with a
//! literal `...T00:00:00+03:30` bound silently moves every boundary by three
//! and a half hours.

use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};

use crate::error::{AppError, bad_request};

pub(crate) fn tehran_offset() -> UtcOffset {
    UtcOffset::from_hms(3, 30, 0).expect("valid Tehran offset")
}

pub(crate) fn tehran_today() -> Date {
    OffsetDateTime::now_utc().to_offset(tehran_offset()).date()
}

pub(crate) fn iso_utc(moment: OffsetDateTime) -> String {
    let utc = moment.to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        utc.year(),
        utc.month() as u8,
        utc.day(),
        utc.hour(),
        utc.minute(),
        utc.second(),
        utc.millisecond()
    )
}

/// Parses a strict `YYYY-MM-DD` Gregorian day.
pub(crate) fn parse_day(value: &str, label: &str) -> Result<Date, AppError> {
    let trimmed = value.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 {
        return Err(invalid_date(label));
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        parts[0].parse::<i32>(),
        parts[1].parse::<u8>(),
        parts[2].parse::<u8>(),
    ) else {
        return Err(invalid_date(label));
    };
    let Ok(month) = Month::try_from(month) else {
        return Err(invalid_date(label));
    };
    Date::from_calendar_date(year, month, day).map_err(|_| invalid_date(label))
}

pub(crate) fn add_days(date: Date, days: i64) -> Result<Date, AppError> {
    let moment = PrimitiveDateTime::new(date, Time::MIDNIGHT).assume_offset(tehran_offset())
        + time::Duration::days(days);
    Ok(moment.date())
}

/// UTC bounds (`start` inclusive, `end` exclusive) of one Tehran calendar day.
pub(crate) fn day_bounds(date: Date) -> Result<(String, String), AppError> {
    let start = PrimitiveDateTime::new(date, Time::MIDNIGHT)
        .assume_offset(tehran_offset())
        .to_offset(UtcOffset::UTC);
    let next = date
        .next_day()
        .ok_or_else(|| bad_request("تاریخ پایان معتبر نیست.", "INVALID_DATE_RANGE"))?;
    let end = PrimitiveDateTime::new(next, Time::MIDNIGHT)
        .assume_offset(tehran_offset())
        .to_offset(UtcOffset::UTC);
    Ok((iso_utc(start), iso_utc(end)))
}

/// UTC bounds covering `from` through `to` inclusive, in Tehran time.
pub(crate) fn range_bounds(from: Date, to: Date) -> Result<(String, String), AppError> {
    let (start, _) = day_bounds(from)?;
    let (_, end) = day_bounds(to)?;
    Ok((start, end))
}

fn invalid_date(label: &str) -> AppError {
    bad_request(format!("{label} تاریخ معتبری نیست."), "INVALID_DATE_RANGE")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(year: i32, month: u8, day: u8) -> Date {
        Date::from_calendar_date(year, Month::try_from(month).unwrap(), day).unwrap()
    }

    #[test]
    fn tehran_day_bounds_are_utc_text() {
        let (start, end) = day_bounds(date(2026, 11, 22)).unwrap();
        assert_eq!(start, "2026-11-21T20:30:00.000Z");
        assert_eq!(end, "2026-11-22T20:30:00.000Z");
    }

    #[test]
    fn stored_utc_timestamps_fall_inside_the_tehran_day() {
        let (start, end) = day_bounds(date(2026, 11, 22)).unwrap();
        // 00:30 and 23:30 in Tehran, both still the same calendar day there.
        for paid_at in ["2026-11-21T21:00:00.000Z", "2026-11-22T20:00:00.000Z"] {
            assert!(
                paid_at >= start.as_str() && paid_at < end.as_str(),
                "{paid_at} should be inside {start}..{end}"
            );
        }
        assert!("2026-11-22T20:45:00.000Z" >= end.as_str());
    }

    #[test]
    fn rejects_malformed_days() {
        assert!(parse_day("2026-13-01", "تاریخ").is_err());
        assert!(parse_day("1405/08/27", "تاریخ").is_err());
        assert!(parse_day("", "تاریخ").is_err());
        assert_eq!(
            parse_day("2026-11-22", "تاریخ").unwrap(),
            date(2026, 11, 22)
        );
    }
}
