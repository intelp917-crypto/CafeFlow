import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { GameCatalogItem } from '@cafeflow/shared';
import { Alert, cn } from '@cafeflow/ui';
import { ArrowRight, Gamepad2, Radio } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { gamesApi, useGameRoom } from '../lib/games';
import { useBranding } from '../lib/branding';
import { JoinGate } from '../features/games/shell/JoinGate';
import { WaitingRoom } from '../features/games/shell/WaitingRoom';
import { GameView } from '../features/games/shell/GameView';

interface StoredSession {
  seatToken: string;
  gameId: string;
}

/**
 * `/table/:qrToken/games` — everything that happens after the sticker is scanned.
 *
 * The page keeps the seat token for the tab, so a refresh or a locked screen comes
 * back to the same cards. When the server says the seat is gone, the page falls
 * back to the game picker instead of retrying forever.
 */
export function TableGamesPage() {
  const { qrToken } = useParams<{ qrToken: string }>();
  const { nameFa: cafeNameFa } = useBranding();
  const storageKey = `cafeflow:table-game:${qrToken ?? 'none'}`;

  const [games, setGames] = useState<GameCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [session, setSession] = useState<StoredSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  });

  const { room, state, connection, error, send, move, clearError } = useGameRoom(session?.seatToken ?? null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gamesApi
      .catalog()
      .then((response) => {
        if (!cancelled) setGames(response.games);
      })
      .catch((caught) => {
        if (!cancelled) setCatalogError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The seat is gone (server restarted, or the table was released): start over.
  useEffect(() => {
    if (connection !== 'unauthorized' || !session) return;
    setSession(null);
    setJoinError('این دست بسته شد. یک بازی را دوباره شروع کنید.');
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Nothing to clean up in private mode.
    }
  }, [connection, session, storageKey]);

  const remember = (next: StoredSession | null) => {
    setSession(next);
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Storage may be unavailable; the socket still works for this page view.
    }
  };

  const join = useCallback(
    async (gameId: string, nameFa: string) => {
      if (!qrToken) return;
      setJoining(gameId);
      setJoinError(null);
      try {
        const response = await gamesApi.join({ qrToken, gameId, nameFa: nameFa || undefined });
        remember({ seatToken: response.seatToken, gameId: response.room.gameId });
      } catch (caught) {
        setJoinError(errorMessage(caught));
      } finally {
        setJoining(null);
      }
    },
    // `remember` only touches local state and storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qrToken, storageKey],
  );

  const mySeat = room?.seats.find((seat) => seat.isYou)?.index ?? 0;

  return (
    <div className="game-lounge relative min-h-dvh overflow-hidden text-[#f4e7d6]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 top-0 size-[28rem] rounded-full bg-[#a34c25]/25 blur-[110px]" />
        <div className="absolute -left-32 top-1/3 size-[26rem] rounded-full bg-[#6d8b78]/20 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.055] [background-image:radial-gradient(#f7efe3_1px,transparent_1px)] [background-size:22px_22px]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#120c0a]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e0a15f]/15 text-[#efb577] ring-1 ring-[#e0a15f]/25">
              <Gamepad2 aria-hidden className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[9px] text-[#a99786]">{cafeNameFa} · بازی میزی</p>
              <p className="truncate text-sm font-bold text-[#f8eddc]">
                {room ? `${room.gameNameFa} — ${room.tableNameFa}` : 'لابی بازی'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[10px]">
            {session ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
                  connection === 'open'
                    ? 'bg-[#7f9d84]/15 text-[#b9d3bd] ring-1 ring-[#9ab5a0]/25'
                    : 'bg-[#e0a15f]/15 text-[#f0c18c] ring-1 ring-[#e0a15f]/25',
                )}
                role="status"
                aria-live="polite"
              >
                <Radio aria-hidden className="size-3" />
                {connection === 'open' ? 'متصل' : 'اتصال دوباره…'}
              </span>
            ) : null}
            <Link
              to={qrToken ? `/menu/${qrToken}` : '/menu'}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 text-[#d8c5b1] transition-colors hover:border-white/25 hover:text-white"
            >
              <ArrowRight aria-hidden className="size-3.5" />
              منو
            </Link>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
        {error ? (
          <button type="button" onClick={clearError} className="block w-full text-start" aria-label="بستن پیام">
            <Alert tone="warning" title="پیام میز">{error}</Alert>
          </button>
        ) : null}

        {!session ? (
          <JoinGate
            tableNameFa={room?.tableNameFa ?? 'این میز'}
            games={games}
            loading={loading}
            error={joinError ?? catalogError}
            joiningGameId={joining}
            onJoin={(gameId, nameFa) => void join(gameId, nameFa)}
          />
        ) : room && room.phase === 'lobby' ? (
          <WaitingRoom
            room={room}
            mySeat={mySeat}
            onReady={(ready) => send({ type: 'ready', ready })}
            onStart={() => send({ type: 'start' })}
            onLeave={() => {
              // Tell the table first so the chair is free for the next guest.
              send({ type: 'leave' });
              remember(null);
            }}
          />
        ) : room && room.phase === 'playing' ? (
          <TheTable roomLabel={room.tableNameFa} gameNameFa={room.gameNameFa} gameId={room.gameId}>
            <GameView room={room} state={state} mySeat={mySeat} onMove={move} onRestart={() => send({ type: 'restart' })} />
          </TheTable>
        ) : room && room.phase === 'over' ? (
          <TheTable roomLabel={room.tableNameFa} gameNameFa={room.gameNameFa} gameId={room.gameId}>
            <GameView room={room} state={state} mySeat={mySeat} onMove={move} onRestart={() => send({ type: 'restart' })} />
          </TheTable>
        ) : (
          <div className="flex justify-center py-10 text-brand-600">
            <span className="text-xs text-muted">در حال اتصال به میز…</span>
          </div>
        )}
      </main>

      <p className="relative pb-6 text-center text-[10px] text-[#8c7663]">
        دست‌ها فقط برای همین نشستِ میز هستند و در پایگاه داده ذخیره نمی‌شوند.
      </p>
    </div>
  );
}

function TheTable({
  roomLabel,
  gameNameFa,
  gameId,
  children,
}: {
  roomLabel: string;
  gameNameFa: string;
  gameId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <p className="text-[9px] text-[#a99786]">{roomLabel}</p>
          <h2 className="text-lg font-black text-[#f8eddc]">{gameNameFa}</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[9px] text-[#c9b6a2]">
          میز زنده · بدون نصب
        </span>
      </div>

      <div className="relative overflow-hidden rounded-[1.9rem] border border-[#e0a15f]/20 bg-[#1a1210] p-2.5 shadow-[0_40px_100px_-45px_rgba(0,0,0,0.95)] sm:p-3.5">
        <div
          aria-hidden
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url('/games/${gameId}.jpg')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/55 via-[#1a1210]/80 to-black/65" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.12] [background-image:repeating-linear-gradient(45deg,#e0a15f_0,#e0a15f_1px,transparent_1px,transparent_9px)]"
        />
        <div className="relative rounded-[1.4rem] bg-[#f8f1e5] p-3 text-ink shadow-inner sm:p-5">{children}</div>
      </div>
    </section>
  );
}
