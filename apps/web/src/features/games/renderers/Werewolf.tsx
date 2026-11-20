import type { GameRendererProps } from '../shared/GamePieces';
import { SeatList, Timer } from '../shared/GamePieces';
import { formatCountFa } from '../../../lib/format';

const ROLE_FA: Record<string, string> = {
  wolf: 'گرگ',
  seer: 'پیشگو',
  witch: 'جادوگر',
  hunter: 'شکارچی',
  idiot: 'ابله',
  villager: 'روستایی',
};

const PHASE_FA: Record<string, string> = {
  waiting: 'در انتظار شروع',
  night_wolf: 'شب — گرگ‌ها بیدارند',
  night_witch: 'شب — جادوگر',
  dawn: 'سپیده‌دم',
  sheriff_sign: 'انتخاب کلانتر',
  speech: 'صحبت‌ها',
  discuss: 'گفت‌وگوی آزاد',
  vote: 'رأی‌گیری',
  hunter: 'شکارچی',
  badge: 'تحویل نشان',
  over: 'پایان بازی',
};

/** Turns one engine log entry into the sentence a guest reads. */
function describeLog(entry: Record<string, any>, seats: GameRendererProps['seats']): string {
  const name = (index: unknown) => (typeof index === 'number' ? seats[index]?.nameFa ?? '' : '');
  switch (entry.t) {
    case 'night':
      return `شب ${formatCountFa(Number(entry.night ?? 0))} آغاز شد`;
    case 'deaths': {
      const list = (entry.list ?? []) as number[];
      return list.length > 0
        ? `قربانیان شب: ${list.map((seat) => name(seat)).join('، ')}`
        : 'شب بدون قتل گذشت';
    }
    case 'exile':
      return `${name(entry.who)} با رأی اخراج شد`;
    case 'sheriff':
      return `${name(entry.who)} کلانتر شد`;
    case 'no_sheriff':
      return 'کلانتر انتخاب نشد';
    case 'shot':
      return `${name(entry.by)} شلیک کرد و ${name(entry.who)} بیرون رفت`;
    case 'badge':
      return entry.who >= 0 ? `${name(entry.who)} نشان کلانتری را گرفت` : 'نشان کلانتری از بازی خارج شد';
    case 'idiot':
      return `${name(entry.who)} ابله بود و زنده ماند`;
    case 'dawn':
      return `روز ${formatCountFa(Number(entry.day ?? 0))} آغاز شد`;
    default:
      return '—';
  }
}

const CAUSE_FA: Record<string, string> = {
  knife: 'شب، چاقو',
  poison: 'شب، سم',
  exile: 'اخراج با رأی',
  shot: 'گلولهٔ شکارچی',
  dead: 'مرموز',
};

/**
 * گرگینه — one phone per seat, so the phone *is* the judge.
 *
 * Every action panel is gated by what the server says this seat may do: the view
 * carries only your own role, and other seats' roles arrive as `null`.
 */
