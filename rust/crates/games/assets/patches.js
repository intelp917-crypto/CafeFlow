"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPatch = applyPatch;
/**
 * Local fixes and Persian content on top of a vendored module.
 *
 * The rules in `upstream/` stay untouched so they can be diffed against
 * GameNest. Only gaps that make a table stall, or content that would reach the
 * guest in Chinese, are handled here; every patch has a test in `test/`.
 */
function applyPatch(id, module) {
    if (id === 'twentyfour')
        return withTwentyFourRounds(module);
    if (id === 'truthdare')
        return withPersianTruthDare(module);
    if (id === 'undercover')
        return withPersianUndercover(module);
    if (id === 'quizrace')
        return withPersianQuiz(module);
    if (id === 'drawguess')
        return withPersianWords(module);
    if (id === 'monopoly')
        return withPersianMonopoly(module);
    return module;
}
/** Persian prompts for حقیقت یا جرئت. */
const TRUTH_CARDS = [
    'آخرین باری که از ته دل خندیدی کِی بود؟',
    'اگر امروز را می‌توانستی تکرار کنی، کدام لحظه را انتخاب می‌کردی؟',
    'یک چیز عجیب که در کودکی باور داشتی چیست؟',
    'آخرین محبت بی‌انتظاری که از کسی دیدی چه بود؟',
    'دوست داری دیگران بیشتر چه چیزی درباره‌ات بدانند؟',
    'اگر اسم بازیگوشی برای خودت انتخاب کنی، چه می‌شود؟',
    'کدام عادت کوچک خودت را بیشتر از همه دوست داری؟',
    'آخرین چیزی که یاد گرفتی و به کارت آمد چیست؟',
    'کدام آهنگ همیشه حالت را خوب می‌کند؟',
    'اگر یک روز مرخصی بی‌قید داشته باشی، چه می‌کنی؟',
    'دوست داری کدام شهر را برای یک سفر کوتاه ببینی؟',
    'یک تعریف که همیشه یادت مانده چه بود؟',
];
const DARE_CARDS = [
    'با سه حالت مختلف یک عکس سلفی بگیر و آخرین را نشان بده.',
    'یکی از بازیکنان را با لحن گزارشگر معرفی کن.',
    'یک نفر را انتخاب کن و ۱۵ ثانیه صادقانه تعریفش کن.',
    'ده ثانیه صدای یک حیوان را دربیاور.',
    'برای امشب یک عنوان یک‌خطی انتخاب کن.',
    'ژست «قهرمان» بگیر و ده ثانیه نگه دار.',
    'یک جمله را با لهجهٔ دلخواهت بگو.',
    'با نفر سمت راستت دست بده و یک اسم تیمی فریاد بزن.',
    'چشم‌بسته به کسی اشاره کن که به نظرت برندهٔ امشب است.',
    'هر بازیکن را با کمتر از پنج کلمه توصیف کن.',
    'یک حرکت ورزشی ساده انجام بده و بشمار.',
    'آخرین پیام غیرخصوصی‌ات را با هیجان بخوان.',
];
function withPersianTruthDare(module) {
    const init = module.initGame;
    return {
        ...module,
        initGame(state, players) {
            init?.(state, players);
            state.decks = {
                persian: {
                    name: 'فارسی',
                    nameEn: 'Persian',
                    truth: TRUTH_CARDS.map((text) => ({ text, textEn: text })),
                    dare: DARE_CARDS.map((text) => ({ text, textEn: text })),
                },
            };
            state.enabledDecks = ['persian'];
        },
    };
}
/** Persian civilian/undercover word pairs for آندرکاور. */
const UNDERCOVER_PAIRS = [
    ['قهوه', 'چای'],
    ['کیک', 'دسر'],
    ['گارسون', 'باریستا'],
    ['لیوان', 'فنجان'],
    ['منو', 'رسید'],
    ['میز', 'صندلی'],
    ['شیرینی', 'شکلات'],
    ['آب‌میوه', 'شربت'],
    ['صندوق', 'کارت‌خوان'],
    ['آشپزخانه', 'انبار'],
    ['اسپرسو', 'لاته'],
    ['بستنی', 'ژله'],
    ['پیتزا', 'ساندویچ'],
    ['سرویس', 'تحویل'],
    ['مشتری', 'میزبان'],
    ['نان', 'کلوچه'],
];
function withPersianUndercover(module) {
    const init = module.initGame;
    return {
        ...module,
        initGame(state, players) {
            init?.(state, players);
            const pair = UNDERCOVER_PAIRS[Math.floor(Math.random() * UNDERCOVER_PAIRS.length)];
            state.civWord = pair[0];
            state.ucWord = pair[1];
            state.words = state.roles.map((role) => role === 'civilian' ? pair[0] : role === 'undercover' ? pair[1] : '');
        },
    };
}
const QUIZ_QUESTIONS = [
    { q: 'قهوهٔ اسپرسو در اصل از کدام کشور می‌آید؟', opts: ['ایتالیا', 'فرانسه', 'ترکیه', 'برزیل'], answer: 0 },
    { q: 'کدام مادهٔ اصلی قهوه است؟', opts: ['کافئین', 'ویتامین C', 'پروتئین', 'فیبر'], answer: 0 },
    { q: 'لاته از چه چیزی تشکیل می‌شود؟', opts: ['اسپرسو و شیر', 'چای و شیر', 'آب و شکر', 'شکلات و خامه'], answer: 0 },
    { q: 'کاپوچینو نامش را از کجا گرفته است؟', opts: ['رنگ لباس راهبان', 'یک شهر ایتالیایی', 'نام یک گیاه', 'یک برند قهوه'], answer: 0 },
    { q: 'کدام دانه معمولاً تلخ‌تر است؟', opts: ['رست تیره', 'رست روشن', 'دانهٔ سبز', 'دانهٔ خام'], answer: 0 },
    { q: 'دم‌کردن قهوه با فشار بخار را چه می‌نامند؟', opts: ['اسپرسو', 'فرنچ پرس', 'کُلد برو', 'موکا'], answer: 0 },
    { q: 'شیر بخارداده‌شده برای لاته چه نام دارد؟', opts: ['میکروفوم', 'کرم', 'شیرعسل', 'ماست'], answer: 0 },
    { q: 'آمریکانو معمولاً چگونه ساخته می‌شود؟', opts: ['اسپرسو و آب گرم', 'شیر و شکر', 'چای و یخ', 'قهوه و خامه'], answer: 0 },
    { q: 'کدام کشور بیشترین تولید قهوه را دارد؟', opts: ['برزیل', 'ایتالیا', 'ژاپن', 'مصر'], answer: 0 },
    { q: 'کدام گزینه قهوهٔ سرد است؟', opts: ['کُلد برو', 'فلت وایت', 'موکا', 'ماکیاتو'], answer: 0 },
    { q: 'کدام شیرینی با قهوهٔ تلخ هماهنگ‌تر است؟', opts: ['شکلات تلخ', 'آب‌نبات', 'ماست', 'نان ساده'], answer: 0 },
    { q: 'دانهٔ قهوه در واقع چه چیزی است؟', opts: ['دانهٔ میوه', 'ریشهٔ گیاه', 'برگ خشک', 'گل خشک'], answer: 0 },
];
function withPersianQuiz(module) {
    const init = module.initGame;
    return {
        ...module,
        initGame(state, players) {
            init?.(state, players);
            const deck = QUIZ_QUESTIONS.map((question, index) => {
                const perm = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
                return {
                    id: `fa-${index}`,
                    cat: 'all',
                    diff: 2,
                    zh: { q: question.q, opts: perm.map((position) => question.opts[position]) },
                    en: { q: question.q, opts: perm.map((position) => question.opts[position]) },
                    answer: perm.indexOf(question.answer),
                };
            });
            state._deck = deck;
            state.totalQuestions = deck.length;
            state.questionCount = deck.length;
            state.phase = 'question';
            state.questionIndex = 0;
            state.currentQuestion = 1;
            const first = deck[0];
            state.questionId = first.id;
            state.questionCat = 'all';
            state.question = { id: first.id, cat: 'all', diff: 2, zh: first.zh, en: first.en };
            state.answer = first.answer;
            state.isDouble = false;
            state.questionStartedAt = Date.now();
            state.deadline = Date.now() + (state.timePerQuestion || 15) * 1000;
            state.choices = Array(players).fill(null);
            state.answered = Array(players).fill(false);
            state.answerTimesMs = Array(players).fill(null);
            state.roundPoints = Array(players).fill(0);
            state.streakBonuses = Array(players).fill(0);
            state._atQuestionStart = {
                streaks: state.streaks.slice(),
                scores: state.scores.slice(),
                correctCounts: state.correctCounts.slice(),
                ranking: [],
            };
        },
    };
}
/** Persian words for نقاشی و حدس. */
const DRAW_WORDS = [
    'قهوه',
    'فنجان',
    'کیک',
    'گربه',
    'خانه',
    'خورشید',
    'درخت',
    'ماشین',
    'کتاب',
    'ماهی',
    'گل',
    'ابر',
    'باران',
    'دوچرخه',
    'هواپیما',
    'ساعت',
    'کلید',
    'صندلی',
    'پیتزا',
    'بستنی',
    'ستاره',
    'قلب',
    'پل',
    'قطار',
    'چتر',
    'توپ',
    'میز',
    'شیر',
    'پروانه',
    'کوه',
];
function withPersianWords(module) {
    const init = module.initGame;
    return {
        ...module,
        initGame(state, players) {
            init?.(state, players);
            state._wordPool = [...DRAW_WORDS];
            state._usedWords = [];
            if (state.phase === 'choosing' && Array.isArray(state.wordOptions)) {
                state.wordOptions = [...DRAW_WORDS].sort(() => Math.random() - 0.5).slice(0, 3);
            }
        },
    };
}
/** تعداد دور برنده/مساوی را از تعداد دورهای برده‌شده حساب می‌کند. */
function pickMatchWinner(roundsWon) {
    const best = Math.max(...roundsWon, 0);
    const leaders = roundsWon.map((won, seat) => (won === best ? seat : -1)).filter((seat) => seat >= 0);
    return leaders.length === 1 ? leaders[0] : -1;
}
/**
 * «بیست‌وچهار» یک دور را با پاسخ درست تمام می‌کند ولی راهی برای دور بعد و
 * اعلام برندهٔ مسابقه ندارد. این وصله همان دو قدم را اضافه می‌کند.
 */
