/**
 * Persian copy for the rules engine.
 *
 * Upstream modules return stable machine keys (`g_not_your_turn`,
 * `uno_card_not_in_hand`, …). A guest must never see a key, so every key the six
 * shipped games can return is translated here; an unknown key falls back to a
 * neutral Persian sentence rather than leaking English.
 */
const MESSAGES_FA: Record<string, string> = {
  g_game_over: 'این دست تمام شده است.',
  g_not_your_turn: 'الان نوبت شما نیست.',
  g_unknown_action: 'این حرکت شناخته نشد.',
  g_invalid_action: 'این حرکت مجاز نیست.',

  ttt_invalid_cell: 'خانهٔ انتخاب‌شده معتبر نیست.',
  ttt_position_occupied: 'این خانه قبلاً پر شده است.',

  c4_invalid_column: 'ستون انتخاب‌شده معتبر نیست.',
  c4_column_full: 'این ستون پر است؛ ستون دیگری را امتحان کنید.',

  rv_invalid_move: 'این حرکت معتبر نیست.',
  rv_out_of_bounds: 'این خانه بیرون صفحه است.',
  rv_cell_occupied: 'این خانه قبلاً پر شده است.',
  rv_illegal_move: 'با این حرکت هیچ مهره‌ای برنمی‌گردد.',
  rv_must_play_if_possible: 'تا وقتی حرکت دارید نمی‌توانید رد کنید.',

  g2048_bad_dir: 'جهت حرکت معتبر نیست.',
  g2048_no_move: 'این جهت تغییری در صفحه نمی‌دهد.',
  g2048_dead: 'صفحهٔ شما قفل شده است.',

  uno_card_not_in_hand: 'این کارت در دست شما نیست.',
  uno_cannot_play_card: 'این کارت با رنگ یا عدد روی زمین جور نیست.',
  uno_have_playable_card: 'تا وقتی کارت قابل‌بازی دارید نمی‌توانید کارت بکشید.',
  uno_must_draw_or_play: 'وقتی جریمه روی میز است فقط ۲+ یا ۴+ بیندازید یا جریمه را بکشید.',
  uno_invalid_color: 'رنگ انتخاب‌شده معتبر نیست.',
  uno_no_challenge_pending: 'الان اعتراضی در جریان نیست.',

  ww_not_now: 'این کار الان ممکن نیست.',
  ww_bad_target: 'این بازیکن برای این کار مناسب نیست.',
  ww_chat_closed: 'الان نمی‌توانید پیام بفرستید.',
  ww_chat_moved: 'مرحله عوض شد؛ پیام ارسال نشد.',
  ww_chat_empty: 'متن پیام خالی است.',
  ww_chat_fast: 'کمی صبر کنید و دوباره بفرستید.',
  ww_one_potion: 'در یک شب فقط یکی از دو معجون را می‌توانید استفاده کنید.',
  ww_no_potion: 'این معجون قبلاً استفاده شده است.',
  ww_no_self_save: 'نمی‌توانید خودتان را نجات دهید.',
};

const FALLBACK = 'این حرکت انجام نشد؛ دوباره تلاش کنید.';

export function messageFa(key: string | null | undefined): string {
  if (!key) return FALLBACK;
  return MESSAGES_FA[key] ?? FALLBACK;
}

export function hasMessageFa(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGES_FA, key);
}
