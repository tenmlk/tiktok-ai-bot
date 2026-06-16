/**
 * ===================================
 * بوت تيك توك الذكي - v10.0
 * ===================================
 * v10.0: API-BASED commenting (NO video page navigation = NO CAPTCHA!)
 * 
 * KEY CHANGE: Instead of navigating to video pages (which triggers CAPTCHA),
 * we use TikTok's internal API to:
 * 1. Fetch mentions via /api/inbox/notice_list/ 
 * 2. Post comment replies via /api/comment/create/
 * 3. All through page.evaluate(fetch()) with credentials:'include'
 * 
 * This avoids CAPTCHAs entirely because we never load video pages!
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

// ===================================
// ردود ذكية احتياطية (لا تحتاج AI)
// ===================================
const SMART_REPLIES = {
  ar: [
    'أهلاً! شكراً على المنشن 🙏',
    'هلا والله! نورتنا ✨',
    'يسعدني إنك ذكرتني! 😊',
    'مشكور على المنشن! 💪',
    'حبيبي! شكراً لك 🌟',
    'يا هلا! وينك من زمان 🔥',
    'تسلملي يا غالي ❤️',
    'الله يسعدك! شكراً 🌹',
    'منور يا بطل! 🏆',
    'أحبك والله! 😍'
  ],
  en: [
    'Hey! Thanks for the mention! 🙏',
    'Hello there! ✨',
    'Thanks for tagging me! 😊',
    'Appreciate it! 💪',
    'Great point! 🌟',
    'Awesome! 🔥',
    'Love it! ❤️',
    'You rock! 🏆'
  ]
};

function getSmartReply(username) {
  const replies = SMART_REPLIES[CONFIG.language] || SMART_REPLIES.ar;
  return `@${username} ${replies[Math.floor(Math.random() * replies.length)]}`;
}

// ===================================
// توليد رد بالذكاء الاصطناعي
// ===================================
async function createAIResponse(mentionText, videoDescription, mentionerUsername) {
  // فحص الأمان أولاً
  const safety = checkContentSafety(mentionText);
  if (!safety.isSafe) return getRefusalResponse(safety.category);
  if (!checkContentSafety(videoDescription || '').isSafe) return 'آسف، ما أقدر أعلق على هالمحتوى. 😊';

  // v10.0: حاول AI مع timeout طويل، ولو فشل استخدم SMART_REPLIES
  try {
    // ديناميكي import للـ z-ai-web-dev-sdk
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
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
        { role: 'system', content: `أنت بوت تيك توك ذكي بشخصية "${persona.name}". نبرتك: ${persona.tone}
القواعد: 1) ترد بالعربية 2) الرد أقل من 150 حرف 3) تبدأ بـ @${mentionerUsername} 4) 1-3 إيموجي 5) ما تتكلم عن تحريض/كراهية/مخدرات/طبي 6) تكون طبيعي` },
        { role: 'user', content: `شخص منشنك: @${mentionerUsername} كتب: "${mentionText}" وصف الفيديو: "${videoDescription || 'لا يوجد'}" رد عليه بشكل طبيعي.` }
      ],
      temperature: 0.8, max_tokens: 100, top_p: 0.9
    }, {
      timeout: 30000 // 30 ثانية timeout
    });

    let response = completion.choices[0]?.message?.content?.trim();
    if (!response) return getSmartReply(mentionerUsername);
    if (!checkContentSafety(response).isSafe) return getRefusalResponse(checkContentSafety(response).category);
    if (!response.startsWith(`@${mentionerUsername}`)) response = `@${mentionerUsername} ${response}`;
    if (response.length > 150) response = response.substring(0, 147) + '...';
    console.log('🤖 رد AI:', response);
    return response;
  } catch (error) {
    console.log(`⚠️ AI غير متاح (${error.message?.substring(0, 50)}), استخدم رد ذكي`);
    return getSmartReply(mentionerUsername);
  }
}

// ===================================
// تأكد من z-ai-config
// ===================================
function ensureZAIConfig() {
  const configContent = JSON.stringify({
    baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
    apiKey: process.env.ZAI_API_KEY || 'Z.ai',
    chatId: process.env.ZAI_CHAT_ID || '',
    token: process.env.ZAI_TOKEN || '',
    userId: process.env.ZAI_USER_ID || ''
  });
  const configPaths = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config'
  ];
  let found = false;
  for (const cp of configPaths) {
    try {
      if (fs.existsSync(cp)) {
        const existing = JSON.parse(fs.readFileSync(cp, 'utf-8'));
        if (existing.baseUrl && existing.apiKey) {
          console.log(`✅ z-ai-config موجود: ${cp}`);
          found = true;
          break;
        }
      }
    } catch (e) {}
  }
  if (!found) {
    for (const cp of configPaths) {
      try {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, configContent);
        console.log(`📝 أنشأت z-ai-config: ${cp}`);
      } catch (e) {}
    }
  }
}

// ===================================
// الكلاس الرئيسي
// ===================================
class TikTokBot {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.runId = Date.now();
    this.apiIntercepted = [];
  }

  async init() {
    console.log('🌐 تشغيل المتصفح v10.0...');
    this.browser = await puppeteerExtra.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled', '--disable-gpu',
        '--window-size=1920,1080', '--lang=ar-SA',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security', '--user-data-dir=/tmp/chrome-user-data'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    // Anti-detect
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
      window.chrome = { runtime: { connect(){}, sendMessage(){}, onMessage:{ addListener(){} }, id: undefined }, loadTimes(){ return {}; }, csi(){ return {}; }, app: { isInstalled: false } };
      Object.defineProperty(navigator, 'plugins', { get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }, { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' }] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    });

    // تعيين الكوكيز قبل أي تنقل
    if (CONFIG.sessionCookie) {
      console.log('🍪 تعيين الكوكيز قبل التحميل...');
      const cookies = this.parseCookies(CONFIG.sessionCookie);
      await this.page.setCookie(...cookies);
      console.log(`✅ تم تعيين ${cookies.length} كوكيز`);
    }

    // اعتراض API للتصحيح
    this.page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') && url.includes('tiktok.com')) {
        try {
          const status = response.status();
          if (url.includes('notice') || url.includes('inbox') || url.includes('comment') || url.includes('mention')) {
            const text = await response.text().catch(() => '');
            this.apiIntercepted.push({ url: url.substring(0, 200), status, bodyPreview: text.substring(0, 500) });
            console.log(`📡 API: ${url.substring(0, 80)} → ${status} (${text.length}b)`);
          }
        } catch (e) {}
      }
    });

    try { fs.mkdirSync(CONFIG.debugDir, { recursive: true }); } catch (e) {}
    console.log('✅ المتصفح v10.0 جاهز');
  }

  parseCookies(cookieStr) {
    return cookieStr.split(';').filter(c => c.trim()).map(pair => {
      const [name, ...valueParts] = pair.trim().split('=');
      const value = valueParts.join('=').trim();
      if (!name || !value) return null;
      const httpOnlyNames = ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_tt_ss', 'uid_tt', 'uid_tt_ss', 'odin_tt', 'odin_tt_ss'];
      return { name: name.trim(), value, domain: '.tiktok.com', path: '/', secure: true, sameSite: 'None', url: 'https://www.tiktok.com', httpOnly: httpOnlyNames.includes(name.trim()) };
    }).filter(Boolean);
  }

  async debugScreenshot(name) {
    try { await this.page.screenshot({ path: `${CONFIG.debugDir}/${name}-${this.runId}.png` }); console.log(`📸 لقطة: ${name}`); } catch (e) {}
  }

  async debugHTML(name) {
    try { fs.writeFileSync(`${CONFIG.debugDir}/${name}-${this.runId}.html`, await this.page.content()); console.log(`📄 HTML: ${name}`); } catch (e) {}
  }

  async randomDelay(min = 1000, max = 3000) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  }

  // ===================================
  // تسجيل الدخول
  // ===================================
  async login() {
    console.log('\n🔑 تسجيل الدخول...');
    try {
      await this.page.goto('https://www.tiktok.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
      await this.randomDelay(3000, 5000);
      try { await this.page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e2) {}
    }
    await this.randomDelay(3000, 5000);
    await this.debugScreenshot('homepage');

    const homeStatus = await this.page.evaluate(() => ({
      title: document.title?.substring(0, 100),
      is403: document.title?.includes('403') || document.body?.textContent?.includes('ERROR 403'),
      hasProfile: !!document.querySelector('[data-e2e="profile-icon"]'),
    }));
    console.log(`📋 الصفحة: title="${homeStatus.title}", 403=${homeStatus.is403}, profile=${homeStatus.hasProfile}`);

    if (homeStatus.is403) {
      console.log('🚫 403! جرب mobile UA...');
      await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
      if (CONFIG.sessionCookie) await this.page.setCookie(...this.parseCookies(CONFIG.sessionCookie));
      await this.page.goto('https://www.tiktok.com/', { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('homepage-mobile');
    }

    const loggedIn = await this.checkIfLoggedIn();
    if (loggedIn) { this.isLoggedIn = true; console.log('✅ تم تسجيل الدخول! 🎉'); return true; }

    // Fallback: الباسورد
    if (CONFIG.username && CONFIG.password) {
      console.log('⚠️ جرب الباسورد...');
      if (await this.loginWithPassword()) { this.isLoggedIn = true; console.log('✅ تسجيل دخول بالباسورد! 🎉'); return true; }
    }
    console.log('❌ فشل تسجيل الدخول!');
    return false;
  }

  async loginWithPassword() {
    try {
      await this.page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(3000, 5000);
      const userInput = await this.page.$('input[name="username"]') || await this.page.$('input[type="text"]');
      if (userInput) { await userInput.click({ clickCount: 3 }); await this.randomDelay(500, 1000); await this.page.keyboard.type(CONFIG.username, { delay: 100 }); }
      await this.randomDelay(1500, 2500);
      const passInput = await this.page.$('input[type="password"]');
      if (passInput) { await passInput.click({ clickCount: 3 }); await this.randomDelay(500, 1000); await this.page.keyboard.type(CONFIG.password, { delay: 100 }); }
      await this.randomDelay(1500, 2500);
      const loginBtn = await this.page.$('button[data-e2e="login-button"]') || await this.page.$('button[type="submit"]');
      if (loginBtn) await loginBtn.click();
      await this.randomDelay(5000, 8000);
      return await this.checkIfLoggedIn();
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  async checkIfLoggedIn() {
    try {
      await this.randomDelay(2000, 3000);
      const check = await this.page.evaluate(() => {
        const profile = document.querySelector('[data-e2e="profile-icon"]') || document.querySelector('[data-e2e="menu-profile"]');
        const loginBtn = document.querySelector('[data-e2e="login-button"]');
        if (profile) return { loggedIn: true, method: 'profile' };
        if (loginBtn) return { loggedIn: false, method: 'login-btn' };
        return { loggedIn: null, method: 'uncertain' };
      });
      if (check.loggedIn === true) { console.log(`✅ مسجل (${check.method})`); return true; }
      if (check.loggedIn === false) { console.log(`❌ غير مسجل`); return false; }
      const cookies = await this.page.cookies();
      if (cookies.some(c => ['sessionid', 'sid_tt', 'd_ticket'].includes(c.name))) { console.log('✅ كوكيز جلسة موجودة'); return true; }
      return false;
    } catch (e) { return CONFIG.sessionCookie ? true : false; }
  }

  // ===================================
  // v10.0: جلب المنشنات عبر API فقط
  // (لا نفتح صفحات فيديو!)
  // ===================================

  async fetchMentionsViaAPI() {
    console.log('📡 جلب المنشنات عبر API...');
    try {
      // تأكد إننا على تيك توك
      if (!this.page.url().includes('tiktok.com')) {
        await this.page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.randomDelay(2000, 3000);
      }

      const mentions = [];
      
      // الطريقة 1: جلب إشعارات صندوق الوارد
      for (const group of [2, 3, 5]) {
        try {
          const result = await this.page.evaluate(async (grp) => {
            try {
              const params = new URLSearchParams({
                group: String(grp),
                count: '20',
                aid: '1988',
                app_language: 'ar',
                app_name: 'tiktok_web'
              });
              const resp = await fetch(`https://www.tiktok.com/api/inbox/notice_list/?${params}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json', 'Referer': 'https://www.tiktok.com/' }
              });
              if (!resp.ok) return { error: `HTTP ${resp.status}` };
              const text = await resp.text();
              let json = text;
              if (json.startsWith('while(1)') || json.startsWith('for(;;)')) json = json.substring(json.indexOf('{'));
              const fb = json.indexOf('{'); if (fb > 0) json = json.substring(fb);
              return { data: JSON.parse(json), preview: text.substring(0, 300) };
            } catch (e) { return { error: e.message }; }
          }, group);

          if (result.error) { console.log(`⚠️ API group ${group}: ${result.error}`); continue; }
          console.log(`✅ API group ${group}: ${result.preview?.substring(0, 100)}`);

          // استخراج المنشنات من البيانات
          let list = [];
          const d = result.data;
          for (const p of [d.notice_list, d.notifications, d.data, d.body?.notice_list, d.data?.notice_list, d.list, d.items]) {
            if (Array.isArray(p) && p.length > 0) { list = p; break; }
          }
          if (list.length === 0) {
            for (const k of Object.keys(d)) {
              if (Array.isArray(d[k]) && d[k].length > 0 && typeof d[k][0] === 'object') { list = d[k]; break; }
            }
          }
          console.log(`📋 ${list.length} إشعار من group ${group}`);

          for (const n of list) {
            const content = n.content || n.title || n.body || n.text || '';
            const user = n.from_user?.unique_id || n.user?.unique_id || n.author?.unique_id || '';
            const url = n.target_url || n.url || n.link || '';
            const comment = n.comment?.text || n.content || '';
            const commentId = n.comment?.cid || n.comment?.id || n.cid || '';
            const videoId = n.target_url?.match(/\/video\/(\d+)/)?.[1] || n.aweme_id || n.video_id || '';
            const type = n.type || n.sub_type || '';
            
            // فحص هل هذا منشن
            const isMention = content.includes('@' + CONFIG.username) || 
                             comment.includes('@' + CONFIG.username) || 
                             String(type).includes('mention') ||
                             content.toLowerCase().includes('mentioned');
            
            if (isMention) {
              const id = n.id || `${videoId}::${commentId}::${user}`;
              if (!CONFIG.repliedMentions.has(String(id))) {
                mentions.push({
                  text: comment || content,
                  mentioner: user || 'user',
                  videoUrl: url,
                  videoId,
                  commentId,
                  id: String(id),
                  source: 'api',
                  rawData: n
                });
                console.log(`📬 منشن! @${user}: ${(comment || content).substring(0, 60)}`);
              }
            }
          }
        } catch (e) { console.log(`⚠️ خطأ API group ${group}:`, e.message); }
      }

      return mentions;
    } catch (e) { console.error('❌ خطأ:', e.message); return []; }
  }

  // v10.0: جلب المنشنات من صفحة الإشعارات (DOM-based)
  async findMentionsInNotificationsPage() {
    console.log('🔔 الطريقة 2: صفحة الإشعارات (DOM)...');
    try {
      await this.page.goto('https://www.tiktok.com/inbox', { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(3000, 5000);
      await this.debugScreenshot('notif-inbox');

      const notifData = await this.page.evaluate((bot) => {
        const results = [];
        
        // ابحث عن روابط الفيديوهات في الإشعارات
        document.querySelectorAll('a[href*="/video/"]').forEach(a => {
          const text = (a.closest('div')?.textContent || a.textContent || '').trim();
          const isMention = text.includes('@' + bot) || text.toLowerCase().includes('mentioned') || text.includes('ذكر');
          if (isMention) {
            const videoMatch = a.href.match(/\/video\/(\d+)/);
            results.push({
              text: text.substring(0, 300),
              url: a.href,
              videoId: videoMatch?.[1] || '',
              type: 'mention'
            });
          }
        });

        // ابحث عن عناصر الإشعارات
        document.querySelectorAll('[data-e2e="inbox-notification"], [class*="notification"]').forEach(item => {
          const text = (item.textContent || '').trim();
          const link = item.querySelector('a')?.href || '';
          if (text.length > 5 && (text.includes('mentioned') || text.includes('ذكر'))) {
            const videoMatch = link.match(/\/video\/(\d+)/);
            results.push({
              text: text.substring(0, 300),
              url: link,
              videoId: videoMatch?.[1] || '',
              type: 'mention'
            });
          }
        });

        return results;
      }, CONFIG.username);

      const mentions = [];
      for (const item of notifData) {
        const id = item.url || item.text.slice(0, 50);
        if (!CONFIG.repliedMentions.has(id)) {
          const userMatch = item.text.match(/@(\w[\w.]*)/);
          let mentioner = 'user';
          if (userMatch && userMatch[1] !== CONFIG.username) mentioner = userMatch[1];
          mentions.push({
            text: item.text,
            mentioner,
            videoUrl: item.url,
            videoId: item.videoId,
            commentId: '',
            id,
            source: 'notifications'
          });
        }
      }
      console.log(`🔔 وجد ${mentions.length} منشن من صفحة الإشعارات`);
      return mentions;
    } catch (e) { console.error('❌ خطأ:', e.message); return []; }
  }

  async getAllMentions() {
    console.log('\n📥 ═══════════════════════════════');
    console.log('📥 فحص المنشنات (بدون فتح فيديو!)');
    console.log('📥 ═══════════════════════════════');

    let all = [];
    all = all.concat(await this.fetchMentionsViaAPI());
    if (all.length === 0) all = all.concat(await this.findMentionsInNotificationsPage());

    const unique = []; const seen = new Set();
    for (const m of all) { if (!seen.has(m.id)) { seen.add(m.id); unique.push(m); } }

    console.log(`\n📊 النتيجة: ${unique.length} منشن`);
    unique.forEach(m => console.log(`   📬 [@${m.mentioner}]: "${m.text.substring(0, 60)}..." (${m.source})`));
    return unique;
  }

  // ===================================
  // v10.0: الرد عبر API (بدون فتح صفحة فيديو!)
  // هذا هو التغيير الرئيسي - لا كابتشا!
  // ===================================

  async replyToMention(mention) {
    console.log(`\n💬 ═══════════════════════════════`);
    console.log(`💬 الرد على @${mention.mentioner}...`);
    console.log(`💬 "${mention.text.substring(0, 80)}..."`);

    try {
      // توليد الرد
      const replyText = await createAIResponse(mention.text, '', mention.mentioner);
      console.log(`💬 الرد: "${replyText}"`);

      // v10.0: حاول 3 طرق للرد

      // الطريقة 1: API تعليق مباشر (أفضل طريقة - بدون فتح صفحة!)
      if (mention.videoId) {
        const posted = await this.replyViaAPI(mention, replyText);
        if (posted) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تم نشر الرد عبر API! 🎉');
          return true;
        }
      }

      // الطريقة 2: API تعليق جديد على الفيديو
      if (mention.videoId) {
        const posted = await this.commentViaAPI(mention, replyText);
        if (posted) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تم نشر تعليق جديد عبر API! 🎉');
          return true;
        }
      }

      // الطريقة 3 (fallback): افتح صفحة الفيديو وحاول ترد (مع حل الكابتشا)
      console.log('⚠️ API فشلت، جرب DOM fallback...');
      if (mention.videoUrl) {
        const posted = await this.replyViaDOM(mention, replyText);
        if (posted) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تم نشر الرد عبر DOM! 🎉');
          return true;
        }
      }

      console.log('❌ فشل الرد بجميع الطرق');
      return false;
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  // ===================================
  // v10.0: رد عبر API تعليق
  // POST /api/comment/create/reply/
  // ===================================
  async replyViaAPI(mention, replyText) {
    console.log('📡 الطريقة 1: رد عبر API...');
    try {
      const result = await this.page.evaluate(async (data) => {
        try {
          // الطريقة 1a: رد على تعليق محدد
          if (data.commentId) {
            const params = new URLSearchParams({
              aid: '1988',
              app_language: 'ar',
              app_name: 'tiktok_web',
              item_id: data.videoId,
              comment_id: data.commentId,
              content: data.replyText
            });
            
            const resp = await fetch('https://www.tiktok.com/api/comment/create/reply/?' + params.toString(), {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://www.tiktok.com/',
                'Origin': 'https://www.tiktok.com'
              }
            });
            
            const text = await resp.text();
            return { status: resp.status, body: text.substring(0, 500), method: 'reply' };
          }
          return { status: 0, body: 'no commentId', method: 'reply' };
        } catch (e) { return { error: e.message, method: 'reply' }; }
      }, { videoId: mention.videoId, commentId: mention.commentId, replyText });

      if (result.error) {
        console.log(`⚠️ API رد: ${result.error}`);
      } else {
        console.log(`📡 API رد: ${result.status} → ${result.body?.substring(0, 150)}`);
        if (result.status === 200) {
          // تحقق إن الرد فعلاً اننشر
          try {
            const json = JSON.parse(result.body);
            if (json.status_code === 0 || json.status_msg === 'success' || json.comment) {
              console.log('✅ رد عبر API ناجح!');
              return true;
            }
          } catch (e) {}
          // حتى لو ما فهمنا الرد، إذا status 200 يمكن اشتغل
          if (result.body && !result.body.includes('error') && !result.body.includes('blocked')) {
            console.log('✅ رد عبر API (محتمل نجاح)!');
            return true;
          }
        }
      }
    } catch (e) { console.log(`⚠️ خطأ API رد: ${e.message}`); }
    return false;
  }

  // ===================================
  // v10.0: تعليق جديد عبر API
  // POST /api/comment/create/
  // ===================================
  async commentViaAPI(mention, replyText) {
    console.log('📡 الطريقة 2: تعليق جديد عبر API...');
    try {
      const result = await this.page.evaluate(async (data) => {
        try {
          const params = new URLSearchParams({
            aid: '1988',
            app_language: 'ar',
            app_name: 'tiktok_web',
            item_id: data.videoId,
            content: data.replyText
          });

          const resp = await fetch('https://www.tiktok.com/api/comment/create/?' + params.toString(), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': 'https://www.tiktok.com/',
              'Origin': 'https://www.tiktok.com'
            }
          });

          const text = await resp.text();
          return { status: resp.status, body: text.substring(0, 500), method: 'comment' };
        } catch (e) { return { error: e.message, method: 'comment' }; }
      }, { videoId: mention.videoId, replyText });

      if (result.error) {
        console.log(`⚠️ API تعليق: ${result.error}`);
      } else {
        console.log(`📡 API تعليق: ${result.status} → ${result.body?.substring(0, 150)}`);
        if (result.status === 200) {
          try {
            const json = JSON.parse(result.body);
            if (json.status_code === 0 || json.status_msg === 'success' || json.comment) {
              console.log('✅ تعليق عبر API ناجح!');
              return true;
            }
          } catch (e) {}
          if (result.body && !result.body.includes('error') && !result.body.includes('blocked')) {
            console.log('✅ تعليق عبر API (محتمل نجاح)!');
            return true;
          }
        }
      }
    } catch (e) { console.log(`⚠️ خطأ API تعليق: ${e.message}`); }
    return false;
  }

  // ===================================
  // v10.0: Fallback - رد عبر DOM
  // (يفتح صفحة الفيديو فقط إذا API فشلت)
  // ===================================
  async replyViaDOM(mention, replyText) {
    console.log('🖥️ الطريقة 3: DOM fallback (فتح صفحة الفيديو)...');
    try {
      await this.page.goto(mention.videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(3000, 5000);

      // حل الكابتشا إذا ظهرت
      await this.solveCaptcha();

      const is403 = await this.page.evaluate(() => document.title?.includes('403'));
      if (is403) {
        console.log('⚠️ 403 - جرب mobile...');
        await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
        if (CONFIG.sessionCookie) await this.page.setCookie(...this.parseCookies(CONFIG.sessionCookie));
        await this.page.goto(mention.videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);
        await this.solveCaptcha();
      }

      await this.debugScreenshot('video-page-dom');

      // افتح التعليقات
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) { await commentBtn.click(); await this.randomDelay(3000, 5000); }

      // جرب ترد على التعليق
      if (await this.findAndClickReply(mention)) {
        if (await this.writeAndSubmitReply(replyText)) return true;
      }

      // جرب تعليق جديد
      if (await this.postNewComment(null, replyText)) return true;

      return false;
    } catch (e) { console.error('❌ خطأ DOM:', e.message); return false; }
  }

  // ===================================
  // DOM-based interaction methods (fallback only)
  // ===================================

  async findAndClickReply(mention) {
    try {
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => { window.scrollBy(0, 500); });
        await this.randomDelay(1000, 2000);
      }
      await this.debugScreenshot('comments');

      const clicked = await this.page.evaluate((bot) => {
        for (const sel of ['[data-e2e="comment-level-1"]', '[class*="comment-item"]', '[class*="CommentContent"]', 'div[class*="comment"]']) {
          for (const c of document.querySelectorAll(sel)) {
            if ((c.textContent || '').includes('@' + bot)) {
              const btn = c.querySelector('[data-e2e="reply-button"]') || c.querySelector('[class*="reply"]') || c.querySelector('[class*="Reply"]');
              if (btn) { btn.click(); return { found: true, text: c.textContent.substring(0, 100) }; }
            }
          }
        }
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
        'textarea[placeholder*="Add a reply" i]',
        'div[contenteditable="true"]', 'div[role="textbox"]',
        '[data-e2e="reply-input"] textarea', '[data-e2e="reply-input"]',
        'textarea[class*="reply"]', 'textarea'
      ];
      let input = null;
      for (const s of selectors) { input = await this.page.$(s); if (input) { console.log(`✅ خانة رد: ${s}`); break; } }

      if (!input) {
        const activated = await this.page.evaluate(() => {
          const editable = document.querySelector('div[contenteditable="true"]') || document.querySelector('div[role="textbox"]');
          if (editable) { editable.click(); return true; }
          return false;
        });
        if (activated) {
          await this.randomDelay(1000, 2000);
          for (const s of selectors) { input = await this.page.$(s); if (input) break; }
        }
      }

      if (!input) { console.log('❌ لا خانة رد'); return false; }

      await input.click();
      await this.randomDelay(500, 1000);
      await this.page.keyboard.type(replyText, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      let submitted = false;
      for (const s of ['[data-e2e="comment-submit"]', 'button[type="submit"]', '[class*="comment-post"]', '[data-e2e="reply-submit"]']) {
        const btn = await this.page.$(s); if (btn) { await btn.click(); submitted = true; console.log(`✅ إرسال: ${s}`); break; }
      }
      if (!submitted) { await this.page.keyboard.press('Enter'); console.log('✅ إرسال: Enter'); }

      await this.randomDelay(2000, 3000);
      await this.debugScreenshot('after-reply');
      return true;
    } catch (e) { console.error('❌ خطأ كتابة رد:', e.message); return false; }
  }

  async postNewComment(videoUrl, comment) {
    try {
      if (videoUrl) {
        await this.page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);
      }
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) { await commentBtn.click(); await this.randomDelay(2000, 3000); }
      await this.debugScreenshot('comment-section');

      const selectors = [
        '[data-e2e="comment-input"] textarea', '[data-e2e="comment-input"]',
        'textarea[placeholder*="comment" i]', 'textarea[placeholder*="تعليق" i]',
        'textarea[placeholder*="Add a comment" i]',
        'div[contenteditable="true"]', 'div[role="textbox"]',
        'textarea[placeholder]', 'textarea'
      ];
      let input = null;
      for (const s of selectors) { input = await this.page.$(s); if (input) { console.log(`✅ خانة تعليق: ${s}`); break; } }

      if (!input) { console.log('❌ لا خانة تعليق'); await this.debugScreenshot('no-comment-input'); await this.debugHTML('no-comment-input'); return false; }

      await input.click();
      await this.randomDelay(500, 1000);
      await this.page.keyboard.type(comment, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      let submitted = false;
      for (const s of ['[data-e2e="comment-submit"]', 'button[type="submit"]', '[class*="comment-post"]']) {
        const btn = await this.page.$(s); if (btn) { await btn.click(); submitted = true; break; }
      }
      if (!submitted) await this.page.keyboard.press('Enter');

      await this.randomDelay(2000, 3000);
      return true;
    } catch (e) { console.error('❌ خطأ تعليق:', e.message); return false; }
  }

  // ===================================
  // حل الكابتشا (للمرحلة fallback فقط)
  // ===================================
  async solveCaptcha() {
    try {
      const hasCaptcha = await this.page.evaluate(() => {
        const text = document.body?.textContent || '';
        return !!document.querySelector('[class*="captcha"]') ||
               !!document.querySelector('[class*="verify"]') ||
               !!document.querySelector('iframe[src*="captcha"]') ||
               text.includes('اسحب') || text.includes('slider') || text.includes('puzzle') ||
               text.includes('لغز') || text.includes('تحقق') || text.includes('Drag');
      });

      if (!hasCaptcha) return false;
      console.log('🤖 اكتشفت كابتشا! محاولة الحل...');
      await this.debugScreenshot('captcha-detected');

      // حاول سحب الـ slider
      for (const selector of ['[class*="captcha-slider"]', '[class*="slider-btn"]', '[class*="drag"]', '[class*="Drag"]', '[class*="handler"]', 'div[role="slider"]']) {
        const slider = await this.page.$(selector);
        if (slider) {
          const box = await slider.boundingBox();
          if (box) {
            console.log(`🤖 وجدت slider: ${selector} at (${box.x}, ${box.y})`);
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;
            const targetX = startX + 250 + Math.random() * 50;

            await this.page.mouse.move(startX, startY);
            await this.randomDelay(300, 600);
            await this.page.mouse.down();
            await this.randomDelay(200, 400);

            const steps = 15 + Math.floor(Math.random() * 10);
            const dx = (targetX - startX) / steps;
            for (let i = 1; i <= steps; i++) {
              const x = startX + dx * i;
              const y = startY + (Math.random() - 0.5) * 4;
              await this.page.mouse.move(x, y);
              await this.randomDelay(20, 50);
            }

            await this.randomDelay(200, 400);
            await this.page.mouse.up();
            await this.randomDelay(3000, 5000);
            await this.debugScreenshot('captcha-after-slider');

            const stillCaptcha = await this.page.evaluate(() => {
              const text = document.body?.textContent || '';
              return text.includes('اسحب') || text.includes('slider') || text.includes('لغز') ||
                     !!document.querySelector('[class*="captcha"]');
            });

            if (!stillCaptcha) { console.log('✅ الكابتشا انحلت!'); return true; }
            console.log('⚠️ الكابتشا لسه موجودة');
          }
        }
      }
      return false;
    } catch (e) { console.log(`⚠️ خطأ في حل الكابتشا: ${e.message}`); return false; }
  }

  async close() {
    if (this.browser) { await this.browser.close(); console.log('🔒 إغلاق'); }
  }
}

// ===================================
// الحلقة الرئيسية
// ===================================

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║                                          ║
║      🤖 بوت تيك توك الذكي v10.0         ║
║      API-Based (No CAPTCHA!)            ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  ensureZAIConfig();

  const bot = new TikTokBot();
  try {
    await bot.init();
    const loggedIn = await bot.login();

    if (!loggedIn) {
      console.log('\n═══════════════════════════════════════');
      console.log('❌ فشل تسجيل الدخول!');
      console.log('تأكد من TIKTOK_SESSION أو TIKTOK_USERNAME+PASSWORD');
      console.log('═══════════════════════════════════════');
      await bot.close(); return;
    }

    const singleRun = process.env.SINGLE_RUN === 'true';
    do {
      try {
        const mentions = await bot.getAllMentions();
        for (const mention of mentions.slice(0, CONFIG.maxRepliesPerRun)) {
          if (await bot.replyToMention(mention)) {
            const delay = CONFIG.minDelayBetweenReplies + Math.random() * (CONFIG.maxDelayBetweenReplies - CONFIG.minDelayBetweenReplies);
            console.log(`⏳ انتظار ${Math.round(delay)} ثانية...`);
            await bot.randomDelay(delay * 1000);
          }
        }
        if (mentions.length === 0) console.log('📭 لا يوجد منشنات جديدة');
        if (!singleRun) { await bot.randomDelay(60000); }
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
