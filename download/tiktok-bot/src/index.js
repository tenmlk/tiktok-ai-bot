/**
 * ===================================
 * بوت تيك توك الذكي - الملف الرئيسي
 * ===================================
 * 
 * بوت يتفاعل مع فيديوهات تيك توك بشكل ذكي:
 * - يمنشن صاحب الفيديو
 * - يعطي رأيه ومعلومات
 * - يرفض التفاعل مع المحتوى الحساس (تحريض/مخدرات/طبي)
 * 
 * الاستخدام:
 *   node src/index.js
 *   node src/index.js --mode=simulate
 *   node src/index.js --hashtag=طبخ --personality=funny
 */

import 'dotenv/config';
import { AIResponder } from './modules/aiResponder.js';
import { TikTokInterface } from './modules/tiktokInterface.js';
import { checkContentSafety, checkVideoSafety } from './modules/contentFilter.js';
import {
  delay, printBanner, printVideoInfo, printResponse,
  randomBetween, log, StatsTracker
} from './utils/helpers.js';

// ===================================
// إعدادات البوت من متغيرات البيئة
// ===================================
const CONFIG = {
  username: process.env.TIKTOK_USERNAME || '',
  password: process.env.TIKTOK_PASSWORD || '',
  maxVideosPerRun: parseInt(process.env.MAX_VIDEOS_PER_RUN) || 10,
  delayBetweenActions: parseInt(process.env.DELAY_BETWEEN_ACTIONS) || 30,
  language: process.env.BOT_LANGUAGE || 'ar',
  personality: process.env.BOT_PERSONALITY || 'friendly',
  targetHashtags: (process.env.TARGET_HASHTAGS || 'funny,comedy,daily,vlog,cooking,art,music').split(','),
  targetUsers: (process.env.TARGET_USERS || '').split(',').filter(Boolean),
  safeMode: process.env.SAFE_MODE !== 'false'
};

// ===================================
// تحليل معاملات سطر الأوامر
// ===================================
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      parsed[key] = value || true;
    }
  }

  return parsed;
}

