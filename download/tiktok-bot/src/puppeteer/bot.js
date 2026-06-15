/**
 * ===================================
 * بوت تيك توك الذكي - v4.0 Stealth
 * ===================================
 * 
 * يستخدم puppeteer-extra + stealth plugin
 * لتخطي كشف البوتات في تيك توك
 * يشتغل على GitHub Actions (مجاني - بدون بطاقة)
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import ZAI from 'z-ai-web-dev-sdk';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';

// تفعيل وضع التخفي!
puppeteerExtra.use(StealthPlugin());

// ===================================
// إعدادات البوت
// ===================================

const CONFIG = {
  username: process.env.TIKTOK_USERNAME || '',
  password: process.env.TIKTOK_PASSWORD || '',
  sessionCookie: process.env.TIKTOK_SESSION || '',
  maxRepliesPerRun: parseInt(process.env.MAX_REPLIES_PER_RUN) || 5,
  personality: process.env.BOT_PERSONALITY || 'friendly',
  language: process.env.BOT_LANGUAGE || 'ar',
  safeMode: process.env.SAFE_MODE !== 'false',
  minDelayBetweenReplies: 5,
  maxDelayBetweenReplies: 15,
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
// متصفح Puppeteer Stealth
// ===================================

class TikTokBot {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
  }

  async init() {
    console.log('🌐 تشغيل المتصفح بخوض التخفي (Stealth)...');

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    this.browser = await puppeteerExtra.launch({
      headless: 'new',
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-acceleration-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--lang=ar-SA'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });

    // User-Agent حقيقي
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // إخفاء خصائص البوت
    await this.page.evaluateOnNewDocument(() => {
      // إخفاء webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // إخفاء chrome.runtime
      window.chrome = { runtime: {} };
      // إضافة plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      // إضافة languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ar-SA', 'ar', 'en-US', 'en']
      });
    });

    console.log('✅ المتصفح Stealth جاهز');
  }

  /**
   * تسجيل الدخول باليوزر والباسورد (مع وضع التخفي)
   */
  async loginWithPassword() {
    if (!CONFIG.username || !CONFIG.password) {
      console.log('❌ لا يوجد بيانات دخول!');
      return false;
    }

    console.log(`🔑 تسجيل الدخول باسم @${CONFIG.username} (وضع Stealth)...`);

    try {
      // فتح صفحة تسجيل الدخول
      await this.page.goto('https://www.tiktok.com/login/phone-or-email/email', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);

      // إدخال اسم المستخدم
      const usernameInput = await this.page.$('input[name="username"]') ||
                             await this.page.$('input[type="text"]') ||
                             await this.page.$('input[placeholder*="email"]') ||
                             await this.page.$('input[placeholder*="بريد"]');

      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 });
        await this.randomDelay(500, 1000);
        await this.page.keyboard.type(CONFIG.username, { delay: 80 + Math.random() * 120 });
        console.log('✅ تم إدخال اسم المستخدم');
      } else {
        console.log('⚠️ لم أجد خانة اسم المستخدم');
      }

      await this.randomDelay(1500, 2500);

      // إدخال كلمة المرور
      const passwordInput = await this.page.$('input[type="password"]');

      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await this.randomDelay(500, 1000);
        await this.page.keyboard.type(CONFIG.password, { delay: 80 + Math.random() * 120 });
        console.log('✅ تم إدخال كلمة المرور');
      } else {
        console.log('⚠️ لم أجد خانة كلمة المرور');
      }

      await this.randomDelay(1500, 2500);

      // الضغط على زر تسجيل الدخول
      const loginButton = await this.page.$('button[data-e2e="login-button"]') ||
                           await this.page.$('button[type="submit"]') ||
                           await this.page.$('button[class*="login"]');

      if (loginButton) {
        await loginButton.click();
        console.log('✅ تم الضغط على زر الدخول');
      }

      // انتظار أطول عشان تيك توك يعالج الطلب
      await this.randomDelay(5000, 8000);

      // محاولة التعامل مع CAPTCHA تلقائياً
      await this.handleCaptcha();

      // انتظار إضافي بعد CAPTCHA
      await this.randomDelay(3000, 5000);

      // التحقق من تسجيل الدخول
      const loggedIn = await this.checkIfLoggedIn();

      if (loggedIn) {
        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بنجاح! 🎉');
        return true;
      } else {
        // فحص هل لسه في صفحة login
        const currentUrl = this.page.url();
        console.log('📍 URL الحالي:', currentUrl);

        if (currentUrl.includes('login')) {
          console.log('⚠️ لا زلنا في صفحة تسجيل الدخول');

          // محاولة الضغط على زر الدخول مرة ثانية
          const retryButton = await this.page.$('button[data-e2e="login-button"]') ||
                               await this.page.$('button[type="submit"]');
          if (retryButton) {
            await retryButton.click();
            await this.randomDelay(5000, 8000);
            const retryLoggedIn = await this.checkIfLoggedIn();
            if (retryLoggedIn) {
              this.isLoggedIn = true;
              console.log('✅ تم تسجيل الدخول في المحاولة الثانية! 🎉');
              return true;
            }
          }
        }

        console.log('❌ فشل تسجيل الدخول');
        return false;
      }

    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error.message);
      return false;
    }
  }

  /**
   * محاولة التعامل مع CAPTCHA
   */
  async handleCaptcha() {
    try {
      // فحص هل فيه CAPTCHA
      const captchaExists = await this.page.evaluate(() => {
        // Slide CAPTCHA
        const slider = document.querySelector('[class*="captcha-slider"]') ||
                       document.querySelector('[class*="verify"]') ||
                       document.querySelector('iframe[src*="captcha"]');
        // Image CAPTCHA
        const imgCaptcha = document.querySelector('[class*="captcha"]') ||
                          document.querySelector('[id*="captcha"]');
        return !!(slider || imgCaptcha);
      });

      if (captchaExists) {
        console.log('🤖 تم اكتشاف CAPTCHA - محاولة التخطي...');

        // محاولة الضغط على زر التحقق إذا موجود
        const verifyButton = await this.page.$('button[class*="verify"]') ||
                             await this.page.$('button[class*="confirm"]');
        if (verifyButton) {
          await verifyButton.click();
          await this.randomDelay(2000, 3000);
        }

        // محاولة سحب الشريط (slider captcha)
        const slider = await this.page.$('[class*="slider"]') ||
                       await this.page.$('[class*="drag"]');
        if (slider) {
          const box = await slider.boundingBox();
          if (box) {
            await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await this.page.mouse.down();
            await this.page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, {
              steps: 30
            });
            await this.page.mouse.up();
            await this.randomDelay(2000, 3000);
          }
        }
      }
    } catch (error) {
      // تجاهل أخطاء CAPTCHA
    }
  }

  /**
   * تسجيل الدخول بالكوكيز (بديل)
   */
  async loginWithCookies() {
    if (!CONFIG.sessionCookie) {
      return false;
    }

    console.log('🍪 محاولة تسجيل الدخول بالكوكيز...');

    try {
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(2000, 3000);

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

      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);

      const loggedIn = await this.checkIfLoggedIn();
      if (loggedIn) {
        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بالكوكيز!');
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * تحقق هل المستخدم مسجل دخول
   */
  async checkIfLoggedIn() {
    try {
      const result = await this.page.evaluate(() => {
        const profileImg = document.querySelector('[data-e2e="profile-icon"]') ||
                           document.querySelector('[class*="avatar"]') ||
                           document.querySelector('[data-e2e="menu-profile"]');
        const loginBtn = document.querySelector('[data-e2e="login-button"]') ||
                        document.querySelector('a[href="/login"]');
        
        if (profileImg) return true;
        if (loginBtn) return false;

        const cookies = document.cookie;
        return cookies.includes('sessionid') || cookies.includes('sid_tt');
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
      await this.page.goto('https://www.tiktok.com/inbox', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);

      const mentions = [];

      try {
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
        console.log('⚠️ لم أجد إشعارات - أحاول صفحة المنشنات...');
        
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

      let commentInput = await this.page.$(
        '[data-e2e="comment-input"] textarea, ' +
        'textarea[placeholder], ' +
        'div[contenteditable="true"], ' +
        '[class*="comment-input"]'
      );

      if (!commentInput) {
        const commentButton = await this.page.$('[data-e2e="comment-button"], [class*="comment-icon"]');
        if (commentButton) {
          await commentButton.click();
          await this.randomDelay(2000, 3000);
        }
        commentInput = await this.page.$(
          '[data-e2e="comment-input"] textarea, ' +
          'textarea[placeholder], ' +
          'div[contenteditable="true"]'
        );
      }

      if (!commentInput) {
        console.log('❌ لم أجد خانة التعليق');
        return false;
      }

      await commentInput.click();
      await this.randomDelay(500, 1000);

      await this.page.keyboard.type(comment, { delay: 20 + Math.random() * 50 });
      await this.randomDelay(500, 1000);

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
║      🤖 بوت تيك توك الذكي v4.0          ║
║      Stealth + ذكاء اصطناعي              ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  const bot = new TikTokBot();

  try {
    await bot.init();

    // محاولة تسجيل الدخول: كوكيز أولاً، بعدين يوزر/باسورد
    let loggedIn = false;

    if (CONFIG.sessionCookie) {
      loggedIn = await bot.loginWithCookies();
    }

    if (!loggedIn && CONFIG.username && CONFIG.password) {
      loggedIn = await bot.loginWithPassword();
    }

    if (!loggedIn) {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('❌ فشل تسجيل الدخول!');
      console.log('');
      console.log('تأكد من:');
      console.log('1. بيانات الدخول صحيحة في GitHub Secrets');
      console.log('   TIKTOK_USERNAME و TIKTOK_PASSWORD');
      console.log('');
      console.log('2. أو استخدم كوكيز الجلسة:');
      console.log('   TIKTOK_SESSION=sessionid=xxx; sid_tt=xxx');
      console.log('═══════════════════════════════════════');
      await bot.close();
      return;
    }

    // فحص المنشنات
    console.log('🔄 فحص المنشنات...');

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

          const reply = await createAIResponse(mention.text, videoDescription, mentionerUsername);
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
