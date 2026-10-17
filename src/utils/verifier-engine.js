/**
 * Tibyan - Verifier Engine
 * المحرك المركزي للتحقق من صحة الحديث وتصنيف الدرجات
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const cleaner = require('./text-cleaner');
    const offlineDB = require('./offline-dataset');
    module.exports = factory(cleaner, offlineDB);
  } else {
    root.TibyanVerifierEngine = factory(root.TibyanTextCleaner, root.TibyanOfflineDB);
  }
})(typeof self !== 'undefined' ? self : this, function (TextCleaner, OfflineDB) {
  'use strict';

  // الرابط الافتراضي للـ API (قابل للتخصيص من إعدادات الإضافة)
  const DEFAULT_API_BASE = 'https://dorar-hadith-api.hirenodes.com';
  const DORAR_WEB_SEARCH = 'https://dorar.net/hadith/search?q=';

  /**
   * تصنيف حكم المحدث إلى حالة لونية قياسية
   * @param {string} gradeText 
   * @returns {'sahih'|'daif'|'mawdoo'|'unknown'}
   */
  function classifyGrade(gradeText) {
    if (!gradeText || typeof gradeText !== 'string') return 'unknown';

    const normalized = TextCleaner.normalizeArabic(gradeText);

    // 1. الأحاديث الموضوعة والباطلة والمكذوبة (أحمر)
    if (
      normalized.includes('موضوع') ||
      normalized.includes('باطل') ||
      normalized.includes('مكذوب') ||
      normalized.includes('لا اصل له') ||
      normalized.includes('ليس بحديث') ||
      normalized.includes('كذب') ||
      normalized.includes('ساقط')
    ) {
      return 'mawdoo';
    }

    // 2. الأحاديث الضعيفة والمنكرة (برتقالي)
    if (
      normalized.includes('ضعيف') ||
      normalized.includes('منكر') ||
      normalized.includes('واه') ||
      normalized.includes('معلول') ||
      normalized.includes('فيه عله') ||
      normalized.includes('لا يصح') ||
      normalized.includes('مضطرب') ||
      normalized.includes('شاذ') ||
      normalized.includes('متروك')
    ) {
      return 'daif';
    }

    // 3. الأحاديث الصحيحة والحسنة (أخضر)
    if (
      normalized.includes('صحيح') ||
      normalized.includes('حسن') ||
      normalized.includes('ثابت') ||
      normalized.includes('اسناده جيد') ||
      normalized.includes('رجاله ثقات') ||
      normalized.includes('متفق عليه') ||
      normalized.includes('محفوظ')
    ) {
      return 'sahih';
    }

    return 'unknown';
  }

  /**
   * استخراج عنوان وصفي ولون للدرجة
   * @param {'sahih'|'daif'|'mawdoo'|'unknown'} status 
   * @returns {{ label: string, color: string, badgeBg: string }}
   */
  function getStatusMetadata(status) {
    switch (status) {
      case 'sahih':
        return {
          label: 'حديث صحيح / مقبول',
          color: '#10b981', // Emerald green
          badgeBg: 'rgba(16, 185, 129, 0.12)',
          icon: '✅'
        };
      case 'daif':
        return {
          label: 'حديث ضعيف',
          color: '#f59e0b', // Amber
          badgeBg: 'rgba(245, 158, 11, 0.12)',
          icon: '⚠️'
        };
      case 'mawdoo':
        return {
          label: 'موضوع / مكذوب / لا أصل له',
          color: '#ef4444', // Red
          badgeBg: 'rgba(239, 68, 68, 0.12)',
          icon: '❌'
        };
      default:
        return {
          label: 'غير محدد بدقة / راجع التخريج',
          color: '#6b7280', // Gray
          badgeBg: 'rgba(107, 114, 128, 0.12)',
          icon: 'ℹ️'
        };
    }
  }

  /**
   * التحقق من الحديث: يفحص القاعدة المحلية أولاً ثم الشبكة
   * @param {string} rawInput 
   * @param {object} options 
   * @returns {Promise<object>}
   */
  async function verifyHadith(rawInput, options = {}) {
    if (!rawInput || rawInput.trim().length < 3) {
      return {
        success: false,
        error: 'النص المحدد قصير جداً للتحقق منه. يرجى تحديد جملة أطول من الحديث.'
      };
    }

    const { cleanQuery, normalizedText } = TextCleaner.prepareQuery(rawInput);

    if (!cleanQuery || cleanQuery.length < 3) {
      return {
        success: false,
        error: 'لم نتمكن من استخراج كلمات بحث صالحة من النص المحدد.'
      };
    }

    // 1. الفحص الفوري في قاعدة البيانات المحلية (Offline Database)
    const offlineMatch = OfflineDB.findInOfflineDB(normalizedText);
    if (offlineMatch) {
      const status = offlineMatch.status || classifyGrade(offlineMatch.grade);
      return {
        success: true,
        source: 'offline',
        query: cleanQuery,
        hadith: offlineMatch.hadith,
        rawi: offlineMatch.rawi,
        mohadith: offlineMatch.mohadith,
        book: offlineMatch.book,
        grade: offlineMatch.grade,
        status: status,
        statusMeta: getStatusMetadata(status),
        explanation: offlineMatch.explanation || '',
        dorarUrl: offlineMatch.sourceUrl || `${DORAR_WEB_SEARCH}${encodeURIComponent(cleanQuery)}`
      };
    }

    // 2. البحث عبر واجهة الـ API للدرر السنية
    try {
      const apiEndpoint = options.apiEndpoint || `${DEFAULT_API_BASE}/hadith/search?value=${encodeURIComponent(cleanQuery)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // مهلة 8 ثوانٍ

      const response = await fetch(apiEndpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`تعذر الوصول للخادم: رمز الرد ${response.status}`);
      }

      const result = await response.json();
      const items = result.data || result;

      if (!Array.isArray(items) || items.length === 0) {
        return {
          success: false,
          notFound: true,
          query: cleanQuery,
          error: 'لم يتم العثور على هذا اللفظ في الموسوعة الحديثية. تأكد من تحديد الكلمات الأساسية لمتن الحديث.',
          dorarUrl: `${DORAR_WEB_SEARCH}${encodeURIComponent(cleanQuery)}`
        };
      }

      // أخذ أفضل نتيجة مطابقة
      const top = items[0];
      const status = classifyGrade(top.grade);

      return {
        success: true,
        source: 'api',
        query: cleanQuery,
        hadith: top.hadith || cleanQuery,
        rawi: top.rawi || 'غير محدد',
        mohadith: top.mohdith || top.mohadith || 'غير محدد',
        book: top.book || 'غير محدد',
        numberOrPage: top.numberOrPage || '',
        grade: top.grade || 'لم يُذكر',
        status: status,
        statusMeta: getStatusMetadata(status),
        explanation: top.explainGrade || '',
        takhrij: top.takhrij || '',
        dorarUrl: `${DORAR_WEB_SEARCH}${encodeURIComponent(cleanQuery)}`,
        totalResults: items.length
      };
    } catch (err) {
      // في حالة فشل الاتصال بالشبكة، نقدم رابط مباشر للدرر مع بيان تعذر الاتصال
      return {
        success: false,
        networkError: true,
        query: cleanQuery,
        error: 'تعذر الاتصال بقاعدة بيانات الموسوعة الحديثية حالياً (ربما بسبب انقطاع الإنترنت أو جدار الحماية).',
        dorarUrl: `${DORAR_WEB_SEARCH}${encodeURIComponent(cleanQuery)}`
      };
    }
  }

  return {
    classifyGrade,
    getStatusMetadata,
    verifyHadith,
    DEFAULT_API_BASE,
    DORAR_WEB_SEARCH
  };
});