// ===================================
// الوظيفة الرئيسية
// ===================================
async function main() {
  const args = parseArgs();
  const stats = new StatsTracker();

  // طباعة الشعار
  printBanner();

  log('🚀 جاري تشغيل البوت...', 'info');
  log(`📋 الشخصية: ${CONFIG.personality} | اللغة: ${CONFIG.language} | الوضع الآمن: ${CONFIG.safeMode}`, 'info');

  if (args.hashtag) {
    CONFIG.targetHashtags = [args.hashtag];
    log(`🏷️  هاشتاق مخصص: #${args.hashtag}`, 'info');
  }

  if (args.personality) {
    CONFIG.personality = args.personality;
    log(`🎭 شخصية مخصصة: ${args.personality}`, 'info');
  }

  // ===================================
  // 1. تهيئة واجهة تيك توك
  // ===================================
  const tiktok = new TikTokInterface({
    username: CONFIG.username,
    password: CONFIG.password,
    maxVideosPerRun: CONFIG.maxVideosPerRun,
    delayBetweenActions: CONFIG.delayBetweenActions,
    targetHashtags: CONFIG.targetHashtags,
    targetUsers: CONFIG.targetUsers
  });

  const tiktokReady = await tiktok.init();

  // ===================================
  // 2. تهيئة الذكاء الاصطناعي
  // ===================================
  const ai = new AIResponder({
    personality: CONFIG.personality,
    language: CONFIG.language
  });

  const aiReady = await ai.init();

  if (!aiReady) {
    log('فشل تهيئة الذكاء الاصطناعي. لا يمكن المتابعة.', 'error');
    process.exit(1);
  }

  // ===================================
  // 3. بدء التشغيل
  // ===================================
  stats.start();
  log('✨ البوت جاهز! بدء التفاعل مع الفيديوهات...', 'success');
  console.log('');

  try {
    // ===================================
    // المرحلة 1: التفاعل مع فيديوهات الترند
    // ===================================
    log('📹 المرحلة 1: البحث عن فيديوهات...', 'info');

    let videos = [];

    // إذا فيه مستخدمين محددين، نجلب فيديوهاتهم
    if (CONFIG.targetUsers.length > 0) {
      for (const user of CONFIG.targetUsers) {
        log(`🔍 جلب فيديوهات @${user}...`, 'info');
        const userVideos = await tiktok.fetchUserVideos(user, 3);
        videos.push(...userVideos);
      }
    }

    // جلب فيديوهات من الهاشتاقات
    if (videos.length < CONFIG.maxVideosPerRun) {
      log(`🔍 جلب فيديوهات من الهاشتاقات: ${CONFIG.targetHashtags.join(', ')}...`, 'info');
      const hashtagVideos = await tiktok.fetchTrendingVideos(
        CONFIG.targetHashtags,
        CONFIG.maxVideosPerRun - videos.length
      );
      videos.push(...hashtagVideos);
    }

    log(`📊 تم العثور على ${videos.length} فيديو`, 'info');
    console.log('');

    // ===================================
    // المرحلة 2: التفاعل مع كل فيديو
    // ===================================
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];

      // فحص أمان الفيديو
      if (CONFIG.safeMode) {
        const videoSafety = checkVideoSafety(video);
        if (!videoSafety.isSafe) {
          log(`🚫 تم تخطي فيديو @${video.username} - محتوى حساس: ${videoSafety.reasons[0]}`, 'warn');
          stats.incrementBlocked();
          continue;
        }
      }

      // عرض معلومات الفيديو
      printVideoInfo(video);

      // توليد الرد
      try {
        const response = await ai.generateVideoResponse(video);

        // عرض الرد
        const isSimulation = !tiktokReady || args.mode === 'simulate';
        printResponse(response, isSimulation);

        // نشر التعليق
        await tiktok.postComment(video.id, response);
        stats.incrementComment();
        stats.addUser(video.username);

      } catch (error) {
        log(`خطأ في توليد الرد: ${error.message}`, 'error');
        stats.incrementError();
      }

      stats.incrementVideo();

      // تأخير بين التفاعلات (عشان ما يحظرنا تيك توك)
      if (i < videos.length - 1) {
        const waitTime = randomBetween(
          CONFIG.delayBetweenActions - 10,
          CONFIG.delayBetweenActions + 20
        );
        log(`⏳ انتظار ${waitTime} ثانية قبل التفاعل التالي...`, 'info');
        await delay(waitTime * 1000);
      }
    }

    // ===================================
    // المرحلة 3: الرد على تعليقات (اختياري)
    // ===================================
    if (args.interact === 'true' && videos.length > 0) {
      console.log('');
      log('💬 المرحلة 3: الرد على التعليقات...', 'info');

      for (const video of videos.slice(0, 3)) {
        const comments = await tiktok.fetchVideoComments(video.id, 5);

        for (const comment of comments) {
          const commentText = comment.text || comment.commentText || '';
          const commentUser = comment.author?.name || comment.username || 'user';

          // فحص أمان التعليق
          if (CONFIG.safeMode) {
            const commentSafety = checkContentSafety(commentText);
            if (!commentSafety.isSafe) {
              log(`🚫 تخطي تعليق حساس من @${commentUser}`, 'warn');
              stats.incrementBlocked();
              continue;
            }
          }

          try {
            const reply = await ai.generateCommentReply(commentUser, commentText, video);
            log(`💬 رد على @${commentUser}: "${reply}"`, 'success');

            await delay(randomBetween(15, 30) * 1000);
          } catch (error) {
            log(`خطأ في الرد على التعليق: ${error.message}`, 'error');
            stats.incrementError();
          }
        }
      }
    }

  } catch (error) {
    log(`خطأ عام: ${error.message}`, 'error');
    stats.incrementError();
  }

  // ===================================
  // عرض الإحصائيات النهائية
  // ===================================
  console.log('');
  stats.printStats();

  log('👋 انتهى تشغيل البوت. لإعادة التشغيل شغل البوت مرة أخرى.', 'info');

  // تنظيف
  ai.clearAllHistory();
}

// ===================================
// تشغيل البوت
// ===================================
main().catch(error => {
  console.error('💥 خطأ فادح:', error);
  process.exit(1);
});
