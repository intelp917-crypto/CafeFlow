import type { GameRoomView } from '@cafeflow/shared';
import { Alert } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import { SeatList } from '../shared/GamePieces';

export interface WaitingRoomProps {
  room: GameRoomView;
  mySeat: number;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}

/**
 * The waiting room is the only place a guest sees other seats' readiness.
 *
 * Starting is the host's call and needs the rules' minimum count, so a two-player
 * game cannot be started early and a werewolf table cannot start with four.
 */
export function WaitingRoom({ room, mySeat, onReady, onStart, onLeave }: WaitingRoomProps) {
  const me = room.seats.find((seat) => seat.index === mySeat);
  const isHost = me?.isHost ?? false;
  // A ready seat whose phone dropped is not a player yet: starting with a
  // ghost would pause the first turn until the grace period frees it.
  const everyoneReady = room.seats.length > 0 && room.seats.every((seat) => seat.ready && seat.connected);
  const offline = room.seats.filter((seat) => !seat.connected).length;
  const enoughPlayers = room.seats.length >= room.minPlayers;
  const canStart = isHost && everyoneReady && enoughPlayers;

  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] border border-line/70 bg-surface p-5">
        <p className="text-[10px] text-brand-700">{room.tableNameFa}</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">{room.gameNameFa}</h1>
        <p className="mt-2 text-[11px] leading-6 text-muted">
          بقیهٔ هم‌میزها همین کد QR میز را اسکن کنند و «{room.gameNameFa}» را انتخاب کنند تا در همین
          اتاق کنار شما بنشینند.
        </p>

        <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span>
            {formatCountFa(room.seats.length)} از {formatCountFa(room.maxPlayers)} صندلی
          </span>
          <span>
            حداقل برای شروع: {formatCountFa(room.minPlayers)}
          </span>
        </div>

        <SeatList className="mt-2" seats={room.seats} />
      </section>

      {!enoughPlayers ? (
        <Alert tone="info" title="منتظر بقیهٔ میز">
          تا رسیدن حداقل {formatCountFa(room.minPlayers)} بازیکن، بازی شروع نمی‌شود.
        </Alert>
      ) : offline > 0 ? (
        <Alert tone="warning" title="در انتظار اتصال">
          {formatCountFa(offline)} صندلی قطع است؛ با برگشتن اتصالش می‌توانید شروع کنید.
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onReady(!(me?.ready ?? false))}
          aria-pressed={me?.ready ?? false}
          className={`min-h-11 flex-1 rounded-full px-5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
            me?.ready ? 'border border-brand-300 bg-brand-50 text-brand-800' : 'bg-espresso text-cream hover:bg-brand-800'
          }`}
        >
          {me?.ready ? 'آماده‌ام ✓' : 'آماده‌ام'}
        </button>

        {isHost ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className="min-h-11 flex-1 rounded-full bg-brand-600 px-5 text-xs font-bold text-white transition-colors enabled:hover:bg-brand-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            شروع بازی
          </button>
        ) : (
          <span className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-line/70 text-[11px] text-muted">
            میزبان شروع می‌کند
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onLeave}
        className="min-h-11 w-full text-[11px] text-muted underline-offset-4 hover:underline"
      >
        ترک این بازی
      </button>
    </div>
  );
}
