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

  // الرابط الرسمي للموسوعة الحديثية بموقع الدرر السنية
  const DORAR_API_URL = 'https://dorar.net/dorar_api.json?skey=';
  const DORAR_WEB_SEARCH = 'https://dorar.net/hadith/search?q=';
  const DEFAULT_API_BASE = DORAR_API_URL;

  /**
   * تفكيك واستخراج نتائج الأحاديث من رد الدرر السنية
   * @param {string} html 
   * @returns {Array<object>}
   */
  function parseDorarHtml(html) {
    if (!html || typeof html !== 'string') return [];
    const results = [];
    const regex = /<div class="hadith"[^>]*>([\s\S]*?)<\/div>\s*<div class="hadith-info">([\s\S]*?)<\/div>/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const rawHadith = match[1]
        .replace(/<[^>]+>/g, '')
        .replace(/^\s*\d+\s*-\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();

      const info = match[2];

      const getField = (label) => {
        const r = new RegExp('<span class="info-subtitle">' + label + ':</span>\\s*([^<]+)', 'i');
        const m = info.match(r);
        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
      };

      const gradeMatch = info.match(/<span class="info-subtitle">خلاصة حكم المحدث:<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i);
      const grade = gradeMatch ? gradeMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';

      if (rawHadith) {
        results.push({
          hadith: rawHadith,
          rawi: getField('الراوي'),
          mohadith: getField('المحدث'),
          book: getField('المصدر'),
          numberOrPage: getField('الصفحة أو الرقم'),
          grade: grade
        });
      }
    }

    return results;
  }

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
      let apiEndpoint = options.apiEndpoint;
      if (!apiEndpoint) {
        apiEndpoint = `${DORAR_API_URL}${encodeURIComponent(cleanQuery)}`;
      } else if (!apiEndpoint.includes('?') && !apiEndpoint.endsWith('=')) {
        apiEndpoint = `${apiEndpoint}?skey=${encodeURIComponent(cleanQuery)}`;
      } else if (apiEndpoint.endsWith('=')) {
        apiEndpoint = `${apiEndpoint}${encodeURIComponent(cleanQuery)}`;
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000); // مهلة 9 ثوانٍ

      const response = await fetch(apiEndpoint, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json, text/plain, */*'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`تعذر الوصول للخادم: رمز الرد ${response.status}`);
      }

      const data = await response.json();
      let items = [];

      // إذا كان الرد من واجهة الدرر المباشرة (dorar_api.json)
      if (data && data.ahadith && data.ahadith.result) {
        items = parseDorarHtml(data.ahadith.result);
      } else if (Array.isArray(data.data)) {
        // دعم التوافقية مع أي API وسيط يعيد data مصفوفة
        items = data.data;
      } else if (Array.isArray(data)) {
        items = data;
      }

      if (!Array.isArray(items) || items.length === 0) {
        return {
          success: false,
          notFound: true,
          query: cleanQuery,
          error: 'لم يتم العثور على هذا اللفظ في الموسوعة الحديثية. تأكد من تحديد الكلمات الأساسية لمتن الحديث.',
          dorarUrl: `${DORAR_WEB_SEARCH}${encodeURIComponent(cleanQuery)}`
        };
      }

      // إعطاء الأولوية للرواية الصحيحة في حال تعدد الروايات، وإلا أخذ النتيجة الأولى
      const top = items.find(i => classifyGrade(i.grade) === 'sahih') || items[0];
      const status = classifyGrade(top.grade);

      return {
        success: true,
        source: 'api',
        query: cleanQuery,
        hadith: top.hadith || cleanQuery,
        rawi: top.rawi || 'غير محدد',
        mohadith: top.mohadith || top.mohdith || 'غير محدد',
        book: top.book || 'غير محدد',
        numberOrPage: top.numberOrPage || '',
        grade: top.grade || 'لم يُذكر',
        status: status,
        statusMeta: getStatusMetadata(status),
        explanation: top.explanation || top.explainGrade || '',
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
    parseDorarHtml,
    DEFAULT_API_BASE,
    DORAR_API_URL,
    DORAR_WEB_SEARCH
  };
});
