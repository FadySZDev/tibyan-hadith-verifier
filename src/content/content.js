/**
 * Tibyan - Content Script
 * حقن واجهة الفحص السريعة والبطاقة العائمة داخل صفحات الويب
 */

(function () {
  'use strict';

  // منع الحقن المتعدد للسكربت في الصفحة الواحدة
  if (window.__tibyan_content_injected__) {
    return;
  }
  window.__tibyan_content_injected__ = true;

  let lastClickX = 0;
  let lastClickY = 0;
  let overlayContainer = null;
  let currentCard = null;

  // تسجيل موضع الماوس عند النقر بزر الفأرة الأيمن
  document.addEventListener('contextmenu', (e) => {
    lastClickX = e.clientX;
    lastClickY = e.clientY;
  }, true);

  /**
   * إنشاء حاوية التراكب الأساسية
   */
  function getOrCreateOverlay() {
    if (!overlayContainer || !document.body.contains(overlayContainer)) {
      overlayContainer = document.createElement('div');
      overlayContainer.id = 'tibyan-overlay-container';
      document.body.appendChild(overlayContainer);

      // إغلاق النافذة عند الضغط على مفتاح Escape
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') removeCard();
      });

      // إغلاق النافذة عند النقر خارجها
      document.addEventListener('mousedown', (e) => {
        if (currentCard && !currentCard.contains(e.target)) {
          removeCard();
        }
      });
    }
    return overlayContainer;
  }

  /**
   * إزالة البطاقة الحالية
   */
  function removeCard() {
    if (currentCard && currentCard.parentNode) {
      currentCard.parentNode.removeChild(currentCard);
      currentCard = null;
    }
  }

  /**
   * حساب الإحداثيات الذكية للبطاقة بالقرب من النص المحدد أو موقع النقر
   */
  function getOptimalCoordinates() {
    try {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.bottom > 0) {
          return {
            x: Math.max(15, rect.right - 380),
            y: rect.bottom + 10
          };
        }
      }
    } catch (e) {
      // ignore
    }

    if (lastClickX > 0 && lastClickY > 0) {
      return { x: lastClickX, y: lastClickY };
    }

    // موقع افتراضي وسطي ومريح للمستخدم
    return {
      x: Math.max(15, (window.innerWidth - 380) / 2),
      y: Math.max(30, window.innerHeight / 4)
    };
  }

  /**
   * حساب الإحداثيات الذكية للبطاقة حتى لا تخرج عن حدود الشاشة
   */
  function positionCard(card, x, y) {
    const coords = (x !== undefined && y !== undefined && x > 0 && y > 0)
      ? { x, y }
      : getOptimalCoordinates();

    const cardWidth = 380;
    const cardHeight = 340;
    const padding = 15;

    let posX = coords.x + 10;
    let posY = coords.y + 10;

    // التحقق من تجاوز الحافة اليسرى أو اليمنى
    if (posX + cardWidth > window.innerWidth - padding) {
      posX = window.innerWidth - cardWidth - padding;
    }
    if (posX < padding) posX = padding;

    // التحقق من تجاوز الحافة السفلية
    if (posY + cardHeight > window.innerHeight - padding) {
      posY = coords.y - cardHeight - 10;
      if (posY < padding) posY = padding;
    }

    card.style.left = `${posX}px`;
    card.style.top = `${posY}px`;
  }

  /**
   * إظهار مؤشر التحميل فور طلب الفحص
   */
  function showLoadingTooltip(queryText) {
    const overlay = getOrCreateOverlay();
    removeCard();

    const card = document.createElement('div');
    card.className = 'tibyan-card';
    card.innerHTML = `
      <div class="tibyan-card-header">
        <div class="tibyan-brand">
          <span class="tibyan-brand-icon">ت</span>
          <span>تبيان | التحقق من صحة الحديث</span>
        </div>
        <button class="tibyan-close-btn" title="إغلاق">✕</button>
      </div>
      <div class="tibyan-card-body">
        <div class="tibyan-loading-box">
          <div class="tibyan-spinner"></div>
          <div>جارٍ البحث والتوثيق من الموسوعة الحديثية...</div>
          <div style="font-size: 11.5px; color: #94a3b8; max-width: 280px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            «${escapeHtml(queryText)}»
          </div>
        </div>
      </div>
    `;

    positionCard(card);
    overlay.appendChild(card);
    currentCard = card;

    card.querySelector('.tibyan-close-btn').addEventListener('click', removeCard);
  }

  /**
   * عرض نتيجة الفحص الكاملة
   */
  function showResultTooltip(queryText, result) {
    const overlay = getOrCreateOverlay();
    removeCard();

    const card = document.createElement('div');
    card.className = 'tibyan-card';

    if (!result || !result.success) {
      // حالة الفشل أو عدم العثور على نتائج
      card.innerHTML = `
        <div class="tibyan-card-header">
          <div class="tibyan-brand">
            <span class="tibyan-brand-icon">ت</span>
            <span>تبيان | نتيجة الفحص</span>
          </div>
          <button class="tibyan-close-btn">✕</button>
        </div>
        <div class="tibyan-card-body">
          <div class="tibyan-badge-wrapper">
            <span class="tibyan-grade-badge unknown">⚠️ ${escapeHtml(result.notFound ? 'لم يُعثر على الحديث' : 'تنبيه')}</span>
          </div>
          <p style="font-size: 13px; color: #475569; margin-bottom: 12px;">
            ${escapeHtml(result.error || 'تعذر استخراج بيانات الحديث المحددة.')}
          </p>
          <div class="tibyan-hadith-text">
            «${escapeHtml(queryText)}»
          </div>
        </div>
        <div class="tibyan-card-footer">
          <a href="${result.dorarUrl || '#'}" target="_blank" rel="noopener noreferrer" class="tibyan-action-btn tibyan-btn-secondary">
            🔍 البحث يدوياً في الدرر
          </a>
          <button class="tibyan-action-btn tibyan-btn-primary tibyan-close-btn-action">حسناً</button>
        </div>
      `;
    } else {
      // حالة العثور على النتيجة بنجاح
      const meta = result.statusMeta || { label: result.grade, icon: 'ℹ️' };
      const statusClass = result.status || 'unknown';

      card.innerHTML = `
        <div class="tibyan-copy-toast" id="tibyan-toast">تم نسخ بطاقة التخريج بنجاح! 📋</div>
        <div class="tibyan-card-header">
          <div class="tibyan-brand">
            <span class="tibyan-brand-icon">ت</span>
            <span>تبيان | نتيجة التحقق</span>
          </div>
          <button class="tibyan-close-btn" title="إغلاق">✕</button>
        </div>
        <div class="tibyan-card-body">
          <div class="tibyan-badge-wrapper">
            <span class="tibyan-grade-badge ${statusClass}">
              <span>${meta.icon}</span>
              <span>${escapeHtml(meta.label)}</span>
            </span>
            ${result.source === 'offline' ? '<span style="font-size: 11px; color: #10b981; margin-right: 8px; font-weight: 600;">⚡ فحص فوري معتمد</span>' : ''}
          </div>

          <div class="tibyan-hadith-text">
            «${escapeHtml(result.hadith || queryText)}»
          </div>

          <div class="tibyan-meta-grid">
            <div class="tibyan-meta-row">
              <span class="tibyan-meta-label">⚖️ الحكم:</span>
              <span class="tibyan-meta-value" style="font-weight: 700;">${escapeHtml(result.grade || 'غير محدد')}</span>
            </div>
            ${result.rawi ? `
            <div class="tibyan-meta-row">
              <span class="tibyan-meta-label">👤 الراوي:</span>
              <span class="tibyan-meta-value">${escapeHtml(result.rawi)}</span>
            </div>` : ''}
            ${result.mohadith ? `
            <div class="tibyan-meta-row">
              <span class="tibyan-meta-label">📖 المحدث:</span>
              <span class="tibyan-meta-value">${escapeHtml(result.mohadith)}</span>
            </div>` : ''}
            ${result.book ? `
            <div class="tibyan-meta-row">
              <span class="tibyan-meta-label">📚 المصدر:</span>
              <span class="tibyan-meta-value">${escapeHtml(result.book)} ${result.numberOrPage ? `(${escapeHtml(result.numberOrPage)})` : ''}</span>
            </div>` : ''}
          </div>

          ${result.explanation ? `
            <div class="tibyan-explanation">
              <strong>💡 فائدة وتوضيح:</strong> ${escapeHtml(result.explanation)}
            </div>
          ` : ''}
        </div>

        <div class="tibyan-card-footer">
          <button class="tibyan-action-btn tibyan-btn-primary" id="tibyan-copy-card-btn">
            📋 نسخ بطاقة الرد
          </button>
          <a href="${result.dorarUrl || '#'}" target="_blank" rel="noopener noreferrer" class="tibyan-action-btn tibyan-btn-secondary" title="الانتقال للموسوعة الحديثية">
            🔗 فتح في الدرر
          </a>
        </div>
      `;
    }

    positionCard(card);
    overlay.appendChild(card);
    currentCard = card;

    // ربط الأحداث
    const closeBtns = card.querySelectorAll('.tibyan-close-btn, .tibyan-close-btn-action');
    closeBtns.forEach(btn => btn.addEventListener('click', removeCard));

    const copyBtn = card.querySelector('#tibyan-copy-card-btn');
    if (copyBtn && typeof TibyanCardGenerator !== 'undefined') {
      copyBtn.addEventListener('click', async () => {
        const textCard = TibyanCardGenerator.generateTextCard(result);
        const ok = await TibyanCardGenerator.copyToClipboard(textCard);
        if (ok) {
          const toast = card.querySelector('#tibyan-toast');
          if (toast) {
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
          }
        }
      });
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // الاستماع للأوامر من Background Service Worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
      sendResponse({ status: 'PONG' });
      return true;
    }

    if (request.action === 'SHOW_LOADING_TOOLTIP') {
      showLoadingTooltip(request.text);
      sendResponse({ status: 'loading_shown' });
      return true;
    }

    if (request.action === 'SHOW_RESULT_TOOLTIP') {
      showResultTooltip(request.queryText, request.result);
      sendResponse({ status: 'result_shown' });
      return true;
    }
  });

})();
