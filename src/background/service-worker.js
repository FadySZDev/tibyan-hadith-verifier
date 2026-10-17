/**
 * Tibyan - Background Service Worker (Manifest V3)
 * إدارة القوائم السياقية (Context Menus)، والاتصال بالـ API، وتخزين السجل، وحقن السكربتات التفاعلية
 */

// استيراد الأدوات المساعدة داخل الـ Service Worker
importScripts(
  '../utils/text-cleaner.js',
  '../utils/offline-dataset.js',
  '../utils/verifier-engine.js'
);

const CONTEXT_MENU_ID = 'tibyan-verify-selection';

/**
 * فحص ما إذا كان الرابط من الروابط المحمية التي يمنع المتصفح حقن السكربتات فيها
 */
function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:') ||
    url.includes('chromewebstore.google.com')
  );
}

/**
 * التأكد من أن الـ Content Script والأنماط محقونة في التبويب وجاهزة للتفاعل
 */
async function ensureContentScriptReady(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    if (res && res.status === 'PONG') {
      return true;
    }
  } catch (err) {
    // السكربت غير محقون بعد في هذا التبويب
  }

  // حقن السكربت والـ CSS برمجياً (مهم جداً للتبويبات التي كانت مفتوحة قبل تثبيت/تحديث الإضافة)
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['src/content/content.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'src/utils/text-cleaner.js',
        'src/utils/offline-dataset.js',
        'src/utils/verifier-engine.js',
        'src/utils/card-generator.js',
        'src/content/content.js'
      ]
    });

    // مهلة قصيرة للتأكد من اكتمال تسجيل مستمعي الأحداث
    await new Promise((resolve) => setTimeout(resolve, 80));
    return true;
  } catch (injectErr) {
    return false;
  }
}

/**
 * إظهار إشعار سطح المكتب في حالة الصفحات المحمية أو تعذر عرض البطاقة في الصفحة
 */
function showDesktopNotification(result, selectedText) {
  if (!chrome.notifications) return;

  const iconUrl = chrome.runtime.getURL('icons/icon128.png');
  let title = 'تبيان | التحقق من صحة الحديث';
  let message = '';

  if (result && result.success) {
    const statusLabel = result.statusMeta ? result.statusMeta.label : result.grade;
    title = `تبيان | ${statusLabel}`;
    message = `«${result.hadith || selectedText}»\nالحكم: ${result.grade}\nالراوي: ${result.rawi || 'غير محدد'} | المصدر: ${result.book || 'غير محدد'}`;
  } else {
    title = 'تبيان | لم يتم العثور على الحديث';
    message = result ? (result.error || 'تعذر استخراج بيانات الحديث المحددة.') : selectedText;
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconUrl,
    title: title,
    message: message,
    priority: 2
  });
}

// تهيئة الإضافة عند التثبيت أو التحديث
chrome.runtime.onInstalled.addListener(async () => {
  // إعادة إنشاء عنصر القائمة السياقية بأمان
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '🔍 تحقق من صحة الحديث عبر «تبيان»',
      contexts: ['selection']
    });
  });

  // تهيئة الإعدادات الأولية وإزالة أي روابط قديمة غير صالحة
  const settings = await chrome.storage.local.get(['apiEndpoint', 'history', 'autoLookup']);
  if (!settings.apiEndpoint || settings.apiEndpoint.includes('hirenodes.com')) {
    await chrome.storage.local.set({
      apiEndpoint: TibyanVerifierEngine.DORAR_API_URL,
      history: settings.history || [],
      autoLookup: settings.autoLookup !== undefined ? settings.autoLookup : true
    });
  }

  // حقن السكربتات في التبويبات المفتوحة حالياً لتفادي الحاجة لتحديث الصفحات
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (tab.id && !isRestrictedUrl(tab.url)) {
        ensureContentScriptReady(tab.id).catch(() => {});
      }
    }
  } catch (e) {
    // تجاهل أي تبويب لا يمكن الوصول إليه
  }

  console.log('Tibyan Hadith Verifier v1.1.0 initialized successfully.');
});

// الاستماع لنقر القائمة السياقية (زر الفأرة الأيمن)
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && info.selectionText) {
    const selectedText = info.selectionText.trim();
    if (!tab || !tab.id) return;

    const restricted = isRestrictedUrl(tab.url);
    let canShowInPage = false;

    if (!restricted) {
      canShowInPage = await ensureContentScriptReady(tab.id);
    }

    // 1. إظهار مؤشر التحميل داخل الصفحة إذا كانت الصفحة تدعم ذلك
    if (canShowInPage) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'SHOW_LOADING_TOOLTIP',
          text: selectedText
        });
      } catch (e) {
        // تجاهل أي خطأ مؤقت في التواصل
      }
    }

    // 2. فحص الحديث عبر المحرك
    const result = await TibyanVerifierEngine.verifyHadith(selectedText);

    // 3. حفظ النتيجة في سجل الفحص
    await saveToHistory(selectedText, result);

    // 4. إرسال النتيجة إلى الصفحة لعرض البطاقة العائمة أو إشعار سطح المكتب
    if (canShowInPage) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'SHOW_RESULT_TOOLTIP',
          queryText: selectedText,
          result: result
        });
      } catch (err) {
        // إذا حدث خطأ غير متوقع في الصفحة، يتم عرض إشعار سطح المكتب كبديل فوري
        showDesktopNotification(result, selectedText);
      }
    } else {
      // للصفحات المحمية (مثل chrome://extensions أو صفحات المتصفح الداخلية)
      showDesktopNotification(result, selectedText);
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
      success: result ? result.success : false,
      grade: (result && result.grade) ? result.grade : 'غير محدد',
      status: (result && result.status) ? result.status : 'unknown',
      hadith: (result && result.hadith) ? result.hadith.substring(0, 120) : queryText.substring(0, 120),
      rawi: (result && result.rawi) ? result.rawi : '',
      book: (result && result.book) ? result.book : '',
      mohadith: (result && result.mohadith) ? result.mohadith : ''
    };

    // منع التكرار وتحديث الأولويات
    history = history.filter((h) => h.query !== entry.query);
    history.unshift(entry);

    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await chrome.storage.local.set({ history });
  } catch (err) {
    // تجاهل خطأ التخزين في الحالات النادرة
  }
}
