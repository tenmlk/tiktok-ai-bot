/**
 * ===================================
 * بوت تيك توك الذكي - v9.1
 * ===================================
 * v9.0: Anti-403 + API interception + mobile UA fallback
 * v9.1: Fix z-ai-config auto-creation + better comment input detection
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import ZAI from 'z-ai-web-dev-sdk';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';
import fs from 'fs';
import path from 'path';

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

// v9.1: أنشئ z-ai-config تلقائياً
function ensureZAIConfig() {
  const configContent = '{"provider":"zai","apiKey":"default"}';
  const configPaths = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(process.env.HOME || '/root', '.z-ai-config'),
    '/etc/.z-ai-config'
  ];
  for (const cp of configPaths) {
    try {
      if (!fs.existsSync(cp)) {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, configContent);
        console.log(`📝 أنشأت z-ai-config: ${cp}`);
      }
    } catch (e) {}
  }
}

const SMART_REPLIES = {
  ar: ['أهلاً! شكراً على المنشن 🙏', 'هلا والله! نورتنا ✨', 'يسعدني إنك ذكرتني! 😊', 'مشكور على المنشن! 💪', 'حبيبي! شكراً لك 🌟', 'يا هلا! وينك من زمان 🔥'],
  en: ['Hey! Thanks for the mention! 🙏', 'Hello there! ✨', 'Thanks for tagging me! 😊', 'Appreciate it! 💪', 'Great point! 🌟', 'Awesome! 🔥']
};

function getSmartReply(username) {
  const replies = SMART_REPLIES[CONFIG.language] || SMART_REPLIES.ar;
  return `@${username} ${replies[Math.floor(Math.random() * replies.length)]}`;
}

async function createAIResponse(mentionText, videoDescription, mentionerUsername) {
  const safety = checkContentSafety(mentionText);
  if (!safety.isSafe) return getRefusalResponse(safety.category);
  if (!checkContentSafety(videoDescription || '').isSafe) return 'آسف، ما أقدر أعلق على هالمحتوى. 😊';

  // v9.1: تأكد من وجود z-ai-config
  ensureZAIConfig();

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
        { role: 'system', content: `أنت بوت تيك توك ذكي بشخصية "${persona.name}". نبرتك: ${persona.tone}
القواعد: 1) ترد بالعربية 2) الرد أقل من 150 حرف 3) تبدأ بـ @${mentionerUsername} 4) 1-3 إيموجي 5) ما تتكلم عن تحريض/كراهية/مخدرات/طبي 6) تكون طبيعي` },
        { role: 'user', content: `شخص منشنك: @${mentionerUsername} كتب: "${mentionText}" وصف الفيديو: "${videoDescription || 'لا يوجد'}" رد عليه بشكل طبيعي.` }
      ],
      temperature: 0.8, max_tokens: 100, top_p: 0.9
    });

    let response = completion.choices[0]?.message?.content?.trim();
    if (!response) return getSmartReply(mentionerUsername);
    if (!checkContentSafety(response).isSafe) return getRefusalResponse(checkContentSafety(response).category);
    if (!response.startsWith(`@${mentionerUsername}`)) response = `@${mentionerUsername} ${response}`;
    if (response.length > 150) response = response.substring(0, 147) + '...';
    return response;
  } catch (error) {
    console.error('❌ خطأ AI:', error.message);
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
    console.log('🌐 تشغيل المتصفح v9.1...');
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

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
      window.chrome = { runtime: { connect(){}, sendMessage(){}, onMessage:{ addListener(){} }, id: undefined }, loadTimes(){ return {}; }, csi(){ return {}; }, app: { isInstalled: false } };
      Object.defineProperty(navigator, 'plugins', { get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }, { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' }] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    });

    // v9.0: تعيين الكوكيز قبل أي تنقل (anti-403)
    if (CONFIG.sessionCookie) {
      console.log('🍪 تعيين الكوكيز قبل التحميل (anti-403)...');
      const cookies = this.parseCookies(CONFIG.sessionCookie);
      await this.page.setCookie(...cookies);
      console.log(`✅ تم تعيين ${cookies.length} كوكيز`);
    }

    // اعتراض API
    this.page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') && url.includes('tiktok.com')) {
        try {
          const status = response.status();
          const text = await response.text().catch(() => '');
          if (text.length > 0 && (url.includes('notice') || url.includes('inbox') || url.includes('comment') || url.includes('mention'))) {
            this.apiIntercepted.push({ url: url.substring(0, 200), status, bodyPreview: text.substring(0, 500) });
            console.log(`📡 API: ${url.substring(0, 80)} → ${status} (${text.length}b)`);
          }
        } catch (e) {}
      }
    });

    try { fs.mkdirSync(CONFIG.debugDir, { recursive: true }); } catch (e) {}
    console.log('✅ المتصفح v9.1 جاهز');
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
      // CAPTCHA
      const slider = await this.page.$('[class*="slider"]') || await this.page.$('[class*="drag"]');
      if (slider) { const box = await slider.boundingBox(); if (box) { await this.page.mouse.move(box.x + box.width/2, box.y + box.height/2); await this.page.mouse.down(); await this.page.mouse.move(box.x + box.width + 200, box.y + box.height/2, { steps: 30 }); await this.page.mouse.up(); await this.randomDelay(2000, 3000); } }
      await this.randomDelay(3000, 5000);
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
      for (const ep of [
        { path: '/api/inbox/notice_list/', params: { group: 2, count: 20 } },
        { path: '/api/inbox/notice_list/', params: { group: 3, count: 20 } },
      ]) {
        try {
          const result = await this.page.evaluate(async (endpoint) => {
            try {
              const params = new URLSearchParams(endpoint.params);
              const resp = await fetch(`https://www.tiktok.com${endpoint.path}?${params}`, {
                credentials: 'include', headers: { 'Accept': 'application/json', 'Referer': 'https://www.tiktok.com/' }
              });
              if (!resp.ok) return { error: `HTTP ${resp.status}` };
              const text = await resp.text();
              let json = text;
              if (json.startsWith('while(1)') || json.startsWith('for(;;)')) json = json.substring(json.indexOf('{'));
              const fb = json.indexOf('{'); if (fb > 0) json = json.substring(fb);
              return { data: JSON.parse(json), preview: text.substring(0, 300) };
            } catch (e) { return { error: e.message }; }
          }, ep);
          if (result.error) { console.log(`⚠️ API: ${result.error}`); continue; }
          console.log(`✅ API: ${result.preview?.substring(0, 150)}`);

          let list = [];
          const d = result.data;
          for (const p of [d.notice_list, d.notifications, d.data, d.body?.notice_list, d.data?.notice_list, d.list, d.items]) {
            if (Array.isArray(p) && p.length > 0) { list = p; break; }
          }
          if (list.length === 0) { for (const k of Object.keys(d)) { if (Array.isArray(d[k]) && d[k].length > 0 && typeof d[k][0] === 'object') { list = d[k]; break; } } }
          console.log(`📋 ${list.length} إشعار`);

          for (const n of list) {
            const content = n.content || n.title || n.body || n.text || '';
            const user = n.from_user?.unique_id || n.user?.unique_id || n.author?.unique_id || '';
            const url = n.target_url || n.url || n.link || '';
            const comment = n.comment?.text || n.content || '';
            const type = n.type || n.sub_type || '';
            if (content.includes('@' + CONFIG.username) || comment.includes('@' + CONFIG.username) || String(type).includes('mention')) {
              const id = n.id || (url + comment).slice(0, 50);
              if (!CONFIG.repliedMentions.has(String(id))) {
                mentions.push({ text: comment || content, mentioner: user || 'user', videoUrl: url, id: String(id), source: 'api' });
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
      for (const notifUrl of ['https://www.tiktok.com/inbox', 'https://www.tiktok.com/inbox/mentions', 'https://www.tiktok.com/notifications']) {
        console.log(`🔗 جرب: ${notifUrl}`);
        await this.page.goto(notifUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);

        const status = await this.page.evaluate(() => ({
          title: document.title?.substring(0, 50),
          is404: document.title?.includes('404'),
          is403: document.title?.includes('403'),
          hasContent: !!document.querySelector('[data-e2e="inbox"]') || !!document.querySelector('[class*="inbox"]') || !!document.querySelector('[class*="notification"]')
        }));
        console.log(`📋 title="${status.title}", 404=${status.is404}`);

        if (!status.is404 && !status.is403) {
          await this.debugScreenshot(`notif-${notifUrl.split('/').pop()}`);
          const notifData = await this.page.evaluate((bot) => {
            const results = [];
            document.querySelectorAll('a[href*="/video/"]').forEach(a => {
              const text = (a.closest('div')?.textContent || a.textContent || '').trim();
              const isMention = text.includes('@' + bot) || text.toLowerCase().includes('mentioned') || text.includes('ذكر');
              if (isMention) results.push({ text: text.substring(0, 300), url: a.href, type: 'mention' });
            });
            document.querySelectorAll('[data-e2e="inbox-notification"], [class*="notification"]').forEach(item => {
              const text = (item.textContent || '').trim();
              const link = item.querySelector('a')?.href || '';
              if (text.length > 5 && (text.includes('mentioned') || text.includes('ذكر'))) results.push({ text: text.substring(0, 300), url: link, type: 'mention' });
            });
            return results;
          }, CONFIG.username);

          if (notifData.length > 0) {
            const mentions = [];
            for (const item of notifData) {
              const id = item.url || item.text.slice(0, 50);
              if (!CONFIG.repliedMentions.has(id) && item.url) {
                // v9.1: تحسين استخراج اسم المستخدم
                const userMatch = item.text.match(/@(\w[\w.]*)/);
                let mentioner = 'user';
                if (userMatch && userMatch[1] !== CONFIG.username) mentioner = userMatch[1];
                mentions.push({ text: item.text, mentioner, videoUrl: item.url, id, source: 'notifications' });
              }
            }
            console.log(`🔔 وجد ${mentions.length} منشن`);
            return mentions;
          }
          if (status.hasContent) break;
        }
      }
      return [];
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
        await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
        if (CONFIG.sessionCookie) await this.page.setCookie(...this.parseCookies(CONFIG.sessionCookie));
        await this.page.goto(`https://www.tiktok.com/@${CONFIG.username}`, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);
      }

      let videoLinks = await this.page.evaluate(() => {
        const links = new Set();
        document.querySelectorAll('a').forEach(a => { if (a.href?.includes('/video/')) links.add(a.href); });
        document.querySelectorAll('[data-e2e="user-post-item"]').forEach(item => { const a = item.querySelector('a'); if (a?.href) links.add(a.href); });
        return [...links].slice(0, 5);
      });

      if (videoLinks.length === 0) {
        for (let i = 0; i < 3; i++) { await this.page.evaluate(() => window.scrollBy(0, 1000)); await this.randomDelay(2000, 3000); }
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
                const m = text.match(/@(\w[\w.]*)/);
                results.push({ text: text.trim().substring(0, 200), mentioner: m && m[1] !== bot ? m[1] : 'user' });
              }
            });
            return results;
          }, CONFIG.username);
          for (const cm of commentMentions) {
            const id = `${videoUrl}::${cm.mentioner}::${cm.text.slice(0, 30)}`;
            if (!CONFIG.repliedMentions.has(id)) mentions.push({ text: cm.text, mentioner: cm.mentioner, videoUrl, id, source: 'own-videos' });
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

    const unique = []; const seen = new Set();
    for (const m of all) { if (!seen.has(m.id)) { seen.add(m.id); unique.push(m); } }

    if (this.apiIntercepted.length > 0) {
      console.log(`\n📡 API intercepted (${this.apiIntercepted.length}):`);
      this.apiIntercepted.slice(0, 5).forEach(a => console.log(`   ${a.url.substring(0, 100)} → ${a.status}`));
    }

    console.log(`\n📊 النتيجة: ${unique.length} منشن`);
    unique.forEach(m => console.log(`   📬 [@${m.mentioner}]: "${m.text.substring(0, 60)}..." (${m.source})`));
    return unique;
  }

  // ===================================
  // الرد - v9.1 محسّن
  // ===================================

  async replyToMention(mention) {
    console.log(`\n💬 الرد على @${mention.mentioner}...`);
    try {
      if (!mention.videoUrl) { console.log('⚠️ لا يوجد رابط فيديو'); return false; }

      await this.page.goto(mention.videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(3000, 5000);

      const is403 = await this.page.evaluate(() => document.title?.includes('403'));
      if (is403) {
        console.log('⚠️ 403 - جرب mobile...');
        await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
        if (CONFIG.sessionCookie) await this.page.setCookie(...this.parseCookies(CONFIG.sessionCookie));
        await this.page.goto(mention.videoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await this.randomDelay(3000, 5000);
      }

      await this.debugScreenshot('video-page');

      // توليد الرد
      const reply = await createAIResponse(mention.text, '', mention.mentioner);
      console.log(`💬 الرد: "${reply}"`);

      // v9.1: جرب عدة طرق للتعليق
      // الطريقة 1: افتح التعليقات واضغط رد
      const commentBtn = await this.page.$('[data-e2e="comment-button"]');
      if (commentBtn) { await commentBtn.click(); await this.randomDelay(3000, 5000); }

      // الطريقة 1a: اضغط رد على التعليق اللي فيه المنشن
      if (await this.findAndClickReply(mention)) {
        if (await this.writeAndSubmitReply(reply)) {
          CONFIG.repliedMentions.add(mention.id);
          console.log('✅ تم نشر الرد! 🎉');
          return true;
        }
      }

      // الطريقة 2: تعليق جديد مباشر
      if (await this.postNewComment(null, reply)) {
        CONFIG.repliedMentions.add(mention.id);
        console.log('✅ تعليق جديد! 🎉');
        return true;
      }

      return false;
    } catch (e) { console.error('❌ خطأ:', e.message); return false; }
  }

  async findAndClickReply(mention) {
    try {
      // تمرير لتحميل التعليقات
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => { window.scrollBy(0, 500); });
        await this.randomDelay(1000, 2000);
      }
      await this.debugScreenshot('comments');

      const clicked = await this.page.evaluate((bot) => {
        // ابحث عن التعليق اللي فيه المنشن
        for (const sel of ['[data-e2e="comment-level-1"]', '[class*="comment-item"]', '[class*="CommentContent"]', 'div[class*="comment"]']) {
          for (const c of document.querySelectorAll(sel)) {
            if ((c.textContent || '').includes('@' + bot)) {
              const btn = c.querySelector('[data-e2e="reply-button"]') || c.querySelector('[class*="reply"]') || c.querySelector('[class*="Reply"]');
              if (btn) { btn.click(); return { found: true, text: c.textContent.substring(0, 100) }; }
            }
          }
        }
        // fallback: دور كل أزرار الرد
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
      // v9.1: سيلكتورات أكثر شمولاً
      const selectors = [
        'textarea[placeholder*="reply" i]', 'textarea[placeholder*="رد" i]',
        'textarea[placeholder*="Add a reply" i]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        '[data-e2e="reply-input"] textarea', '[data-e2e="reply-input"]',
        'textarea[class*="reply"]', 'textarea[class*="Reply"]',
        'textarea'
      ];
      let input = null;
      for (const s of selectors) { input = await this.page.$(s); if (input) { console.log(`✅ خانة رد: ${s}`); break; } }

      if (!input) {
        // v9.1: جرب الضغط على منطقة التعليق لتفعيلها
        console.log('⚠️ لا خانة رد - جرب التفعيل...');
        const activated = await this.page.evaluate(() => {
          const editable = document.querySelector('div[contenteditable="true"]') || document.querySelector('div[role="textbox"]');
          if (editable) { editable.click(); return true; }
          // جرب الضغط على أي عنصر placeholder
          const placeholders = document.querySelectorAll('[class*="placeholder"], [class*="Placeholder"]');
          for (const p of placeholders) { if (p.textContent?.includes('comment') || p.textContent?.includes('رد')) { p.click(); return true; } }
          return false;
        });
        if (activated) {
          await this.randomDelay(1000, 2000);
          // أعد البحث
          for (const s of selectors) { input = await this.page.$(s); if (input) { console.log(`✅ خانة رد بعد التفعيل: ${s}`); break; } }
        }
      }

      if (!input) { console.log('❌ لا خانة رد'); await this.debugScreenshot('no-reply-input'); await this.debugHTML('no-reply-input'); return false; }

      await input.click();
      await this.randomDelay(500, 1000);
      await this.page.keyboard.type(replyText, { delay: 30 + Math.random() * 70 });
      await this.randomDelay(500, 1000);

      // إرسال
      let submitted = false;
      for (const s of ['[data-e2e="comment-submit"]', 'button[type="submit"]', '[class*="comment-post"]', '[data-e2e="reply-submit"]']) {
        const btn = await this.page.$(s); if (btn) { await btn.click(); submitted = true; console.log(`✅ إرسال: ${s}`); break; }
      }
      if (!submitted) { await this.page.keyboard.press('Enter'); console.log('✅ إرسال: Enter'); }

      await this.randomDelay(2000, 3000);
      await this.debugScreenshot('after-reply');
      console.log(`✅ تم إرسال: "${replyText}"`);
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

      // v9.1: سيلكتورات أكثر شمولاً
      const selectors = [
        '[data-e2e="comment-input"] textarea', '[data-e2e="comment-input"]',
        'textarea[placeholder*="comment" i]', 'textarea[placeholder*="تعليق" i]',
        'textarea[placeholder*="Add a comment" i]',
        'div[contenteditable="true"]', 'div[role="textbox"]',
        'textarea[placeholder]', 'textarea'
      ];
      let input = null;
      for (const s of selectors) { input = await this.page.$(s); if (input) { console.log(`✅ خانة تعليق: ${s}`); break; } }

      if (!input) {
        // جرب التفعيل
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
      console.log(`✅ تعليق: "${comment}"`);
      return true;
    } catch (e) { console.error('❌ خطأ تعليق:', e.message); return false; }
  }

  async randomDelay(min = 1000, max = 3000) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
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
║      🤖 بوت تيك توك الذكي v9.1          ║
║      Anti-Detect + Auto-Config           ║
║                                          ║
╚══════════════════════════════════════════╝
  `);

  // v9.1: أنشئ z-ai-config من البداية
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
          console.log(`\n📬 ═══════════════════════════════`);
          console.log(`📬 منشن من @${mention.mentioner} (${mention.source})`);
          console.log(`📬 "${mention.text.substring(0, 80)}..."`);
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
