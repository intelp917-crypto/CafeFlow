//! Jalali (Shamsi) calendar utilities using the Borkowski algorithm.

use time::{Date, Month, OffsetDateTime, UtcOffset};

const BREAKS: [i32; 20] = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324,
    2394, 2456, 3178,
];

fn div(a: i32, b: i32) -> i32 {
    a / b
}

fn modulo(a: i32, b: i32) -> i32 {
    a % b
}

#[derive(Debug, Clone, Copy)]
pub struct JalCalResult {
    pub leap: i32,
    pub gy: i32,
    pub march: i32,
}

pub fn jal_cal(jy: i32) -> Result<JalCalResult, String> {
    let gy = jy + 621;
    let mut leap_j = -14;
    let mut jp = BREAKS[0];
    let mut jump = 0;

    if jy < jp || jy >= BREAKS[BREAKS.len() - 1] {
        return Err(format!("سال شمسی نامعتبر است: {jy}"));
    }

    for &jm in BREAKS.iter().skip(1) {
        jump = jm - jp;
        if jy < jm {
            break;
        }
        leap_j += div(jump, 33) * 8 + div(modulo(jump, 33), 4);
        jp = jm;
    }

    let mut n = jy - jp;
    leap_j += div(n, 33) * 8 + div(modulo(n, 33) + 3, 4);
    if modulo(jump, 33) == 4 && jump - n == 4 {
        leap_j += 1;
    }

    let leap_g = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    let march = 20 + leap_j - leap_g;

    if jump - n < 6 {
        n = n - jump + div(jump + 4, 33) * 33;
    }
    let mut leap = modulo(modulo(n + 1, 33) - 1, 4);
    if leap == -1 {
        leap = 4;
    }

    Ok(JalCalResult { leap, gy, march })
}

