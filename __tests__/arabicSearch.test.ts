/**
 * Searching in Arabic the way Arabic is typed on a phone.
 *
 * The search boxes used to find only the exact spelling of the data. Nobody types
 * harakat, most people leave the hamza off its seat, many type "سورة" in front of
 * a surah's name, and an Arabic keyboard types ١٨ for 18. Every one of those found
 * nothing. And six surah names in the data were themselves misspelt, so even the
 * correct spelling found nothing for those.
 */
import { BUILTIN_RECITERS, searchReciters } from '../src/data/audio';
import { asciiDigits, foldArabic, foldedPattern } from '../src/data/fold';
import { searchSurahs, surahInfo, surahs } from '../src/data/quran';

const numbers = (query: string): number[] => searchSurahs(query).map((s) => s.number);

describe('surah names', () => {
  it('spells the hamza where the name has one, and not where it has none', () => {
    // hamzat al-qat'
    expect(surahInfo(14).name).toBe('إبراهيم');
    expect(surahInfo(76).name).toBe('الإنسان');
    // masdars of انفعل verbs begin with hamzat al-wasl
    expect(surahInfo(82).name).toBe('الانفطار');
    expect(surahInfo(84).name).toBe('الانشقاق');
    // standing alone, a final hamza after a fatha sits on alif
    expect(surahInfo(34).name).toBe('سبأ');
    expect(surahInfo(78).name).toBe('النبأ');
  });

  it('has no typos in the English', () => {
    expect(surahInfo(21).transliteration).toBe('Al-Anbiya');
    expect(surahInfo(86).translation).toBe('The Nightcomer');
    expect(surahInfo(107).translation).toBe('The Small Kindnesses');
  });

  it('changed names only, never the ayah text', () => {
    // the mushaf text is checked elsewhere; this pins that the name fix kept
    // the shape of the table it was made in
    expect(surahs).toHaveLength(114);
    expect(surahInfo(14).totalVerses).toBe(52);
    expect(surahInfo(78).totalVerses).toBe(40);
  });
});

describe('searchSurahs', () => {
  it('finds a name typed without its hamza, as phones type it', () => {
    expect(numbers('الاسراء')).toEqual([17]);
    expect(numbers('الانعام')).toEqual([6]);
    expect(numbers('اخلاص')).toEqual([112]);
    expect(numbers('الاعلى')).toEqual([87]);
    expect(numbers('ال عمران')).toEqual([3]);
  });

  it('finds the corrected names whichever way they are typed', () => {
    for (const query of ['إبراهيم', 'ابراهيم']) expect(numbers(query)).toEqual([14]);
    for (const query of ['الإنسان', 'الانسان']) expect(numbers(query)).toEqual([76]);
    for (const query of ['الانفطار', 'الإنفطار']) expect(numbers(query)).toEqual([82]);
    for (const query of ['النبأ', 'النبإ', 'النبا']) expect(numbers(query)).toEqual([78]);
    expect(numbers('سبأ')).toEqual([34]);
  });

  it('reads past "سورة" in front of a name, and ة typed as ه', () => {
    expect(numbers('سورة البقرة')).toEqual([2]);
    expect(numbers('سوره البقره')).toEqual([2]);
    expect(numbers('سُورَةُ الكَهْف')).toEqual([18]);
    expect(numbers('surah al-kahf')).toEqual([18]);
  });

  it('takes a number in either set of digits, and only that surah', () => {
    expect(numbers('18')).toEqual([18]);
    expect(numbers('١٨')).toEqual([18]);
    expect(numbers('۱۸')).toEqual([18]);
    expect(numbers('سورة ٢')).toEqual([2]);
    expect(numbers('2')).toEqual([2]);
  });

  it('still finds English names and meanings, without minding hyphens', () => {
    expect(numbers('al ikhlas')).toEqual([112]);
    expect(numbers('Al-Ikhlas')).toEqual([112]);
    expect(numbers('alikhlas')).toEqual([112]);
    expect(numbers('cow')).toEqual([2]);
    expect(numbers('THE COW')).toEqual([2]);
  });

  it('returns everything for an empty query, or for "surah" alone', () => {
    expect(searchSurahs('')).toHaveLength(114);
    expect(searchSurahs('   ')).toHaveLength(114);
    expect(searchSurahs('سورة')).toHaveLength(114);
  });

  it('returns nothing for something that is not there', () => {
    expect(numbers('zzzz')).toEqual([]);
    expect(numbers('115')).toEqual([]);
  });
});

describe('searchReciters', () => {
  it('finds an Arabic name typed without its hamza', () => {
    expect(searchReciters(BUILTIN_RECITERS, 'مصطفى اسماعيل').map((r) => r.id)).toEqual(['mostafa_ismaeel/']);
    expect(searchReciters(BUILTIN_RECITERS, 'عبد الله').length).toBe(2);
  });
});

describe('folding', () => {
  it('turns both sets of Arabic digits into ASCII and leaves the rest alone', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(asciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(asciiDigits('سورة 12')).toBe('سورة 12');
  });

  it('keeps Arabic-Indic digits through the fold', () => {
    // they sit just past the harakat, and a range one too wide deletes them
    expect(foldArabic('١٨')).toBe('١٨');
  });

  /**
   * The hadith search matches a pattern against the UNFOLDED text instead of
   * folding every narration. It is only an optimisation if it is the same
   * question, so it is asked both ways here.
   */
  const texts = [
    'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ',
    'قَالَ رَسُولُ اللَّهِ صلى الله عليه وسلم',
    'سَأَلَ رَجُلٌ عَنِ الصَّلَاةِ',
    'مُؤْمِنٌ وَمُؤْمِنَةٌ',
    'شَيْءٌ جَاءَ',
    'عَلَى الْمُصْطَفَى',
    'a.b (c) [d] ١٨',
  ];
  const needles = [
    'انما', 'الاعمال بالنيات', 'إنما', 'رسول الله', 'سال', 'سأل', 'الصلاه', 'الصلاة', 'مومن', 'مؤمنه',
    'شي', 'جا', 'علي', 'المصطفي', 'a.b', '(c)', '[d]', '١٨', 'zz', 'ه', 'ة',
  ];

  it('foldedPattern asks exactly what fold-and-includes asks', () => {
    for (const text of texts) {
      for (const needle of needles) {
        const pattern = foldedPattern(needle);
        const expected = foldArabic(text).includes(foldArabic(needle));
        expect([text, needle, pattern?.test(text) ?? false]).toEqual([text, needle, expected]);
      }
    }
  });

  it('has no pattern for a needle that folds to nothing', () => {
    expect(foldedPattern('')).toBeNull();
    expect(foldedPattern('ًٌٍ')).toBeNull();
  });
});
