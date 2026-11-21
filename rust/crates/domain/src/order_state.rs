//! Order and preparation state machines. The backend is the authority.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Draft,
    Submitted,
    AwaitingConfirmation,
    Confirmed,
    Preparing,
    PartiallyReady,
    Ready,
    Served,
    AwaitingPayment,
    Paid,
    Cancelled,
}

pub const ORDER_STATUSES: [OrderStatus; 11] = [
    OrderStatus::Draft,
    OrderStatus::Submitted,
    OrderStatus::AwaitingConfirmation,
    OrderStatus::Confirmed,
    OrderStatus::Preparing,
    OrderStatus::PartiallyReady,
    OrderStatus::Ready,
    OrderStatus::Served,
    OrderStatus::AwaitingPayment,
    OrderStatus::Paid,
    OrderStatus::Cancelled,
];

impl OrderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Submitted => "submitted",
            Self::AwaitingConfirmation => "awaiting_confirmation",
            Self::Confirmed => "confirmed",
            Self::Preparing => "preparing",
            Self::PartiallyReady => "partially_ready",
            Self::Ready => "ready",
            Self::Served => "served",
            Self::AwaitingPayment => "awaiting_payment",
            Self::Paid => "paid",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn label_fa(self) -> &'static str {
        match self {
            Self::Draft => "پیش‌نویس",
            Self::Submitted => "ثبت شده",
            Self::AwaitingConfirmation => "در انتظار تأیید",
            Self::Confirmed => "تأیید شده",
            Self::Preparing => "در حال آماده‌سازی",
            Self::PartiallyReady => "بخشی آماده",
            Self::Ready => "آماده تحویل",
            Self::Served => "سرو شده",
            Self::AwaitingPayment => "در انتظار پرداخت",
            Self::Paid => "پرداخت شده",
            Self::Cancelled => "لغو شده",
        }
    }

    pub fn parse_status(value: &str) -> Option<Self> {
        ORDER_STATUSES
            .into_iter()
            .find(|status| status.as_str() == value)
    }

    pub fn next(self) -> &'static [OrderStatus] {
        match self {
            Self::Draft => &[Self::Submitted, Self::Cancelled],
            Self::Submitted => &[Self::AwaitingConfirmation, Self::Confirmed, Self::Cancelled],
            Self::AwaitingConfirmation => &[Self::Confirmed, Self::Cancelled],
            Self::Confirmed => &[Self::Preparing, Self::Cancelled],
            Self::Preparing => &[Self::PartiallyReady, Self::Ready, Self::Cancelled],
            Self::PartiallyReady => &[Self::Ready, Self::Cancelled],
            Self::Ready => &[Self::Served, Self::Cancelled],
            Self::Served => &[Self::AwaitingPayment, Self::Paid],
            Self::AwaitingPayment => &[Self::Paid],
            Self::Paid | Self::Cancelled => &[],
        }
    }
}

impl fmt::Display for OrderStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

pub fn can_transition(from: OrderStatus, to: OrderStatus) -> bool {
    from.next().contains(&to)
}

pub fn is_terminal_status(status: OrderStatus) -> bool {
    matches!(status, OrderStatus::Paid | OrderStatus::Cancelled)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrderTransitionError {
    pub from: OrderStatus,
    pub to: OrderStatus,
}

impl fmt::Display for OrderTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "انتقال وضعیت سفارش از «{}» به «{}» مجاز نیست.",
            self.from.label_fa(),
            self.to.label_fa()
        )
    }
}

impl std::error::Error for OrderTransitionError {}

pub fn assert_transition(from: OrderStatus, to: OrderStatus) -> Result<(), OrderTransitionError> {
    if can_transition(from, to) {
        Ok(())
    } else {
        Err(OrderTransitionError { from, to })
    }
}

pub fn next_statuses(from: OrderStatus) -> Vec<(OrderStatus, &'static str)> {
    from.next()
        .iter()
        .map(|status| (*status, status.label_fa()))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrepStatus {
    Queued,
    InProgress,
    Ready,
    Delayed,
    Cancelled,
}

pub fn prep_next(status: PrepStatus) -> &'static [PrepStatus] {
    match status {
        PrepStatus::Queued => &[
            PrepStatus::InProgress,
            PrepStatus::Ready,
            PrepStatus::Cancelled,
        ],
        PrepStatus::InProgress => &[
            PrepStatus::Ready,
            PrepStatus::Delayed,
            PrepStatus::Cancelled,
        ],
        PrepStatus::Delayed => &[
            PrepStatus::InProgress,
            PrepStatus::Ready,
            PrepStatus::Cancelled,
        ],
        PrepStatus::Ready | PrepStatus::Cancelled => &[],
    }
}

pub fn can_prep_transition(from: PrepStatus, to: PrepStatus) -> bool {
    prep_next(from).contains(&to)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_and_partial_ready() {
        let path = [
            OrderStatus::Draft,
            OrderStatus::Submitted,
            OrderStatus::Confirmed,
            OrderStatus::Preparing,
            OrderStatus::Ready,
            OrderStatus::Served,
            OrderStatus::AwaitingPayment,
            OrderStatus::Paid,
        ];
        for pair in path.windows(2) {
            assert!(can_transition(pair[0], pair[1]));
        }
        assert!(can_transition(
            OrderStatus::Preparing,
            OrderStatus::PartiallyReady
        ));
        assert!(can_transition(
            OrderStatus::PartiallyReady,
            OrderStatus::Ready
        ));
    }

    #[test]
    fn rejects_skips_and_terminal_changes() {
        assert!(!can_transition(OrderStatus::Confirmed, OrderStatus::Served));
        assert!(!can_transition(OrderStatus::Submitted, OrderStatus::Paid));
        assert!(!can_transition(OrderStatus::Cancelled, OrderStatus::Paid));
        assert!(!can_transition(OrderStatus::Paid, OrderStatus::Cancelled));
        assert!(is_terminal_status(OrderStatus::Cancelled));
        assert!(is_terminal_status(OrderStatus::Paid));
    }

    #[test]
    fn labels_and_errors() {
        assert_eq!(
            next_statuses(OrderStatus::Draft),
            vec![
                (OrderStatus::Submitted, "ثبت شده"),
                (OrderStatus::Cancelled, "لغو شده")
            ]
        );
        let error = assert_transition(OrderStatus::Draft, OrderStatus::Served).unwrap_err();
        assert!(error.to_string().contains("مجاز نیست"));
    }

    #[test]
    fn prep_transitions() {
        assert!(can_prep_transition(
            PrepStatus::Queued,
            PrepStatus::InProgress
        ));
        assert!(can_prep_transition(
            PrepStatus::InProgress,
            PrepStatus::Ready
        ));
        assert!(!can_prep_transition(
            PrepStatus::Ready,
            PrepStatus::InProgress
        ));
    }
}
