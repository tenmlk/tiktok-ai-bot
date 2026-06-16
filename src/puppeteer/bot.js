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
   * v8.3: مبسّط - إذا الكوكيز موجودة نعتبر مسجل
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
        waitUntil: 'networkidle2',
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

      // فحص سريع - هل الكوكيز فعّالة؟
      const hasSessionCookies = cookies.some(c => 
        ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_tt_ss', 'd_ticket'].includes(c.name)
      );

      if (hasSessionCookies) {
        this.isLoggedIn = true;
        console.log('✅ كوكيز الجلسة موجودة - مسجل الدخول! 🎉');
        return true;
      }

      // إذا ما عندنا كوكيز جلسة، تحقق من الصفحة
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
      // إذا عندنا كوكيز session، نعتبر مسجل
      if (CONFIG.sessionCookie.includes('sessionid') || CONFIG.sessionCookie.includes('sid_tt')) {
        this.isLoggedIn = true;
        console.log('⚠️ خطأ لكن الكوكيز موجودة - أعتبر مسجل الدخول');
        return true;
      }
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
   * v8.1: طريقة أكثر مرونة مع عدة محاولات
   */
  async checkIfLoggedIn() {
    try {
      // انتظار إضافي عشان الصفحة تتحمل
      await this.randomDelay(2000, 3000);

      // الطريقة 1: فحص العناصر في الصفحة
      const elementCheck = await this.page.evaluate(() => {
        const profileImg = document.querySelector('[data-e2e="profile-icon"]') ||
                           document.querySelector('[data-e2e="menu-profile"]') ||
                           document.querySelector('[class*="avatar"][class*="logged"]') ||
                           document.querySelector('img[alt*="profile"]') ||
                           document.querySelector('[data-e2e="profile-avatar"]');
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

      // الطريقة 3: فحص الكوكيز اللي نقدر نوصلها
      const cookieCheck = await this.page.evaluate(() => {
        const cookies = document.cookie;
        // إذا فيه sessionid أو sid_tt في الكوكيز = مسجل
        if (cookies.includes('sessionid') || cookies.includes('sid_tt') || 
            cookies.includes('uid_tt') || cookies.includes('d_ticket')) {
          return { loggedIn: true, method: 'cookies-present' };
        }
        return { loggedIn: null, method: 'no-session-cookies' };
      });

      if (cookieCheck.loggedIn === true) {
        console.log(`✅ تسجيل الدخول مؤكد (كوكيز: ${cookieCheck.method})`);
        return true;
      }

      // الطريقة 4: محاولة الوصول للبروفايل
      console.log('🔍 فحص البروفايل...');
      await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await this.randomDelay(3000, 5000);

      const profileCheck = await this.page.evaluate(() => {
        // إذا في زر Edit profile = مسجل دخول وحسابك
        const editBtn = document.querySelector('[data-e2e="edit-profile"]') ||
                       document.querySelector('button[data-e2e="profile-following"]');
        // إذا في زر Follow = ما عندك صلاحية (مو حسابك أو مو مسجل)
        const followBtn = document.querySelector('[data-e2e="follow-button"]');
        // إذا في username display
        const usernameEl = document.querySelector('[data-e2e="user-title"]');
        
        return {
          hasEdit: !!editBtn,
          hasFollow: !!followBtn,
          hasUsername: !!usernameEl
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

      // الطريقة 5: إذا عندنا كوكيز session، نعتبر مسجل حتى لو ما شفنا عنصر
      if (CONFIG.sessionCookie && (CONFIG.sessionCookie.includes('sessionid') || CONFIG.sessionCookie.includes('sid_tt'))) {
        console.log('⚠️ لم أجد عنصر تأكيد، لكن الكوكيز موجودة - أعتبر مسجل الدخول');
        return true;
      }

      console.log('⚠️ غير متأكد من حالة الدخول');
      return false;
    } catch (error) {
      console.error('❌ خطأ في فحص الدخول:', error.message);
      // إذا عندنا كوكيز session، نعتبر مسجل
      if (CONFIG.sessionCookie && (CONFIG.sessionCookie.includes('sessionid') || CONFIG.sessionCookie.includes('sid_tt'))) {
        console.log('⚠️ خطأ في الفحص لكن الكوكيز موجودة - أعتبر مسجل الدخول');
        return true;
      }
      return false;
    }
  }

  // ===================================
  // جلب المنشنات - 3 طرق + مساعدات
  // ===================================

  /**
   * الحصول على msToken من الكوكيز
   */
  async getMSToken() {
    try {
      const cookies = await this.page.cookies();
      const msToken = cookies.find(c => c.name === 'msToken');
      return msToken ? msToken.value : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * الطريقة 1: جلب المنشنات عبر API (مع msToken)
   */
  async fetchMentionsViaAPI() {
    console.log('📡 الطريقة 1: جلب المنشنات عبر API...');

    try {
      // دائماً اروح للصفحة الرئيسية أولاً
      await this.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);

      const mentions = [];

      // جرب group=2 (منشنات) و group=3 (تعليقات)
      for (const group of [2, 3]) {
        try {
          // الطريقة A: fetch
          const result = await this.page.evaluate(async (groupNum) => {
            try {
              // الطريقة 1: fetch
              const response = await fetch(`https://www.tiktok.com/api/inbox/notice_list/?group=${groupNum}&count=20`, {
                credentials: 'include',
                headers: {
                  'Accept': 'application/json'
                }
              });

              if (!response.ok) {
                return { error: `fetch HTTP ${response.status}`, method: 'fetch' };
              }

              const text = await response.text();

              let jsonText = text;
              if (text.startsWith('while(1)') || text.startsWith('for(;;)')) {
                jsonText = text.substring(text.indexOf('{'));
              }
              const firstBrace = jsonText.indexOf('{');
              if (firstBrace > 0) {
                jsonText = jsonText.substring(firstBrace);
              }

              const data = JSON.parse(jsonText);
              return { data, group: groupNum, rawKeys: Object.keys(data), method: 'fetch' };
            } catch (fetchErr) {
              // الطريقة 2: XMLHttpRequest
              try {
                return await new Promise((resolve) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open('GET', `https://www.tiktok.com/api/inbox/notice_list/?group=${groupNum}&count=20`, true);
                  xhr.withCredentials = true;
                  xhr.setRequestHeader('Accept', 'application/json');
                  xhr.onload = function() {
                    try {
                      let text = xhr.responseText;
                      if (text.startsWith('while(1)') || text.startsWith('for(;;)')) {
                        text = text.substring(text.indexOf('{'));
                      }
                      const fb = text.indexOf('{');
                      if (fb > 0) text = text.substring(fb);
                      const data = JSON.parse(text);
                      resolve({ data, group: groupNum, rawKeys: Object.keys(data), method: 'xhr' });
                    } catch (e) {
                      resolve({ error: `xhr parse: ${e.message}`, method: 'xhr' });
                    }
                  };
                  xhr.onerror = function() {
                    resolve({ error: `xhr error: ${xhr.status}`, method: 'xhr' });
                  };
                  xhr.send();
                });
              } catch (xhrErr) {
                return { error: `fetch: ${fetchErr.message}, xhr: ${xhrErr.message}`, method: 'both' };
              }
            }
          }, group);

          if (result.error) {
            console.log(`⚠️ API group=${group} خطأ (${result.method}): ${result.error}`);
            continue;
          }

          if (result.data) {
            console.log(`✅ API group=${group} رجع بيانات! (${result.method}) Keys: ${result.rawKeys?.join(', ')}`);

            // تسجيل هيكل البيانات للتصحيح
            const dataStr = JSON.stringify(result.data).substring(0, 800);
            console.log(`📋 API raw preview: ${dataStr}`);

            // محاولة استخراج القائمة بعدة طرق
            let noticeList = result.data.notice_list || result.data.notifications || 
                            result.data.data?.notice_list || result.data.data?.notifications ||
                            result.data.body?.notice_list || result.data.body?.notifications || [];

            // إذا القائمة فاضية، شوف إذا البيانات نفسها عبارة عن مصفوفة
            if (!Array.isArray(noticeList) || noticeList.length === 0) {
              // جرب الدخول أعمق
              for (const key of Object.keys(result.data)) {
                const val = result.data[key];
                if (Array.isArray(val) && val.length > 0) {
                  console.log(`📋 Found array at key: ${key} (${val.length} items)`);
                  noticeList = val;
                  break;
                }
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                  for (const subKey of Object.keys(val)) {
                    if (Array.isArray(val[subKey]) && val[subKey].length > 0) {
                      console.log(`📋 Found array at ${key}.${subKey} (${val[subKey].length} items)`);
                      noticeList = val[subKey];
                      break;
                    }
                  }
                  if (noticeList.length > 0) break;
                }
              }
            }

            console.log(`📋 عدد الإشعارات: ${noticeList.length}`);

            // إذا لسه ما لقينا شي، سجّل أول عنصر لو موجود
            if (noticeList.length > 0) {
              const sampleStr = JSON.stringify(noticeList[0]).substring(0, 300);
              console.log(`📋 عينة إشعار: ${sampleStr}`);
            }

            for (const notice of noticeList) {
              try {
                // استخراج النص بكل الطرق الممكنة
                const content = notice.content || notice.title || notice.body || notice.text || '';
                const username = notice.from_user?.unique_id || notice.from_user?.nickname || 
                               notice.user?.unique_id || notice.user?.nickname ||
                               notice.author?.unique_id || notice.from?.unique_id || '';
                const videoUrl = notice.target_url || notice.url || notice.link || 
                               notice.target?.url || notice.extra?.url || '';
                const commentText = notice.comment?.text || notice.comment?.content || 
                                   notice.content || notice.body || '';
                const noticeType = notice.type || notice.sub_type || notice.action_type || '';

                console.log(`📋 إشعار: type=${noticeType}, user=@${username}, url=${videoUrl}, content=${(commentText || content).substring(0, 60)}`);

                // تحقق إنه منشن - بطريقة مرنة
                const isMention = content.includes('@' + CONFIG.username) || 
                    commentText.includes('@' + CONFIG.username) ||
                    noticeType === 'mention' || noticeType === 'mention_comment' || 
                    noticeType === '3' || noticeType === 3 ||
                    String(noticeType).includes('mention');
                  
                if (isMention) {
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
                    console.log(`📬 منشن موجود! @${username}: ${(commentText || content).substring(0, 60)}`);
                  }
                }
              } catch (e) {
                console.log(`⚠️ خطأ في تحليل إشعار: ${e.message}`);
              }
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
   * الطريقة 2: مسح صفحة الإشعارات (محسّن)
   * v8.6: فحص أعمق + حفظ مرجع الإشعار للضغط عليه لاحقاً
   */
  async findMentionsInNotificationsPage() {
    console.log('🔔 الطريقة 2: مسح صفحة الإشعارات...');

    try {
      // جرب رابط الإشعارات المباشر
      await this.page.goto('https://www.tiktok.com/inbox?is_from_webapp=1&webapp_id=1988', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('notifications-page');

      const mentions = [];

      // استخراج كل الروابط والنصوص من الإشعارات
      // وتخزين العناصر للضغط عليها لاحقاً
      const notifData = await this.page.evaluate((botUsername) => {
        const results = [];
        
        // كل الروابط اللي فيها /video/
        const allLinks = document.querySelectorAll('a[href*="/video/"]');
        for (const a of allLinks) {
          const text = a.textContent?.trim() || '';
          const href = a.href || '';
          const parentText = a.closest('div')?.textContent?.trim() || text;
          
          // هل هذا منشن؟
          const isMention = text.includes('@' + botUsername) || 
                           parentText.includes('mentioned you') || 
                           parentText.includes('منشن') || parentText.includes('ذكر');
          
          results.push({
            text: parentText.substring(0, 300),
            url: href,
            type: isMention ? 'mention-link' : 'video-link',
            index: results.length
          });
        }

        // كل عناصر الإشعار
        const notifItems = document.querySelectorAll(
          '[data-e2e="inbox-notification"], [class*="notification"], [class*="Notification"], [class*="inbox-item"]'
        );
        for (const item of notifItems) {
          const text = item.textContent?.trim() || '';
          const link = item.querySelector('a')?.href || '';
          if (text.length > 5) {
            results.push({
              text: text.substring(0, 300),
              url: link,
              type: text.includes('mentioned') ? 'mention-notification' : 'notification-item',
              index: results.length
            });
          }
        }

        return results;
      }, CONFIG.username);

      console.log(`🔔 وجد ${notifData.length} عنصر في صفحة الإشعارات`);
      for (const item of notifData.slice(0, 10)) {
        console.log(`   📋 ${item.type}: "${item.text.substring(0, 60)}..." → ${item.url.substring(0, 60)}`);
      }

      // فلترة المنشنات
      for (const item of notifData) {
        if (item.type === 'mention-link' || item.type === 'mention-notification' ||
            item.text.includes('@' + CONFIG.username) || 
            item.text.toLowerCase().includes('mention') || 
            item.text.includes('منشن') || item.text.includes('ذكر')) {
          const mentionId = item.url || item.text.slice(0, 50);
          if (!CONFIG.repliedMentions.has(mentionId) && item.url) {
            const usernameMatch = item.text.match(/@(\w+)/);
            const mentioner = usernameMatch && usernameMatch[1] !== CONFIG.username ? usernameMatch[1] : 'user';
            mentions.push({
              text: item.text,
              mentioner: mentioner,
              videoUrl: item.url,
              id: mentionId,
              source: 'notifications-page',
              notifIndex: item.index
            });
          }
        }
      }

      console.log(`🔔 إشعارات: وجد ${mentions.length} منشن جديد`);
      
      // حفظ URL الإشعارات للضغط لاحقاً
      this._notificationsPageUrl = this.page.url();
      
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

      // جلب روابط الفيديوهات - بطريقة محسنة
      let videoLinks = await this.page.evaluate(() => {
        const links = [];
        // الطريقة 1: روابط الفيديو المباشرة
        const allAnchors = document.querySelectorAll('a');
        for (const a of allAnchors) {
          if (a.href && a.href.includes('/video/')) {
            links.push(a.href);
          }
        }
        // الطريقة 2: عناصر البوست
        const postItems = document.querySelectorAll('[data-e2e="user-post-item"], [data-e2e="user-post-item-list"]');
        for (const item of postItems) {
          const a = item.querySelector('a') || item.closest('a');
          if (a && a.href) {
            links.push(a.href);
          }
        }
        return [...new Set(links)].slice(0, 5);
      });

      // إذا ما لقينا فيديوهات، جرب التمرير لتحميلها
      if (videoLinks.length === 0) {
        console.log('⏳ لم أجد فيديوهات - أحاول التمرير...');
        await this.page.evaluate(() => window.scrollBy(0, 1000));
        await this.randomDelay(2000, 3000);
        await this.debugScreenshot('profile-scrolled');
        
        videoLinks = await this.page.evaluate(() => {
          const links = [];
          const allAnchors = document.querySelectorAll('a');
          for (const a of allAnchors) {
            if (a.href && a.href.includes('/video/')) {
              links.push(a.href);
            }
          }
          return [...new Set(links)].slice(0, 5);
        });
      }

      console.log(`🎬 وجد ${videoLinks.length} فيديو في البروفايل`);
      
      // سجّل كل الروابط اللي لقيناها
      if (videoLinks.length === 0) {
        // احفظ HTML للتحليل
        await this.debugHTML('profile-page');
        console.log('📄 تم حفظ HTML البروفايل للتحليل');
      }

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
   * الرد على تعليق المنشن
   * v8.6: الضغط على الإشعار بدل التنقل المباشر (لتجنب 403)
   */
  async replyToMention(mention) {
    console.log(`\n💬 الرد على @${mention.mentioner}...`);

    try {
      // v8.6: إذا المنشن من صفحة الإشعارات، نرجع للإشعارات ونضغط على الرابط
      // هذا يمنع HTTP 403 من تيك توك
      if (mention.source === 'notifications-page' && mention.videoUrl) {
        console.log('🔗 الرجوع لصفحة الإشعارات والضغط على الرابط...');
        
        // الرجوع لصفحة الإشعارات
        await this.page.goto('https://www.tiktok.com/inbox?is_from_webapp=1&webapp_id=1988', {
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        await this.randomDelay(2000, 3000);

        // الضغط على رابط الإشعار اللي فيه المنشن
        const clicked = await this.clickNotificationLink(mention);
        if (clicked) {
          await this.randomDelay(3000, 5000);
          await this.debugScreenshot('video-from-notification');
          
          // فحص هل الصفحة تحملت بنجاح
          const pageStatus = await this.page.evaluate(() => {
            return {
              is403: document.title?.includes('403') || document.body?.textContent?.includes('ERROR 403'),
              isVideo: !!document.querySelector('video') || !!document.querySelector('[data-e2e="browse-video"]'),
              title: document.title?.substring(0, 50)
            };
          });

          console.log(`📋 حالة الصفحة: title="${pageStatus.title}", is403=${pageStatus.is403}, isVideo=${pageStatus.isVideo}`);

          if (pageStatus.is403) {
            console.log('⚠️ صفحة 403 - جرب mobile web...');
            // جرب نسخة الموبايل
            await this.page.goto(mention.videoUrl.replace('www.tiktok.com', 'm.tiktok.com'), {
              waitUntil: 'networkidle2',
              timeout: 60000
            });
            await this.randomDelay(3000, 5000);
          }

          if (pageStatus.isVideo || !pageStatus.is403) {
            // محاولة الرد المباشر
            const foundAndClickedReply = await this.findAndClickReply(mention);
            
            if (foundAndClickedReply) {
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
            const posted = await this.postNewComment(null, reply);
            if (posted) {
              CONFIG.repliedMentions.add(mention.id);
              console.log('✅ تم نشر تعليق جديد! 🎉');
              return true;
            }
          }
        }
      }

      // الطريقة القديمة: التنقل المباشر (fallback)
      if (mention.videoUrl) {
        console.log(`🔗 التنقل المباشر للفيديو: ${mention.videoUrl}`);
        await this.page.goto(mention.videoUrl, {
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        await this.randomDelay(3000, 5000);
        await this.debugScreenshot('video-direct');

        // فحص 403
        const is403 = await this.page.evaluate(() => 
          document.title?.includes('403') || document.body?.textContent?.includes('ERROR 403')
        );
        if (is403) {
          console.log('❌ HTTP 403 - تم حظر الوصول');
          return false;
        }

        const foundAndClickedReply = await this.findAndClickReply(mention);
        if (foundAndClickedReply) {
          const reply = await createAIResponse(mention.text, '', mention.mentioner);
          const submitted = await this.writeAndSubmitReply(reply);
          if (submitted) {
            CONFIG.repliedMentions.add(mention.id);
            console.log('✅ تم نشر الرد! 🎉');
            return true;
          }
        }

        const reply = await createAIResponse(mention.text, '', mention.mentioner);
        const posted = await this.postNewComment(null, reply);
        if (posted) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تم نشر تعليق جديد! 🎉');
          return true;
        }
      }

      return false;

    } catch (error) {
      console.error('❌ خطأ في الرد:', error.message);
      return false;
    }
  }

  /**
   * الضغط على رابط إشعار المنشن في صفحة الإشعارات
   */
  async clickNotificationLink(mention) {
    try {
      // البحث عن رابط الإشعار والضغط عليه
      const clicked = await this.page.evaluate((videoUrl) => {
        // دور الرابط اللي يطابق URL الفيديو
        const allLinks = document.querySelectorAll('a[href*="/video/"]');
        for (const a of allLinks) {
          if (a.href === videoUrl || a.href.includes(videoUrl.split('/video/')[1]?.split('?')[0])) {
            a.click();
            return true;
          }
        }
        
        // إذا ما لقيناه، جرب الضغط على أول رابط فيه "mentioned"
        const allAnchors = document.querySelectorAll('a');
        for (const a of allAnchors) {
          const text = a.textContent || '';
          if (text.includes('mentioned') || text.includes('منشن')) {
            a.click();
            return true;
          }
        }
        
        return false;
      }, mention.videoUrl);

      if (clicked) {
        console.log('✅ تم الضغط على رابط الإشعار');
        await this.randomDelay(2000, 3000);
        return true;
      }

      console.log('⚠️ لم أجد رابط الإشعار للضغط');
      return false;

    } catch (error) {
      console.error('❌ خطأ في الضغط على الإشعار:', error.message);
      return false;
    }
  }

  /**
   * البحث عن تعليق المنشن والضغط على زر الرد
   * v8.5: محسّن مع تحميل أفضل للتعليقات
   */
  async findAndClickReply(mention) {
    try {
      // فتح قسم التعليقات إذا كان مغلق
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) {
        await commentBtn.click();
        await this.randomDelay(3000, 5000);
        console.log('✅ تم فتح قسم التعليقات');
      }

      // تمرير لتحميل التعليقات
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => {
          const container = document.querySelector('[class*="comment"]') || document.querySelector('[data-e2e="comment-list"]');
          if (container) container.scrollTop = container.scrollHeight;
          window.scrollBy(0, 500);
        });
        await this.randomDelay(1000, 2000);
      }

      await this.debugScreenshot('comments-section');

      // البحث عن التعليق اللي فيه منشن البوت
      const replyClicked = await this.page.evaluate((botUsername) => {
        // كل التعليقات المحتملة
        const commentSelectors = [
          '[data-e2e="comment-level-1"]',
          '[class*="comment-item"]', 
          '[class*="CommentItem"]',
          '[class*="CommentContent"]',
          '[class*="comment-content"]',
          'div[class*="comment"]'
        ];

        for (const selector of commentSelectors) {
          const comments = document.querySelectorAll(selector);
          for (const comment of comments) {
            const text = comment.textContent || '';
            
            if (text.includes('@' + botUsername)) {
              // دور زر الرد
              const replyBtn = comment.querySelector('[data-e2e="reply-button"]') ||
                             comment.querySelector('[class*="reply"]') ||
                             comment.querySelector('[class*="Reply"]') ||
                             comment.querySelector('span[class*="reply"]');
              
              if (replyBtn) {
                replyBtn.click();
                return { found: true, commentText: text.substring(0, 150) };
              }
            }
          }
        }

        // طريقة بديلة: دور كل أزرار الرد واضغط على اللي قريب من @botUsername
        const allReplyBtns = document.querySelectorAll('[data-e2e="reply-button"]');
        for (const btn of allReplyBtns) {
          const parent = btn.closest('div');
          if (parent && parent.textContent?.includes('@' + botUsername)) {
            btn.click();
            return { found: true, commentText: parent.textContent.substring(0, 150) };
          }
        }

        return { found: false };
      }, CONFIG.username);

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
   * v8.5: محسّن مع selectors أكثر
   */
  async writeAndSubmitReply(replyText) {
    try {
      // البحث عن خانة الرد - عدة محاولات
      const replySelectors = [
        'textarea[placeholder*="reply" i]',
        'textarea[placeholder*="رد" i]',
        'textarea[placeholder*="Add a reply" i]',
        'div[contenteditable="true"]',
        'textarea[class*="reply"]',
        'textarea[class*="Reply"]',
        '[data-e2e="reply-input"] textarea',
        '[data-e2e="reply-input"]',
        'textarea'
      ];

      let replyInput = null;
      for (const selector of replySelectors) {
        replyInput = await this.page.$(selector);
        if (replyInput) {
          console.log(`✅ وجدت خانة الرد: ${selector}`);
          break;
        }
      }

      if (!replyInput) {
        console.log('⚠️ لم أجد خانة الرد بكل السيلكتورات');
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
      const submitSelectors = [
        '[data-e2e="comment-submit"]',
        'button[type="submit"]',
        '[class*="comment-post"]',
        '[data-e2e="reply-submit"]',
        'button[class*="submit"]'
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        const btn = await this.page.$(selector);
        if (btn) {
          await btn.click();
          submitted = true;
          console.log(`✅ تم الضغط على زر الإرسال: ${selector}`);
          break;
        }
      }

      if (!submitted) {
        await this.page.keyboard.press('Enter');
        console.log('✅ تم إرسال بالضغط على Enter');
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
   * v8.5: محسّن مع فتح قسم التعليقات
   */
  async postNewComment(videoUrl, comment) {
    try {
      await this.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);

      // فتح قسم التعليقات
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) {
        await commentBtn.click();
        await this.randomDelay(2000, 3000);
        console.log('✅ تم فتح قسم التعليقات');
      }

      await this.debugScreenshot('comment-section');

      // البحث عن خانة التعليق
      const commentSelectors = [
        '[data-e2e="comment-input"] textarea',
        '[data-e2e="comment-input"]',
        'textarea[placeholder*="comment" i]',
        'textarea[placeholder*="تعليق" i]',
        'textarea[placeholder*="Add a comment" i]',
        'div[contenteditable="true"]',
        'textarea[placeholder]',
        'textarea'
      ];

      let commentInput = null;
      for (const selector of commentSelectors) {
        commentInput = await this.page.$(selector);
        if (commentInput) {
          console.log(`✅ وجدت خانة التعليق: ${selector}`);
          break;
        }
      }

      if (!commentInput) {
        console.log('❌ لم أجد خانة التعليق بكل السيلكتورات');
        await this.debugScreenshot('no-comment-input');
        return false;
      }

      await commentInput.click();
      await this.randomDelay(500, 1000);

      await this.page.keyboard.type(comment, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      const submitSelectors = [
        '[data-e2e="comment-submit"]',
        'button[type="submit"]',
        '[class*="comment-post"]'
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        const btn = await this.page.$(selector);
        if (btn) {
          await btn.click();
          submitted = true;
          break;
        }
      }

      if (!submitted) {
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

    // بعد تسجيل الدخول، ارجع للصفحة الرئيسية عشان API يشتغل صح
    if (loggedIn) {
      console.log('🏠 العودة للصفحة الرئيسية...');
      await bot.page.goto('https://www.tiktok.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await bot.randomDelay(2000, 3000);
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
