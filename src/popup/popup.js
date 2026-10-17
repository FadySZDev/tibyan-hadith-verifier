/**
 * Tibyan - Toolbar Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const hadithInput = document.getElementById('hadith-input');
  const verifyBtn = document.getElementById('verify-btn');
  const clearBtn = document.getElementById('clear-btn');
  const loadingState = document.getElementById('loading-state');
  const resultSection = document.getElementById('result-section');
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const sampleChips = document.querySelectorAll('.chip');

  // تحميل السجل عند فتح الـ Popup
  loadHistory();

  // فحص الحديث عند الضغط على زر التحقق
  verifyBtn.addEventListener('click', () => {
    executeVerification(hadithInput.value);
  });

  // دعم الضغط على Enter مع Ctrl أو Command
  hadithInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      executeVerification(hadithInput.value);
    }
  });

  // مسح حقل الإدخال والنتيجة
  clearBtn.addEventListener('click', () => {
    hadithInput.value = '';
    resultSection.classList.add('hidden');
    resultSection.innerHTML = '';
    hadithInput.focus();
  });

  // الضغط على النماذج الجاهزة
  sampleChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const sampleText = chip.getAttribute('data-sample');
      hadithInput.value = sampleText;
      executeVerification(sampleText);
    });
  });

  // مسح السجل
  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('هل أنت متأكد من رغبتك في مسح سجل الفحص السابق؟')) {
      chrome.runtime.sendMessage({ action: 'CLEAR_HISTORY' }, () => {
        loadHistory();
      });
    }
  });

  /**
   * تنفيذ التحقق وعرض النتائج
   */
  async function executeVerification(text) {
    if (!text || text.trim().length < 3) {
      alert('يرجى كتابة أو لصق جملة مفيدة من الحديث للتحقق منها.');
      hadithInput.focus();
      return;
    }

    // إظهار التحميل وإخفاء النتائج السابقة
    resultSection.classList.add('hidden');
    loadingState.classList.remove('hidden');
    verifyBtn.disabled = true;

    try {
      const result = await TibyanVerifierEngine.verifyHadith(text);
      loadingState.classList.add('hidden');
      renderResult(text, result);

      // حفظ النتيجة في الخلفية وتحديث السجل
      chrome.runtime.sendMessage({ action: 'VERIFY_HADITH', text: text }, () => {
        loadHistory();
      });
    } catch (err) {
      loadingState.classList.add('hidden');
      renderResult(text, {
        success: false,
        error: 'حدث خطأ غير متوقع أثناء الفحص: ' + err.message
      });
    } finally {
      verifyBtn.disabled = false;
    }
  }

  /**
   * عرض نتيجة الفحص في بطاقة الـ Popup
   */
  function renderResult(queryText, result) {
    resultSection.innerHTML = '';
    resultSection.classList.remove('hidden');

    const card = document.createElement('div');
    card.className = 'result-card';

    if (!result || !result.success) {
      card.innerHTML = `
        <div class="badge-row">
          <span class="grade-badge unknown">⚠️ ${escapeHtml(result.notFound ? 'غير موجود' : 'تنبيه')}</span>
        </div>
        <p style="font-size: 13px; color: #475569; margin-bottom: 10px;">
          ${escapeHtml(result.error || 'تعذر العثور على الحديث في الموسوعة.')}
        </p>
        <div class="card-actions">
          <a href="${result.dorarUrl || '#'}" target="_blank" rel="noopener" class="btn btn-ghost action-btn-dorar" style="width: 100%; text-align: center;">
            🔍 فتح البحث المباشر في الدرر السنية
          </a>
        </div>
      `;
    } else {
      const meta = result.statusMeta || { label: result.grade, icon: 'ℹ️' };
      const statusClass = result.status || 'unknown';

      card.innerHTML = `
        <div class="badge-row">
          <span class="grade-badge ${statusClass}">
            <span>${meta.icon}</span>
            <span>${escapeHtml(meta.label)}</span>
          </span>
          ${result.source === 'offline' ? '<span class="verified-source-tag">⚡ فحص فوري</span>' : ''}
        </div>

        <div class="card-hadith-text">
          «${escapeHtml(result.hadith || queryText)}»
        </div>

        <div class="meta-details">
          <div class="meta-item">
            <span class="meta-key">⚖️ الحكم:</span>
            <span class="meta-val" style="font-weight: 700;">${escapeHtml(result.grade || 'غير محدد')}</span>
          </div>
          ${result.rawi ? `
          <div class="meta-item">
            <span class="meta-key">👤 الراوي:</span>
            <span class="meta-val">${escapeHtml(result.rawi)}</span>
          </div>` : ''}
          ${result.mohadith ? `
          <div class="meta-item">
            <span class="meta-key">📖 المحدث:</span>
            <span class="meta-val">${escapeHtml(result.mohadith)}</span>
          </div>` : ''}
          ${result.book ? `
          <div class="meta-item">
            <span class="meta-key">📚 المصدر:</span>
            <span class="meta-val">${escapeHtml(result.book)} ${result.numberOrPage ? `(${escapeHtml(result.numberOrPage)})` : ''}</span>
          </div>` : ''}
        </div>

        ${result.explanation ? `
          <div class="card-explanation">
            <strong>💡 فائدة وتوضيح:</strong> ${escapeHtml(result.explanation)}
          </div>
        ` : ''}

        <div class="card-actions">
          <button class="btn btn-primary action-btn-copy" id="popup-copy-btn">
            📋 نسخ بطاقة الرد
          </button>
          <a href="${result.dorarUrl || '#'}" target="_blank" rel="noopener" class="btn btn-ghost action-btn-dorar">
            🔗 الدرر السنية
          </a>
        </div>
      `;

      // نسخ بطاقة الرد
      const copyBtn = card.querySelector('#popup-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const textCard = TibyanCardGenerator.generateTextCard(result);
          const ok = await TibyanCardGenerator.copyToClipboard(textCard);
          if (ok) {
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '✅ تم النسخ!';
            setTimeout(() => {
              copyBtn.innerHTML = originalText;
            }, 2000);
          }
        });
      }
    }

    resultSection.appendChild(card);
  }

  /**
   * تحميل وعرض سجل الفحص
   */
  function loadHistory() {
    chrome.runtime.sendMessage({ action: 'GET_HISTORY' }, (history) => {
      if (!Array.isArray(history) || history.length === 0) {
        historyList.innerHTML = '<div class="empty-history">لا توجد عمليات فحص سابقة حتى الآن.</div>';
        return;
      }

      historyList.innerHTML = '';
      history.slice(0, 8).forEach((item) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'history-item';

        const statusClass = item.status || 'unknown';
        const statusMeta = TibyanVerifierEngine.getStatusMetadata(statusClass);

        itemEl.innerHTML = `
          <div class="history-info">
            <div class="history-title">«${escapeHtml(item.query)}»</div>
            <div class="history-meta">
              ${escapeHtml(item.rawi ? `الراوي: ${item.rawi}` : '')} ${escapeHtml(item.mohadith ? `| المحدث: ${item.mohadith}` : '')}
            </div>
          </div>
          <span class="history-tag grade-badge ${statusClass}">
            ${statusMeta.icon} ${escapeHtml(item.grade || statusMeta.label)}
          </span>
        `;

        itemEl.addEventListener('click', () => {
          hadithInput.value = item.query;
          executeVerification(item.query);
        });

        historyList.appendChild(itemEl);
      });
    });
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
});
