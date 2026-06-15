/**
 * ===================================
 * بوت تيك توك الذكي - v3.0 كوكيز
 * ===================================
 * 
 * يستخدم كوكيز الجلسة بدل تسجيل الدخول
 * يراقب المنشنات ويرد عليها تلقائياً بالذكاء الاصطناعي
 * يشتغل على GitHub Actions (مجاني - بدون بطاقة)
 */

import puppeteer from 'puppeteer';
import ZAI from 'z-ai-web-dev-sdk';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';

// ===================================
// إعدادات البوت
// ===================================

const CONFIG = {
  // اسم المستخدم (للقراءة فقط - ما نسوي منه تسجيل دخول)
  username: process.env.TIKTOK_USERNAME || '',

  // كوكيز الجلسة (الأهم!)
  sessionCookie: process.env.TIKTOK_SESSION || '',

  // إعدادات المراقبة
  maxRepliesPerRun: parseInt(process.env.MAX_REPLIES_PER_RUN) || 5,

  // إعدادات البوت
  personality: process.env.BOT_PERSONALITY || 'friendly',
  language: process.env.BOT_LANGUAGE || 'ar',
  safeMode: process.env.SAFE_MODE !== 'false',

  // إعدادات الحماية من الحظر (مختصرة للاختبار)
  minDelayBetweenReplies: 5,    // 5 ثواني بين كل رد (للاختبار)
  maxDelayBetweenReplies: 15,   // 15 ثانية أقصى

  // منشنات تم الرد عليها
  repliedMentions: new Set()
};

// ===================================
// نظام الذكاء الاصطناعي
// ===================================

