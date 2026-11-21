import { useState } from 'react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, TurnBar, seatName } from '../shared/GamePieces';

interface Tile {
  k?: string;
  n?: number;
  id?: string;
}

const SUIT_NAMES: Record<string, string> = {
  wan: 'کاراکتر',
  tong: 'دایره',
  tiao: 'بامبو',
  feng: 'باد',
  jian: 'اژدها',
};

const HONOURS: Record<string, Record<number, string>> = {
  feng: { 1: 'شرق', 2: 'جنوب', 3: 'غرب', 4: 'شمال' },
  jian: { 1: 'قرمز', 2: 'سبز', 3: 'سفید' },
};

const SUIT_TONE: Record<string, string> = {
  wan: 'border-brand-300 bg-brand-50 text-brand-800',
  tong: 'border-[#9db4c4] bg-[#e8f0f5] text-[#2f4a5c]',
  tiao: 'border-[#a9c2ad] bg-[#eaf2ea] text-[#2f5537]',
  feng: 'border-line bg-[#efe9df] text-[#4a3b2c]',
  jian: 'border-[#c3b3d0] bg-[#f0eaf5] text-[#4b3a5c]',
};

function tileLabel(tile: Tile): string {
  if (!tile || tile.k === undefined) return 'کاشی پنهان';
  if (tile.k === 'feng' || tile.k === 'jian') {
    return `${SUIT_NAMES[tile.k]} ${HONOURS[tile.k]?.[tile.n ?? 0] ?? formatCountFa(tile.n ?? 0)}`;
  }
  return `${formatCountFa(tile.n ?? 0)} ${SUIT_NAMES[tile.k] ?? tile.k}`;
}

