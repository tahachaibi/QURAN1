# 1 — King Fahd Glorious Quran Printing Complex (the font)

**Channel:** `qurancomplex.gov.sa` → Contact / اتصل بنا. Take the address from
that page; do not use one from anywhere else.

**What is at stake:** the app sets the Quran text in KFGQPC Uthmanic Script
HAFS, which is what makes the page read as the printed mushaf rather than as a
web page. The licence in the font's own name table grants Use, Copy and
Distribute "Free of Cost" and forbids the font being Sold or Modified. The app
honours both — it is bundled whole and never subsetted — but "free of cost"
inside a distributed app, and especially one that might later charge for
unrelated features, is a question for them and not for us.

---

## English

> **Subject:** Permission to distribute KFGQPC Uthmanic Script HAFS inside a free Quran application
>
> Assalamu alaikum wa rahmatullahi wa barakatuh,
>
> I am developing a free Android application for reading and memorising the
> Quran. It sets the Quranic text in **KFGQPC Uthmanic Script HAFS**, downloaded
> from fonts.qurancomplex.gov.sa.
>
> I have read the licence in the font's name table, and the application follows
> it: the font file is bundled **whole and unmodified**, it is never subsetted,
> altered or converted, and the licence travels inside the file itself.
>
> I would be grateful for confirmation on two points:
>
> 1. May the font be included, unmodified, in an application distributed **free
>    of charge** through the Google Play Store?
> 2. If the application later offers a paid feature **unrelated to the font** —
>    a memorisation review schedule — does that affect the permission? The font
>    itself would never be sold, and the Quran text would remain free to every
>    user, paying or not.
>
> If attribution is required anywhere in the application, please tell me the
> exact wording you would like and I will add it.
>
> Thank you for making this typeface available, and for the work of the Complex.
>
> Jazakum Allahu khayran,
>
> [YOUR NAME]
> [YOUR EMAIL]

---

## العربية

> **الموضوع:** إذن باستخدام خط مجمع الملك فهد (عثماني حفص) داخل تطبيق قرآني مجاني
>
> السلام عليكم ورحمة الله وبركاته،
>
> أعمل على تطوير تطبيق مجاني لنظام أندرويد لقراءة القرآن الكريم وحفظه، ويستخدم
> التطبيق خط **KFGQPC Uthmanic Script HAFS** الذي حصلت عليه من موقع
> fonts.qurancomplex.gov.sa.
>
> وقد اطّلعت على نص الترخيص الموجود داخل ملف الخط، والتطبيق ملتزم به: يُضمَّن
> ملف الخط **كاملًا دون أي تعديل**، ولا يُجزّأ ولا يُحوَّل ولا يُغيَّر، ويبقى
> نص الترخيص داخل الملف نفسه.
>
> وأرجو التكرم بإفادتي في أمرين:
>
> ١. هل يجوز تضمين الخط، دون تعديل، في تطبيق يُوزَّع **مجانًا** عبر متجر Google
>    Play؟
> ٢. وإذا أضاف التطبيق لاحقًا ميزة مدفوعة **لا علاقة لها بالخط** — وهي جدولة
>    مراجعة الحفظ — فهل يؤثر ذلك في الإذن؟ علمًا أن الخط نفسه لا يُباع، وأن نص
>    القرآن الكريم يبقى متاحًا مجانًا لكل مستخدم، سواء اشترك أم لم يشترك.
>
> وإن كان هناك نص إسناد معيّن تودّون إظهاره داخل التطبيق، فأرجو تزويدي بصيغته
> بالضبط وسأضيفه.
>
> شكر الله لكم ما تقدمونه، وجزاكم الله خيرًا،
>
> [YOUR NAME]
> [YOUR EMAIL]

---

## If the answer is no, or never comes

`docs/fonts.md` already records the fallback: Amiri is bundled and already used
for Arabic UI that is not Quran text. Switching the ayah text to it is a
one-line change in `app/_layout.tsx`. The page stops looking like the printed
mushaf, which is a real loss and not a broken app.

Do **not** switch pre-emptively. The app complies with the licence as written
today; this letter is about being certain, not about doubting it.
