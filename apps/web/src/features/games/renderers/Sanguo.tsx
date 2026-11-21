import { useMemo, useState } from 'react';
import { Crosshair, Hand, Shield, Sparkles, Swords, Target, Timer as TimerIcon, UserRound, X } from 'lucide-react';
import { cn } from '@cafeflow/ui';
import { formatCountFa } from '../../../lib/format';
import type { GameRendererProps } from '../shared/GamePieces';
import { ResultOverlay, Timer, seatName } from '../shared/GamePieces';

interface Card {
  id: number;
  name: string;
  suit: string;
  rank: number;
}

interface Player {
  role: string | null;
  general: string;
  gender: string;
  kingdom: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  hand: Card[];
  handCount: number;
  equip: Record<string, Card | null>;
  judge: Card[];
}

interface Ask {
  type: string;
  to: number;
  need?: string;
  count?: number;
  reason?: string;
  optional?: boolean;
  target?: number;
  cards?: Card[];
  mode?: string;
  dying?: number;
}

const CARD_FA: Record<string, string> = {
  sha: 'حمله',
  shan: 'دفاع',
  tao: 'درمان',
  wuxie: 'باطل',
  guohe: 'پل را خراب کن',
  shunshou: 'دستبرد',
  wuzhong: 'هدیهٔ آسمان',
  juedou: 'دوئل',
  jiedao: 'تیراندازی',
  nanman: 'حملهٔ نانمان',
  wanjian: 'رگبار تیر',
  taoyuan: 'باغ هلو',
  wugu: 'پنج غله',
  lebu: 'زنجیر',
  shandian: 'صاعقه',
  zhuge: 'تیربار',
  qinggang: 'شمشیر آبی',
  cixiong: 'شمشیر خنجری',
  hanbing: 'شمشیر یخی',
  guanshi: 'تبر قاضی',
  qinglong: 'اژدهای سبز',
  zhangba: 'نیزهٔ ژانگ با',
  fangtian: 'هلال آسمانی',
  qilin: 'نیزهٔ قیلین',
  bagua: 'سپر باغوا',
  renwang: 'سپر شاهانه',
  jueying: 'اسب تیزپا',
  dilu: 'اسب دیلو',
  zhuahuang: 'اسب ارغوانی',
  chitu: 'اسب سرخ',
  dawan: 'اسب دوان',
  zixing: 'اسب زیسینگ',
};

const GENERAL_FA: Record<string, string> = {
  liubei: 'لیو بی',
  guanyu: 'گوان یو',
  zhangfei: 'ژانگ فی',
  caocao: 'سائو سائو',
  simayi: 'سیما یی',
  xiahoudun: 'شیا هو دون',
  sunquan: 'سون چوان',
  ganning: 'گان نینگ',
  lvmeng: 'لو منگ',
  lvbu: 'لو بو',
  huatuo: 'هوا تو',
  diaochan: 'دیائو چان',
};

const ROLE_FA: Record<string, string> = {
  lord: 'فرمانروا',
  loyal: 'وفادار',
  rebel: 'شورشی',
  spy: 'جاسوس',
};

const SUIT: Record<string, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };

const SKILLS: Record<string, { label: string; needsCards: number; targets: number }> = {
  rende: { label: 'بخشش', needsCards: 1, targets: 1 },
  zhiheng: { label: 'توازن', needsCards: 1, targets: 0 },
  qingnang: { label: 'درمانگری', needsCards: 1, targets: 1 },
  lijian: { label: 'دسیسه', needsCards: 1, targets: 2 },
};

function cardTone(name: string) {
  if (name === 'sha') return 'border-[#c98d7d] bg-[#f7e1d8] text-[#7c2d1d]';
  if (name === 'shan') return 'border-[#9bb3c4] bg-[#e4edf3] text-[#2e5468]';
  if (name === 'tao') return 'border-[#9cba9a] bg-[#e6f0e2] text-[#356039]';
  if (['guohe', 'shunshou', 'juedou', 'jiedao', 'nanman', 'wanjian', 'lebu', 'shandian'].includes(name))
    return 'border-[#c3a7b8] bg-[#f3e5ed] text-[#653247]';
  if (['wuzhong', 'taoyuan', 'wugu', 'wuxie'].includes(name)) return 'border-[#d6bd8c] bg-[#f7edd5] text-[#6f5318]';
  return 'border-[#b9ad9d] bg-[#eee7dc] text-[#4b3c2d]';
}