function TileChip({ tile, selected, onClick, disabled, size = 'md' }: {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const hidden = tile.k === undefined;
  const className = cn(
    'num flex shrink-0 flex-col items-center justify-center rounded-lg border font-bold leading-none',
    size === 'sm' ? 'h-9 w-7 text-[10px]' : 'h-12 w-9 text-xs',
    hidden ? 'border-line bg-[#ddd3c4] text-transparent' : SUIT_TONE[tile.k!] ?? SUIT_TONE.wan,
    selected && 'ring-2 ring-brand-500 ring-offset-1',
    disabled && 'opacity-50',
  );
  const inside = hidden ? (
    <span aria-hidden>؟</span>
  ) : tile.k === 'feng' || tile.k === 'jian' ? (
    <span className="text-[9px]">{HONOURS[tile.k!]?.[tile.n ?? 0] ?? tile.n}</span>
  ) : (
    <>
      <span>{formatCountFa(tile.n ?? 0)}</span>
      <span className="mt-0.5 text-[8px]">{SUIT_NAMES[tile.k!]}</span>
    </>
  );
  if (!onClick) {
    return (
      <span aria-label={tileLabel(tile)} className={className}>
        {inside}
      </span>
    );
  }
  return (
    <button type="button" aria-label={tileLabel(tile)} aria-pressed={selected} onClick={onClick} disabled={disabled} className={className}>
      {inside}
    </button>
  );
}

/**
 * ماهیونگ — یک صفحه برای دو قواعد سیچوان (تبدیل سه‌تایی، انتخاب یک رنگ برای
 * دور انداختن، ادعای خورد) و کانتونی (کشیدن/دور انداختن، چنگ، پنگ، کنگ، هو).
 * دست حریف‌ها فقط تعداد است؛ دیوار، ملدها و دورریزها عمومی‌اند.
 */
export function Mahjong({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const [picked, setPicked] = useState<string[]>([]);

  const gamePhase = (state.phase as string) ?? 'play';
  const currentPlayer = (state.currentPlayer as number) ?? 0;
  const winner = (state.winner as number | null) ?? null;
  const hands = (state.hands as Array<Tile[] | number> | undefined) ?? [];
  const melds = (state.melds as Array<Array<{ type: string; tiles: Tile[]; concealed?: boolean }>> | undefined) ?? [];
  const discards = (state.discards as Tile[][] | undefined) ?? [];
  const claim = (state.claim as { tile: Tile; discarder: number; order: number[]; idx: number } | null) ?? null;
  const voidSuit = (state.voidSuit as Array<string | undefined> | undefined) ?? [];
  const drawn = (state.drawn as string | null) ?? null;
  const lastDiscard = (state.lastDiscard as Tile | null) ?? null;
  const wall = (state.deckCount ?? state.wall ?? 0) as number | Tile[];
  const myHand = Array.isArray(hands[mySeat]) ? (hands[mySeat] as Tile[]) : [];
  const handCount = (seat: number) => {
    const hand = hands[seat];
    return Array.isArray(hand) ? hand.length : hand ?? 0;
  };

  const claimActor = claim ? claim.order[claim.idx] : null;
  const myTurn = phase === 'playing' && gamePhase === 'play' && currentPlayer === mySeat && winner === null;
  const myClaim = phase === 'playing' && gamePhase === 'claim' && claimActor === mySeat && winner === null;
  const mySwap = gamePhase === 'swap' && currentPlayer === mySeat;
  const myVoid = gamePhase === 'void' && currentPlayer === mySeat;
  const selected = picked.filter((id) => myHand.some((tile) => tile.id === id));
  const swapSuit = selected.length > 0 ? myHand.find((tile) => tile.id === selected[0])?.k : undefined;
  const canSwap = selected.length === 3 && swapSuit && !['feng', 'jian'].includes(swapSuit) && selected.every((id) => myHand.find((tile) => tile.id === id)?.k === swapSuit);
  const kongCandidate = (() => {
    const counts = new Map<string, { k: string; n: number; ids: string[] }>();
    for (const tile of myHand) {
      if (!tile.k || !tile.id) continue;
      const key = `${tile.k}-${tile.n}`;
      const entry = counts.get(key) ?? { k: tile.k, n: tile.n ?? 0, ids: [] };
      entry.ids.push(tile.id);
      counts.set(key, entry);
    }
    return [...counts.values()].find((entry) => entry.ids.length >= 4) ?? null;
  })();
  const wallCount = Array.isArray(wall) ? wall.length : wall;

  return (
    <div className="space-y-4">
      <TurnBar
        seats={seats}
        mySeat={mySeat}
        currentSeat={winner !== null ? null : myClaim ? mySeat : currentPlayer}
        hint={
          winner !== null
            ? 'این دست تمام شد'
            : mySwap
              ? 'سه کاشی هم‌رنگ برای تبدیل انتخاب کنید'
              : myVoid
                ? 'یک رنگ را برای این دست کنار بگذارید'
                : myClaim
                  ? `ادعای ${tileLabel(claim?.tile ?? {})}`
                  : myTurn
                    ? 'یک کاشی برای دور انداختن انتخاب کنید'
                    : `نوبت ${seatName(seats, currentPlayer)} است`
        }
      />

      <ResultOverlay
        seats={seats}
        winner={winner}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
        headline={winner === -1 ? 'دیوار تمام شد؛ دست مساوی' : undefined}
      >
        <p className="mt-1 text-[11px] text-muted">
          دیوار: {formatCountFa(wallCount)} کاشی · دورریزها: {formatCountFa(discards.reduce((sum, pile) => sum + pile.length, 0))}
        </p>
      </ResultOverlay>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="text-muted">حالت: {state._variants === 'cantonese' ? 'کانتونی' : 'سیچوان'}</p>
        <p className="text-muted">دیوار: {formatCountFa(wallCount)}</p>
        <p className="text-muted">
          {seats.map((seat) => `${seat.nameFa}: ${formatCountFa(handCount(seat.index))} کاشی`).join(' · ')}
        </p>
      </div>

      {lastDiscard && lastDiscard.k ? (
        <p className="flex items-center gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2 text-[11px] text-muted">
          آخرین دورریز:
          <TileChip tile={lastDiscard} size="sm" />
        </p>
      ) : null}

      <div className="space-y-2 rounded-2xl border border-line/70 bg-surface p-3">
        <p className="text-[10px] text-muted">میز</p>
        {seats.map((seat) => (
          <div key={seat.index} className="flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-1.5 first:border-0 first:pt-0">
            <span className="w-20 shrink-0 text-[10px] text-muted">{seat.nameFa}</span>
            {(melds[seat.index] ?? []).map((meld, index) => (
              <span key={index} className="flex gap-0.5 rounded-md bg-cream/60 p-0.5">
                {meld.tiles.length > 0 ? (
                  meld.tiles.map((tile, tileIndex) => <TileChip key={tileIndex} tile={tile} size="sm" />)
                ) : (
                  <span className="px-1.5 text-[9px] text-muted">{meld.type === 'kong' ? 'کنگ بسته' : 'ملد'}</span>
                )}
              </span>
            ))}
            <span className="flex flex-wrap gap-0.5">
              {(discards[seat.index] ?? []).slice(-12).map((tile, index) => (
                <TileChip key={tile.id ?? index} tile={tile} size="sm" />
              ))}
            </span>
          </div>
        ))}
      </div>

      {mySwap ? (
        <div className="space-y-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">سه کاشی هم‌رنگ انتخاب کنید تا با حریف‌ها عوض شود.</p>
          <button
            type="button"
            onClick={() => {
              onMove({ type: 'swap', tileIds: selected });
              setPicked([]);
            }}
            disabled={!canSwap}
            className="min-h-11 rounded-full bg-brand-600 px-5 text-xs font-bold text-white disabled:opacity-50"
          >
            تبدیل سه کاشی
          </button>
        </div>
      ) : null}

      {myVoid ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">یک رنگ را کنار بگذارید:</p>
          {['wan', 'tong', 'tiao'].map((suit) => (
            <button
              key={suit}
              type="button"
              onClick={() => onMove({ type: 'void', suit })}
              className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
            >
              {SUIT_NAMES[suit]}
            </button>
          ))}
          {voidSuit.length > 0 ? (
            <p className="text-[10px] text-muted">
              {seats.map((seat) => `${seat.nameFa}: ${voidSuit[seat.index] ? SUIT_NAMES[voidSuit[seat.index]!] : '—'}`).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}

      {myClaim ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-300 bg-brand-50 p-3">
          <p className="text-xs text-ink">این کاشی را برمی‌دارید؟</p>
          <button type="button" onClick={() => onMove({ type: 'win' })} className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white">
            هو
          </button>
          <button type="button" onClick={() => onMove({ type: 'pung' })} className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink">
            پنگ
          </button>
          <button type="button" onClick={() => onMove({ type: 'kong' })} className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink">
            کنگ
          </button>
          {state._variants === 'cantonese' ? (
            <button type="button" onClick={() => onMove({ type: 'chow' })} className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink">
              چنگ
            </button>
          ) : null}
          <button type="button" onClick={() => onMove({ type: 'pass' })} className="min-h-11 rounded-full px-4 text-[11px] text-muted">
            رد
          </button>
        </div>
      ) : null}

      <section aria-label="دست شما" className="space-y-2">
        <p className="text-[11px] text-muted">دست شما ({formatCountFa(myHand.length)} کاشی)</p>
        <div className="flex flex-wrap gap-1">
          {myHand.map((tile) => (
            <TileChip
              key={tile.id ?? `${tile.k}-${tile.n}`}
              tile={tile}
              selected={picked.includes(tile.id ?? '')}
              disabled={!myTurn && !mySwap}
              onClick={() => {
                if (myTurn) {
                  onMove({ type: 'discard', tileId: tile.id });
                  setPicked([]);
                  return;
                }
                if (!mySwap || !tile.id) return;
                setPicked((current) =>
                  current.includes(tile.id!) ? current.filter((id) => id !== tile.id) : [...current, tile.id!],
                );
                return;
              }}
            />
          ))}
          {myHand.length === 0 ? <p className="text-[11px] text-muted">کاشی‌ای در دست ندارید.</p> : null}
        </div>
        {drawn ? <p className="text-[10px] text-muted">کاشی تازه کشیده‌شده در دست شما هایلایت نشده؛ آخرین کاشی سمت راست است.</p> : null}
        {myTurn ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onMove({ type: 'win' })} className="min-h-11 rounded-full bg-brand-600 px-4 text-xs font-bold text-white">
              هو (خودکش)
            </button>
            {kongCandidate ? (
              <button
                type="button"
                onClick={() => onMove({ type: 'selfkong', suit: kongCandidate.k, num: kongCandidate.n })}
                className="min-h-11 rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
              >
                کنگ نهان
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="text-[10px] text-muted">با انتخاب هر کاشی در نوبت خودتان، همان کاشی دور انداخته می‌شود.</p>
      </section>
    </div>
  );
}
