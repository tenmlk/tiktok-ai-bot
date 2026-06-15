/**
 * ===================================
 * بوت تيك توك الذكي - Cloudflare Worker
 * ===================================
 * 
 * يعمل كـ Serverless Function على Cloudflare Workers
 * يشتغل تلقائياً كل 30 دقيقة عبر Cron Trigger
 * 
 * المميزات:
 * - مجاني 100% بدون بطاقة بنكية
 * - ما ينام أبدًا (Cron يشغله)
 * - سريع جداً (شبكة Cloudflare العالمية)
 */

import ZAI from 'z-ai-web-dev-sdk';

// ===================================
# ثوابت وأعدادات
# ===================================

// كلمات مفتاحية محظورة
const BLOCKED_KEYWORDS = {
  incitement: [
    'اقتل', 'اغتال', 'حرق', 'تفجير', 'ارهاب', 'ارهابي', 'كافر', 'خائن',
    'عميل', 'خيانة', 'تآمر', 'انقلاب', 'عصيان', 'تمرد', 'فتنة', 'طائفية',
    'عنصرية', 'تمييز', 'ابادة', 'حرب', 'قتال', 'دمار', 'انتقام', 'ثأر',
    'kill', 'murder', 'terrorist', 'terrorism', 'hate', 'racist', 'genocide',
    'bomb', 'attack', 'destroy', 'revenge', 'war', 'violence'
  ],
  drugs: [
    'مخدرات', 'حشيش', 'كوكايين', 'هيروين', 'حبوب', 'مهلوسات', 'غزلان',
    'بانجو', 'أفيون', 'مورفين', 'امفيتامين', 'كبتاجون', 'ترامادول',
    'مسكرات', 'خمر', 'خمور', 'كحول', 'سكر', 'مستكر',
    'drugs', 'cocaine', 'heroin', 'marijuana', 'weed', 'cannabis', 'hashish',
    'opioid', 'meth', 'crack', 'lsd', 'ecstasy', 'narcotics', 'alcohol'
  ],
  medical: [
    'علاج', 'دواء', 'تشخيص', 'مرض', 'سرطان', 'سكري', 'ضغط', 'قلب',
    'جراحة', 'عملية', 'أعراض', 'تحليل', 'أشعة', 'روشتة', 'وصفة طبية',
    'مضاد حيوي', 'مسكن', 'مهدئ', 'منوم', 'حقنة', 'تطعيم', 'لقاح',
    'صحة نفسية', 'اكتئاب', 'قلق', 'وسواس', 'صرع', 'نوبات',
    'treatment', 'medicine', 'diagnosis', 'disease', 'cancer', 'diabetes',
    'surgery', 'symptoms', 'prescription', 'antibiotic', 'vaccine',
    'depression', 'anxiety', 'mental health', 'therapy', 'doctor'
  ],
  violence: [
    'اضرب', 'ايذاء', 'تعذيب', 'سلاح', 'مسدس', 'بندقية', 'سكين',
    'تهديد', 'وعيد', 'عقاب', 'انتقام', 'ضرب', 'عنف', 'اعتداء',
    'weapon', 'gun', 'knife', 'assault', 'abuse', 'torture', 'threat',
    'punish', 'harm', 'hurt', 'fight'
  ]
};

const BLOCKED_PATTERNS = [
  /كيف.*تصنع|طريقة.*تحضير|وصفة.*مخدر|كيف.*تتعاطى/i,
  /how to make.*drug|how to prepare|drug recipe/i,
  /عالج.*بنفسك|علاج.*منزلي|وصفة.*علاج|تخلص.*مرض/i,
  /home remedy|self treatment|cure yourself/i,
  /انضم.*لنا|شارك.*القتال|ادعم.*الجهاد|كفر.*بـ/i,
  /جرب.*حشيش|استخدم.*مخدر|تأثير.*رائع.*حبوب/i
];

// ===================================
# نظام فلترة المحتوى
# ===================================

