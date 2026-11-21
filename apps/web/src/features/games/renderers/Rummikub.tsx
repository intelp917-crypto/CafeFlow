import { useState } from 'react';
import { Shuffle } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';

interface Tile {
  id: string;
  color: string;
  num: number;
  wild?: boolean;
}

const COLOR_CLASS: Record<string, string> = {
  black: 'bg-[#2a211a] text-cream',
  blue: 'bg-[#3c5a72] text-white',
  red: 'bg-[#a83a2c] text-white',
  orange: 'bg-[#c07a2e] text-white',
  joker: 'bg-[#6d5b8f] text-white',
};

function TileChip({
  tile,
  selected,
  onClick,
  disabled,
  size = 'md',
}: {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const className = cn(
    'num flex shrink-0 items-center justify-center rounded-lg border font-bold shadow-sm',
    size === 'sm' ? 'size-8 text-[11px]' : 'size-12 text-base',
    COLOR_CLASS[tile.color] ?? COLOR_CLASS.black,
    selected ? 'ring-2 ring-brand-500 ring-offset-1' : 'border-black/20',
    disabled && 'opacity-50',
  );
  const content = tile.wild ? '★' : formatCountFa(tile.num);
  const label = tile.wild ? 'جوکر' : `${formatCountFa(tile.num)} ${tile.color === 'black' ? 'مشکی' : tile.color === 'blue' ? 'آبی' : tile.color === 'red' ? 'قرمز' : 'نارنجی'}`;
  if (!onClick) {
    return (
      <span aria-label={label} className={className}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {content}
    </button>
  );
}

/**
 * رامیکاب — دست‌های ۱۴ کاشی، سری‌ها و رنگ‌های پشت‌سرهم روی میز، و بازآرایی
 * میز به‌صورت ساخت گروه‌های تازه. اعتبار هر سری، شرط ۳۰ امتیاز اولیه و
 * بازگرداندن همهٔ کاشی‌های میز در سرور بررسی می‌شود.
 */
export function Rummikub({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[][]>([]);
  const [groupPick, setGroupPick] = useState<string[]>([]);

  const gamePhase = (state.phase as string) ?? 'play';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<Tile[] | null> | undefined) ?? [];
  const hand = hands[mySeat] ?? [];
  const table = (state.table as Tile[][] | undefined) ?? [];
  const pool = (state.pool as unknown[] | undefined) ?? [];
  const workspace = (state.workspace as Tile[] | undefined) ?? [];
  const hasBroken = (state.hasBroken as boolean[] | undefined) ?? [];
  const playedThisTurn = (state.playedThisTurn as boolean[] | undefined) ?? [];
  const meldPending = (state.meldPending as { score: number } | null) ?? null;

  const myTurn = phase === 'playing' && currentPlayer === mySeat && winner === null;
  const manipulating = gamePhase === 'manipulate';
  const selected = picked.filter((id) => hand.some((tile) => tile.id === id));

  const toggle = (id: string, list: string[], setList: (next: string[]) => void) => {
    setList(list.includes(id) ? list.filter((candidate) => candidate !== id) : [...list, id]);
  };

  const submitGroups = () => {
    if (groups.length === 0) return;
    onMove({ action: 'submit', groups });
    setGroups([]);
    setGroupPick([]);
  };

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : currentPlayer}
        hint={
          winner !== null
            ? 'این دست تمام شد'
            : manipulating
              ? 'همهٔ کاشی‌های میز را در گروه‌های معتبر بچینید و ثبت کنید'
              : myTurn
                ? hasBroken[mySeat]
                  ? 'سه کاشی هم‌رنگ پشت‌سرهم یا سه عدد یکسان بچینید'
                  : 'اولین سری باید دست‌کم ۳۰ امتیاز باشد'
                : `نوبت ${seatName(seats, currentPlayer)} است`
        }
      />

      <ResultOverlay seats={seats} winner={winner} phase={phase} canRestart={canRestart} onRestart={onRestart}>
        <p className="mt-1 text-[11px] text-muted">اولین کسی که دستش خالی شود برنده است.</p>
      </ResultOverlay>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">کیسهٔ کاشی: {formatCountFa(pool.length)}</p>
        <p className="text-muted">
          {meldPending
            ? `امتیاز سری اول این نوبت: ${formatCountFa(meldPending.score)} از ۳۰`
            : hasBroken[mySeat]
              ? 'سری اول باز شده'
              : 'سری اول باز نشده'}
        </p>
        <p className="text-muted">
          {seats.map((seat) => `${seat.nameFa}: ${formatCountFa(hands[seat.index]?.length ?? 0)}`).join(' · ')}
        </p>
      </div>

      {manipulating ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">
            کاشی‌های میز و دست شما ({formatCountFa(workspace.length)} کاشی) را به گروه‌های تازه تقسیم کنید.
            هر کاشی فقط یک بار و همهٔ کاشی‌های میز باید در گروه‌ها باشند؛ دست‌کم یک کاشی از دست خودتان.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {workspace.map((tile) => (
              <TileChip
                key={tile.id}
                tile={tile}
                selected={groupPick.includes(tile.id)}
                onClick={() => toggle(tile.id, groupPick, setGroupPick)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (groupPick.length >= 3) {
                  setGroups((current) => [...current, groupPick]);
                  setGroupPick([]);
                }
              }}
              disabled={groupPick.length < 3}
              className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              این گروه را بساز ({formatCountFa(groupPick.length)})
            </button>
            <button
              type="button"
              onClick={() => {
                onMove({ action: 'cancel' });
                setGroups([]);
                setGroupPick([]);
              }}
              className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
            >
              انصراف
            </button>
          </div>
          <ul className="space-y-1.5">
            {groups.map((group, index) => (
              <li key={index} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line/70 bg-surface p-1.5">
                {group.map((id) => {
                  const tile = workspace.find((candidate) => candidate.id === id);
                  return tile ? <TileChip key={id} tile={tile} size="sm" /> : null;
                })}
                <button
                  type="button"
                  onClick={() => setGroups((current) => current.filter((_, position) => position !== index))}
                  className="min-h-8 rounded-full px-2 text-[10px] text-muted"
                >
                  حذف
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={submitGroups}
            disabled={groups.length === 0}
            className="min-h-11 rounded-full bg-espresso px-5 text-xs font-semibold text-cream disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            ثبت چیدمان
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
            <p className="mb-1.5 text-[10px] text-muted">میز</p>
            {table.length === 0 ? (
              <p className="text-[11px] text-muted">میز خالی است؛ اولین سری را از دست خودتان بچینید.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {table.map((set, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      if (!myTurn || selected.length !== 1) return;
                      onMove({ tileIds: selected, targetSet: index });
                      setPicked([]);
                    }}
                    disabled={!myTurn || selected.length !== 1}
                    aria-label={`سری ${formatCountFa(index + 1)}`}
                    className="flex flex-wrap items-center gap-1 rounded-xl border border-line/70 bg-cream/60 p-1.5 text-right disabled:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    {set.map((tile) => (
                      <TileChip key={tile.id} tile={tile} size="sm" />
                    ))}
                  </button>
                ))}
              </div>
            )}
            {myTurn && selected.length === 1 && table.length > 0 ? (
              <p className="mt-1.5 text-[10px] text-brand-700">برای افزودن کاشی، روی سری مورد نظر بزنید.</p>
            ) : null}
          </div>

          <section aria-label="دست شما" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted">دست شما ({formatCountFa(hand.length)} کاشی)</p>
              {selected.length > 0 ? (
                <p className="text-[11px] text-brand-700">{formatCountFa(selected.length)} کاشی انتخاب شده</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {hand.map((tile) => (
                <TileChip
                  key={tile.id}
                  tile={tile}
                  selected={picked.includes(tile.id)}
                  onClick={() => toggle(tile.id, picked, setPicked)}
                  disabled={!myTurn}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onMove({ tileIds: selected });
                  setPicked([]);
                }}
                disabled={!myTurn || selected.length < 3}
                className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                چیدن سری تازه
              </button>
              <button
                type="button"
                onClick={() => {
                  onMove({ pass: true });
                  setPicked([]);
                }}
                disabled={!myTurn || playedThisTurn[mySeat]}
                className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                کارت بکش و پایان نوبت
              </button>
              <button
                type="button"
                onClick={() => onMove({ endTurn: true })}
                disabled={!myTurn || !playedThisTurn[mySeat]}
                className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                پایان نوبت
              </button>
              <button
                type="button"
                onClick={() => onMove({ action: 'start_manipulate' })}
                disabled={!myTurn || table.length === 0 || Boolean(meldPending)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-4 text-xs font-semibold text-brand-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Shuffle aria-hidden className="size-3.5" />
                بازآرایی میز
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