function withTwentyFourRounds(module) {
    const init = module.initGame;
    return {
        ...module,
        handleMove(data, state, seat) {
            if (state.phase === 'round_end' && data && data.action === 'next_round') {
                if (state.currentRound >= state.maxRounds) {
                    state.winner = pickMatchWinner(state.roundsWon ?? []);
                    state.phase = 'over';
                    return null;
                }
                const kept = {
                    roundsWon: state.roundsWon,
                    currentRound: state.currentRound,
                    maxRounds: state.maxRounds,
                    roundTime: state.roundTime,
                    _options: state._options,
                };
                state.phase = 'playing';
                state.currentRound = kept.currentRound + 1;
                state.roundWinner = null;
                state.roundsWon = kept.roundsWon;
                state.maxRounds = kept.maxRounds;
                state.roundTime = kept.roundTime;
                state._options = kept._options;
                init?.(state, kept.roundsWon.length);
                return null;
            }
            return module.handleMove(data, state, seat);
        },
    };
}
/** Persian names for the Monopoly-style board, by space index. */
const MP_NAMES = [
    'شروع',
    'خانهٔ ارزان',
    'شانس',
    'خیابان قدیم',
    'مالیات بر درآمد',
    'ایستگاه شمال',
    'خیابان شرقی',
    'بازدید زندان',
    'خیابان نانجینگ',
    'خیابان هوآی‌های',
    'شرکت برق',
    'معبد لونگهوا',
    'ایستگاه جنوب',
    'شینتی‌اندی',
    'پارکینگ رایگان',
    'ساحل باند',
    'باغ یو',
    'شانس',
    'معبد شهر',
    'میدان مردم',
    'ایستگاه غرب',
    'برو به زندان',
    'بندر جهانی',
    'ساحل شوهویی',
    'لوجیازوی',
    'ایستگاه شرق',
    'فرودگاه پودونگ',
    'دیزنی‌لند',
];
/** Persian chance cards, in the engine's original order. */
const MP_CHANCE = [
    'سود سهام بانک؛ ۵۰ سکه بگیرید.',
    'اظهارنامهٔ مالیاتی؛ ۱۰۰ سکه بپردازید.',
    'برندهٔ قرعه‌کشی شدید! ۲۰۰ سکه بگیرید.',
    'هزینهٔ تعمیر خانه؛ ۱۵۰ سکه بپردازید.',
    'تولدت مبارک! هر بازیکن ۵۰ سکه به شما می‌دهد.',
    'پرداخت بیمه؛ ۱۰۰ سکه بگیرید.',
    'جریمهٔ راهنمایی و رانندگی؛ ۵۰ سکه بپردازید.',
    'به خانهٔ شروع بروید و ۲۰۰ سکه بگیرید.',
    'مستقیم به زندان بروید!',
    'برگشت از سفر؛ ۱۰۰ سکه بگیرید.',
    'ترکیدگی لوله؛ ۸۰ سکه بپردازید.',
    'سود سرمایه‌گذاری؛ ۱۵۰ سکه بگیرید.',
    'شهریه؛ ۱۰۰ سکه بپردازید.',
    'کیفی پیدا کردید؛ ۵۰ سکه بگیرید.',
    'کمک خیریه؛ ۱۰۰ سکه بپردازید.',
    'بازار سهام اوج گرفت؛ ۲۵۰ سکه بگیرید.',
    'سه خانه جلو بروید.',
    'دو خانه عقب بروید.',
    'کارت معافیت از اجاره (نگه دارید).',
    'درآمد کسب‌وکار؛ ۱۰۰ سکه بگیرید.',
];
function withPersianMonopoly(module) {
    const init = module.initGame;
    return {
        ...module,
        initGame(state, players) {
            init?.(state, players);
            const board = state.board;
            if (Array.isArray(board)) {
                board.forEach((space, index) => {
                    const name = MP_NAMES[index];
                    if (name) {
                        space.name = name;
                        space.nameEn = name;
                    }
                });
            }
            const cards = state._chanceCards;
            if (Array.isArray(cards)) {
                cards.forEach((card, index) => {
                    const text = MP_CHANCE[index];
                    if (text) {
                        card.text = text;
                        card.textEn = text;
                    }
                });
            }
        },
    };
}
//# sourceMappingURL=patches.js.map