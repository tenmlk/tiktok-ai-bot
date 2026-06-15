/**
 * ===================================
 * خادم Keep-Alive
 * ===================================
 * يمنع Replit/Render من إيقاف البوت بسبب عدم النشاط
 * يرسل ping لنفسه كل 5 دقائق
 */

import express from 'express';
import { AIResponder } from './modules/aiResponder.js';
import { TikTokInterface } from './modules/tiktokInterface.js';
import { checkContentSafety, checkVideoSafety } from './modules/contentFilter.js';
import { delay, randomBetween, log, StatsTracker } from './utils/helpers.js';

const app = express();
const PORT = process.env.PORT || 3000;

// إحصائيات
const stats = new StatsTracker();
stats.start();

// تهيئة البوت
const ai = new AIResponder({
  personality: process.env.BOT_PERSONALITY || 'friendly',
  language: process.env.BOT_LANGUAGE || 'ar'
});

const tiktok = new TikTokInterface({
  username: process.env.TIKTOK_USERNAME || '',
  password: process.env.TIKTOK_PASSWORD || '',
  targetHashtags: (process.env.TARGET_HASHTAGS || 'funny,comedy,daily,vlog,cooking,art,music').split(','),
  targetUsers: (process.env.TARGET_USERS || '').split(',').filter(Boolean)
});

// ===================================
# صفحة الحالة
# ===================================
app.get('/', (req, res) => {
  const botStats = stats.getStats();
  res.json({
    status: 'running',
    bot: '🤖 بوت تيك توك الذكي',
    stats: botStats,
    uptime: process.uptime(),
    message: 'البوت شغال! 🎉'
  });
});

// صفحة فحص الصحة (لـ Uptime Robot)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ===================================
# تشغيل الخادم
# ===================================
const server = app.listen(PORT, '0.0.0.0', () => {
  log(`🌐 خادم Keep-Alive يعمل على المنفذ ${PORT}`, 'success');
});

// ===================================
# تشغيل البوت
# ===================================
async function startBot() {
  // تهيئة
  await tiktok.init();
  const aiReady = await ai.init();

  if (!aiReady) {
    log('فشل تهيئة الذكاء الاصطناعي', 'error');
    return;
  }

  log('✨ البوت يعمل بشكل مستمر!', 'success');

  // حلقة مستمرة
  while (true) {
    try {
      const maxVideos = parseInt(process.env.MAX_VIDEOS_PER_RUN) || 5;
      const delaySeconds = parseInt(process.env.DELAY_BETWEEN_ACTIONS) || 30;

      // جلب الفيديوهات
      let videos = [];

      const targetUsers = (process.env.TARGET_USERS || '').split(',').filter(Boolean);
      if (targetUsers.length > 0) {
        for (const user of targetUsers) {
          const userVideos = await tiktok.fetchUserVideos(user, 3);
          videos.push(...userVideos);
        }
      }

      if (videos.length < maxVideos) {
        const hashtags = (process.env.TARGET_HASHTAGS || 'funny,comedy,daily').split(',');
        const moreVideos = await tiktok.fetchTrendingVideos(hashtags, maxVideos - videos.length);
        videos.push(...moreVideos);
      }

      log(`📹 تم العثور على ${videos.length} فيديو`, 'info');

      // التفاعل مع كل فيديو
      for (const video of videos) {
        // فحص الأمان
        const safety = checkVideoSafety(video);
        if (!safety.isSafe) {
          log(`🚫 تخطي فيديو @${video.username} - محتوى حساس`, 'warn');
          stats.incrementBlocked();
          continue;
        }

        try {
          const response = await ai.generateVideoResponse(video);
          log(`💬 @${video.username}: "${response}"`, 'success');
          await tiktok.postComment(video.id, response);

          stats.incrementComment();
          stats.incrementVideo();
          stats.addUser(video.username);

        } catch (error) {
          log(`خطأ: ${error.message}`, 'error');
          stats.incrementError();
        }

        // تأخير
        await delay(randomBetween(delaySeconds - 10, delaySeconds + 20) * 1000);
      }

      // انتظار قبل الدورة الجديدة (10 دقائق)
      log('⏳ انتظار 10 دقائق قبل الدورة القادمة...', 'info');
      await delay(10 * 60 * 1000);

    } catch (error) {
      log(`خطأ عام: ${error.message}`, 'error');
      stats.incrementError();
      await delay(60 * 1000); // انتظار دقيقة قبل إعادة المحاولة
    }
  }
}

// بدء البوت
startBot();

// ===================================
# Keep-Alive: يمنع النوم على Replit
# ===================================
const KEEP_ALIVE_URL = process.env.REPL_SLUG 
  ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
  : null;

if (KEEP_ALIVE_URL) {
  setInterval(async () => {
    try {
      await fetch(`${KEEP_ALIVE_URL}/health`);
    } catch (e) {
      // تجاهل الأخطاء
    }
  }, 4 * 60 * 1000); // كل 4 دقائق
}
