/**
 * ===================================
 * بوت تيك توك الذكي - نسخة Puppeteer
 * ===================================
 * 
 * يراقب المنشنات ويرد عليها تلقائياً بالذكاء الاصطناعي
 * يشتغل على GitHub Codespaces (مجاني - بدون بطاقة)
 */

import puppeteer from 'puppeteer';
import ZAI from 'z-ai-web-dev-sdk';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';

// ===================================
// إعدادات البوت
// ===================================

const CONFIG = {
  // بيانات حساب تيك توك
  username: process.env.TIKTOK_USERNAME || '',
  password: process.env.TIKTOK_PASSWORD || '',

  // إعدادات المراقبة
  checkInterval: parseInt(process.env.CHECK_INTERVAL) || 60, // كل كم ثانية يفحص المنشنات (أقل شيء 60)
  maxRepliesPerRun: parseInt(process.env.MAX_REPLIES_PER_RUN) || 5,

  // إعدادات البوت
  personality: process.env.BOT_PERSONALITY || 'friendly',
  language: process.env.BOT_LANGUAGE || 'ar',
  safeMode: process.env.SAFE_MODE !== 'false',

  // إعدادات الحماية من الحظر
  minDelayBetweenReplies: 120,  // أقل شيء دقيقتين بين كل رد
  maxDelayBetweenReplies: 300,  // أقصى شيء 5 دقائق

  // منشنات تم الرد عليها (عشان ما نرد مرتين)
  repliedMentions: new Set()
};

// ===================================
// نظام الذكاء الاصطناعي
// ===================================

async function createAIResponse(mentionText, videoDescription, mentionerUsername) {
  // فحص أمان المحتوى
  const safety = checkContentSafety(mentionText);
  if (!safety.isSafe) {
    return getRefusalResponse(safety.category);
  }

  const videoSafety = checkContentSafety(videoDescription || '');
  if (!videoSafety.isSafe) {
    return 'آسف، ما أقدر أعلق على هالمحتوى. 😊';
  }

  try {
    const zai = await ZAI.create();

    const personas = {
      friendly: { name: 'صديق ودود', tone: 'ودود ومشجع' },
      funny: { name: 'فكاهي', tone: 'مرح وخفيف' },
      critic: { name: 'ناقد بنّاء', tone: 'صريح ومحترم' },
      informative: { name: 'مثقف', tone: 'مثقف ومفيد' }
    };
    const persona = personas[CONFIG.personality] || personas.friendly;

    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `أنت بوت تيك توك ذكي بشخصية "${persona.name}". نبرتك: ${persona.tone}

القواعد الصارمة:
1. ترد بالعربية فقط
2. الرد قصير مناسب لتعليق تيك توك (أقل من 150 حرف)
3. تبدأ الرد بـ @${mentionerUsername} دائماً
4. ترد على اللي منشنك - أجب سؤاله أو علّق على الفيديو
5. تستخدم 1-3 إيموجي فقط
6. ما تتكلم عن تحريض/كراهية/عنف/مخدرات/مواضيع طبية
7. إذا السؤال عن شيء محظور، تعتذر بأدب
8. تكون طبيعي وما تبين إنك بوت`
        },
        {
          role: 'user',
          content: `شخص منشنك في تيك توو:
- اسمه: @${mentionerUsername}
- كتب: "${mentionText}"
- وصف الفيديو: "${videoDescription || 'لا يوجد وصف'}"

رد عليه بشكل طبيعي. ابدأ بـ @${mentionerUsername}`
        }
      ],
      temperature: 0.8,
      max_tokens: 100,
      top_p: 0.9
    });

    let response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      return `@${mentionerUsername} أهلاً! شكراً على المنشن 🙏`;
    }

    // فحص أمان الرد
    const responseSafety = checkContentSafety(response);
    if (!responseSafety.isSafe) {
      return getRefusalResponse(responseSafety.category);
    }

    if (!response.startsWith(`@${mentionerUsername}`)) {
      response = `@${mentionerUsername} ${response}`;
    }

    return response;

  } catch (error) {
    console.error('❌ خطأ في توليد الرد:', error.message);
    return `@${mentionerUsername} أهلاً! شكراً على المنشن 🙏`;
  }
}

// ===================================
// متصفح Puppeteer - التعامل مع تيك توك
// ===================================

