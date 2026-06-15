/**
 * ===================================
 * واجهة التعامل مع تيك توك
 * ===================================
 * مسؤول عن جلب الفيديوهات، نشر التعليقات، والمنشنات
 */

import { checkVideoSafety } from './contentFilter.js';

/**
 * كلاس واجهة تيك توك
 * يستخدم TikTok Scraper للتفاعل مع المنصة
 */
export class TikTokInterface {
  constructor(options = {}) {
    this.username = options.username || '';
    this.password = options.password || '';
    this.maxVideosPerRun = options.maxVideosPerRun || 10;
    this.delayBetweenActions = options.delayBetweenActions || 30;
    this.targetHashtags = options.targetHashtags || [];
    this.targetUsers = options.targetUsers || [];
    this.scraper = null;
    this.loggedIn = false;
  }

  /**
   * تهيئة و تسجيل الدخول
   */
  async init() {
    try {
      const { default: TikTokScraper } = await import('tiktok-scraper');
      this.scraper = TikTokScraper;
      console.log('✅ تم تهيئة واجهة تيك توك');
      return true;
    } catch (error) {
      console.error('❌ فشل تهيئة واجهة تيك توك:', error.message);
      console.log('ℹ️  سيتم تشغيل البوت في وضع المحاكاة');
      return false;
    }
  }

  /**
   * جلب فيديوهات ترند بناءً على هاشتاقات
   * @param {string[]} hashtags - قائمة الهاشتاقات
   * @param {number} count - عدد الفيديوهات
   * @returns {Promise<Array>} قائمة الفيديوهات
   */
  async fetchTrendingVideos(hashtags = [], count = 10) {
    const targetTags = hashtags.length > 0 ? hashtags : this.targetHashtags;
    const videos = [];

    for (const tag of targetTags.slice(0, 3)) {
      try {
        if (this.scraper) {
          const result = await this.scraper.hashtag(tag, { number: Math.ceil(count / targetTags.length) });
          const collected = result.collector || result || [];
          
          for (const video of collected) {
            const videoInfo = this.normalizeVideoData(video);
            if (videoInfo) {
              // فحص أمان الفيديو
              const safety = checkVideoSafety(videoInfo);
              if (safety.isSafe) {
                videos.push(videoInfo);
              } else {
                console.log(`⚠️ تم تخطي فيديو محتوى حساس: @${videoInfo.username}`);
              }
            }
          }
        }
      } catch (error) {
        console.error(`❌ خطأ في جلب هاشتاق #${tag}:`, error.message);
      }
    }

    // في حالة عدم وجود scraper (وضع المحاكاة)
    if (videos.length === 0) {
      console.log('🎭 وضع المحاكاة: جلب فيديوهات وهمية للاختبار');
      return this.getSimulatedVideos(count);
    }

    return videos.slice(0, count);
  }

  /**
   * جلب فيديوهات مستخدم معين
   * @param {string} username - اسم المستخدم
   * @param {number} count - عدد الفيديوهات
   * @returns {Promise<Array>}
   */
  async fetchUserVideos(username, count = 5) {
    try {
      if (this.scraper) {
        const result = await this.scraper.user(username, { number: count });
        const collected = result.collector || result || [];
        return collected
          .map(v => this.normalizeVideoData(v))
          .filter(v => {
            if (!v) return false;
            const safety = checkVideoSafety(v);
            return safety.isSafe;
          });
      }
    } catch (error) {
      console.error(`❌ خطأ في جلب فيديوهات @${username}:`, error.message);
    }

    return this.getSimulatedVideos(count, username);
  }

  /**
   * نشر تعليق على فيديو
   * @param {string} videoId - معرف الفيديو
   * @param {string} comment - نص التعليق
   * @returns {Promise<boolean>}
   */
  async postComment(videoId, comment) {
    try {
      if (this.scraper && this.loggedIn) {
        // محاولة النشر الحقيقي
        console.log(`📤 نشر تعليق على فيديو ${videoId}: "${comment}"`);
        // Note: نشر التعليقات يتطلب تسجيل دخول وصلاحيات خاصة
        // await this.scraper.comment(videoId, comment);
        return true;
      }
    } catch (error) {
      console.error(`❌ فشل نشر التعليق:`, error.message);
    }

    // وضع المحاكاة
    console.log(`🎭 [محاكاة] تعليق على فيديو ${videoId}: "${comment}"`);
    return true;
  }

  /**
   * جلب تعليقات فيديو
   * @param {string} videoId - معرف الفيديو
   * @param {number} count - عدد التعليقات
   * @returns {Promise<Array>}
   */
  async fetchVideoComments(videoId, count = 20) {
    try {
      if (this.scraper) {
        const result = await this.scraper.comments(videoId, { number: count });
        return result.collector || result || [];
      }
    } catch (error) {
      console.error(`❌ فشل جلب تعليقات الفيديو ${videoId}:`, error.message);
    }

    return [];
  }

