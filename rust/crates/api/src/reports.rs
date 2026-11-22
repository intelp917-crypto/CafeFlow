//! Sales reporting over confirmed payments and paid orders. Money stays in
//! integer rial; refunds are subtracted from sales instead of hidden.

use std::collections::BTreeMap;

use axum::Json;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::Response;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::format_description::well_known::Rfc3339;
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, UtcOffset};

use crate::auth::{require_auth, session_has_permission};
use crate::error::{AppError, bad_request, forbidden};
use crate::state::AppState;
use crate::xlsx::{Cell, build_payments_workbook};

#[derive(Debug, Deserialize, Default)]
pub struct RangeQuery {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DateRange {
    start_iso: String,
    end_iso: String,
    from: String,
    to: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    from: String,
    to: String,
    totals: Totals,
    by_method: Vec<MethodTotal>,
    daily: Vec<DailyTotal>,
    top_products: Vec<ProductTotal>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    sales: i64,
    refunds: i64,
    net: i64,
    payments: i64,
    orders: i64,
    average_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MethodTotal {
    method: String,
    method_label_fa: String,
    total: i64,
    count: i64,
}

#[derive(Debug, Serialize)]
struct DailyTotal {
    date: String,
    sales: i64,
    count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductTotal {
    name_fa: String,
    quantity: i64,
    revenue: i64,
}

struct PaymentRow {
    paid_at: String,
    code: Option<String>,
    method: String,
    amount: i64,
    status: String,
    receiver: Option<String>,
}

fn tehran_offset() -> UtcOffset {
    UtcOffset::from_hms(3, 30, 0).expect("valid Tehran offset")
}

fn iso_utc(moment: OffsetDateTime) -> String {
    let moment = moment.to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        moment.year(),
        moment.month() as u8,
        moment.day(),
        moment.hour(),
        moment.minute(),
        moment.second(),
        moment.millisecond()
    )
}

fn calendar_date(value: &str, label: &str) -> Result<Date, AppError> {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 {
        return Err(bad_request(
            format!("{label} تاریخ معتبری نیست."),
            "INVALID_DATE_RANGE",
        ));
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        parts[0].parse::<i32>(),
        parts[1].parse::<u8>(),
        parts[2].parse::<u8>(),
    ) else {
        return Err(bad_request(
            format!("{label} تاریخ معتبری نیست."),
            "INVALID_DATE_RANGE",
        ));
    };
    let Ok(month) = Month::try_from(month) else {
        return Err(bad_request(
            format!("{label} تاریخ معتبری نیست."),
            "INVALID_DATE_RANGE",
        ));
    };
    Date::from_calendar_date(year, month, day).map_err(|_| {
        bad_request(
            format!("{label} تاریخ معتبری نیست."),
            "INVALID_DATE_RANGE",
        )
    })
}

fn day_bounds(date: Date) -> Result<(String, String), AppError> {
    let midnight = PrimitiveDateTime::new(date, time::Time::MIDNIGHT)
        .assume_offset(tehran_offset())
        .to_offset(UtcOffset::UTC);
    let next = date.next_day().ok_or_else(|| {
        bad_request("تاریخ پایان معتبر نیست.", "INVALID_DATE_RANGE")
    })?;
    let next_midnight = PrimitiveDateTime::new(next, time::Time::MIDNIGHT)
        .assume_offset(tehran_offset())
        .to_offset(UtcOffset::UTC);
    Ok((iso_utc(midnight), iso_utc(next_midnight)))
}

fn resolve_range(query: &RangeQuery) -> Result<DateRange, AppError> {
    let today = OffsetDateTime::now_utc().to_offset(tehran_offset()).date();
    let parsed_from = query
        .from
        .as_deref()
        .map(|value| calendar_date(value, "تاریخ شروع"))
        .transpose()?;
    let parsed_to = query
        .to
        .as_deref()
        .map(|value| calendar_date(value, "تاریخ پایان"))
        .transpose()?;
    let start = parsed_from.or(parsed_to).unwrap_or(today);
    let end = parsed_to.unwrap_or(today);
    if start > end {
        return Err(bad_request(
            "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.",
            "INVALID_DATE_RANGE",
        ));
    }
    let (start_iso, _) = day_bounds(start)?;
    let (_, end_iso) = day_bounds(end)?;
    Ok(DateRange {
        start_iso,
        end_iso,
        from: format!("{:04}-{:02}-{:02}", start.year(), start.month() as u8, start.day()),
        to: format!("{:04}-{:02}-{:02}", end.year(), end.month() as u8, end.day()),
    })
}

fn method_label(method: &str) -> &'static str {
    match method {
        "cash" => "نقدی",
        "card" => "کارت‌خوان",
        "online" => "آنلاین",
        "wallet" => "کیف پول",
        _ => "سایر",
    }
}

fn status_label(status: &str) -> &'static str {
    match status {
        "pending" => "در انتظار تأیید",
        "confirmed" => "تأیید شده",
        "failed" => "ناموفق",
        "refunded" => "بازگشت داده شده",
        _ => "نامشخص",
    }
}