async function createAIResponse(mentionText, videoDescription, mentionerUsername) {
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
          content: `شخص منشنك في تيك توك:
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

  async init() {
    console.log('🌐 تشغيل المتصفح...');

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    this.browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
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

    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('✅ المتصفح جاهز');
  }

  /**
   * تسجيل الدخول بالكوكيز (بدون فتح صفحة تسجيل الدخول!)
   */
  async loginWithCookies() {
    if (!CONFIG.sessionCookie) {
      console.log('❌ لا يوجد كوكيز جلسة!');
      console.log('أضف TIKTOK_SESSION في GitHub Secrets');
      return false;
    }

    console.log('🍪 تسجيل الدخول بالكوكيز...');

    try {
      // فتح تيك توك أول شي عشان نقدر نحط الكوكيز
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(2000, 3000);

      // حط الكوكيز
      const cookies = CONFIG.sessionCookie.split(';').map(cookie => {
        const [name, ...valueParts] = cookie.trim().split('=');
        return {
          name: name.trim(),
          value: valueParts.join('=').trim(),
          domain: '.tiktok.com',
          path: '/',
          httpOnly: false,
          secure: true
        };
      }).filter(c => c.name && c.value);

      await this.page.setCookie(...cookies);

      console.log(`✅ تم تحميل ${cookies.length} كوكيز`);

      // أعد تحميل الصفحة بالكوكيز الجديدة
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);

      // تحقق هل نسجلنا دخول
      const loggedIn = await this.checkIfLoggedIn();

      if (loggedIn) {
        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بنجاح بالكوكيز!');
        return true;
      } else {
        console.log('❌ الكوكيز ما اشتغلت - يمكن انتهت صلاحيتها');
        return false;
      }

    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول بالكوكيز:', error.message);
      return false;
    }
  }

  /**
   * محاولة تسجيل الدخول باليوزر والباسورد (احتياطي)
   */
  async loginWithPassword() {
    const username = process.env.TIKTOK_USERNAME || '';
    const password = process.env.TIKTOK_PASSWORD || '';

    if (!username || !password) {
      console.log('⚠️ لا يوجد بيانات دخول (يوزر/باسورد)');
      return false;
    }

    console.log(`🔑 محاولة تسجيل الدخول باسم @${username}...`);

    try {
      await this.page.goto('https://www.tiktok.com/login', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(2000, 4000);

      // الضغط على تبويب اسم المستخدم
      const emailTab = await this.page.$('[data-e2e="login-username"]') ||
                        await this.page.$('input[name="username"]');
      if (emailTab) {
        await emailTab.click();
        await this.randomDelay(1000, 2000);
      }

      // إدخال اسم المستخدم
      const usernameInput = await this.page.$('input[name="username"]') ||
                             await this.page.$('input[type="text"]');
      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 });
        await this.page.keyboard.type(username, { delay: 50 + Math.random() * 100 });
      }

      await this.randomDelay(1000, 2000);

      // إدخال كلمة المرور
      const passwordInput = await this.page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await this.page.keyboard.type(password, { delay: 50 + Math.random() * 100 });
      }

      await this.randomDelay(1000, 2000);

      // الضغط على زر تسجيل الدخول
      const loginButton = await this.page.$('button[data-e2e="login-button"]') ||
                           await this.page.$('button[type="submit"]');
      if (loginButton) {
        await loginButton.click();
      }

      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      await this.randomDelay(3000, 5000);

      const loggedIn = await this.checkIfLoggedIn();

      if (loggedIn) {
        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بنجاح!');
        return true;
      } else {
        console.log('⚠️ فشل تسجيل الدخول - يمكن بسبب CAPTCHA');
        return false;
      }

    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error.message);
      return false;
    }
  }

  /**
   * تحقق هل المستخدم مسجل دخول
   */
  async checkIfLoggedIn() {
    try {
      // فحص هل فيه عنصر يدل إنه مسجل دخول
      const result = await this.page.evaluate(() => {
        // فحص وجود صورة الملف الشخصي أو زر تسجيل الخروج
        const profileImg = document.querySelector('[data-e2e="profile-icon"]') ||
                           document.querySelector('[class*="avatar"]') ||
                           document.querySelector('[data-e2e="menu-profile"]');
        const loginButton = document.querySelector('[data-e2e="login-button"]') ||
                           document.querySelector('a[href="/login"]');
        
        if (profileImg) return true;
        if (loginButton) return false;
        
        // فحص الكوكيز
        const cookies = document.cookie;
        return cookies.includes('sessionid') || cookies.includes('sid_tt') || cookies.includes('sid_guard');
      });

      return result;
    } catch (error) {
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

      // أخذ سكرين شوت للتصحيح
      try {
        await this.page.screenshot({ path: 'debug_inbox.png', fullPage: false });
        console.log('📸 تم أخذ سكرين شوت للإنبوكس');
      } catch (e) {}

      const mentions = [];

      try {
        // محاولة جلب عناصر الإشعارات
        const notificationElements = await this.page.$$(
          '[data-e2e="inbox-notification"], .notification-item, [class*="notification"], [class*="Notification"]'
        );

        console.log(`🔍 وجد ${notificationElements.length} إشعار`);

        for (const element of notificationElements.slice(0, 20)) {
          try {
            const text = await element.evaluate(el => el.textContent || '');
            const link = await element.evaluate(el => {
              const a = el.querySelector('a');
              return a ? a.href : '';
            });

            // التحقق إنه منشن
            if (text.includes('@' + CONFIG.username) || 
                text.toLowerCase().includes('mentioned') || 
                text.includes('ذكر')) {
              mentions.push({
                text: text.trim(),
                link: link,
                id: link || text.slice(0, 50)
              });
            }
          } catch (e) {}
        }

      } catch (error) {
        console.log('⚠️ لم يتم العثور على إشعارات - يمكن تيك توك غيّر التصميم');

        // محاولة بديلة: فحص صفحة المنشنات مباشرة
        try {
          await this.page.goto('https://www.tiktok.com/inbox?filter=mentions', {
            waitUntil: 'networkidle2',
            timeout: 60000
          });

          await this.randomDelay(3000, 5000);

          const mentionElements = await this.page.$$('[class*="mention"], [class*="Mention"], a[href*="/@"]');
          for (const element of mentionElements.slice(0, 10)) {
            try {
              const text = await element.evaluate(el => el.textContent || '');
              const link = await element.evaluate(el => el.href || '');
              if (text.trim()) {
                mentions.push({
                  text: text.trim(),
                  link: link,
                  id: link || text.slice(0, 50)
                });
              }
            } catch (e) {}
          }
        } catch (e2) {}
      }

      const newMentions = mentions.filter(m => !CONFIG.repliedMentions.has(m.id));

      console.log(`📬 وجد ${newMentions.length} منشن جديد`);
      return newMentions;

    } catch (error) {
      console.error('❌ خطأ في جلب المنشنات:', error.message);
      return [];
    }
  }

  /**
   * جلب تفاصيل الفيديو
   */
  async getVideoDetails(videoUrl) {
    try {
      await this.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(2000, 3000);

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
        console.log('⚠️ لم يتم العثور على خانة التعليق');

        // محاولة الضغط على زر التعليقات أول
        const commentButton = await this.page.$('[data-e2e="comment-button"], [class*="comment-icon"]');
        if (commentButton) {
          await commentButton.click();
          await this.randomDelay(2000, 3000);
        }

        // محاولة مرة ثانية
        const commentInput2 = await this.page.$(
          '[data-e2e="comment-input"] textarea, ' +
          'textarea[placeholder], ' +
          'div[contenteditable="true"]'
        );

        if (!commentInput2) {
          console.log('❌ ما حصلت خانة التعليق');
          return false;
        }

        await commentInput2.click();
      } else {
        await commentInput.click();
      }

      await this.randomDelay(500, 1000);

      // كتابة التعليق
      await this.page.keyboard.type(comment, {
        delay: 20 + Math.random() * 50
      });

      await this.randomDelay(500, 1000);

      // الضغط على زر الإرسال
      const submitButton = await this.page.$(
        '[data-e2e="comment-submit"], ' +
        'button[type="submit"], ' +
        '[class*="comment-post"]'
      );

      if (submitButton) {
        await submitButton.click();
      } else {
        await this.page.keyboard.press('Enter');
      }

      await this.randomDelay(2000, 3000);
      console.log(`✅ تم نشر التعليق: "${comment}"`);
      return true;

    } catch (error) {
      console.error('❌ خطأ في نشر التعليق:', error.message);
      return false;
    }
  }

  async randomDelay(min = 1000, max = 3000) {
    const delay = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

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
║      🤖 بوت تيك توك الذكي v3.0          ║
║      كوكيز + ذكاء اصطناعي               ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  const bot = new TikTokBot();

  try {
    // 1. تشغيل المتصفح
    await bot.init();

    // 2. محاولة تسجيل الدخول (كوكيز أولاً، بعدين باسورد)
    let loggedIn = false;

    if (CONFIG.sessionCookie) {
      loggedIn = await bot.loginWithCookies();
    }

    if (!loggedIn) {
      console.log('🔄 محاولة تسجيل الدخول باليوزر والباسورد...');
      loggedIn = await bot.loginWithPassword();
    }

    if (!loggedIn) {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('❌ فشل تسجيل الدخول!');
      console.log('');
      console.log('📋 الحل: استخدم كوكيز الجلسة:');
      console.log('1. افتح تيك توك في متصفحك');
      console.log('2. سجل دخولك');
      console.log('3. اضغط F12 > Application > Cookies');
      console.log('4. انسخ كوكيز sessionid و sid_tt');
      console.log('5. أضفها في GitHub Secrets:');
      console.log('   Name: TIKTOK_SESSION');
      console.log('   Value: sessionid=xxx; sid_tt=xxx; sid_guard=xxx');
      console.log('═══════════════════════════════════════');
      console.log('');
      await bot.close();
      return;
    }

    // 3. فحص المنشنات
    console.log('🔄 فحص المنشنات...');
    console.log('');

    const singleRun = process.env.SINGLE_RUN === 'true';

    do {
      try {
        const mentions = await bot.getNewMentions();

        for (const mention of mentions.slice(0, CONFIG.maxRepliesPerRun)) {
          console.log(`\n📬 منشن جديد: "${mention.text.substring(0, 80)}..."`);

          const mentionerMatch = mention.text.match(/@(\w+)/);
          const mentionerUsername = mentionerMatch ? mentionerMatch[1] : 'user';

          let videoDescription = '';
          if (mention.link) {
            const details = await bot.getVideoDetails(mention.link);
            videoDescription = details.description;
          }

          const reply = await createAIResponse(
            mention.text,
            videoDescription,
            mentionerUsername
          );

          console.log(`💬 الرد: "${reply}"`);

          if (mention.link) {
            const posted = await bot.postComment(mention.link, reply);
            if (posted) {
              CONFIG.repliedMentions.add(mention.id);
              console.log('✅ تم النشر!');
            } else {
              console.log('❌ فشل النشر');
            }
          }

          // تأخير بين الردود
          const delaySec = CONFIG.minDelayBetweenReplies +
            Math.random() * (CONFIG.maxDelayBetweenReplies - CONFIG.minDelayBetweenReplies);
          console.log(`⏳ انتظار ${Math.round(delaySec)} ثانية...`);
          await bot.randomDelay(delaySec * 1000, delaySec * 1000);
        }

        if (mentions.length === 0) {
          console.log('📭 لا يوجد منشنات جديدة');
        }

        if (!singleRun) {
          const checkInterval = parseInt(process.env.CHECK_INTERVAL) || 60;
          console.log(`\n⏱️ الفحص القادم بعد ${checkInterval} ثانية...`);
          await bot.randomDelay(checkInterval * 1000, checkInterval * 1000);
        }

      } catch (error) {
        console.error('❌ خطأ في حلقة المراقبة:', error.message);
        if (singleRun) break;
        await bot.randomDelay(30000, 60000);
      }
    } while (!singleRun);

  } catch (error) {
    console.error('💥 خطأ فادح:', error.message);
  } finally {
    await bot.close();
  }
}

export { TikTokBot, createAIResponse, CONFIG };
export default main;

main().catch(console.error);
