import type { GameRoomView } from '@cafeflow/shared';
import { Spinner } from '@cafeflow/ui';
import { RENDERERS } from '../renderers';

export interface GameViewProps {
  room: GameRoomView;
  state: Record<string, any> | null;
  mySeat: number;
  onMove: (move: Record<string, unknown>) => void;
  onRestart: () => void;
}

/**
 * Hands the seat's own state to the renderer for that game.
 *
 * A game with no renderer is a server-side possibility, not a broken page: the
 * seat keeps its room and sees a plain message instead of a blank screen.
 */
export function GameView({ room, state, mySeat, onMove, onRestart }: GameViewProps) {
  const Renderer = RENDERERS[room.gameId];
  const me = room.seats.find((seat) => seat.index === mySeat);

  if (!Renderer) {
    return <p className="rounded-2xl border border-line/70 bg-surface p-5 text-center text-xs text-muted">این بازی در این نسخه نمایش داده نمی‌شود.</p>;
  }

  if (!state) {
    return (
      <div className="flex justify-center py-10 text-brand-600">
        <Spinner size="lg" label="در حال چیدن میز…" />
      </div>
    );
  }

  return (
    <Renderer
      state={state}
      seats={room.seats}
      mySeat={mySeat}
      phase={room.phase}
      deadline={room.deadline}
      canRestart={me?.isHost ?? false}
      onMove={onMove}
      onRestart={onRestart}
    />
  );
}
