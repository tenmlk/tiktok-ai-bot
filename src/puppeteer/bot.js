/**
 * ===================================
 * بوت تيك توك الذكي - v9.0 Anti-Detect
 * ===================================
 * 
 * ابتكارات v9.0:
 * - إصلاح HTTP 403: تعيين كوكيز قبل فتح أي صفحة
 * - إصلاح 404: روابط صحيحة للإشعارات
 * - اعتراض طلبات الشبكة لمعرفة API الصحيح
 * - تشغيل JavaScript المطلوب قبل التحميل
 * - تسجيل دخول تلقائي بالباسورد كـ fallback
 * - أفضل إخفاء البوت (navigator, chrome object, etc.)
 * - استخدام page.setCookie قبل goTo (السر الأساسي!)
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import ZAI from 'z-ai-web-dev-sdk';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';

puppeteerExtra.use(StealthPlugin());

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
    if (!response) return getSmartReply(mentionerUsername);

    const responseSafety = checkContentSafety(response);
    if (!responseSafety.isSafe) return getRefusalResponse(responseSafety.category);

    if (!response.startsWith(`@${mentionerUsername}`)) {
      response = `@${mentionerUsername} ${response}`;
    }
    if (response.length > 150) response = response.substring(0, 147) + '...';
    return response;
  } catch (error) {
    console.error('❌ خطأ في توليد الرد:', error.message);
    return getSmartReply(mentionerUsername);
  }
}

class TikTokBot {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.runId = Date.now();
    this.apiIntercepted = [];
  }

  async init() {
    console.log('🌐 تشغيل المتصفح Stealth v9.0 (Anti-Detect)...');
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
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=ImprovedCookieControls',
        '--disable-features=SameSiteByDefaultCookies',
        '--user-data-dir=/tmp/chrome-user-data'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });

    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // v9.0: إخفاء خصائص البوت المحسّن
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
      window.chrome = {
        runtime: { connect(){}, sendMessage(){}, onMessage:{ addListener(){} }, id: undefined },
        loadTimes() { return {}; },
        csi() { return {}; },
        app: { isInstalled: false }
      };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' }
        ]
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) => (
        params.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          origQuery(params)
      );
    });

    // ===================================
    // v9.0 السر: تعيين الكوكيز قبل أي تنقل!
    // هذا يمنع HTTP 403 لأن تيك توك يشوف الكوكيز من أول طلب
    // ===================================
    if (CONFIG.sessionCookie) {
      console.log('🍪 تعيين الكوكيز قبل فتح أي صفحة (v9.0 anti-403)...');
      const cookies = this.parseCookies(CONFIG.sessionCookie);
      await this.page.setCookie(...cookies);
      console.log(`✅ تم تعيين ${cookies.length} كوكيز قبل التحميل`);
    }

    // v9.0: اعتراض طلبات الشبكة
    this.page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') && url.includes('tiktok.com')) {
        try {
          const status = response.status();
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json') || url.includes('notice_list') || url.includes('inbox') || url.includes('comment')) {
            const text = await response.text().catch(() => '');
            this.apiIntercepted.push({
              url: url.substring(0, 200),
              status,
              bodyLength: text.length,
              bodyPreview: text.substring(0, 300),
              timestamp: Date.now()
            });
            console.log(`📡 API: ${url.substring(0, 80)} → ${status} (${text.length}b)`);
          }
        } catch (e) {}
      }
    });

    try {
      const fs = await import('fs');
      fs.mkdirSync(CONFIG.debugDir, { recursive: true });
    } catch (e) {}

    console.log('✅ المتصفح v9.0 جاهز (anti-403 + API intercept)');
  }

  parseCookies(cookieStr) {
    return cookieStr.split(';').filter(c => c.trim()).map(pair => {
      const [name, ...valueParts] = pair.trim().split('=');
      const value = valueParts.join('=').trim();
      if (!name || !value) return null;
      const httpOnlyNames = ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_tt_ss', 'uid_tt', 'uid_tt_ss', 'odin_tt', 'odin_tt_ss'];
      return {
        name: name.trim(),
        value,
        domain: '.tiktok.com',
        path: '/',
        secure: true,
        sameSite: 'None',
        url: 'https://www.tiktok.com',
        httpOnly: httpOnlyNames.includes(name.trim())
      };
    }).filter(Boolean);
  }

  async debugScreenshot(name) {
    try {
      const path = `${CONFIG.debugDir}/${name}-${this.runId}.png`;
      await this.page.screenshot({ path, fullPage: false });
      console.log(`📸 لقطة: ${name}`);
    } catch (e) {}
  }

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

  async login() {
    console.log('\n🔑 تسجيل الدخول...');

    try {
      await this.page.goto('https://www.tiktok.com/', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
    } catch (e) {
      console.log(`⚠️ خطأ تحميل: ${e.message}`);
      await this.randomDelay(3000, 5000);
      try {
        await this.page.goto('https://www.tiktok.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
      } catch (e2) {
        console.log(`❌ فشل تحميل مرتين`);
      }
    }

    await this.randomDelay(3000, 5000);
    await this.debugScreenshot('homepage');

    const homeStatus = await this.page.evaluate(() => ({
      title: document.title?.substring(0, 100),
      is403: document.title?.includes('403') || document.body?.textContent?.includes('ERROR 403'),
      is404: document.title?.includes('404'),
      hasLoginBtn: !!document.querySelector('[data-e2e="login-button"]'),
      hasProfile: !!document.querySelector('[data-e2e="profile-icon"]'),
      url: window.location.href
    }));

    console.log(`📋 الصفحة الرئيسية: title="${homeStatus.title}", 403=${homeStatus.is403}, profile=${homeStatus.hasProfile}`);

    if (homeStatus.is403) {
      console.log('🚫 403! جرب mobile UA...');
      await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
      // أعد تعيين الكوكيز مع UA الجديد
      if (CONFIG.sessionCookie) {
        const cookies = this.parseCookies(CONFIG.sessionCookie);
        await this.page.setCookie(...cookies);
      }
      await this.page.goto('https://www.tiktok.com/', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('homepage-mobile');
    }

    const loggedIn = await this.checkIfLoggedIn();
    if (loggedIn) {
      this.isLoggedIn = true;
      console.log('✅ تم تسجيل الدخول! 🎉');
      return true;
    }

    // Fallback: جرب الباسورد
    console.log('⚠️ الكوكيز ما نفعت - جرب الباسورد...');
    if (await this.loginWithPassword()) {
      this.isLoggedIn = true;
      console.log('✅ تم تسجيل الدخول بالباسورد! 🎉');
      return true;
    }

    console.log('❌ فشل تسجيل الدخول!');
    return false;
  }

  async loginWithPassword() {
    if (!CONFIG.username || !CONFIG.password) return false;
    console.log(`🔑 تسجيل دخول بالباسورد: @${CONFIG.username}...`);

    try {
      await this.page.goto('https://www.tiktok.com/login/phone-or-email/email', {
        waitUntil: 'networkidle2', timeout: 60000
      });
      await this.randomDelay(3000, 5000);

      const usernameInput = await this.page.$('input[name="username"]') ||
                             await this.page.$('input[type="text"]');
      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 });
        await this.randomDelay(500, 1000);
        await this.page.keyboard.type(CONFIG.username, { delay: 80 + Math.random() * 120 });
      }

      await this.randomDelay(1500, 2500);
      const passwordInput = await this.page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await this.randomDelay(500, 1000);
        await this.page.keyboard.type(CONFIG.password, { delay: 80 + Math.random() * 120 });
      }

      await this.randomDelay(1500, 2500);
      const loginBtn = await this.page.$('button[data-e2e="login-button"]') ||
                        await this.page.$('button[type="submit"]');
      if (loginBtn) await loginBtn.click();

      await this.randomDelay(5000, 8000);
      // CAPTCHA handler
      const slider = await this.page.$('[class*="slider"]') || await this.page.$('[class*="drag"]');
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
      await this.randomDelay(3000, 5000);
      return await this.checkIfLoggedIn();
    } catch (e) {
      console.error('❌ خطأ:', e.message);
      return false;
    }
  }

  async checkIfLoggedIn() {
    try {
      await this.randomDelay(2000, 3000);

      const check = await this.page.evaluate(() => {
        const profile = document.querySelector('[data-e2e="profile-icon"]') ||
                       document.querySelector('[data-e2e="menu-profile"]');
        const loginBtn = document.querySelector('[data-e2e="login-button"]');
        if (profile) return { loggedIn: true, method: 'profile' };
        if (loginBtn) return { loggedIn: false, method: 'login-btn' };
        return { loggedIn: null, method: 'uncertain' };
      });

      if (check.loggedIn === true) { console.log(`✅ مسجل (${check.method})`); return true; }
      if (check.loggedIn === false) { console.log(`❌ غير مسجل (${check.method})`); return false; }

      // فحص الكوكيز
      const cookies = await this.page.cookies();
      const hasSession = cookies.some(c => ['sessionid', 'sid_tt', 'd_ticket'].includes(c.name));
      if (hasSession) { console.log('✅ كوكيز جلسة موجودة'); return true; }

      // فحص البروفايل
      await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await this.randomDelay(3000, 5000);

      const profileCheck = await this.page.evaluate(() => ({
        hasEdit: !!document.querySelector('[data-e2e="edit-profile"]'),
        hasFollow: !!document.querySelector('[data-e2e="follow-button"]'),
        is403: document.title?.includes('403')
      }));

      if (profileCheck.hasEdit) return true;
      if (profileCheck.hasFollow && !profileCheck.is403) return false;
      if (profileCheck.is403 && CONFIG.sessionCookie) { console.log('⚠️ 403 لكن كوكيز موجودة'); return true; }
      return false;
    } catch (e) {
      return CONFIG.sessionCookie ? true : false;
    }
  }

  // ===================================
  // جلب المنشنات
  // ===================================

  async fetchMentionsViaAPI() {
    console.log('📡 الطريقة 1: API...');
    try {
      if (!this.page.url().includes('tiktok.com')) {
        await this.page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.randomDelay(2000, 3000);
      }

      const mentions = [];
      const endpoints = [
        { path: '/api/inbox/notice_list/', params: { group: 2, count: 20 } },
        { path: '/api/inbox/notice_list/', params: { group: 3, count: 20 } },
        { path: '/api/user/mention/', params: { count: 20 } },
      ];

      for (const ep of endpoints) {
        try {
          const result = await this.page.evaluate(async (endpoint) => {
            try {
              const params = new URLSearchParams(endpoint.params);
              const resp = await fetch(`https://www.tiktok.com${endpoint.path}?${params}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json', 'Referer': 'https://www.tiktok.com/' }
              });
              if (!resp.ok) return { error: `HTTP ${resp.status}` };
              const text = await resp.text();
              let json = text;
              if (json.startsWith('while(1)') || json.startsWith('for(;;)')) json = json.substring(json.indexOf('{'));
              const fb = json.indexOf('{'); if (fb > 0) json = json.substring(fb);
              const data = JSON.parse(json);
              return { data, preview: JSON.stringify(data).substring(0, 500) };
            } catch (e) { return { error: e.message }; }
          }, ep);

          if (result.error) { console.log(`⚠️ API: ${result.error}`); continue; }

          console.log(`✅ API رجع: ${result.preview?.substring(0, 150)}`);

          // استخراج القائمة
          let list = [];
          const d = result.data;
          const paths = [d.notice_list, d.notifications, d.data, d.body?.notice_list, d.data?.notice_list, d.data?.list, d.list, d.items];
          for (const p of paths) { if (Array.isArray(p) && p.length > 0) { list = p; break; } }
          if (list.length === 0) {
            for (const k of Object.keys(d)) {
              if (Array.isArray(d[k]) && d[k].length > 0 && typeof d[k][0] === 'object') { list = d[k]; break; }
            }
          }

          console.log(`📋 ${list.length} إشعار`);

          for (const n of list) {
            const content = n.content || n.title || n.body || n.text || '';
            const user = n.from_user?.unique_id || n.user?.unique_id || n.author?.unique_id || '';
            const url = n.target_url || n.url || n.link || '';
            const comment = n.comment?.text || n.content || '';
            const type = n.type || n.sub_type || '';
            const isMention = content.includes('@' + CONFIG.username) || comment.includes('@' + CONFIG.username) ||
                String(type).includes('mention');
            if (isMention) {
              const id = n.id || (url + comment).slice(0, 50);
              if (!CONFIG.repliedMentions.has(String(id))) {
                mentions.push({ text: comment || content, mentioner: user, videoUrl: url, id: String(id), source: 'api' });
                console.log(`📬 منشن! @${user}: ${(comment || content).substring(0, 60)}`);
              }
            }
          }
        } catch (e) { console.log(`⚠️ خطأ API:`, e.message); }
      }
      return mentions;
    } catch (e) { console.error('❌ خطأ:', e.message); return []; }
  }

  async findMentionsInNotificationsPage() {
    console.log('🔔 الطريقة 2: صفحة الإشعارات...');
    try {
      const urls = ['https://www.tiktok.com/inbox', 'https://www.tiktok.com/inbox/mentions', 'https://www.tiktok.com/notifications'];
      let notifData = [];

      for (const notifUrl of urls) {
        console.log(`🔗 جرب: ${notifUrl}`);
        await this.page.goto(notifUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);

        const status = await this.page.evaluate(() => ({
          title: document.title?.substring(0, 50),
          is404: document.title?.includes('404'),
          is403: document.title?.includes('403'),
          hasContent: !!document.querySelector('[data-e2e="inbox"]') ||
                      !!document.querySelector('[class*="inbox"]') ||
                      !!document.querySelector('[class*="notification"]')
        }));

        console.log(`📋 title="${status.title}", 404=${status.is404}, hasContent=${status.hasContent}`);

        if (!status.is404 && !status.is403) {
          await this.debugScreenshot(`notif-${notifUrl.split('/').pop()}`);
          notifData = await this.page.evaluate((bot) => {
            const results = [];
            document.querySelectorAll('a[href*="/video/"]').forEach(a => {
              const text = (a.closest('div')?.textContent || a.textContent || '').trim();
              const isMention = text.includes('@' + bot) || text.includes('mentioned') || text.includes('ذكر');
              results.push({ text: text.substring(0, 300), url: a.href, type: isMention ? 'mention' : 'link' });
            });
            document.querySelectorAll('[data-e2e="inbox-notification"], [class*="notification"]').forEach(item => {
              const text = (item.textContent || '').trim();
              const link = item.querySelector('a')?.href || '';
              if (text.length > 5) results.push({ text: text.substring(0, 300), url: link, type: text.includes('mentioned') ? 'mention' : 'notif' });
            });
            return results;
          }, CONFIG.username);

          if (notifData.length > 0 || status.hasContent) break;
        }
      }

      const mentions = [];
      for (const item of notifData) {
        if (item.type === 'mention' || item.text.includes('@' + CONFIG.username) || item.text.toLowerCase().includes('mention')) {
          const id = item.url || item.text.slice(0, 50);
          if (!CONFIG.repliedMentions.has(id) && item.url) {
            const userMatch = item.text.match(/@(\w+)/);
            const mentioner = userMatch && userMatch[1] !== CONFIG.username ? userMatch[1] : 'user';
            mentions.push({ text: item.text, mentioner, videoUrl: item.url, id, source: 'notifications' });
          }
        }
      }
      console.log(`🔔 وجد ${mentions.length} منشن`);
      return mentions;
    } catch (e) { console.error('❌ خطأ:', e.message); return []; }
  }

  async findMentionsInMyVideos() {
    console.log('🎬 الطريقة 3: فيديوهات البوت...');
    try {
      await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('bot-profile');

      const is403 = await this.page.evaluate(() => document.title?.includes('403'));
      if (is403) {
        console.log('⚠️ 403 - جرب mobile...');
        await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
        if (CONFIG.sessionCookie) await this.page.setCookie(...this.parseCookies(CONFIG.sessionCookie));
        await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);
      }

      let videoLinks = await this.page.evaluate(() => {
        const links = new Set();
        document.querySelectorAll('a').forEach(a => { if (a.href?.includes('/video/')) links.add(a.href); });
        document.querySelectorAll('[data-e2e="user-post-item"]').forEach(item => {
          const a = item.querySelector('a'); if (a?.href) links.add(a.href);
        });
        return [...links].slice(0, 5);
      });

      if (videoLinks.length === 0) {
        for (let i = 0; i < 3; i++) {
          await this.page.evaluate(() => window.scrollBy(0, 1000));
          await this.randomDelay(2000, 3000);
        }
        videoLinks = await this.page.evaluate(() => {
          const links = new Set();
          document.querySelectorAll('a').forEach(a => { if (a.href?.includes('/video/')) links.add(a.href); });
          return [...links].slice(0, 5);
        });
      }

      console.log(`🎬 وجد ${videoLinks.length} فيديو`);
      if (videoLinks.length === 0) await this.debugHTML('no-videos');

      const mentions = [];
      for (const videoUrl of videoLinks) {
        try {
          await this.page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await this.randomDelay(2000, 3000);
          const commentBtn = await this.page.$('[data-e2e="comment-button"]');
          if (commentBtn) { await commentBtn.click(); await this.randomDelay(3000, 5000); }

          const commentMentions = await this.page.evaluate((bot) => {
            const results = [];
            document.querySelectorAll('[data-e2e="comment-level-1"], [class*="comment-item"], div[class*="CommentContent"]').forEach(c => {
              const text = c.textContent || '';
              if (text.includes('@' + bot)) {
                const m = text.match(/@(\w+)/);
                results.push({ text: text.trim().substring(0, 200), mentioner: m && m[1] !== bot ? m[1] : 'user' });
              }
            });
            return results;
          }, CONFIG.username);

          for (const cm of commentMentions) {
            const id = `${videoUrl}::${cm.mentioner}::${cm.text.slice(0, 30)}`;
            if (!CONFIG.repliedMentions.has(id)) {
              mentions.push({ text: cm.text, mentioner: cm.mentioner, videoUrl, id, source: 'own-videos' });
            }
          }
        } catch (e) { console.log(`⚠️ خطأ فيديو:`, e.message); }
      }
      console.log(`🎬 وجد ${mentions.length} منشن`);
      return mentions;
    } catch (e) { console.error('❌ خطأ:', e.message); return []; }
  }

  async getAllMentions() {
    console.log('\n📥 ═══════════════════════════════');
    console.log('📥 فحص المنشنات (3 طرق)...');
    console.log('📥 ═══════════════════════════════');

    let all = [];
    all = all.concat(await this.fetchMentionsViaAPI());
    if (all.length === 0) all = all.concat(await this.findMentionsInNotificationsPage());
    if (all.length === 0) all = all.concat(await this.findMentionsInMyVideos());

    // إزالة التكرار
    const unique = []; const seen = new Set();
    for (const m of all) { if (!seen.has(m.id)) { seen.add(m.id); unique.push(m); } }

    // سجّل API المعترض
    if (this.apiIntercepted.length > 0) {
      console.log(`\n📡 API intercepted (${this.apiIntercepted.length}):`);
      this.apiIntercepted.slice(0, 10).forEach(a => console.log(`   ${a.url.substring(0, 100)} → ${a.status}`));
    }

    console.log(`\n📊 النتيجة: ${unique.length} منشن`);
    unique.forEach(m => console.log(`   📬 [@${m.mentioner}]: "${m.text.substring(0, 60)}..." (${m.source})`));
    return unique;
  }

  // ===================================
  // الرد
  // ===================================

  async replyToMention(mention) {
    console.log(`\n💬 الرد على @${mention.mentioner}...`);
    try {
      if (mention.videoUrl) {
        await this.page.goto(mention.videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);

        const is403 = await this.page.evaluate(() => document.title?.includes('403'));
        if (is403) { console.log('❌ 403'); return false; }

        if (await this.findAndClickReply(mention)) {
          const reply = await createAIResponse(mention.text, '', mention.mentioner);
          console.log(`💬 الرد: "${reply}"`);
          if (await this.writeAndSubmitReply(reply)) {
            CONFIG.repliedMentions.add(mention.id);
            console.log('✅ تم نشر الرد! 🎉');
            return true;
          }
        }

        // تعليق جديد كـ fallback
        console.log('⚠️ فشل الرد المباشر - تعليق جديد...');
        const reply = await createAIResponse(mention.text, '', mention.mentioner);
        if (await this.postNewComment(null, reply)) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تعليق جديد! 🎉');
          return true;
        }
      }
      return false;
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  async findAndClickReply(mention) {
    try {
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) { await commentBtn.click(); await this.randomDelay(3000, 5000); }

      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => { window.scrollBy(0, 500); });
        await this.randomDelay(1000, 2000);
      }
      await this.debugScreenshot('comments');

      const clicked = await this.page.evaluate((bot) => {
        for (const sel of ['[data-e2e="comment-level-1"]', '[class*="comment-item"]', '[class*="CommentContent"]', 'div[class*="comment"]']) {
          for (const c of document.querySelectorAll(sel)) {
            if ((c.textContent || '').includes('@' + bot)) {
              const btn = c.querySelector('[data-e2e="reply-button"]') || c.querySelector('[class*="reply"]');
              if (btn) { btn.click(); return { found: true, text: c.textContent.substring(0, 100) }; }
            }
          }
        }
        // fallback
        for (const btn of document.querySelectorAll('[data-e2e="reply-button"]')) {
          const p = btn.closest('div');
          if (p?.textContent?.includes('@' + bot)) { btn.click(); return { found: true, text: p.textContent.substring(0, 100) }; }
        }
        return { found: false };
      }, CONFIG.username);

      if (clicked.found) { console.log(`✅ ضغطت رد: "${clicked.text}"`); await this.randomDelay(1000, 2000); return true; }
      console.log('⚠️ لم أجد زر الرد');
      return false;
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  async writeAndSubmitReply(replyText) {
    try {
      const selectors = [
        'textarea[placeholder*="reply" i]', 'textarea[placeholder*="رد" i]',
        'div[contenteditable="true"]', '[data-e2e="reply-input"] textarea',
        '[data-e2e="reply-input"]', 'textarea'
      ];
      let input = null;
      for (const s of selectors) { input = await this.page.$(s); if (input) break; }
      if (!input) { console.log('⚠️ لا خانة رد'); await this.debugScreenshot('no-reply'); return false; }

      await input.click();
      await this.randomDelay(500, 1000);
      await this.page.keyboard.type(replyText, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      const submitSelectors = ['[data-e2e="comment-submit"]', 'button[type="submit"]', '[class*="comment-post"]'];
      let submitted = false;
      for (const s of submitSelectors) { const btn = await this.page.$(s); if (btn) { await btn.click(); submitted = true; break; } }
      if (!submitted) await this.page.keyboard.press('Enter');

      await this.randomDelay(2000, 3000);
      await this.debugScreenshot('after-reply');
      console.log(`✅ تم إرسال: "${replyText}"`);
      return true;
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  async postNewComment(videoUrl, comment) {
    try {
      if (videoUrl) {
        await this.page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);
      }
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) { await commentBtn.click(); await this.randomDelay(2000, 3000); }

      const selectors = [
        '[data-e2e="comment-input"] textarea', '[data-e2e="comment-input"]',
        'textarea[placeholder*="comment" i]', 'div[contenteditable="true"]', 'textarea'
      ];
      let input = null;
      for (const s of selectors) { input = await this.page.$(s); if (input) break; }
      if (!input) { console.log('❌ لا خانة تعليق'); return false; }

      await input.click();
      await this.randomDelay(500, 1000);
      await this.page.keyboard.type(comment, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      const submitSelectors = ['[data-e2e="comment-submit"]', 'button[type="submit"]', '[class*="comment-post"]'];
      let submitted = false;
      for (const s of submitSelectors) { const btn = await this.page.$(s); if (btn) { await btn.click(); submitted = true; break; } }
      if (!submitted) await this.page.keyboard.press('Enter');

      await this.randomDelay(2000, 3000);
      console.log(`✅ تعليق: "${comment}"`);
      return true;
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  async randomDelay(min = 1000, max = 3000) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  }

  async close() {
    if (this.browser) { await this.browser.close(); console.log('🔒 إغلاق المتصفح'); }
  }
}

// ===================================
// الحلقة الرئيسية
// ===================================

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║      🤖 بوت تيك توك الذكي v9.0          ║
║      Anti-Detect + API Interception      ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  const bot = new TikTokBot();

  try {
    await bot.init();
    const loggedIn = await bot.login();

    if (!loggedIn) {
      console.log('\n═══════════════════════════════════════');
      console.log('❌ فشل تسجيل الدخول!');
      console.log('تأكد من:');
      console.log('1. كوكيز الجلسة في TIKTOK_SESSION');
      console.log('   - افتح تيك توك > DevTools > Network');
      console.log('   - انسخ قيمة Cookie من Request Headers');
      console.log('2. أو TIKTOK_USERNAME و TIKTOK_PASSWORD');
      console.log('═══════════════════════════════════════');
      await bot.close();
      return;
    }

    const singleRun = process.env.SINGLE_RUN === 'true';
    do {
      try {
        const mentions = await bot.getAllMentions();
        for (const mention of mentions.slice(0, CONFIG.maxRepliesPerRun)) {
          console.log(`\n📬 ═══════════════════════════════`);
          console.log(`📬 منشن من @${mention.mentioner} (${mention.source})`);
          console.log(`📬 "${mention.text.substring(0, 80)}..."`);
          console.log(`📬 ═══════════════════════════════`);

          if (await bot.replyToMention(mention)) {
            const delay = CONFIG.minDelayBetweenReplies + Math.random() * (CONFIG.maxDelayBetweenReplies - CONFIG.minDelayBetweenReplies);
            console.log(`⏳ انتظار ${Math.round(delay)} ثانية...`);
            await bot.randomDelay(delay * 1000, delay * 1000);
          }
        }
        if (mentions.length === 0) console.log('📭 لا يوجد منشنات جديدة');
        if (!singleRun) {
          const interval = parseInt(process.env.CHECK_INTERVAL) || 60;
          console.log(`\n⏱️ الفحص القادم بعد ${interval} ثانية...`);
          await bot.randomDelay(interval * 1000, interval * 1000);
        }
      } catch (e) {
        console.error('❌ خطأ:', e.message);
        if (singleRun) break;
        await bot.randomDelay(30000, 60000);
      }
    } while (!singleRun);
  } catch (e) {
    console.error('💥 خطأ فادح:', e.message);
  } finally {
    await bot.close();
  }
}

export { TikTokBot, createAIResponse, CONFIG };
export default main;
main().catch(console.error);
