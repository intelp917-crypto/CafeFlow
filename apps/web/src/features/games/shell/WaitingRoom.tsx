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
      <section className="relative overflow-hidden rounded-[1.9rem] border border-[#e0a15f]/20 bg-[#1a1210] shadow-[0_40px_100px_-50px_rgba(0,0,0,0.95)]">
        <div className="relative h-32 overflow-hidden sm:h-40">
          <img src={`/games/${room.gameId}.jpg`} alt="" className="size-full object-cover" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#1a1210] via-[#1a1210]/35 to-black/25" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
            <div>
              <p className="text-[9px] text-[#e0a15f]">{room.tableNameFa} · در انتظار هم‌میزها</p>
              <h1 className="mt-0.5 text-2xl font-black text-white drop-shadow">{room.gameNameFa}</h1>
            </div>
            <span className="num rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[10px] text-[#f3e3cf] backdrop-blur">
              {formatCountFa(room.seats.length)} / {formatCountFa(room.maxPlayers)}
            </span>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <p className="text-[11px] leading-6 text-[#c9b6a2]">
            بقیهٔ هم‌میزها همین کد QR میز را اسکن کنند و «{room.gameNameFa}» را انتخاب کنند تا در همین
            اتاق کنار شما بنشینند. حداقل {formatCountFa(room.minPlayers)} نفر برای شروع لازم است.
          </p>

          <SeatList seats={room.seats} />
        </div>
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
          className={`min-h-12 flex-1 rounded-full px-5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e0a15f]/70 ${
            me?.ready ? 'border border-[#e0a15f]/50 bg-[#e0a15f]/15 text-[#f0c18c]' : 'bg-[#e0a15f] text-[#241511] hover:bg-[#efb577]'
          }`}
        >
          {me?.ready ? 'آماده‌ام ✓' : 'آماده‌ام'}
        </button>

        {isHost ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className="min-h-12 flex-1 rounded-full bg-[#f8f1e5] px-5 text-xs font-black text-[#241511] transition-colors enabled:hover:bg-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e0a15f]/70"
          >
            شروع بازی
          </button>
        ) : (
          <span className="flex min-h-12 flex-1 items-center justify-center rounded-full border border-white/10 text-[11px] text-[#a99786]">
            میزبان شروع می‌کند
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onLeave}
        className="min-h-11 w-full text-[11px] text-[#8c7663] underline-offset-4 hover:text-[#c9b6a2] hover:underline"
      >
        ترک این بازی
      </button>
    </div>
  );
}