class TikTokBot {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
  }

  /**
   * تشغيل المتصفح
   */
  async init() {
    console.log('🌐 تشغيل المتصفح...');

    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-acceleration-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--lang=ar-SA'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });

    // تغيير User-Agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('✅ المتصفح جاهز');
  }

  /**
   * تسجيل الدخول في تيك توك
   */
  async login() {
    if (!CONFIG.username || !CONFIG.password) {
      console.log('⚠️  لا يوجد بيانات دخول - يرجى إضافة TIKTOK_USERNAME و TIKTOK_PASSWORD في .env');
      console.log('ℹ️  سيتم محاولة الدخول يدوياً...');
      return false;
    }

    console.log(`🔑 تسجيل الدخول باسم @${CONFIG.username}...`);

    try {
      // فتح صفحة تسجيل الدخول
      await this.page.goto('https://www.tiktok.com/login', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(2000, 4000);

      // محاولة تسجيل الدخول بالبريد الإلكتروني
      try {
        // الضغط على "تسجيل الدخول بالبريد/اسم المستخدم"
        const emailTab = await this.page.$('[data-e2e="login-username"]') ||
                          await this.page.$('input[name="username"]') ||
                          await this.page.$('input[type="text"]');

        if (emailTab) {
          await emailTab.click();
          await this.randomDelay(1000, 2000);
        }

        // إدخال اسم المستخدم
        const usernameInput = await this.page.$('input[name="username"]') ||
                               await this.page.$('input[type="text"]');
        if (usernameInput) {
          await usernameInput.click({ clickCount: 3 });
          await this.page.keyboard.type(CONFIG.username, { delay: 50 + Math.random() * 100 });
        }

        await this.randomDelay(1000, 2000);

        // إدخال كلمة المرور
        const passwordInput = await this.page.$('input[type="password"]');
        if (passwordInput) {
          await passwordInput.click({ clickCount: 3 });
          await this.page.keyboard.type(CONFIG.password, { delay: 50 + Math.random() * 100 });
        }

        await this.randomDelay(1000, 2000);

        // الضغط على زر تسجيل الدخول
        const loginButton = await this.page.$('button[data-e2e="login-button"]') ||
                             await this.page.$('button[type="submit"]');
        if (loginButton) {
          await loginButton.click();
        }

        // انتظار التحميل
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

        await this.randomDelay(3000, 5000);

        // التحقق من تسجيل الدخول
        const currentUrl = this.page.url();
        if (currentUrl.includes('login') || currentUrl.includes('signup')) {
          console.log('⚠️  فشل تسجيل الدخول التلقائي');
          console.log('ℹ️  قد تحتاج لحل CAPTCHA يدوياً أو تسجيل الدخول يدوياً');
          return false;
        }

        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بنجاح!');
        return true;

      } catch (error) {
        console.log('⚠️  فشل تسجيل الدخول:', error.message);
        return false;
      }

    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error.message);
      return false;
    }
  }

  /**
   * جلب المنشنات الجديدة
   */
  async getNewMentions() {
    console.log('📥 فحص المنشنات الجديدة...');

    try {
      // فتح صفحة الإشعارات
      await this.page.goto('https://www.tiktok.com/inbox', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);

      // البحث عن المنشنات في الإشعارات
      const mentions = [];

      try {
        // محاولة جلب عناصر الإشعارات
        const notificationElements = await this.page.$$(
          '[data-e2e="inbox-notification"], .notification-item, [class*="notification"]'
        );

        for (const element of notificationElements.slice(0, 20)) {
          try {
            const text = await element.evaluate(el => el.textContent || '');
            const link = await element.evaluate(el => {
              const a = el.querySelector('a');
              return a ? a.href : '';
            });

            // التحقق إنه منشن
            if (text.includes('@' + CONFIG.username) || text.toLowerCase().includes('mentioned')) {
              mentions.push({
                text: text.trim(),
                link: link,
                id: link || text.slice(0, 50) // معرّف فريد
              });
            }
          } catch (e) {
            // تجاهل أخطاء العناصر الفردية
          }
        }

      } catch (error) {
        console.log('⚠️  لم يتم العثور على عناصر إشعارات بالـ selectors الحالية');
      }

      // تصفية المنشنات اللي تم الرد عليها
      const newMentions = mentions.filter(m => !CONFIG.repliedMentions.has(m.id));

      console.log(`📬 وجد ${newMentions.length} منشن جديد`);
      return newMentions;

    } catch (error) {
      console.error('❌ خطأ في جلب المنشنات:', error.message);
      return [];
    }
  }

  /**
   * جلب تفاصيل الفيديو من الرابط
   */
  async getVideoDetails(videoUrl) {
    try {
      await this.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(2000, 3000);

      // استخراج وصف الفيديو
      const description = await this.page.evaluate(() => {
        const descEl = document.querySelector('[data-e2e="video-desc"]') ||
                       document.querySelector('h1') ||
                       document.querySelector('[class*="Caption"]');
        return descEl ? descEl.textContent.trim() : '';
      });

      return { description };

    } catch (error) {
      console.error('❌ خطأ في جلب تفاصيل الفيديو:', error.message);
      return { description: '' };
    }
  }

  /**
   * نشر تعليق على فيديو
   */
  async postComment(videoUrl, comment) {
    try {
      // فتح صفحة الفيديو
      await this.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);

      // الضغط على خانة التعليق
      const commentInput = await this.page.$(
        '[data-e2e="comment-input"] textarea, ' +
        'textarea[placeholder], ' +
        'div[contenteditable="true"], ' +
        '[class*="comment-input"]'
      );

      if (!commentInput) {
        console.log('⚠️  لم يتم العثور على خانة التعليق');
        return false;
      }

      await commentInput.click();
      await this.randomDelay(1000, 2000);

      // كتابة التعليق حرف حرف (عشان يبان طبيعي)
      await this.page.keyboard.type(comment, {
        delay: 30 + Math.random() * 70
      });

      await this.randomDelay(1000, 2000);

      // الضغط على زر الإرسال
      const submitButton = await this.page.$(
        '[data-e2e="comment-submit"], ' +
        'button[type="submit"], ' +
        '[class*="comment-post"]'
      );

      if (submitButton) {
        await submitButton.click();
        await this.randomDelay(2000, 3000);
        console.log(`✅ تم نشر التعليق: "${comment}"`);
        return true;
      }

      // محاولة الضغط على Enter
      await this.page.keyboard.press('Enter');
      await this.randomDelay(2000, 3000);
      console.log(`✅ تم نشر التعليق: "${comment}"`);
      return true;

    } catch (error) {
      console.error('❌ خطأ في نشر التعليق:', error.message);
      return false;
    }
  }

  /**
   * تأخير عشوائي (يحاكي سلوك بشري)
   */
  async randomDelay(min = 1000, max = 3000) {
    const delay = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * إغلاق المتصفح
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 تم إغلاق المتصفح');
    }
  }
}