  /**
   * توحيد بيانات الفيديو
   */
  normalizeVideoData(video) {
    if (!video) return null;

    return {
      id: video.id || video.videoId || Math.random().toString(36).slice(2),
      username: video.author?.name || video.author || video.uniqueId || 'unknown',
      description: video.text || video.description || '',
      title: video.title || '',
      tags: video.tags || video.hashtags || [],
      music: video.music?.title || video.music || '',
      likes: video.diggCount || video.likes || 0,
      comments: video.commentCount || video.comments || 0,
      shares: video.shareCount || video.shares || 0,
      url: video.webVideoUrl || video.videoUrl || '',
      cover: video.covers?.default || video.cover || ''
    };
  }

  /**
   * فيديوهات وهمية للاختبار
   */
  getSimulatedVideos(count = 5, specificUser = null) {
    const sampleVideos = [
      {
        username: specificUser || 'ahmed_cooking',
        description: 'سويت أكل هندي لأول مرة! وش رأيكم؟ 🍛 #طبخ #أكل_هندي',
        title: 'طبخ هندي بالبيت',
        tags: ['طبخ', 'أكل_هندي', 'cooking', 'food'],
        music: 'صوت أصلي',
        likes: 15420,
        comments: 230,
        shares: 89
      },
      {
        username: specificUser || 'sara_art',
        description: 'رسمت لوحة بالألوان المائية 🎨 وش تحسون؟ #رسم #فن #art',
        title: 'لوحة ألوان مائية',
        tags: ['رسم', 'فن', 'art', 'painting'],
        music: 'Calm Piano - AudioLib',
        likes: 8930,
        comments: 156,
        shares: 45
      },
      {
        username: specificUser || 'khaled_fitness',
        description: 'تمرين اليوم كارديو 30 دقيقة 💪 لا تنسوا الإحماء! #رياضة #تمارين #صحة',
        title: 'كارديو 30 دقيقة',
        tags: ['رياضة', 'تمارين', 'صحة', 'fitness', 'cardio'],
        music: 'Workout Beats',
        likes: 22100,
        comments: 340,
        shares: 120
      },
      {
        username: specificUser || 'nora_diy',
        description: 'سويت تنظيم للغرفة بخطوات بسيطة ✨ #تنظيم #ديكور #بيت',
        title: 'تنظيم الغرفة',
        tags: ['تنظيم', 'ديكور', 'بيت', 'DIY', 'organization'],
        music: 'صوت أصلي',
        likes: 5600,
        comments: 89,
        shares: 34
      },
      {
        username: specificUser || 'omar_tech',
        description: 'أفضل 5 تطبيقات للإنتاجية في 2025 📱 #تقنية #تطبيقات #انتاجية',
        title: 'أفضل تطبيقات الإنتاجية',
        tags: ['تقنية', 'تطبيقات', 'انتاجية', 'tech', 'apps'],
        music: 'Tech Vibes - BeatFree',
        likes: 31200,
        comments: 445,
        shares: 230
      },
      {
        username: specificUser || 'layla_travel',
        description: 'زرت مكان سري في الطبيعة 🏔️ مناظر خيالية! #سفر #طبيعة #مغامرة',
        title: 'مكان سري في الطبيعة',
        tags: ['سفر', 'طبيعة', 'مغامرة', 'travel', 'nature'],
        music: 'Adventure Awaits',
        likes: 45800,
        comments: 670,
        shares: 380
      },
      {
        username: specificUser || 'fahad_comedy',
        description: 'لما أمك تطلبك وأنت تلعب 😂 #كوميديا #ضحك #فلوق',
        title: 'لما أمك تطلبك',
        tags: ['كوميديا', 'ضحك', 'فلوق', 'comedy', 'funny'],
        music: 'صوت أصلي',
        likes: 89000,
        comments: 1200,
        shares: 560
      },
      {
        username: specificUser || 'reem_books',
        description: 'مراجعة كتاب "العادات الذرية" 📚 أنصحكم فيه! #كتب #قراءة #مراجعة',
        title: 'مراجعة كتاب العادات الذرية',
        tags: ['كتب', 'قراءة', 'مراجعة', 'books', 'reading'],
        music: 'Lo-fi Reading',
        likes: 3400,
        comments: 78,
        shares: 23
      }
    ];

    // خلط عشوائي واختيار العدد المطلوب
    const shuffled = sampleVideos.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length)).map((v, i) => ({
      ...v,
      id: `sim_${Date.now()}_${i}`
    }));
  }
}