async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let session = require_auth(state, headers).await?;
    if !session_has_permission(state, &session.user.id, "reports.read").await? {
        return Err(forbidden(
            "اجازهٔ مشاهدهٔ گزارش‌ها را ندارید.",
            "FORBIDDEN",
        ));
    }
    Ok(())
}

pub async fn summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RangeQuery>,
) -> Result<Json<ReportSummary>, AppError> {
    authorize(&state, &headers).await?;
    let range = resolve_range(&query)?;

    let sales_row = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM payments
          WHERE status = 'confirmed' AND paid_at >= $1 AND paid_at < $2",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?;
    let sales: i64 = sales_row.get("total");
    let payment_count: i64 = sales_row.get("count");

    let refunds: i64 = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS total
           FROM payments
          WHERE status = 'refunded' AND paid_at >= $1 AND paid_at < $2",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get("total");

    let orders: i64 = sqlx::query(
        "SELECT COUNT(*) AS count FROM orders
          WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_one(&state.db.pool)
    .await
    .map_err(db_error)?
    .get("count");

    let by_method = sqlx::query(
        "SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
           FROM payments
          WHERE status = 'confirmed' AND paid_at >= $1 AND paid_at < $2
          GROUP BY method
          ORDER BY total DESC",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| {
        let method: String = row.get("method");
        MethodTotal {
            method_label_fa: method_label(&method).to_string(),
            method,
            total: row.get("total"),
            count: row.get("count"),
        }
    })
    .collect();

    let daily_rows = sqlx::query(
        "SELECT paid_at, amount FROM payments
          WHERE status = 'confirmed' AND paid_at >= $1 AND paid_at < $2",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    let mut daily_map: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for row in daily_rows {
        let paid_at: String = row.get("paid_at");
        let amount: i64 = row.get("amount");
        let Ok(moment) = OffsetDateTime::parse(&paid_at, &Rfc3339) else {
            continue;
        };
        let local = moment.to_offset(tehran_offset());
        let date = format!(
            "{:04}-{:02}-{:02}",
            local.year(),
            local.month() as u8,
            local.day()
        );
        let entry = daily_map.entry(date).or_insert((0, 0));
        entry.0 += amount;
        entry.1 += 1;
    }
    let daily = daily_map
        .into_iter()
        .map(|(date, (sales, count))| DailyTotal {
            date,
            sales,
            count,
        })
        .collect();

    let top_products = sqlx::query(
        "SELECT oi.product_name_snapshot AS name_fa,
                COALESCE(SUM(oi.quantity), 0) AS quantity,
                COALESCE(SUM(oi.total), 0) AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'paid' AND o.paid_at >= $1 AND o.paid_at < $2
          GROUP BY oi.product_name_snapshot
          ORDER BY revenue DESC
          LIMIT 10",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?
    .into_iter()
    .map(|row| ProductTotal {
        name_fa: row.get("name_fa"),
        quantity: row.get("quantity"),
        revenue: row.get("revenue"),
    })
    .collect();

    Ok(Json(ReportSummary {
        from: range.from,
        to: range.to,
        totals: Totals {
            sales,
            refunds,
            net: sales - refunds,
            payments: payment_count,
            orders,
            average_order: if orders > 0 {
                (sales as f64 / orders as f64).round() as i64
            } else {
                0
            },
        },
        by_method,
        daily,
        top_products,
    }))
}

async fn payment_rows(state: &AppState, range: &DateRange) -> Result<Vec<PaymentRow>, AppError> {
    let rows = sqlx::query(
        "SELECT p.paid_at, o.code, p.method, p.amount, p.status, u.full_name AS receiver
           FROM payments p
           LEFT JOIN orders o ON o.id = p.order_id
           LEFT JOIN users u ON u.id = p.received_by_user_id
          WHERE p.paid_at >= $1 AND p.paid_at < $2
          ORDER BY p.paid_at ASC",
    )
    .bind(&range.start_iso)
    .bind(&range.end_iso)
    .fetch_all(&state.db.pool)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| PaymentRow {
            paid_at: row.get("paid_at"),
            code: row.get("code"),
            method: row.get("method"),
            amount: row.get("amount"),
            status: row.get("status"),
            receiver: row.get("receiver"),
        })
        .collect())
}