export function Werewolf({ state, seats, mySeat, phase, canRestart, deadline, onMove, onRestart }: GameRendererProps) {
  const alive = (state.alive ?? []) as boolean[];
  const roles = (state.roles ?? []) as Array<string | null>;
  const myRole = (state.myRole as string | null) ?? null;
  const winner = state.winner as number | null;
  const currentPhase = (state.phase as string) ?? 'waiting';
  const actor = state.actor as number | undefined;
  const knife = (state.knife as number) ?? -1;
  const candidates = (state.voteCandidates ?? []) as number[];
  const voters = (state.voters ?? []) as number[];
  const speakers = (state.speakers ?? []) as number[];
  const speakerPos = (state.speakerPos as number) ?? 0;
  const myAlive = alive[mySeat] !== false;
  const isWolf = roles[mySeat] === 'wolf';
  const pendingWolves = isWolf && currentPhase === 'night_wolf';
  const canVote = currentPhase === 'vote' && voters.includes(mySeat) && (state.votes ?? {})[mySeat] === undefined;
  const mySpeech = currentPhase === 'speech' && speakers[speakerPos] === mySeat;
  const onlyAlive = seats.filter((seat) => alive[seat.index] !== false);
  const logLines = ((state.log ?? []) as Array<Record<string, any>>)
    .slice(-8)
    .map((entry) => describeLog(entry, seats));
  const voteCount = Object.keys((state.votes ?? {}) as Record<string, unknown>).length;

  const targetButtons = (list: typeof seats, action: (target: number) => void, includeSkip = true) => (
    <div className="flex flex-wrap gap-2">
      {list.map((seat) => (
        <button
          key={seat.index}
          type="button"
          onClick={() => action(seat.index)}
          className="min-h-11 rounded-full border border-line bg-surface px-4 text-[11px] font-semibold text-ink transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {seat.nameFa}
          {roles[seat.index] ? ` — ${ROLE_FA[roles[seat.index]!] ?? ''}` : ''}
        </button>
      ))}
      {includeSkip ? (
        <button
          type="button"
          onClick={() => action(-1)}
          className="min-h-11 rounded-full border border-dashed border-line px-4 text-[11px] text-muted"
        >
          هیچ‌کس
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-espresso/20 bg-espresso px-4 py-3 text-cream">
        <div>
          <p className="text-[10px] text-cream/60">مرحله</p>
          <p className="text-sm font-bold">{PHASE_FA[currentPhase] ?? currentPhase}</p>
        </div>
        <div className="flex items-center gap-2">
          <Timer deadline={deadline} />
          {myRole ? (
            <span className="rounded-full bg-cream/15 px-3 py-1 text-[11px]">
              نقش شما: <strong>{ROLE_FA[myRole] ?? myRole}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {!myAlive && phase === 'playing' ? (
        <p className="rounded-2xl border border-line/70 bg-surface px-4 py-3 text-[11px] text-muted">
          شما از بازی خارج شده‌اید؛ می‌توانید تماشا کنید.
        </p>
      ) : null}

      {phase === 'over' ? (
        <div className="rounded-[1.75rem] border border-brand-200 bg-surface p-5 text-center">
          <p className="text-[10px] text-brand-700">پایان بازی</p>
          <p className="mt-1 font-display text-xl font-bold text-ink">
            {winner === -2 ? 'گرگ‌ها بردند' : winner === -3 ? 'روستا برد' : 'بازی تمام شد'}
          </p>
          <ul className="mt-3 space-y-1 text-[11px] text-ink/80">
            {seats.map((seat) => (
              <li key={seat.index}>
                {seat.nameFa}: {ROLE_FA[roles[seat.index] ?? ''] ?? '—'} ({alive[seat.index] ? 'زنده' : 'خارج'})
              </li>
            ))}
          </ul>
          {canRestart ? (
            <button
              type="button"
              onClick={onRestart}
              className="mt-4 min-h-11 rounded-full bg-espresso px-5 text-xs font-semibold text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              بازی تازه
            </button>
          ) : (
            <p className="mt-3 text-[11px] text-muted">برای بازی بعدی، میزبان شروع می‌کند.</p>
          )}
        </div>
      ) : null}

      <section className="rounded-2xl border border-line/70 bg-surface p-4">
        <p className="mb-2 text-xs font-semibold text-ink">بازیکنان</p>
        <SeatList seats={onlyAlive} activeSeat={currentPhase === 'speech' ? speakers[speakerPos] ?? null : null} />
        <ul className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted">
          {seats
            .filter((seat) => alive[seat.index] === false)
            .map((seat) => (
              <li key={seat.index} className="rounded-full bg-canvas px-2.5 py-1 line-through">
                {seat.nameFa}
                {state.deathCause?.[seat.index] ? ` — ${CAUSE_FA[state.deathCause[seat.index]] ?? ''}` : ''}
              </li>
            ))}
        </ul>
      </section>

      {currentPhase === 'night_wolf' && myAlive ? (
        <section className="space-y-2 rounded-2xl border border-espresso/20 bg-[#241a16] p-4 text-cream">
          <p className="text-xs font-semibold">
            {isWolf ? 'یک قربانی برای امشب انتخاب کنید' : roles[mySeat] === 'seer' ? 'یک نفر را بررسی کنید' : 'چشم‌ها بسته…'}
          </p>
          {isWolf
            ? targetButtons(onlyAlive, (target) => onMove({ type: 'kill', target }))
            : roles[mySeat] === 'seer' && !state.seerDone
              ? targetButtons(
                  onlyAlive.filter((seat) => !seat.isYou),
                  (target) => onMove({ type: 'check', target }),
                )
              : null}
        </section>
      ) : null}

      {currentPhase === 'night_witch' && myAlive && myRole === 'witch' && !state.witchDone ? (
        <section className="space-y-3 rounded-2xl border border-espresso/20 bg-[#241a16] p-4 text-cream">
          <p className="text-xs font-semibold">شب جادوگر</p>
          {knife >= 0 ? (
            <button
              type="button"
              onClick={() => onMove({ type: 'witch', save: true })}
              className="min-h-11 rounded-full bg-cream/15 px-4 text-[11px] font-semibold"
            >
              نجات {seats[knife]?.nameFa ?? 'قربانی'}
            </button>
          ) : (
            <p className="text-[11px] text-cream/70">امشب کسی هدف نیست.</p>
          )}
          <div className="space-y-2">
            <p className="text-[11px] text-cream/70">یا با سم یکی را از بازی خارج کنید:</p>
            {targetButtons(
              onlyAlive.filter((seat) => !seat.isYou),
              (target) => onMove({ type: 'witch', poison: target }),
            )}
          </div>
          <button
            type="button"
            onClick={() => onMove({ type: 'witch' })}
            className="min-h-11 text-[11px] text-cream/70 underline-offset-4 hover:underline"
          >
            کاری نمی‌کنم
          </button>
        </section>
      ) : null}

      {currentPhase === 'sheriff_sign' && myAlive ? (
        <section className="flex flex-wrap gap-2 rounded-2xl border border-line/70 bg-surface p-4">
          <p className="w-full text-xs font-semibold text-ink">برای کلانتری نامزد می‌شوید؟</p>
          <button
            type="button"
            onClick={() => onMove({ type: 'run', run: true })}
            className="min-h-11 rounded-full bg-espresso px-4 text-[11px] font-semibold text-cream"
          >
            نامزد می‌شوم
          </button>
          <button
            type="button"
            onClick={() => onMove({ type: 'run', run: false })}
            className="min-h-11 rounded-full border border-line px-4 text-[11px] text-ink"
          >
            نه
          </button>
        </section>
      ) : null}

      {mySpeech ? (
        <button
          type="button"
          onClick={() => onMove({ type: 'end_speech' })}
          className="min-h-11 w-full rounded-full bg-espresso px-4 text-xs font-semibold text-cream"
        >
          صحبتم تمام شد
        </button>
      ) : null}

      {currentPhase === 'discuss' && myAlive && !(state.ready ?? {})[mySeat] ? (
        <button
          type="button"
          onClick={() => onMove({ type: 'ready' })}
          className="min-h-11 w-full rounded-full border border-line bg-surface px-4 text-xs font-semibold text-ink"
        >
          آمادهٔ رأی‌گیری هستم
        </button>
      ) : null}

      {canVote ? (
        <section className="space-y-2 rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs font-semibold text-ink">
            رأی شما به اخراج چه کسی است؟ ({formatCountFa(voteCount)} رأی ثبت شده)
          </p>
          {targetButtons(
            onlyAlive.filter((seat) => candidates.includes(seat.index) || candidates.length === 0),
            (target) => onMove({ type: 'vote', target }),
          )}
        </section>
      ) : null}

      {currentPhase === 'hunter' && (actor === mySeat || !myAlive) ? (
        <section className="space-y-2 rounded-2xl border border-line/70 bg-surface p-4">
          <p className="text-xs font-semibold text-ink">شکارچی می‌تواند یک نفر را با خود ببرد</p>
          {targetButtons(
            onlyAlive.filter((seat) => !seat.isYou),
            (target) => onMove({ type: 'shoot', target }),
          )}
        </section>
      ) : null}

      {currentPhase === 'badge' && actor === mySeat ? (
        <section className="space-y-2 rounded-2xl border border-line/70 bg-surface p-4">
          <p className="text-xs font-semibold text-ink">نشان کلانتری را به چه کسی می‌دهید؟</p>
          {targetButtons(
            onlyAlive.filter((seat) => !seat.isYou),
            (target) => onMove({ type: 'badge', target }),
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-line/70 bg-canvas/60 p-4">
        <p className="mb-2 text-xs font-semibold text-ink">رویدادها</p>
        <ol className="space-y-1 text-[11px] text-ink/80">
          {logLines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
          {logLines.length === 0 ? <li className="text-muted">هنوز رویدادی نیست.</li> : null}
        </ol>
      </section>
    </div>
  );
}
