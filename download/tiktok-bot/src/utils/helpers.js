/**
 * ===================================
 * أدوات مساعدة
 * ===================================
 */

/**
 * تأخير زمني
 * @param {number} ms - المدة بالميلي ثانية
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * طباعة شعار البوت
 */
export function printBanner() {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║      🤖 بوت تيك توك الذكي v1.0          ║
║                                          ║
║      يتفاعل مع الفيديوهات بذكاء         ║
║      مع فلترة المحتوى الحساس             ║
║                                          ║
╚══════════════════════════════════════════╝
  `);
}

/**
 * طباعة معلومات الفيديو بشكل منظم
 * @param {object} video - معلومات الفيديو
 */
export function printVideoInfo(video) {
  console.log(`
┌─────────────────────────────────────────┐
│ 📹 فيديو جديد                           │
├─────────────────────────────────────────┤
│ 👤 المستخدم:  @${video.username}
│ 📝 الوصف:     ${truncate(video.description, 50)}
│ 🏷️  الهاشتاقات: ${(video.tags || []).slice(0, 5).join(', ')}
│ ❤️  لايكات:    ${formatNumber(video.likes)}
│ 💬 تعليقات:   ${formatNumber(video.comments)}
│ 🔄 مشاركات:   ${formatNumber(video.shares)}
└─────────────────────────────────────────┘`);
}

/**
 * طباعة الرد
 * @param {string} response - الرد
 * @param {boolean} isSimulation - هل هو وضع محاكاة
 */
export function printResponse(response, isSimulation = false) {
  const prefix = isSimulation ? '🎭 [محاكاة]' : '✅ [منشور]';
  console.log(`${prefix} الرد: "${response}"`);
  console.log('─'.repeat(50));
}

/**
 * اقتطاع نص
 * @param {string} text - النص
 * @param {number} maxLength - الحد الأقصى
 * @returns {string}
 */
export function truncate(text, maxLength = 100) {
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

/**
 * تنسيق الأرقام
 * @param {number} num - الرقم
 * @returns {string}
 */
export function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * توليد رقم عشوائي بين قيمتين
 * @param {number} min - الحد الأدنى
 * @param {number} max - الحد الأقصى
 * @returns {number}
 */
export function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * تسجيل الأحداث
 * @param {string} message - الرسالة
 * @param {string} level - المستوى (info, warn, error)
 */
export function log(message, level = 'info') {
  const timestamp = new Date().toLocaleString('ar-SA');
  const prefix = {
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌',
    success: '✅'
  }[level] || 'ℹ️ ';

  console.log(`[${timestamp}] ${prefix} ${message}`);
}

/**
 * حفظ الإحصائيات
 */
export class StatsTracker {
  constructor() {
    this.stats = {
      videosProcessed: 0,
      commentsPosted: 0,
      contentBlocked: 0,
      errors: 0,
      startTime: null,
      usersInteracted: new Set()
    };
  }

  start() {
    this.stats.startTime = new Date();
  }

  incrementVideo() { this.stats.videosProcessed++; }
  incrementComment() { this.stats.commentsPosted++; }
  incrementBlocked() { this.stats.contentBlocked++; }
  incrementError() { this.stats.errors++; }
  addUser(username) { this.stats.usersInteracted.add(username); }

  getStats() {
    const runtime = this.stats.startTime
      ? Math.round((Date.now() - this.stats.startTime.getTime()) / 1000 / 60)
      : 0;

    return {
      ...this.stats,
      runtime: `${runtime} دقيقة`,
      uniqueUsers: this.stats.usersInteracted.size
    };
  }

  printStats() {
    const stats = this.getStats();
    console.log(`
╔══════════════════════════════════════════╗
║          📊 إحصائيات البوت               ║
╠══════════════════════════════════════════╣
║  📹 فيديوهات معالجة:  ${stats.videosProcessed}
║  💬 تعليقات منشورة:  ${stats.commentsPosted}
║  🚫 محتوى محظور:     ${stats.contentBlocked}
║  ❌ أخطاء:            ${stats.errors}
║  👥 مستخدمين فريدين:  ${stats.uniqueUsers}
║  ⏱️  وقت التشغيل:     ${stats.runtime}
╚══════════════════════════════════════════╝`);
  }
}
