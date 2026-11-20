import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { GameCatalogItem } from '@cafeflow/shared';
import { Alert } from '@cafeflow/ui';
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
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line/70 bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] text-muted">{cafeNameFa}</p>
            <p className="truncate font-display text-sm font-bold text-ink">
              {room ? `${room.gameNameFa} — ${room.tableNameFa}` : 'بازی میزی'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px]">
            {session ? (
              <span
                className={`rounded-full px-2.5 py-1 ${
                  connection === 'open'
                    ? 'bg-cream text-ink/80'
                    : 'bg-brand-50 text-brand-800'
                }`}
                role="status"
                aria-live="polite"
              >
                {connection === 'open' ? 'متصل' : 'اتصال دوباره…'}
              </span>
            ) : null}
            <Link to={qrToken ? `/menu/${qrToken}` : '/menu'} className="text-brand-700 hover:underline">
              منو
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 sm:px-6">
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
            onLeave={() => remember(null)}
          />
        ) : room && room.phase === 'playing' ? (
          <TheTable roomLabel={room.tableNameFa} gameNameFa={room.gameNameFa}>
            <GameView room={room} state={state} mySeat={mySeat} onMove={move} onRestart={() => send({ type: 'restart' })} />
          </TheTable>
        ) : room && room.phase === 'over' ? (
          <TheTable roomLabel={room.tableNameFa} gameNameFa={room.gameNameFa}>
            <GameView room={room} state={state} mySeat={mySeat} onMove={move} onRestart={() => send({ type: 'restart' })} />
          </TheTable>
        ) : (
          <div className="flex justify-center py-10 text-brand-600">
            <span className="text-xs text-muted">در حال اتصال به میز…</span>
          </div>
        )}
      </main>

      <p className="pb-6 text-center text-[10px] text-muted">
        بازی‌ها فقط برای همین نشستِ میز هستند و در پایگاه داده ذخیره نمی‌شوند.
      </p>
    </div>
  );
}

function TheTable({
  roomLabel,
  gameNameFa,
  children,
}: {
  roomLabel: string;
  gameNameFa: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted">
          {roomLabel} · {gameNameFa}
        </p>
      </div>
      {children}
    </section>
  );
}
