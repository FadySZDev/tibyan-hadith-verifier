/**
 * Tibyan - Background Service Worker (Manifest V3)
 * إدارة القوائم السياقية (Context Menus)، والاتصال بالـ API، وتخزين السجل
 */

// استيراد الأدوات المساعدة داخل الـ Service Worker
importScripts(
  '../utils/text-cleaner.js',
  '../utils/offline-dataset.js',
  '../utils/verifier-engine.js'
);

const CONTEXT_MENU_ID = 'tibyan-verify-selection';

// تهيئة الإضافة عند التثبيت
chrome.runtime.onInstalled.addListener(async () => {
  // إنشاء عنصر القائمة السياقية عند تحديد أي نص
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '🔍 تحقق من صحة الحديث عبر «تبيان»',
    contexts: ['selection']
  });

  // تهيئة الإعدادات الأولية
  const settings = await chrome.storage.local.get(['apiEndpoint', 'history', 'autoLookup']);
  if (!settings.apiEndpoint) {
    await chrome.storage.local.set({
      apiEndpoint: TibyanVerifierEngine.DEFAULT_API_BASE,
      history: [],
      autoLookup: true
    });
  }
  console.log('Tibyan Hadith Verifier initialized successfully.');
});

// الاستماع لنقر القائمة السياقية (زر الماوس الأيمن)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && info.selectionText) {
    const selectedText = info.selectionText.trim();
    if (!tab || !tab.id) return;

    // 1. إشعار الـ Content Script ببدء الفحص لإظهار مؤشر تحميل فوري
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'SHOW_LOADING_TOOLTIP',
        text: selectedText
      });
    } catch (e) {
      // قد لا يكون الـ Content script محملاً بعد في بعض الصفحات الخاصة
      console.warn('Content script not ready, injecting if possible:', e);
    }

    // 2. فحص الحديث
    const result = await TibyanVerifierEngine.verifyHadith(selectedText);

    // 3. حفظ النتيجة في سجل الفحص
    await saveToHistory(selectedText, result);

    // 4. إرسال النتيجة إلى الـ Content Script لعرضها في البطاقة العائمة
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'SHOW_RESULT_TOOLTIP',
        queryText: selectedText,
        result: result
      });
    } catch (err) {
      console.error('Error sending verification result to tab:', err);
    }
  }
});

// الاستماع للرسائل القادمة من الـ Popup أو الـ Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'VERIFY_HADITH') {
    TibyanVerifierEngine.verifyHadith(message.text)
      .then(async (result) => {
        await saveToHistory(message.text, result);
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // إشارة لإرسال الرد بشكل غير متزامن (asynchronous)
  }

  if (message.action === 'GET_HISTORY') {
    chrome.storage.local.get(['history']).then((res) => {
      sendResponse(res.history || []);
    });
    return true;
  }

  if (message.action === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ history: [] }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

/**
 * حفظ الحديث في السجل المحلي (مع حد أقصى 50 عنصراً)
 */
async function saveToHistory(queryText, result) {
  try {
    const store = await chrome.storage.local.get(['history']);
    let history = store.history || [];

    const entry = {
      id: Date.now(),
      query: queryText.substring(0, 100),
      timestamp: new Date().toISOString(),
      success: result.success,
      grade: result.grade || 'غير محدد',
      status: result.status || 'unknown',
      hadith: result.hadith ? result.hadith.substring(0, 120) : queryText.substring(0, 120),
      rawi: result.rawi || '',
      book: result.book || '',
      mohadith: result.mohadith || ''
    };

    // منع التكرار وتحديث الأولويات
    history = history.filter(h => h.query !== entry.query);
    history.unshift(entry);

    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await chrome.storage.local.set({ history });
  } catch (err) {
    console.error('Failed to save to history:', err);
  }
}