// ===================================
// الحلقة الرئيسية
// ===================================

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║      🤖 بوت تيك توك الذكي v2.0          ║
║      يراقب المنشنات ويرد عليها          ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  const bot = new TikTokBot();

  try {
    // 1. تشغيل المتصفح
    await bot.init();

    // 2. تسجيل الدخول
    const loggedIn = await bot.login();

    if (!loggedIn) {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('⚠️  تسجيل الدخول التلقائي فشل');
      console.log('قد يكون بسبب CAPTCHA أو خطأ في البيانات');
      console.log('');
      console.log('📋 الحل:');
      console.log('1. افتح المتصفح يدوياً في Codespaces');
      console.log('2. سجل دخولك في تيك توك');
      console.log('3. أعد تشغيل البوت');
      console.log('');
      console.log('أو أضف البيانات في ملف .env:');
      console.log('  TIKTOK_USERNAME=اسم_المستخدم');
      console.log('  TIKTOK_PASSWORD=كلمة_المرور');
      console.log('═══════════════════════════════════════');
      console.log('');
      console.log('⏳ المحاولة مرة أخرى بعد 5 دقائق...');
      await bot.randomDelay(300000, 300000);
      await bot.close();
      return;
    }

    // 3. حلقة مراقبة المنشنات
    console.log('🔄 بدء مراقبة المنشنات...');
    console.log(`⏱️  فحص كل ${CONFIG.checkInterval} ثانية`);
    console.log('');

    while (true) {
      try {
        // جلب المنشنات الجديدة
        const mentions = await bot.getNewMentions();

        for (const mention of mentions.slice(0, CONFIG.maxRepliesPerRun)) {
          console.log(`\n📬 منشن جديد: "${mention.text.substring(0, 80)}..."`);

          // استخراج اسم اللي منشن
          const mentionerMatch = mention.text.match(/@(\w+)/);
          const mentionerUsername = mentionerMatch ? mentionerMatch[1] : 'user';

          // جلب تفاصيل الفيديو
          let videoDescription = '';
          if (mention.link) {
            const details = await bot.getVideoDetails(mention.link);
            videoDescription = details.description;
          }

          // توليد الرد
          const reply = await createAIResponse(
            mention.text,
            videoDescription,
            mentionerUsername
          );

          console.log(`💬 الرد: "${reply}"`);

          // نشر التعليق
          if (mention.link) {
            const posted = await bot.postComment(mention.link, reply);
            if (posted) {
              CONFIG.repliedMentions.add(mention.id);
              console.log('✅ تم النشر!');
            } else {
              console.log('❌ فشل النشر');
            }
          }

          // تأخير بين الردود (عشان ما يحظرنا)
          const delaySec = CONFIG.minDelayBetweenReplies +
            Math.random() * (CONFIG.maxDelayBetweenReplies - CONFIG.minDelayBetweenReplies);
          console.log(`⏳ انتظار ${Math.round(delaySec)} ثانية...`);
          await bot.randomDelay(delaySec * 1000, delaySec * 1000);
        }

        if (mentions.length === 0) {
          console.log('📭 لا يوجد منشنات جديدة');
        }

        // انتظار قبل الفحص التالي
        console.log(`\n⏱️  الفحص القادم بعد ${CONFIG.checkInterval} ثانية...`);
        await bot.randomDelay(CONFIG.checkInterval * 1000, CONFIG.checkInterval * 1000);

      } catch (error) {
        console.error('❌ خطأ في حلقة المراقبة:', error.message);
        await bot.randomDelay(30000, 60000); // انتظار قبل إعادة المحاولة
      }
    }

  } catch (error) {
    console.error('💥 خطأ فادح:', error.message);
  } finally {
    await bot.close();
  }
}

export { TikTokBot, createAIResponse, CONFIG };
export default main;

// تشغيل مباشر
main().catch(console.error);
