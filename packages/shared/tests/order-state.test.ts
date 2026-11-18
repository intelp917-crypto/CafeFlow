import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canPrepTransition,
  canTransition,
  isTerminalStatus,
  nextStatuses,
  OrderTransitionError,
} from '../src/order-state';

describe('order transitions', () => {
  it('allows the happy path from draft to paid', () => {
    const path = [
      'draft',
      'submitted',
      'confirmed',
      'preparing',
      'ready',
      'served',
      'awaiting_payment',
      'paid',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows partially ready before ready', () => {
    expect(canTransition('preparing', 'partially_ready')).toBe(true);
    expect(canTransition('partially_ready', 'ready')).toBe(true);
  });

  it('rejects skipping preparation', () => {
    expect(canTransition('confirmed', 'served')).toBe(false);
    expect(canTransition('submitted', 'paid')).toBe(false);
  });

  it('rejects paying a cancelled order', () => {
    expect(canTransition('cancelled', 'paid')).toBe(false);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('paid')).toBe(true);
  });

  it('rejects cancelling after payment', () => {
    expect(canTransition('paid', 'cancelled')).toBe(false);
  });

  it('throws a Persian error for illegal transitions', () => {
    expect(() => assertTransition('draft', 'served')).toThrow(OrderTransitionError);
    expect(() => assertTransition('draft', 'served')).toThrow(/مجاز نیست/);
  });

  it('exposes Persian labels for next statuses', () => {
    const next = nextStatuses('draft');
    expect(next).toEqual([
      { status: 'submitted', labelFa: 'ثبت شده' },
      { status: 'cancelled', labelFa: 'لغو شده' },
    ]);
  });
});

describe('preparation transitions', () => {
  it('moves queued to in progress to ready', () => {
    expect(canPrepTransition('queued', 'in_progress')).toBe(true);
    expect(canPrepTransition('in_progress', 'ready')).toBe(true);
  });

  it('does not allow a ready item to go back', () => {
    expect(canPrepTransition('ready', 'in_progress')).toBe(false);
  });
});