/**
 * سه پادشاهی — نقش پنهان و کارت‌های کلاسیک. صفحه همان چیزی را نشان می‌دهد که
 * موتور می‌پرسد (بازی، پاسخ، دور ریختن، انتخاب کارت) و جزئیات دست حریف را
 * پنهان نگه می‌دارد.
 */
export function Sanguo({ state, seats, mySeat, phase, canRestart, onMove, onRestart }: GameRendererProps) {
  const players = (state.players as Player[] | undefined) ?? [];
  const me = players[mySeat];
  const ask = (state.ask as Ask | null) ?? null;
  const winner = (state.winner as number | null) ?? null;
  const winners = (state.winners as number[] | undefined) ?? [];
  const log = (state.log as Array<Record<string, any>> | undefined) ?? [];
  const lord = (state.lord as number) ?? 0;
  const current = (state.current as number) ?? 0;

  const [selected, setSelected] = useState<number[]>([]);
  const [targets, setTargets] = useState<number[]>([]);
  const [skill, setSkill] = useState<string | null>(null);
  const [wuguPick, setWuguPick] = useState<number | null>(null);

  const myTurn = ask?.to === mySeat && winner === null && phase === 'playing';
  const hand = me?.hand ?? [];
  const selectableCount = ask?.type === 'discard' ? ask.count ?? 0 : 1;
  const skillDef = skill ? SKILLS[skill] : null;
  const needsTargets = skillDef
    ? skillDef.targets
    : ask?.type === 'play' && selected.length === 1
      ? (() => {
          const name = hand.find((card) => card.id === selected[0])?.name;
          if (!name) return 0;
          if (name === 'sha' || ['guohe', 'shunshou', 'juedou', 'lebu'].includes(name)) return 1;
          if (name === 'jiedao') return 2;
          return 0;
        })()
      : 0;

  const activeSkills = useMemo(() => {
    const general = me?.general ?? '';
    const map: Record<string, string[]> = {
      liubei: ['rende'],
      sunquan: ['zhiheng'],
      huatuo: ['qingnang'],
      diaochan: ['lijian'],
    };
    return map[general] ?? [];
  }, [me?.general]);

  const toggleCard = (id: number) => {
    if (!myTurn) return;
    setSelected((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (selectableCount <= 1) return [id];
      if (current.length >= selectableCount) return [...current.slice(1), id];
      return [...current, id];
    });
    setWuguPick(null);
  };

  const toggleTarget = (seat: number) => {
    if (!myTurn || needsTargets === 0) return;
    setTargets((current) => {
      if (current.includes(seat)) return current.filter((entry) => entry !== seat);
      if (needTwoTargets(skill, ask, hand, selected)) {
        const others = current.filter((entry) => entry !== seat);
        return [...others.slice(Math.max(0, others.length - 1)), seat];
      }
      return [seat];
    });
  };

  const reset = () => {
    setSelected([]);
    setTargets([]);
    setSkill(null);
    setWuguPick(null);
  };

  const submit = () => {
    if (!ask) return;
    if (ask.type === 'play') {
      if (skill) {
        onMove({ type: 'skill', skill, cardIds: selected, targets });
      } else if (selected.length > 0) {
        const name = hand.find((card) => card.id === selected[0])?.name;
        const selfOnly = name && ['tao', 'wuzhong', 'shandian'].includes(name);
        onMove({ type: 'use', cardIds: selected, targets: selfOnly ? [] : targets });
      }
    } else if (ask.type === 'discard') {
      onMove({ type: 'discard', cardIds: selected });
    } else if (ask.type === 'respond') {
      if (selected.length > 0) onMove({ type: 'respond', cardIds: selected });
      else onMove({ type: 'pass' });
    } else if (ask.type === 'wugu') {
      if (wuguPick !== null) onMove({ type: 'wugu', cardId: wuguPick });
    }
    reset();
  };

  const pass = () => {
    if (!ask) return;
    if (ask.type === 'play') onMove({ type: 'end' });
    else if (ask.type === 'discard' && ask.optional) onMove({ type: 'pass' });
    else if (ask.type === 'respond') onMove({ type: 'pass' });
    reset();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line/70 bg-surface px-4 py-2.5 text-[11px]">
        <p className="inline-flex items-center gap-1.5 text-ink">
          <Swords aria-hidden className="size-3.5 text-brand-600" />
          {winner !== null ? 'دست تمام شد' : myTurn ? 'نوبت شماست' : `منتظر ${seatName(seats, ask?.to ?? current)}`}
        </p>
        <div className="flex items-center gap-2">
          <Timer deadline={(state.ask?.deadline as number) ?? 0} />
          <span className="num text-[10px] text-muted">دستهٔ باقی‌مانده: {formatCountFa((state.deckCount as number) ?? 0)}</span>
        </div>
      </div>

      <ResultOverlay
        seats={seats}
        winner={winner !== null && winners.length === 1 ? winners[0]! : null}
        phase={phase}
        canRestart={canRestart}
        onRestart={onRestart}
        headline={
          winner === -2
            ? 'فرمانروا و وفاداران بردند'
            : winner === -3
              ? 'شورشی‌ها بردند'
              : winner === -4
                ? 'جاسوس تنها ماند و برد'
                : undefined
        }
      >
        {winner !== null ? (
          <p className="mt-1 text-[11px] text-muted">
            برندگان: {winners.map((seat) => seatName(seats, seat)).join(' · ')}
          </p>
        ) : null}
      </ResultOverlay>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {seats.map((seat) => {
          const player = players[seat.index];
          if (!player) return null;
          const isTarget = targets.includes(seat.index);
          const targetable = myTurn && needsTargets > 0 && seat.index !== mySeat && player.alive;
          return (
            <li key={seat.index}>
              <button
                type="button"
                onClick={() => toggleTarget(seat.index)}
                disabled={!targetable}
                aria-pressed={isTarget}
                className={cn(
                  'w-full rounded-2xl border px-3 py-2 text-right transition-colors',
                  !player.alive
                    ? 'border-line/50 bg-canvas/40 opacity-55'
                    : isTarget
                      ? 'border-brand-500 bg-brand-50'
                      : seat.index === lord
                        ? 'border-[#c9a24a]/60 bg-[#fbf4e0]'
                        : 'border-line/70 bg-surface',
                  targetable && 'hover:border-brand-300',
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-ink">
                    {seat.index === lord ? <Sparkles aria-hidden className="size-3 text-[#a07a2e]" /> : <UserRound aria-hidden className="size-3 text-muted" />}
                    <span className="truncate">{seat.nameFa}</span>
                  </span>
                  <span className="num shrink-0 text-[9px] text-muted">{formatCountFa(player.handCount)} کارت</span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-muted">
                  <span>
                    {GENERAL_FA[player.general] ?? player.general}
                    {player.role ? ` · ${ROLE_FA[player.role] ?? player.role}` : ''}
                  </span>
                  <span className="num text-[#a34c25]">
                    {'♥'.repeat(Math.max(0, player.hp))}
                    <span className="text-line">{'♡'.repeat(Math.max(0, player.maxHp - player.hp))}</span>
                  </span>
                </span>
                {!player.alive ? <span className="text-[8px] text-danger-600">حذف شده</span> : null}
                {isTarget ? <span className="mt-0.5 block text-[8px] text-brand-700">هدف انتخاب شد</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {myTurn ? (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-3">
          <p className="flex items-start gap-1.5 text-[11px] font-semibold text-brand-900">
            <Crosshair aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {askInstruction(ask, seats)}
          </p>

          {ask?.type === 'play' && activeSkills.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeSkills.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSkill(skill === id ? null : id);
                    setSelected([]);
                    setTargets([]);
                  }}
                  aria-pressed={skill === id}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-[10px] font-bold',
                    skill === id ? 'bg-brand-600 text-white' : 'border border-brand-300 bg-surface text-brand-800',
                  )}
                >
                  <Sparkles aria-hidden className="size-3" />
                  {SKILLS[id]?.label ?? id}
                </button>
              ))}
            </div>
          ) : null}

          {skillDef ? (
            <p className="mt-1.5 text-[10px] text-brand-800">
              {formatCountFa(skillDef.needsCards)} کارت انتخاب کنید
              {skillDef.targets ? ` و ${formatCountFa(skillDef.targets)} بازیکن را هدف بگیرید.` : '.'}
            </p>
          ) : needsTargets > 0 ? (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-brand-800">
              <Target aria-hidden className="size-3" />
              {targets.length < needsTargets ? `${formatCountFa(needsTargets - targets.length)} هدف دیگر انتخاب کنید.` : 'هدف‌ها انتخاب شدند.'}
            </p>
          ) : null}

          {ask?.type === 'pick' && ask.target !== undefined ? (
            <PickPanel
              target={ask.target}
              seats={seats}
              player={players[ask.target]}
              onPick={(zone, cardId) => {
                onMove({ zone, cardId });
                reset();
              }}
            />
          ) : null}

          {ask?.type === 'confirm' ? (
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => onMove({ type: 'confirm', yes: true })} className="min-h-10 flex-1 rounded-full bg-brand-600 text-[11px] font-bold text-white">
                بله
              </button>
              <button type="button" onClick={() => onMove({ type: 'confirm', yes: false })} className="min-h-10 flex-1 rounded-full border border-line bg-surface text-[11px] font-semibold">
                نه
              </button>
            </div>
          ) : null}

          {ask?.type === 'wugu' ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(ask.cards ?? []).map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setWuguPick(card.id)}
                  aria-pressed={wuguPick === card.id}
                  className={cn('min-h-10 rounded-full border px-3 text-[10px] font-semibold', wuguPick === card.id ? 'border-brand-500 bg-brand-600 text-white' : 'border-line bg-surface text-ink')}
                >
                  {CARD_FA[card.name] ?? card.name}
                </button>
              ))}
            </div>
          ) : null}

          {ask && !['pick', 'confirm', 'wugu'].includes(ask.type) ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] text-brand-800">
                {selected.length > 0 ? `${formatCountFa(selected.length)} کارت انتخاب شد` : 'کارتی انتخاب نشده'}
              </p>
              <div className="flex flex-wrap gap-2">
                {ask.type === 'respond' || (ask.type === 'discard' && ask.optional) || ask.type === 'play' ? (
                  <button type="button" onClick={pass} className="min-h-10 rounded-full px-3 text-[10px] text-muted">
                    {ask.type === 'play' ? 'پایان نوبت' : 'رد کردن'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={submit}
                  disabled={
                    (ask.type === 'respond' && selected.length === 0) ||
                    (ask.type === 'discard' && selected.length !== (ask.count ?? 0)) ||
                    (ask.type === 'play' && (selected.length === 0 || targets.length < needsTargets))
                  }
                  className="min-h-10 rounded-full bg-brand-600 px-4 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  {ask.type === 'respond' ? 'پاسخ با این کارت' : ask.type === 'discard' ? 'دور بریز' : skill ? 'اجرای مهارت' : 'بازی کن'}
                </button>
              </div>
            </div>
          ) : null}

          {ask?.type === 'wugu' ? (
            <button
              type="button"
              onClick={submit}
              disabled={wuguPick === null}
              className="mt-2 min-h-10 rounded-full bg-brand-600 px-4 text-[11px] font-bold text-white disabled:opacity-40"
            >
              بردار
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-line/70 bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="inline-flex items-center gap-1 text-[10px] text-muted">
            <Hand aria-hidden className="size-3.5" />
            دست شما
          </p>
          <p className="num text-[9px] text-muted">
            {me ? `${formatCountFa(me.hp)} از ${formatCountFa(me.maxHp)} جان` : ''}
          </p>
        </div>

        {hand.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted">دست شما خالی است.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {hand.map((card) => (
              <CardButton
                key={card.id}
                card={card}
                selected={selected.includes(card.id) || wuguPick === card.id}
                disabled={!myTurn || ask?.type === 'pick' || ask?.type === 'confirm'}
                onClick={() => toggleCard(card.id)}
              />
            ))}
          </div>
        )}

        {me ? (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/60 pt-2 text-[9px] text-muted">
            {Object.entries(me.equip ?? {}).map(([slot, card]) =>
              card ? (
                <span key={slot} className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1">
                  <Shield aria-hidden className="size-3" />
                  {CARD_FA[card.name] ?? card.name}
                </span>
              ) : null,
            )}
            {(me.judge ?? []).map((card) => (
              <span key={card.id} className="inline-flex items-center gap-1 rounded-full bg-[#f0e2ec] px-2 py-1">
                <TimerIcon aria-hidden className="size-3" />
                {CARD_FA[card.name] ?? card.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-line/70 bg-surface px-4 py-3">
        <p className="mb-1.5 text-[10px] text-muted">رویدادهای میز</p>
        <ul className="space-y-1">
          {log.slice(-6).reverse().map((entry, index) => (
            <li key={`${entry.t}-${index}`} className="text-[10px] leading-5 text-ink/70">
              {LOG_FA(entry, seats)}
            </li>
          ))}
          {log.length === 0 ? <li className="text-[10px] text-muted">هنوز کاری انجام نشده است.</li> : null}
        </ul>
      </div>
    </div>
  );
}

function needTwoTargets(skill: string | null, ask: Ask | null, hand: Card[], selected: number[]): boolean {
  if (skill === 'lijian') return true;
  if (ask?.type !== 'play' || selected.length !== 1) return false;
  return hand.find((card) => card.id === selected[0])?.name === 'jiedao';
}

function askInstruction(ask: Ask | null, seats: GameRendererProps['seats']): string {
  if (!ask) return 'در انتظار…';
  if (ask.type === 'play') return 'کارت بازی کنید یا نوبت را تمام کنید.';
  if (ask.type === 'respond') return `برای پاسخ، کارت «${CARD_FA[ask.need ?? 'any'] ?? 'مناسب'}» بازی کنید یا رد کنید.`;
  if (ask.type === 'discard') return `${formatCountFa(ask.count ?? 0)} کارت برای دور ریختن انتخاب کنید.`;
  if (ask.type === 'pick') return `از ${seatName(seats, ask.target)} یک کارت بردارید.`;
  if (ask.type === 'confirm') return 'این تصمیم را تأیید می‌کنید؟';
  if (ask.type === 'wugu') return 'از کارت‌های پنج غله یکی را بردارید.';
  return 'در انتظار تصمیم شما.';
}

function CardButton({ card, selected, disabled, onClick }: { card: Card; selected: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'flex min-h-14 w-16 shrink-0 flex-col items-start justify-between rounded-xl border p-1.5 text-right shadow-sm transition-transform disabled:opacity-60',
        cardTone(card.name),
        selected && 'ring-2 ring-brand-500 ring-offset-1',
        !disabled && 'hover:-translate-y-0.5',
      )}
    >
      <span className="flex w-full items-center justify-between text-[9px] opacity-80">
        <span>{SUIT[card.suit] ?? card.suit}</span>
        <span className="num">{formatCountFa(card.rank)}</span>
      </span>
      <span className="text-[9px] font-bold leading-3">{CARD_FA[card.name] ?? card.name}</span>
    </button>
  );
}

function PickPanel({
  target,
  player,
  seats,
  onPick,
}: {
  target: number;
  player: Player | undefined;
  seats: GameRendererProps['seats'];
  onPick: (zone: 'hand' | 'table', cardId?: number) => void;
}) {
  const tableCards = player ? [...Object.values(player.equip ?? {}), ...(player.judge ?? [])].filter(Boolean) as Card[] : [];
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-brand-200 bg-surface/70 p-2">
      <p className="text-[10px] text-brand-800">از {seatName(seats, target)}:</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onPick('hand')}
          disabled={(player?.handCount ?? 0) === 0}
          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[10px] font-semibold disabled:opacity-40"
        >
          <Hand aria-hidden className="size-3" />
          یک کارت از دست ({formatCountFa(player?.handCount ?? 0)})
        </button>
        {tableCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onPick('table', card.id)}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[10px]"
          >
            <X aria-hidden className="size-3" />
            {CARD_FA[card.name] ?? card.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function LOG_FA(entry: Record<string, any>, seats: GameRendererProps['seats']): string {
  const who = (seat?: number) => (seat === undefined ? '' : seatName(seats, seat));
  if (entry.t === 'turn') return `نوبت ${who(entry.p)} شروع شد.`;
  if (entry.t === 'use') return `${who(entry.p)} از «${CARD_FA[entry.name] ?? entry.name}» استفاده کرد.`;
  if (entry.t === 'damage') return `${who(entry.p)} ${formatCountFa(entry.n)} آسیب گرفت.`;
  if (entry.t === 'death') return `${who(entry.p)} از بازی خارج شد (${ROLE_FA[entry.role] ?? entry.role}).`;
  if (entry.t === 'discard') return `${who(entry.p)} ${formatCountFa((entry.cards ?? []).length)} کارت دور ریخت.`;
  if (entry.t === 'respond') return `${who(entry.p)} با «${CARD_FA[entry.name] ?? entry.name}» پاسخ داد.`;
  if (entry.t === 'dodged') return `${who(entry.p)} حمله را دفع کرد.`;
  if (entry.t === 'wuxie') return `${who(entry.p)} کارت باطل بازی کرد.`;
  if (entry.t === 'judge') return `قضاوت برای ${who(entry.p)} انجام شد.`;
  if (entry.t === 'skill') return `${who(entry.p)} از مهارت «${entry.skill}» استفاده کرد.`;
  if (entry.t === 'save') return `${who(entry.p)} ${who(entry.who)} را نجات داد.`;
  if (entry.t === 'dying') return `${who(entry.p)} در آستانهٔ حذف است.`;
  if (entry.t === 'over') return 'دست تمام شد.';
  return 'رویدادی روی میز.';
}