fn attachment(filename: String, content_type: &'static str, body: Vec<u8>) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = StatusCode::OK;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
        response.headers_mut().insert(header::CONTENT_DISPOSITION, value);
    }
    response
}

fn csv_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub async fn payments_csv(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RangeQuery>,
) -> Result<Response, AppError> {
    authorize(&state, &headers).await?;
    let range = resolve_range(&query)?;
    let rows = payment_rows(&state, &range).await?;

    let mut lines = vec![
        [
            "زمان پرداخت",
            "کد سفارش",
            "روش",
            "مبلغ (ریال)",
            "وضعیت",
            "دریافت‌کننده",
        ]
        .map(csv_escape)
        .join(","),
    ];
    for row in &rows {
        let fields = [
            row.paid_at.clone(),
            row.code.clone().unwrap_or_default(),
            method_label(&row.method).to_string(),
            row.amount.to_string(),
            row.status.clone(),
            row.receiver.clone().unwrap_or_default(),
        ];
        lines.push(fields.map(|value| csv_escape(&value)).join(","));
    }

    let body = format!("\u{feff}{}", lines.join("\r\n")).into_bytes();
    Ok(attachment(
        format!("payments-{}-{}.csv", range.from, range.to),
        "text/csv; charset=utf-8",
        body,
    ))
}

pub async fn payments_xlsx(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RangeQuery>,
) -> Result<Response, AppError> {
    authorize(&state, &headers).await?;
    let range = resolve_range(&query)?;
    let rows = payment_rows(&state, &range).await?;

    let mut workbook = vec![vec![
        Cell::Text("زمان پرداخت".to_string()),
        Cell::Text("کد سفارش".to_string()),
        Cell::Text("روش".to_string()),
        Cell::Text("مبلغ (ریال)".to_string()),
        Cell::Text("وضعیت".to_string()),
        Cell::Text("دریافت‌کننده".to_string()),
    ]];
    for row in rows {
        let when = OffsetDateTime::parse(&row.paid_at, &Rfc3339)
            .ok()
            .and_then(|moment| {
                cafeflow_domain::jalali::format_jalali(moment, true, false, false).ok()
            })
            .unwrap_or_else(|| row.paid_at.clone());
        workbook.push(vec![
            Cell::Text(when),
            Cell::Text(row.code.unwrap_or_default()),
            Cell::Text(method_label(&row.method).to_string()),
            Cell::Number(row.amount),
            Cell::Text(status_label(&row.status).to_string()),
            Cell::Text(row.receiver.unwrap_or_default()),
        ]);
    }

    Ok(attachment(
        format!("payments-{}-{}.xlsx", range.from, range.to),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        build_payments_workbook(&workbook),
    ))
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("reports database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_is_converted_from_tehran_midnight_to_utc() {
        let range = resolve_range(&RangeQuery {
            from: Some("2026-11-22".to_string()),
            to: Some("2026-11-22".to_string()),
        })
        .unwrap();
        assert_eq!(range.start_iso, "2026-11-21T20:30:00.000Z");
        assert_eq!(range.end_iso, "2026-11-22T20:30:00.000Z");
        assert_eq!(range.from, "2026-11-22");
        assert_eq!(range.to, "2026-11-22");
    }

    #[test]
    fn invalid_calendar_dates_and_reversed_ranges_are_rejected() {
        assert!(resolve_range(&RangeQuery {
            from: Some("2026-02-30".to_string()),
            to: None,
        })
        .is_err());
        assert!(resolve_range(&RangeQuery {
            from: Some("2026-11-23".to_string()),
            to: Some("2026-11-22".to_string()),
        })
        .is_err());
        assert!(resolve_range(&RangeQuery {
            from: Some("22-11-2026".to_string()),
            to: None,
        })
        .is_err());
    }
}