function checkContentSafety(text) {
  if (!text || typeof text !== 'string') {
    return { isSafe: true, reasons: [], category: null };
  }

  const normalizedText = text.toLowerCase().trim();
  const reasons = [];
  let category = null;

  for (const [cat, keywords] of Object.entries(BLOCKED_KEYWORDS)) {
    for (const keyword of keywords) {
      const kw = keyword.toLowerCase();
      const isEnglish = /^[a-z]/.test(kw);
      const found = isEnglish
        ? new RegExp(`\\b${kw}\\b`).test(normalizedText)
        : normalizedText.includes(kw);

      if (found) {
        reasons.push(`محظور: "${keyword}"`);
        category = cat;
        break;
      }
    }
    if (category) break;
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedText)) {
      reasons.push('نمط محظور');
      category = category || 'pattern_match';
      break;
    }
  }

  return { isSafe: reasons.length === 0, reasons, category };
}

function getRefusalResponse(category) {
  const refusals = {
    incitement: 'آسف، ما أقدر أعلق على مواضيع التحريض أو الكراهية. أحاول أكون إيجابي! 🌟',
    drugs: 'مع احترامي، ما أناقش مواضيع المخدرات أو المسكرات. الصحة أهم! 💪',
    medical: 'ما أنصح بمواضيع طبية لأنها حساسة وتحتاج متخصص. استشر طبيبك! 🏥',
    violence: 'ما أحب أتكلم عن العنف أو التهديد. خلنا نتكلم عن أشياء إيجابية! 😊',
    pattern_match: 'آسف، ما أقدر أرد على هالموضوع. خلني أعلق على شيء ثاني! 🙏'
  };
  return refusals[category] || refusals.pattern_match;
}

// ===================================
# نظام توليد الردود بالذكاء الاصطناعي
# ===================================

function buildSystemPrompt(personality = 'friendly') {
  const personas = {
    friendly: { name: 'صديق ودود', tone: 'ودود ومشجع' },
    funny: { name: 'فكاهي', tone: 'مرح وخفيف' },
    critic: { name: 'ناقد بنّاء', tone: 'صريح ومحترم' },
    informative: { name: 'مثقف', tone: 'مثقف ومفيد' }
  };
  const persona = personas[personality] || personas.friendly;

  return `أنت بوت تيك توك ذكي بشخصية "${persona.name}". نبرتك: ${persona.tone}

القواعد:
1. ترد بالعربية فقط
2. الرد قصير مناسب لتعليق تيك توك (أقل من 150 حرف)
3. تبدأ بـ @{username} دائماً
4. تعطي رأيك أو معلومة مفيدة
5. تستخدم 1-3 إيموجي فقط
6. ما تتكلم عن تحريض/كراهية/عنف/مخدرات/مواضيع طبية
7. تكون طبيعي وما تبين إنك بوت`;
}

async function generateAIResponse(zai, videoInfo, personality) {
  const safetyCheck = checkContentSafety(
    `${videoInfo.description || ''} ${videoInfo.title || ''} ${(videoInfo.tags || []).join(' ')}`
  );

  if (!safetyCheck.isSafe) {
    return { response: getRefusalResponse(safetyCheck.category), blocked: true };
  }

  const username = videoInfo.username || 'user';
  const systemPrompt = buildSystemPrompt(personality);

  const userMessage = `معلومات الفيديو:
- صاحب الفيديو: @${username}
- الوصف: ${videoInfo.description || 'لا يوجد وصف'}
- الهاشتاقات: ${(videoInfo.tags || []).join(', ') || 'لا يوجد'}

اكتب تعليق مناسب. ابدأ بـ @${username}`;

  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.8,
      max_tokens: 100,
      top_p: 0.9
    });

    let response = completion.choices[0]?.message?.content?.trim();

    if (!response) {
      response = `@${username} فيديو حلو! 🔥`;
    }

    // فحص أمان الرد
    const responseSafety = checkContentSafety(response);
    if (!responseSafety.isSafe) {
      return { response: getRefusalResponse(responseSafety.category), blocked: true };
    }

    if (!response.startsWith(`@${username}`)) {
      response = `@${username} ${response}`;
    }

    return { response, blocked: false };

  } catch (error) {
    const fallbacks = [
      `@${username} فيديو حلو! 🔥`,
      `@${username} يستاهل لايك! 👍`,
      `@${username} محتوى ممتاز! 💪`
    ];
    return { response: fallbacks[Math.floor(Math.random() * fallbacks.length)], blocked: false };
  }
}

