/**
 * Tibyan - Automated Unit Tests & Verification Suite
 * تشغيل الاختبارات للتأكد من سلامة منطق تنظيف النصوص وتصنيف الأحاديث
 */

const assert = require('assert');
const TextCleaner = require('../src/utils/text-cleaner');
const OfflineDB = require('../src/utils/offline-dataset');
const VerifierEngine = require('../src/utils/verifier-engine');
const CardGenerator = require('../src/utils/card-generator');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

console.log('\n🚀 Starting Tibyan Hadith Verifier Test Suite...\n');

// 1. Text Cleaner Tests
console.log('--- 1. Testing Text Cleaner & Normalization ---');

runTest('Should remove Arabic tashkeel completely', () => {
  const input = 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ';
  const expected = 'إنما الأعمال بالنيات';
  assert.strictEqual(TextCleaner.removeTashkeel(input), expected);
});

runTest('Should normalize Alef variants and Ta Marbuta', () => {
  const input = 'إبراهيم و آمنة و موسى';
  const normalized = TextCleaner.normalizeArabic(input);
  assert.ok(normalized.includes('ابراهيم'));
  assert.ok(normalized.includes('امنه'));
  assert.ok(normalized.includes('موسي'));
});

runTest('Should clean prefixes (قال رسول الله صلى الله عليه وسلم)', () => {
  const input = 'عن النبي صلى الله عليه وسلم قال: «من غشنا فليس منا»';
  const { cleanQuery } = TextCleaner.prepareQuery(input);
  assert.strictEqual(cleanQuery, 'من غشنا فليس منا');
});

runTest('Should calculate text similarity', () => {
  const s1 = 'من غشنا فليس منا';
  const s2 = 'مَن غَشَّنَا فَلَيْسَ مِنَّا';
  const sim = TextCleaner.calculateSimilarity(s1, s2);
  assert.strictEqual(sim, 1.0);
});

// 2. Offline Database Tests
console.log('\n--- 2. Testing Offline Knowledge Base ---');

runTest('Should identify fabricated hadith (اطلبوا العلم ولو بالصين)', () => {
  const query = 'اطلبوا العلم ولو بالصين';
  const normalized = TextCleaner.normalizeArabic(query);
  const match = OfflineDB.findInOfflineDB(normalized);
  assert.ok(match, 'Hadith should be found in offline DB');
  assert.strictEqual(match.status, 'mawdoo');
});

runTest('Should identify authentic hadith (إنما الأعمال بالنيات)', () => {
  const query = 'إنما الأعمال بالنيات';
  const normalized = TextCleaner.normalizeArabic(query);
  const match = OfflineDB.findInOfflineDB(normalized);
  assert.ok(match, 'Hadith should be found in offline DB');
  assert.strictEqual(match.status, 'sahih');
});

// 3. Verifier Engine Tests
console.log('\n--- 3. Testing Verifier Engine & Grading Classification ---');

runTest('Should correctly classify "صحيح متفق عليه" as sahih', () => {
  assert.strictEqual(VerifierEngine.classifyGrade('صحيح متفق عليه'), 'sahih');
  assert.strictEqual(VerifierEngine.classifyGrade('إسناده صحيح رجاله ثقات'), 'sahih');
});

runTest('Should correctly classify "موضوع وباطل لا أصل له" as mawdoo', () => {
  assert.strictEqual(VerifierEngine.classifyGrade('موضوع مكذوب'), 'mawdoo');
  assert.strictEqual(VerifierEngine.classifyGrade('لا أصل له في كتب السنة'), 'mawdoo');
});

runTest('Should correctly classify "ضعيف جدا ومنكر" as daif', () => {
  assert.strictEqual(VerifierEngine.classifyGrade('ضعيف جداً'), 'daif');
  assert.strictEqual(VerifierEngine.classifyGrade('إسناده مظلم ومنكر'), 'daif');
});

runTest('Should return status metadata with colors and icons', () => {
  const meta = VerifierEngine.getStatusMetadata('sahih');
  assert.strictEqual(meta.icon, '✅');
  assert.ok(meta.label.includes('صحيح'));
});

// 4. Citation Card Generator Tests
console.log('\n--- 4. Testing Citation Card Generator ---');

runTest('Should generate formatted citation text ready to copy', () => {
  const sampleResult = {
    hadith: 'من غشنا فليس منا',
    grade: 'صحيح',
    rawi: 'أبو هريرة',
    mohadith: 'مسلم',
    book: 'صحيح مسلم',
    statusMeta: VerifierEngine.getStatusMetadata('sahih'),
    dorarUrl: 'https://dorar.net/hadith/search?q=من+غشنا'
  };

  const cardText = CardGenerator.generateTextCard(sampleResult);
  assert.ok(cardText.includes('تبيان'));
  assert.ok(cardText.includes('من غشنا فليس منا'));
  assert.ok(cardText.includes('أبو هريرة'));
  assert.ok(cardText.includes('صحيح مسلم'));
  assert.ok(cardText.includes('https://dorar.net'));
});

console.log(`\n========================================`);
console.log(`Test Results: ${passedTests}/${totalTests} passed (${Math.round((passedTests/totalTests)*100)}%)`);
console.log(`========================================\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
