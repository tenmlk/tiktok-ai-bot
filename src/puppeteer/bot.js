/**
 * ===================================
 * بوت تيك توك الذكي - v8.0 Stealth API
 * ===================================
 * 
 * ابتكارات v8.0:
 * - جلب المنشنات عبر API مع credentials: 'include' (الكوكيز ترسل تلقائياً)
 * - مسح صفحة الإشعارات كطريقة بديلة
 * - مسح فيديوهات البوت كطريقة احتياطية
 * - إصلاح مشكلة httpOnly cookies
 * - رد مباشر على تعليق المنشن (مش تعليق جديد)
 * - لقطات شاشة للتصحيح
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
  repliedMentions: new Set(),
  debugDir: process.env.DEBUG_DIR || '/tmp/bot-debug'
};

// ===================================
// ردود ذكية احتياطية (إذا فشل AI)
// ===================================

const SMART_REPLIES = {
  ar: [
    'أهلاً! شكراً على المنشن 🙏',
    'هلا والله! نورتنا ✨',
    'يسعدني إنك ذكرتني! 😊',
    'مشكور على المنشن! 💪',
    'حبيبي! شكراً لك 🌟',
    'يا هلا! وينك من زمان 🔥',
    'أحسنت! كلام سليم 👏',
    'الله يعطيك العافية! ❤️'
  ],
  en: [
    'Hey! Thanks for the mention! 🙏',
    'Hello there! Nice to see you ✨',
    'Thanks for tagging me! 😊',
    'Appreciate the mention! 💪',
    'Great point! 🌟',
    'Awesome! 🔥',
    'Well said! 👏',
    'Love it! ❤️'
  ]
};

function getSmartReply(username) {
  const lang = CONFIG.language;
  const replies = SMART_REPLIES[lang] || SMART_REPLIES.ar;
  const reply = replies[Math.floor(Math.random() * replies.length)];
  return `@${username} ${reply}`;
}

// ===================================
// نظام الذكاء الاصطناعي
// ===================================

async function createAIResponse(mentionText, videoDescription, mentionerUsername) {
  const safety = checkContentSafety(mentionText);
  if (!safety.isSafe) {
    console.log(`⚠️ محتوى غير آمن: ${safety.category}`);
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
      return getSmartReply(mentionerUsername);
    }

    const responseSafety = checkContentSafety(response);
    if (!responseSafety.isSafe) {
      return getRefusalResponse(responseSafety.category);
    }

    if (!response.startsWith(`@${mentionerUsername}`)) {
      response = `@${mentionerUsername} ${response}`;
    }

    // تأكد أن الرد أقل من 150 حرف
    if (response.length > 150) {
      response = response.substring(0, 147) + '...';
    }

    return response;

  } catch (error) {
    console.error('❌ خطأ في توليد الرد:', error.message);
    return getSmartReply(mentionerUsername);
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
    this.runId = Date.now();
  }

  async init() {
    console.log('🌐 تشغيل المتصفح بخوض التخفي (Stealth v8.0)...');

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
        '--lang=ar-SA',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
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
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ar-SA', 'ar', 'en-US', 'en']
      });
    });

    // إنشاء مجلد التصحيح
    try {
      const fs = await import('fs');
      fs.mkdirSync(CONFIG.debugDir, { recursive: true });
    } catch (e) {}

    console.log('✅ المتصفح Stealth v8.0 جاهز');
  }

  /**
   * أخذ لقطة شاشة للتصحيح
   */
  async debugScreenshot(name) {
    try {
      const path = `${CONFIG.debugDir}/${name}-${this.runId}.png`;
      await this.page.screenshot({ path, fullPage: false });
      console.log(`📸 لقطة: ${name}`);
    } catch (e) {}
  }

  /**
   * حفظ HTML للتصحيح
   */
  async debugHTML(name) {
    try {
      const fs = await import('fs');
      const path = `${CONFIG.debugDir}/${name}-${this.runId}.html`;
      const html = await this.page.content();
      fs.writeFileSync(path, html);
      console.log(`📄 HTML: ${name}`);
    } catch (e) {}
  }

  // ===================================
  // تسجيل الدخول
  // ===================================

  /**
   * تسجيل الدخول بالكوكيز (الطريقة الأفضل)
   * v8.0: إصلاح httpOnly cookies
   */
  async loginWithCookies() {
    if (!CONFIG.sessionCookie) {
      console.log('⚠️ لا يوجد TIKTOK_SESSION');
      return false;
    }

    console.log('🍪 محاولة تسجيل الدخول بالكوكيز...');

    try {
      // فتح تيك توك أولاً
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.randomDelay(2000, 3000);

      // تحليل الكوكيز وفصلها
      const cookiePairs = CONFIG.sessionCookie.split(';').filter(c => c.trim());
      const cookies = [];

      for (const pair of cookiePairs) {
        const [name, ...valueParts] = pair.trim().split('=');
        const value = valueParts.join('=').trim();
        if (!name || !value) continue;

        const cookieObj = {
          name: name.trim(),
          value: value,
          domain: '.tiktok.com',
          path: '/',
          secure: true,
          sameSite: 'None'
        };

        // الكوكيز المهمة اللي تكون httpOnly
        const httpOnlyNames = ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_tt_ss', 'uid_tt', 'uid_tt_ss', 'odin_tt', 'odin_tt_ss'];
        if (httpOnlyNames.includes(name.trim())) {
          cookieObj.httpOnly = true;
        } else {
          cookieObj.httpOnly = false;
        }

        cookies.push(cookieObj);
      }

      await this.page.setCookie(...cookies);
      console.log(`✅ تم تحميل ${cookies.length} كوكيز`);
      console.log(`📋 أسماء الكوكيز: ${cookies.map(c => c.name).join(', ')}`);

      // إعادة تحميل الصفحة بالكوكيز الجديدة
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);

      await this.debugScreenshot('after-cookie-login');

      const loggedIn = await this.checkIfLoggedIn();
      if (loggedIn) {
        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بالكوكيز! 🎉');
        return true;
      }

      console.log('❌ فشل تسجيل الدخول بالكوكيز');
      return false;
    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول بالكوكيز:', error.message);
      return false;
    }
  }

  /**
   * تسجيل الدخول باليوزر والباسورد
   */
  async loginWithPassword() {
    if (!CONFIG.username || !CONFIG.password) {
      console.log('⚠️ لا يوجد بيانات دخول (يوزر/باسورد)');
      return false;
    }

    console.log(`🔑 تسجيل الدخول باسم @${CONFIG.username}...`);

    try {
      await this.page.goto('https://www.tiktok.com/login/phone-or-email/email', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('login-page');

      // إدخال اسم المستخدم
      const usernameInput = await this.page.$('input[name="username"]') ||
                             await this.page.$('input[type="text"]') ||
                             await this.page.$('input[placeholder*="email"]');

      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 });
        await this.randomDelay(500, 1000);
        await this.page.keyboard.type(CONFIG.username, { delay: 80 + Math.random() * 120 });
        console.log('✅ تم إدخال اسم المستخدم');
      }

      await this.randomDelay(1500, 2500);

      // إدخال كلمة المرور
      const passwordInput = await this.page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await this.randomDelay(500, 1000);
        await this.page.keyboard.type(CONFIG.password, { delay: 80 + Math.random() * 120 });
        console.log('✅ تم إدخال كلمة المرور');
      }

      await this.randomDelay(1500, 2500);

      // الضغط على زر تسجيل الدخول
      const loginButton = await this.page.$('button[data-e2e="login-button"]') ||
                           await this.page.$('button[type="submit"]');
      if (loginButton) {
        await loginButton.click();
        console.log('✅ تم الضغط على زر الدخول');
      }

      await this.randomDelay(5000, 8000);
      await this.handleCaptcha();
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('after-password-login');

      const loggedIn = await this.checkIfLoggedIn();
      if (loggedIn) {
        this.isLoggedIn = true;
        console.log('✅ تم تسجيل الدخول بالباسورد! 🎉');
        return true;
      }

      console.log('❌ فشل تسجيل الدخول بالباسورد');
      return false;
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
      const captchaExists = await this.page.evaluate(() => {
        const slider = document.querySelector('[class*="captcha-slider"]') ||
                       document.querySelector('[class*="verify"]') ||
                       document.querySelector('iframe[src*="captcha"]');
        const imgCaptcha = document.querySelector('[class*="captcha"]') ||
                          document.querySelector('[id*="captcha"]');
        return !!(slider || imgCaptcha);
      });

      if (captchaExists) {
        console.log('🤖 تم اكتشاف CAPTCHA - محاولة التخطي...');

        const slider = await this.page.$('[class*="slider"]') ||
                       await this.page.$('[class*="drag"]');
        if (slider) {
          const box = await slider.boundingBox();
          if (box) {
            await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await this.page.mouse.down();
            await this.page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 30 });
            await this.page.mouse.up();
            await this.randomDelay(2000, 3000);
          }
        }
      }
    } catch (error) {}
  }

  /**
   * تحقق هل المستخدم مسجل دخول
   */
  async checkIfLoggedIn() {
    try {
      // الطريقة 1: فحص العناصر في الصفحة
      const elementCheck = await this.page.evaluate(() => {
        const profileImg = document.querySelector('[data-e2e="profile-icon"]') ||
                           document.querySelector('[class*="avatar"]') ||
                           document.querySelector('[data-e2e="menu-profile"]');
        const loginBtn = document.querySelector('[data-e2e="login-button"]') ||
                        document.querySelector('a[href="/login"]');

        if (profileImg) return { loggedIn: true, method: 'profile-icon' };
        if (loginBtn) return { loggedIn: false, method: 'login-button-found' };
        return { loggedIn: null, method: 'uncertain' };
      });

      if (elementCheck.loggedIn === true) {
        console.log(`✅ تسجيل الدخول مؤكد (عنصر: ${elementCheck.method})`);
        return true;
      }
      if (elementCheck.loggedIn === false) {
        console.log(`❌ زر الدخول موجود - غير مسجل`);
        return false;
      }

      // الطريقة 2: فحص URL
      const url = this.page.url();
      if (url.includes('/login') || url.includes('/signup')) {
        console.log('❌ لسه في صفحة تسجيل الدخول');
        return false;
      }

      // الطريقة 3: محاولة الوصول للبروفايل
      await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await this.randomDelay(2000, 3000);

      const profileCheck = await this.page.evaluate(() => {
        // إذا في زر Edit profile = مسجل دخول وحسابك
        const editBtn = document.querySelector('[data-e2e="edit-profile"]') ||
                       document.querySelector('button[data-e2e="profile-following"]');
        // إذا في زر Follow = ما عندك صلاحية (مو حسابك أو مو مسجل)
        const followBtn = document.querySelector('[data-e2e="follow-button"]');
        
        return {
          hasEdit: !!editBtn,
          hasFollow: !!followBtn
        };
      });

      if (profileCheck.hasEdit) {
        console.log('✅ زر تعديل الملف موجود - مسجل الدخول!');
        return true;
      }
      if (profileCheck.hasFollow) {
        console.log('❌ زر متابعة موجود - غير مسجل الدخول');
        return false;
      }

      console.log('⚠️ غير متأكد من حالة الدخول');
      return false;
    } catch (error) {
      console.error('❌ خطأ في فحص الدخول:', error.message);
      return false;
    }
  }

  // ===================================
  // جلب المنشنات - 3 طرق
  // ===================================

  /**
   * الطريقة 1: جلب المنشنات عبر API (الأقوى)
   * v8.0: استخدام page.evaluate(fetch()) مع credentials: 'include'
   * هذا يضمن إن الكوكيز (حتى httpOnly) ترسل مع الطلب
   */
  async fetchMentionsViaAPI() {
    console.log('📡 الطريقة 1: جلب المنشنات عبر API...');

    try {
      // التأكد إننا في تيك توك
      if (!this.page.url().includes('tiktok.com')) {
        await this.page.goto('https://www.tiktok.com', {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await this.randomDelay(2000, 3000);
      }

      const mentions = [];

      // جرب group=2 (منشنات) و group=3 (تعليقات)
      for (const group of [2, 3]) {
        try {
          const result = await this.page.evaluate(async (groupNum) => {
            try {
              const response = await fetch(`/api/inbox/notice_list/?group=${groupNum}&count=20`, {
                credentials: 'include',
                headers: {
                  'Accept': 'application/json'
                }
              });

              if (!response.ok) {
                return { error: `HTTP ${response.status}`, status: response.status };
              }

              const text = await response.text();

              // TikTok يضيف بادئة XSSI أحياناً
              let jsonText = text;
              if (text.startsWith('while(1)') || text.startsWith('for(;;)')) {
                jsonText = text.substring(text.indexOf('{'));
              }
              // إزالة أي بادئة غريبة
              const firstBrace = jsonText.indexOf('{');
              if (firstBrace > 0) {
                jsonText = jsonText.substring(firstBrace);
              }

              const data = JSON.parse(jsonText);
              return { data, group: groupNum };
            } catch (e) {
              return { error: e.message };
            }
          }, group);

          if (result.error) {
            console.log(`⚠️ API group=${group} خطأ: ${result.error}`);
            continue;
          }

          if (result.data) {
            console.log(`✅ API group=${group} رجع بيانات!`);
            const noticeList = result.data.notice_list || result.data.notifications || [];

            for (const notice of noticeList) {
              try {
                const content = notice.content || notice.title || notice.body || '';
                const username = notice.from_user?.unique_id || notice.from_user?.nickname || notice.user?.unique_id || '';
                const videoUrl = notice.target_url || notice.url || notice.link || '';
                const commentText = notice.comment?.text || notice.content || '';

                // تحقق إنه منشن
                if (content.includes('@' + CONFIG.username) || 
                    commentText.includes('@' + CONFIG.username) ||
                    notice.type === 'mention' || notice.sub_type === 'mention') {
                  
                  const mentionId = notice.id || notice.create_time || (videoUrl + commentText).slice(0, 50);
                  
                  if (!CONFIG.repliedMentions.has(String(mentionId))) {
                    mentions.push({
                      text: commentText || content,
                      mentioner: username,
                      videoUrl: videoUrl,
                      id: String(mentionId),
                      source: 'api',
                      group: group
                    });
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {
          console.log(`⚠️ خطأ API group=${group}:`, e.message);
        }
      }

      console.log(`📡 API: وجد ${mentions.length} منشن جديد`);
      return mentions;

    } catch (error) {
      console.error('❌ خطأ في API:', error.message);
      return [];
    }
  }

  /**
   * الطريقة 2: مسح صفحة الإشعارات
   */
  async findMentionsInNotificationsPage() {
    console.log('🔔 الطريقة 2: مسح صفحة الإشعارات...');

    try {
      await this.page.goto('https://www.tiktok.com/notifications', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('notifications-page');

      // محاولة الضغط على تبويب المنشنات
      try {
        const mentionTab = await this.page.$('[data-e2e="mention-tab"]') ||
                           await this.page.$('div[class*="mention"]') ||
                           await this.page.evaluateHandle(() => {
                             const tabs = document.querySelectorAll('div[class*="tab"], span[class*="tab"]');
                             for (const tab of tabs) {
                               if (tab.textContent.includes('Mention') || tab.textContent.includes('منشن')) {
                                 return tab;
                               }
                             }
                             return null;
                           });
        if (mentionTab) {
          await mentionTab.click();
          await this.randomDelay(2000, 3000);
          console.log('✅ تم الضغط على تبويب المنشنات');
        }
      } catch (e) {}

      const mentions = [];

      // البحث عن روابط الفيديوهات في الإشعارات
      const notificationLinks = await this.page.evaluate((botUsername) => {
        const links = [];
        const anchors = document.querySelectorAll('a[href*="/video/"], a[href*="/v/"]');
        
        for (const a of anchors) {
          const text = a.textContent || '';
          const href = a.href || '';
          
          if (text.includes('@' + botUsername) || text.includes('mentioned') || text.includes('منشن') || text.includes('ذكر')) {
            links.push({
              text: text.trim().substring(0, 200),
              url: href
            });
          }
        }
        
        return links;
      }, CONFIG.username);

      for (const link of notificationLinks) {
        const mentionId = link.url || link.text.slice(0, 50);
        if (!CONFIG.repliedMentions.has(mentionId)) {
          // استخراج اسم المستخدم من النص
          const usernameMatch = link.text.match(/@(\w+)/);
          const mentioner = usernameMatch ? usernameMatch[1] : 'user';

          mentions.push({
            text: link.text,
            mentioner: mentioner !== CONFIG.username ? mentioner : 'user',
            videoUrl: link.url,
            id: mentionId,
            source: 'notifications-page'
          });
        }
      }

      console.log(`🔔 إشعارات: وجد ${mentions.length} منشن جديد`);
      return mentions;

    } catch (error) {
      console.error('❌ خطأ في صفحة الإشعارات:', error.message);
      return [];
    }
  }

  /**
   * الطريقة 3: مسح فيديوهات البوت نفسه (احتياطي)
   * يروح لبروفايل البوت ويفحص التعليقات
   */
  async findMentionsInMyVideos() {
    console.log('🎬 الطريقة 3: مسح فيديوهات البوت...');

    try {
      await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('bot-profile');

      // جلب روابط الفيديوهات
      const videoLinks = await this.page.evaluate(() => {
        const links = [];
        const items = document.querySelectorAll('a[href*="/video/"], div[data-e2e="user-post-item"] a');
        for (const item of items) {
          const href = item.href || item.querySelector('a')?.href || '';
          if (href.includes('/video/')) {
            links.push(href);
          }
        }
        return [...new Set(links)].slice(0, 5); // أول 5 فيديوهات
      });

      console.log(`🎬 وجد ${videoLinks.length} فيديو في البروفايل`);

      const mentions = [];

      // فحص كل فيديو
      for (const videoUrl of videoLinks) {
        try {
          console.log(`📺 فحص: ${videoUrl}`);
          await this.page.goto(videoUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000
          });
          await this.randomDelay(2000, 3000);

          // فتح قسم التعليقات
          const commentBtn = await this.page.$('[data-e2e="comment-button"], [class*="comment-icon"]');
          if (commentBtn) {
            await commentBtn.click();
            await this.randomDelay(2000, 3000);
          }

          // البحث عن تعليقات فيها @منشن البوت
          const commentMentions = await this.page.evaluate((botUsername) => {
            const results = [];
            const comments = document.querySelectorAll('[data-e2e="comment-level-1"], [class*="comment-item"], div[class*="CommentContent"]');
            
            for (const comment of comments) {
              const text = comment.textContent || '';
              if (text.includes('@' + botUsername)) {
                const userMatch = text.match(/@(\w+)/);
                const username = userMatch && userMatch[1] !== botUsername ? userMatch[1] : 'user';
                
                results.push({
                  text: text.trim().substring(0, 200),
                  mentioner: username,
                  hasReplyButton: !!comment.querySelector('[data-e2e="reply-button"], [class*="reply"]')
                });
              }
            }
            return results;
          }, CONFIG.username);

          for (const cm of commentMentions) {
            const mentionId = `${videoUrl}::${cm.mentioner}::${cm.text.slice(0, 30)}`;
            if (!CONFIG.repliedMentions.has(mentionId)) {
              mentions.push({
                text: cm.text,
                mentioner: cm.mentioner,
                videoUrl: videoUrl,
                id: mentionId,
                source: 'own-videos'
              });
            }
          }

        } catch (e) {
          console.log(`⚠️ خطأ في فحص الفيديو:`, e.message);
        }
      }

      console.log(`🎬 فيديوهات البوت: وجد ${mentions.length} منشن`);
      return mentions;

    } catch (error) {
      console.error('❌ خطأ في مسح الفيديوهات:', error.message);
      return [];
    }
  }

  /**
   * جلب كل المنشنات (الطرق الثلاث مع بعض)
   */
  async getAllMentions() {
    console.log('📥 ═══════════════════════════════');
    console.log('📥 فحص المنشنات الجديدة (3 طرق)...');
    console.log('📥 ═══════════════════════════════');

    let allMentions = [];

    // الطريقة 1: API
    const apiMentions = await this.fetchMentionsViaAPI();
    allMentions = allMentions.concat(apiMentions);

    // إذا API ما رجع شي، جرب الطريقة 2
    if (allMentions.length === 0) {
      const notifMentions = await this.findMentionsInNotificationsPage();
      allMentions = allMentions.concat(notifMentions);
    }

    // إذا لسه ما فيه شي، جرب الطريقة 3
    if (allMentions.length === 0) {
      const videoMentions = await this.findMentionsInMyVideos();
      allMentions = allMentions.concat(videoMentions);
    }

    // إزالة التكرار
    const uniqueMentions = [];
    const seenIds = new Set();
    for (const m of allMentions) {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        uniqueMentions.push(m);
      }
    }

    console.log(`\n📊 النتيجة الإجمالية: ${uniqueMentions.length} منشن جديد`);
    for (const m of uniqueMentions) {
      console.log(`   📬 [@${m.mentioner}]: "${m.text.substring(0, 60)}..." (via ${m.source})`);
    }

    return uniqueMentions;
  }

  // ===================================
  // جلب تفاصيل الفيديو
  // ===================================

  async getVideoDetails(videoUrl) {
    try {
      await this.page.goto(videoUrl, {
        waitUntil: 'domcontentloaded',
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

  // ===================================
  // الرد على التعليقات
  // ===================================

  /**
   * الرد على تعليق المنشن مباشرة (مش تعليق جديد)
   * يفتح الفيديو، يدور التعليق اللي فيه المنشن، يضغط رد، ويكتب
   */
  async replyToMention(mention) {
    console.log(`\n💬 الرد على @${mention.mentioner}...`);

    try {
      // فتح الفيديو
      await this.page.goto(mention.videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('video-page');

      // فتح قسم التعليقات
      const commentBtn = await this.page.$('[data-e2e="comment-button"], [class*="comment-icon"]');
      if (commentBtn) {
        await commentBtn.click();
        await this.randomDelay(2000, 3000);
      }

      // البحث عن تعليق المنشن والضغط على "رد"
      const foundAndClickedReply = await this.findAndClickReply(mention);
      
      if (foundAndClickedReply) {
        // كتابة الرد
        const reply = await createAIResponse(mention.text, '', mention.mentioner);
        console.log(`💬 الرد: "${reply}"`);

        const submitted = await this.writeAndSubmitReply(reply);
        if (submitted) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تم نشر الرد! 🎉');
          return true;
        }
      }

      // إذا فشل الرد المباشر، جرب تعليق جديد
      console.log('⚠️ فشل الرد المباشر - جرب تعليق جديد...');
      const reply = await createAIResponse(mention.text, '', mention.mentioner);
      const posted = await this.postNewComment(mention.videoUrl, reply);
      if (posted) {
        CONFIG.repliedMentions.add(mention.id);
        console.log('✅ تم نشر تعليق جديد! 🎉');
        return true;
      }

      return false;

    } catch (error) {
      console.error('❌ خطأ في الرد:', error.message);
      return false;
    }
  }

  /**
   * البحث عن تعليق المنشن والضغط على زر الرد
   */
  async findAndClickReply(mention) {
    try {
      // تمرير لتحميل التعليقات
      await this.page.evaluate(() => {
        const commentSection = document.querySelector('[class*="comment"], [data-e2e="comment-list"]');
        if (commentSection) {
          commentSection.scrollTop = commentSection.scrollHeight;
        }
        window.scrollBy(0, 300);
      });
      await this.randomDelay(1000, 2000);

      // البحث عن التعليق اللي فيه منشن البوت
      const replyClicked = await this.page.evaluate((botUsername, mentionerName) => {
        const comments = document.querySelectorAll('[data-e2e="comment-level-1"], [class*="comment-item"], div[class*="CommentContent"]');
        
        for (const comment of comments) {
          const text = comment.textContent || '';
          
          // تحقق إن التعليق فيه @botUsername ويفضل يكون من mentionerName
          if (text.includes('@' + botUsername)) {
            // دور زر الرد
            const replyBtn = comment.querySelector('[data-e2e="reply-button"]') ||
                           comment.querySelector('[class*="reply"]') ||
                           comment.querySelector('span[class*="Reply"]');
            
            if (replyBtn) {
              replyBtn.click();
              return { found: true, commentText: text.substring(0, 100) };
            }
          }
        }
        return { found: false };
      }, CONFIG.username, mention.mentioner);

      if (replyClicked.found) {
        console.log(`✅ وجدت التعليق وضغطت رد: "${replyClicked.commentText}"`);
        await this.randomDelay(1000, 2000);
        return true;
      }

      console.log('⚠️ لم أجد التعليق أو زر الرد');
      return false;

    } catch (error) {
      console.error('❌ خطأ في البحث عن التعليق:', error.message);
      return false;
    }
  }

  /**
   * كتابة وإرسال الرد في خانة الرد
   */
  async writeAndSubmitReply(replyText) {
    try {
      // البحث عن خانة الرد
      const replyInput = await this.page.$(
        'textarea[placeholder*="reply" i], ' +
        'textarea[placeholder*="رد" i], ' +
        'textarea[placeholder*="Add a reply" i], ' +
        'div[contenteditable="true"][data-e2e="reply-input"], ' +
        'textarea[class*="reply"], ' +
        'textarea[class*="Reply"]'
      );

      if (!replyInput) {
        console.log('⚠️ لم أجد خانة الرد');
        await this.debugScreenshot('no-reply-input');
        return false;
      }

      // الضغط على الخانة
      await replyInput.click();
      await this.randomDelay(500, 1000);

      // كتابة الرد حرف بحرف (طبيعي)
      await this.page.keyboard.type(replyText, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      // إرسال الرد
      const submitBtn = await this.page.$(
        '[data-e2e="comment-submit"], ' +
        'button[type="submit"], ' +
        '[class*="comment-post"], ' +
        'button[data-e2e="reply-submit"]'
      );

      if (submitBtn) {
        await submitBtn.click();
      } else {
        await this.page.keyboard.press('Enter');
      }

      await this.randomDelay(2000, 3000);
      await this.debugScreenshot('after-reply');
      console.log(`✅ تم إرسال الرد: "${replyText}"`);
      return true;

    } catch (error) {
      console.error('❌ خطأ في كتابة الرد:', error.message);
      return false;
    }
  }

  /**
   * نشر تعليق جديد (بديل إذا فشل الرد المباشر)
   */
  async postNewComment(videoUrl, comment) {
    try {
      await this.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);

      // فتح التعليقات
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
        await this.debugScreenshot('no-comment-input');
        return false;
      }

      await commentInput.click();
      await this.randomDelay(500, 1000);

      await this.page.keyboard.type(comment, { delay: 30 + Math.random() * 70 });
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
      await this.debugScreenshot('after-comment');
      console.log(`✅ تم نشر التعليق: "${comment}"`);
      return true;

    } catch (error) {
      console.error('❌ خطأ في نشر التعليق:', error.message);
      return false;
    }
  }

  // ===================================
  // أدوات مساعدة
  // ===================================

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
║      🤖 بوت تيك توك الذكي v8.0          ║
║      Stealth API + 3 طرق كشف            ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  const bot = new TikTokBot();

  try {
    await bot.init();

    // تسجيل الدخول
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
      console.log('1. كوكيز الجلسة في TIKTOK_SESSION');
      console.log('   كيفية الحصول عليها:');
      console.log('   - افتح تيك توك في المتصفح');
      console.log('   - افتح DevTools > Network > أي طلب');
      console.log('   - انسخ قيمة Cookie من Headers');
      console.log('');
      console.log('2. أو بيانات الدخول:');
      console.log('   TIKTOK_USERNAME و TIKTOK_PASSWORD');
      console.log('═══════════════════════════════════════');
      await bot.close();
      return;
    }

    // فحص المنشنات
    const singleRun = process.env.SINGLE_RUN === 'true';

    do {
      try {
        const mentions = await bot.getAllMentions();

        for (const mention of mentions.slice(0, CONFIG.maxRepliesPerRun)) {
          console.log(`\n📬 ═══════════════════════════════`);
          console.log(`📬 منشن جديد من @${mention.mentioner} (via ${mention.source})`);
          console.log(`📬 النص: "${mention.text.substring(0, 80)}..."`);
          console.log(`📬 ═══════════════════════════════`);

          const replied = await bot.replyToMention(mention);

          if (replied) {
            const delaySec = CONFIG.minDelayBetweenReplies +
              Math.random() * (CONFIG.maxDelayBetweenReplies - CONFIG.minDelayBetweenReplies);
            console.log(`⏳ انتظار ${Math.round(delaySec)} ثانية...`);
            await bot.randomDelay(delaySec * 1000, delaySec * 1000);
          }
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
