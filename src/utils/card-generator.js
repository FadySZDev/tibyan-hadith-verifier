/**
 * Tibyan - Citation & Card Generator Utility
 * توليد نصوص وبطاقات التخريج الجاهزة للمشاركة السريعة على وسائل التواصل
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TibyanCardGenerator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * توليد نص أنيق ومنظم للرد أو المشاركة في التعليقات والتغريدات
   * @param {object} result بيانات فحص الحديث
   * @returns {string}
   */
  function generateTextCard(result) {
    if (!result) return '';

    const icon = result.statusMeta ? result.statusMeta.icon : 'ℹ️';
    const statusLabel = result.statusMeta ? result.statusMeta.label : (result.grade || 'غير محدد');

    let lines = [];
    lines.push(`🔍 فحص وتوثيق حديث نبوي عبر إضافة «تبيان»:`);
    lines.push(`----------------------------------`);
    lines.push(`📜 المتن: «${result.hadith || result.query}»`);
    lines.push(`${icon} الخلاصة: ${statusLabel}`);
    
    if (result.grade && result.grade !== statusLabel) {
      lines.push(`⚖️ حكم المحدث: ${result.grade}`);
    }

    if (result.rawi && result.rawi !== 'غير محدد') {
      lines.push(`👤 الراوي: ${result.rawi}`);
    }

    if (result.mohadith && result.mohadith !== 'غير محدد') {
      lines.push(`📖 المحدث: ${result.mohadith}`);
    }

    if (result.book && result.book !== 'غير محدد') {
      const pageInfo = result.numberOrPage ? ` (${result.numberOrPage})` : '';
      lines.push(`📚 المصدر: ${result.book}${pageInfo}`);
    }

    if (result.explanation) {
      lines.push(`💡 توضيح: ${result.explanation}`);
    }

    if (result.dorarUrl) {
      lines.push(`🔗 التخريج في الدرر السنية: ${result.dorarUrl}`);
    }

    lines.push(`----------------------------------`);
    lines.push(`✨ تم التوثيق بواسطة إضافة تبيان مفتوحة المصدر`);

    return lines.join('\n');
  }

  /**
   * نسخ النص إلى الحافظة
   * @param {string} text 
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // طريقة احتياطية للمتصفحات القديمة
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
      return false;
    }
  }

  /**
   * إنشاء رابط مشاركة مباشر لمنصات التواصل
   * @param {object} result 
   * @param {'whatsapp'|'twitter'|'telegram'} platform 
   * @returns {string}
   */
  function createShareUrl(result, platform) {
    const text = encodeURIComponent(generateTextCard(result));
    switch (platform) {
      case 'whatsapp':
        return `https://api.whatsapp.com/send?text=${text}`;
      case 'twitter':
        return `https://twitter.com/intent/tweet?text=${text}`;
      case 'telegram':
        return `https://t.me/share/url?url=${encodeURIComponent(result.dorarUrl || '')}&text=${text}`;
      default:
        return '';
    }
  }

  return {
    generateTextCard,
    copyToClipboard,
    createShareUrl
  };
});