pub fn g2d(gy: i32, gm: i32, gd: i32) -> i32 {
    let mut d =
        div((gy + div(gm - 8, 6) + 100_100) * 1461, 4) + div(153 * modulo(gm + 9, 12) + 2, 5) + gd
            - 34_840_408;
    d = d - div(div(gy + 100_100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    d
}

pub fn d2g(jdn: i32) -> (i32, i32, i32) {
    let mut j = 4 * jdn + 139_361_631;
    j = j + div(div(4 * jdn + 183_187_720, 146_097) * 3, 4) * 4 - 3908;
    let i = div(modulo(j, 1461), 4) * 5 + 308;
    let gd = div(modulo(i, 153), 5) + 1;
    let gm = modulo(div(i, 153), 12) + 1;
    let gy = div(j, 1461) - 100_100 + div(8 - gm, 6);
    (gy, gm, gd)
}

pub fn j2d(jy: i32, jm: i32, jd: i32) -> Result<i32, String> {
    let result = jal_cal(jy)?;
    Ok(g2d(result.gy, 3, result.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1)
}

pub fn d2j(jdn: i32) -> Result<(i32, i32, i32), String> {
    let gy = d2g(jdn).0;
    let mut jy = gy - 621;
    let result = jal_cal(jy)?;
    let jdn1f = g2d(gy, 3, result.march);
    let mut k = jdn - jdn1f;

    if k >= 0 {
        if k <= 185 {
            return Ok((jy, 1 + div(k, 31), modulo(k, 31) + 1));
        }
        k -= 186;
    } else {
        jy -= 1;
        k += 179;
        if result.leap == 1 {
            k += 1;
        }
    }
    Ok((jy, 7 + div(k, 30), modulo(k, 30) + 1))
}

fn utc_day_number(date: Date) -> i32 {
    g2d(date.year(), date.month() as i32, date.day() as i32)
}

pub fn to_jalali(date: Date) -> Result<(i32, i32, i32), String> {
    d2j(utc_day_number(date))
}

pub fn to_gregorian(jy: i32, jm: i32, jd: i32) -> Result<(i32, i32, i32), String> {
    Ok(d2g(j2d(jy, jm, jd)?))
}

pub fn is_jalali_leap_year(jy: i32) -> Result<bool, String> {
    Ok(jal_cal(jy)?.leap == 0)
}

pub fn jalali_month_length(jy: i32, jm: i32) -> Result<i32, String> {
    if !(1..=12).contains(&jm) {
        return Err("ماه شمسی نامعتبر است.".to_string());
    }
    if jm <= 6 {
        Ok(31)
    } else if jm <= 11 {
        Ok(30)
    } else {
        Ok(if is_jalali_leap_year(jy)? { 30 } else { 29 })
    }
}

pub const JALALI_MONTHS_FA: [&str; 12] = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
];

pub const JALALI_WEEKDAYS_FA: [&str; 7] = [
    "یکشنبه",
    "دوشنبه",
    "سه‌شنبه",
    "چهارشنبه",
    "پنجشنبه",
    "جمعه",
    "شنبه",
];

fn pad2(value: i32) -> String {
    format!("{value:02}")
}

fn month_from_number(value: u8) -> Month {
    match value {
        1 => Month::January,
        2 => Month::February,
        3 => Month::March,
        4 => Month::April,
        5 => Month::May,
        6 => Month::June,
        7 => Month::July,
        8 => Month::August,
        9 => Month::September,
        10 => Month::October,
        11 => Month::November,
        _ => Month::December,
    }
}

fn tehran_offset() -> UtcOffset {
    UtcOffset::from_hms(3, 30, 0).expect("valid Tehran offset")
}

/// Formats a moment as a Jalali string in Tehran local time.
pub fn format_jalali(
    moment: OffsetDateTime,
    with_time: bool,
    month_name: bool,
    persian_digits: bool,
) -> Result<String, String> {
    let tehran = moment.to_offset(tehran_offset());
    let (jy, jm, jd) = to_jalali(tehran.date())?;
    let month = if month_name {
        JALALI_MONTHS_FA[(jm - 1) as usize].to_string()
    } else {
        pad2(jm)
    };
    let mut result = if month_name {
        format!("{} {} {}", pad2(jd), month, jy)
    } else {
        format!("{}/{:02}/{:02}", jy, jm, jd)
    };
    if with_time {
        result.push_str(&format!(" {:02}:{:02}", tehran.hour(), tehran.minute()));
    }
    Ok(if persian_digits {
        crate::money::to_persian_digits(&result)
    } else {
        result
    })
}

/// Parses «۱۴۰۵/۰۸/۲۷» or «1405-8-27» into a UTC instant at Tehran midnight.
pub fn parse_jalali(input: &str) -> Result<OffsetDateTime, String> {
    let normalized = crate::money::to_latin_digits(input)
        .trim()
        .replace(['-', '.'], "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() != 3 {
        return Err("تاریخ شمسی نامعتبر است. قالب صحیح: ۱۴۰۵/۰۸/۲۷".to_string());
    }
    let jy = parts[0]
        .parse::<i32>()
        .map_err(|_| "تاریخ شمسی نامعتبر است.".to_string())?;
    let jm = parts[1]
        .parse::<i32>()
        .map_err(|_| "تاریخ شمسی نامعتبر است.".to_string())?;
    let jd = parts[2]
        .parse::<i32>()
        .map_err(|_| "تاریخ شمسی نامعتبر است.".to_string())?;
    if !(1..=12).contains(&jm) || jd < 1 || jd > jalali_month_length(jy, jm)? {
        return Err("تاریخ شمسی نامعتبر است.".to_string());
    }
    let (gy, gm, gd) = to_gregorian(jy, jm, jd)?;
    let date = Date::from_calendar_date(gy, month_from_number(gm as u8), gd as u8)
        .map_err(|_| "تاریخ شمسی نامعتبر است.".to_string())?;
    Ok(date
        .with_hms(0, 0, 0)
        .map_err(|_| "تاریخ شمسی نامعتبر است.".to_string())?
        .assume_offset(tehran_offset())
        .to_offset(UtcOffset::UTC))
}

pub fn today_jalali(moment: OffsetDateTime) -> Result<String, String> {
    format_jalali(moment, false, true, true)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayRange {
    pub start_iso: String,
    pub end_iso: String,
    pub jalali_label: String,
    pub weekday_fa: String,
}

pub fn iso_utc(moment: OffsetDateTime) -> String {
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

/// UTC range covering the current Tehran calendar day.
pub fn tehran_day_range(moment: OffsetDateTime) -> Result<DayRange, String> {
    let local = moment.to_offset(tehran_offset());
    let local_midnight = local
        .date()
        .with_hms(0, 0, 0)
        .map_err(|_| "تاریخ نامعتبر است.".to_string())?
        .assume_offset(tehran_offset());
    let start = local_midnight.to_offset(UtcOffset::UTC);
    let end = (local_midnight + time::Duration::days(1)).to_offset(UtcOffset::UTC);
    let weekday = local.date().weekday();
    Ok(DayRange {
        start_iso: iso_utc(start),
        end_iso: iso_utc(end),
        jalali_label: format_jalali(moment, false, true, true)?,
        weekday_fa: JALALI_WEEKDAYS_FA[weekday.number_days_from_sunday() as usize].to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn converts_known_dates() {
        let nowruz = Date::from_calendar_date(2026, Month::March, 21).unwrap();
        assert_eq!(to_jalali(nowruz).unwrap(), (1405, 1, 1));
        let project_date = Date::from_calendar_date(2026, Month::November, 18).unwrap();
        assert_eq!(to_jalali(project_date).unwrap(), (1405, 8, 27));
        assert_eq!(jalali_month_length(1403, 12).unwrap(), 30);
        assert_eq!(jalali_month_length(1404, 12).unwrap(), 29);
        assert_eq!(to_gregorian(1405, 8, 27).unwrap(), (2026, 11, 18));
    }

    #[test]
    fn formats_dates() {
        let moment = datetime!(2026-11-18 10:00:00 UTC);
        assert_eq!(
            format_jalali(moment, false, false, true).unwrap(),
            "۱۴۰۵/۰۸/۲۷"
        );
        assert_eq!(
            format_jalali(moment, false, true, true).unwrap(),
            "۲۷ آبان ۱۴۰۵"
        );
        assert_eq!(
            format_jalali(moment, true, false, false).unwrap(),
            "1405/08/27 13:30"
        );
    }

    #[test]
    fn parses_and_ranges() {
        let parsed = parse_jalali("۱۴۰۵/۰۸/۲۷").unwrap();
        assert_eq!(iso_utc(parsed), "2026-11-17T20:30:00.000Z");
        assert!(parse_jalali("1405/13/01").is_err());
        assert!(parse_jalali("not-a-date").is_err());

        let range = tehran_day_range(datetime!(2026-11-18 10:00:00 UTC)).unwrap();
        assert_eq!(range.start_iso, "2026-11-17T20:30:00.000Z");
        assert_eq!(range.end_iso, "2026-11-18T20:30:00.000Z");
        assert_eq!(range.jalali_label, "۲۷ آبان ۱۴۰۵");
        assert_eq!(range.weekday_fa, "چهارشنبه");
    }

    #[test]
    fn month_names() {
        assert_eq!(JALALI_MONTHS_FA[7], "آبان");
        assert_eq!(pad2(7), "07");
    }
}
