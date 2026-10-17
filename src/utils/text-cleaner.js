/**
 * Tibyan - Text Cleaner & Arabic Normalizer Utility
 * معالج ومنظف النصوص العربية لاستخراج الكلمات المفتاحية للبحث الحديثي
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TibyanTextCleaner = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // جدول التشكيل والعلامات العربية
  const TASHKEEL_REGEX = /[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED]/g;
  const TATWEEL_REGEX = /\u0640/g;
  
  // علامات الترقيم والأقواس الشائعة
  const PUNCTUATION_REGEX = /[«»""''()\[\]{}،؛؟:!.\-_/\\*~^#+=<>]/g;

  // الكلمات والعبارات التمهيدية الشائعة التي تسبق الأحاديث
  const PREFIX_PATTERNS = [
    /قال\s+رسول\s+الله\s+(صلى\s+الله\s+عليه\s+وسلم|ﷺ)/gi,
    /قال\s+النبي\s+(صلى\s+الله\s+عليه\s+وسلم|ﷺ)/gi,
    /عن\s+النبي\s+(صلى\s+الله\s+عليه\s+وسلم|ﷺ)(\s+قال)?/gi,
    /عن\s+رسول\s+الله\s+(صلى\s+الله\s+عليه\s+وسلم|ﷺ)(\s+قال)?/gi,
    /سمعت\s+رسول\s+الله\s+(صلى\s+الله\s+عليه\s+وسلم|ﷺ)(\s+يقول)?/gi,
    /أن\s+رسول\s+الله\s+(صلى\s+الله\s+عليه\s+وسلم|ﷺ)\s+قال/gi,
    /صلى\s+الله\s+عليه\s+وسلم/gi,
    /رضي\s+الله\s+عنه(ما|م|ا)?(\s+قال)?/gi,
    /رحمه\s+الله/gi,
    /عليه\s+السلام/gi,
    /ﷺ/g
  ];

  /**
   * إزالة التشكيل وعلامات الإعراب بالكامل
   * @param {string} text 
   * @returns {string}
   */
  function removeTashkeel(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(TASHKEEL_REGEX, '').replace(TATWEEL_REGEX, '');
  }

  /**
   * توحيد الحروف العربية المتشابهة (الهمزات، الياء، التاء المربوطة)
   * @param {string} text 
   * @returns {string}
   */
  function normalizeArabic(text) {
    if (!text) return '';
    let result = removeTashkeel(text);

    // توحيد الألفات
    result = result.replace(/[أإآٱ]/g, 'ا');
    
    // توحيد الياء والألف المقصورة
    result = result.replace(/ى/g, 'ي');

    // توحيد التاء المربوطة والهاء في أواخر الكلمات للبحث المتسامح
    result = result.replace(/ة/g, 'ه');

    // توحيد الهمزات المركبة
    result = result.replace(/[ؤئ]/g, 'ء');

    return result.trim();
  }

  /**
   * تنظيف النص المحدد من الويب وتحويله إلى استعلام بحث دقيق
   * @param {string} rawText 
   * @returns {{ cleanQuery: string, normalizedText: string }}
   */
  function prepareQuery(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { cleanQuery: '', normalizedText: '' };
    }

    let text = rawText.trim();

    // إزالة العبارات التمهيدية
    for (const pattern of PREFIX_PATTERNS) {
      text = text.replace(pattern, ' ');
    }

    // إزالة التشكيل
    text = removeTashkeel(text);

    // إزالة علامات الترقيم والأقواس
    text = text.replace(PUNCTUATION_REGEX, ' ');

    // إزالة الفراغات المزدوجة والأسطر الجديدة
    text = text.replace(/\s+/g, ' ').trim();

    // إزالة أي كلمة تمهيدية متبقية في بداية النص مثل "قال" أو "روي"
    text = text.replace(/^(قال|روي|روى|يقول|سمعت)\s+/gi, '').trim();

    // استخراج الكلمات الأساسية إذا كان النص طويلاً جداً
    // محركات البحث تفضل من 3 إلى 10 كلمات لتحديد الحديث بدقة
    const words = text.split(' ').filter(w => w.length > 1);
    let cleanQuery = text;

    if (words.length > 12) {
      // نأخذ أهم جملة (أول 8-10 كلمات من صلب المتن)
      cleanQuery = words.slice(0, 10).join(' ');
    }

    return {
      cleanQuery: cleanQuery,
      normalizedText: normalizeArabic(cleanQuery)
    };
  }

  /**
   * حساب نسبة التشابه بين نصين للتحقق من التطابق (Levenshtein-based similarity)
   * @param {string} s1 
   * @param {string} s2 
   * @returns {number} 0.0 إلى 1.0
   */
  function calculateSimilarity(s1, s2) {
    const norm1 = normalizeArabic(s1);
    const norm2 = normalizeArabic(s2);

    if (norm1 === norm2) return 1.0;
    if (!norm1 || !norm2) return 0.0;

    const len1 = norm1.length;
    const len2 = norm2.length;
    const maxLen = Math.max(len1, len2);
    if (maxLen === 0) return 1.0;

    // مصفوفة المسافات
    const matrix = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = norm1[i - 1] === norm2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // حذف
          matrix[i][j - 1] + 1,      // إضافة
          matrix[i - 1][j - 1] + cost // استبدال
        );
      }
    }

    const distance = matrix[len1][len2];
    return Math.max(0, (maxLen - distance) / maxLen);
  }

  return {
    removeTashkeel,
    normalizeArabic,
    prepareQuery,
    calculateSimilarity
  };
});