// ===================================
# فيديوهات تجريبية (محاكاة)
# ===================================

function getSimulatedVideos(count = 5) {
  const videos = [
    { username: 'ahmed_cooking', description: 'سويت أكل هندي لأول مرة! 🍛 #طبخ #أكل_هندي', tags: ['طبخ', 'أكل_هندي', 'cooking'] },
    { username: 'sara_art', description: 'رسمت لوحة بالألوان المائية 🎨 #رسم #فن', tags: ['رسم', 'فن', 'art'] },
    { username: 'khaled_fitness', description: 'تمرين كارديو 30 دقيقة 💪 #رياضة #تمارين', tags: ['رياضة', 'تمارين', 'fitness'] },
    { username: 'nora_diy', description: 'تنظيم الغرفة بخطوات بسيطة ✨ #تنظيم #ديكور', tags: ['تنظيم', 'ديكور', 'DIY'] },
    { username: 'fahad_comedy', description: 'لما أمك تطلبك وأنت تلعب 😂 #كوميديا #ضحك', tags: ['كوميديا', 'ضحك', 'comedy'] },
    { username: 'reem_books', description: 'مراجعة كتاب "العادات الذرية" 📚 #كتب #قراءة', tags: ['كتب', 'قراءة', 'books'] },
    { username: 'layla_travel', description: 'مكان سري في الطبيعة 🏔️ #سفر #طبيعة', tags: ['سفر', 'طبيعة', 'travel'] },
    { username: 'omar_tech', description: 'أفضل 5 تطبيقات للإنتاجية 📱 #تقنية #تطبيقات', tags: ['تقنية', 'تطبيقات', 'tech'] }
  ];
  return videos.sort(() => Math.random() - 0.5).slice(0, count);
}

// ===================================
# Cloudflare Worker الرئيسي
# ===================================

export default {
  // معالجة طلبات HTTP
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // صفحة الحالة
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'running',
        bot: '🤖 بوت تيك توك الذكي',
        message: 'البوت شغال على Cloudflare Workers! ⚡',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // تشغيل البوت يدوياً
    if (url.pathname === '/run') {
      const result = await runBot(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  // تشغيل مجدول (Cron Trigger)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBot(env));
  }
};

// ===================================
# تشغيل البوت
# ===================================

async function runBot(env) {
  const startTime = Date.now();
  const results = {
    videosProcessed: 0,
    commentsPosted: 0,
    contentBlocked: 0,
    errors: 0,
    responses: []
  };

  try {
    // تهيئة الذكاء الاصطناعي
    const zai = await ZAI.create();

    // جلب الفيديوهات (محاكاة - يمكن استبدالها بـ API حقيقي)
    const videos = getSimulatedVideos(
      parseInt(env.MAX_VIDEOS_PER_RUN || '5')
    );

    const personality = env.BOT_PERSONALITY || 'friendly';

    // التفاعل مع كل فيديو
    for (const video of videos) {
      try {
        // فحص أمان الفيديو
        const videoSafety = checkContentSafety(
          `${video.description || ''} ${(video.tags || []).join(' ')}`
        );

        if (!videoSafety.isSafe) {
          results.contentBlocked++;
          continue;
        }

        // توليد الرد
        const { response, blocked } = await generateAIResponse(zai, video, personality);

        if (blocked) {
          results.contentBlocked++;
        } else {
          results.commentsPosted++;
          results.responses.push({
            username: video.username,
            comment: response
          });
        }

        results.videosProcessed++;

      } catch (error) {
        results.errors++;
      }
    }

  } catch (error) {
    results.errors++;
    results.errorMessage = error.message;
  }

  results.runtime = `${Date.now() - startTime}ms`;
  results.timestamp = new Date().toISOString();

  return results;
}
