/**
 * ===================================
 * نظام فلترة المحتوى الحساس
 * ===================================
 * يمنع البوت من الرد على المواضيع التالية:
 * - التحريض والكراهية
 * - المخدرات والمسكرات
 * - المواضيع الطبية
 * - العنف والتهديد
 */

// كلمات مفتاحية محظورة بالعربية والإنجليزية
const BLOCKED_KEYWORDS = {
  // تحريض وكراهية
  incitement: [
    'اقتل', 'اغتال', 'حرق', 'تفجير', 'ارهاب', 'ارهابي', 'كافر', 'خائن',
    'عميل', 'خيانة', 'تآمر', 'انقلاب', 'عصيان', 'تمرد', 'فتنة', 'طائفية',
    'عنصرية', 'تمييز', 'ابادة', 'حرب', 'قتال', 'دمار', 'انتقام', 'ثأر',
    'kill', 'murder', 'terrorist', 'terrorism', 'hate', 'racist', 'genocide',
    'bomb', 'attack', 'destroy', 'revenge', 'war', 'violence'
  ],

  // مخدرات ومسكرات
  drugs: [
    'مخدرات', 'حشيش', 'كوكايين', 'هيروين', 'حبوب', 'مهلوسات', 'غزلان',
    'بانجو', 'أفيون', 'مورفين', 'امفيتامين', 'كبتاجون', 'ترامادول',
    'مسكرات', 'خمر', 'خمور', 'كحول', 'سكر', 'مستكر', 'سُكر',
    'drugs', 'cocaine', 'heroin', 'marijuana', 'weed', 'cannabis', 'hashish',
    'opioid', 'meth', 'crack', 'lsd', 'ecstasy', 'narcotics', 'alcohol'
  ],

  // مواضيع طبية
  medical: [
    'علاج', 'دواء', 'تشخيص', 'مرض', 'سرطان', 'سكري', 'ضغط', 'قلب',
    'جراحة', 'عملية', 'أعراض', 'تحليل', 'أشعة', 'روشتة', 'وصفة طبية',
    'مضاد حيوي', 'مسكن', 'مهدئ', 'منوم', 'حقنة', 'تطعيم', 'لقاح',
    'صحة نفسية', 'اكتئاب', 'قلق', 'وسواس', 'صرع', 'نوبات',
    'treatment', 'medicine', 'diagnosis', 'disease', 'cancer', 'diabetes',
    'surgery', 'symptoms', 'prescription', 'antibiotic', 'vaccine',
    'depression', 'anxiety', 'mental health', 'therapy', 'doctor'
  ],

  // عنف وتهديد
  violence: [
    'اضرب', 'ايذاء', 'تعذيب', 'سلاح', 'مسدس', 'بندقية', 'سكين',
    'تهديد', 'وعيد', 'عقاب', 'انتقام', 'ضرب', 'عنف', 'اعتداء',
    'weapon', 'gun', 'knife', 'assault', 'abuse', 'torture', 'threat',
    'punish', 'harm', 'hurt', 'fight'
  ]
};

// أنماط regex للكشف عن محتوى حساس
const BLOCKED_PATTERNS = [
  // وصفات/طرق تحضير مخدرات
  /كيف.*تصنع|طريقة.*تحضير|وصفة.*مخدر|كيف.*تتعاطى/i,
  /how to make.*drug|how to prepare|drug recipe/i,

  // نصائح طبية
  /عالج.*بنفسك|علاج.*منزلي|وصفة.*علاج|تخلص.*مرض/i,
  /home remedy|self treatment|cure yourself/i,

  // تحريض
  /انضم.*لنا|شارك.*القتال|ادعم.*الجهاد|كفر.*بـ/i,
  /join us.*fight|support.*jihad|kill them all/i,

  // نصائح باستخدام مخدرات
  /جرب.*حشيش|استخدم.*مخدر|تأثير.*رائع.*حبوب/i,
  /try.*weed|use.*drug|amazing.*high/i
];

/**
 * فحص هل النص يحتوي على محتوى حساس
 * @param {string} text - النص المراد فحصه
 * @returns {{isSafe: boolean, reasons: string[], category: string|null}}
 */
export function checkContentSafety(text) {
  if (!text || typeof text !== 'string') {
    return { isSafe: true, reasons: [], category: null };
  }

  const normalizedText = text.toLowerCase().trim();
  const reasons = [];
  let category = null;

  // فحص الكلمات المفتاحية (باستخدام حدود الكلمات لتقليل الإيجابيات الكاذبة)
  for (const [cat, keywords] of Object.entries(BLOCKED_KEYWORDS)) {
    for (const keyword of keywords) {
      const kw = keyword.toLowerCase();
      // للكلمات الإنجليزية: استخدام حدود الكلمات
      // للكلمات العربية: استخدام includes لأن العربية ما عندها حدود كلمات واضحة
      const isEnglish = /^[a-z]/.test(kw);
      const found = isEnglish
        ? new RegExp(`\\b${kw}\\b`).test(normalizedText)
        : normalizedText.includes(kw);
      
      if (found) {
        reasons.push(`كلمة محظورة: "${keyword}"`);
        category = cat;
        break;
      }
    }
    if (category) break;
  }

  // فحص أنماط Regex
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedText)) {
      reasons.push(`نمط محظور متطابق`);
      category = category || 'pattern_match';
      break;
    }
  }

  return {
    isSafe: reasons.length === 0,
    reasons,
    category
  };
}

/**
 * الحصول على رد رفض مهذب حسب نوع المحتوى
 * @param {string} category - فئة المحتوى المحظور
 * @returns {string} رد الرفض
 */
export function getRefusalResponse(category) {
  const refusals = {
    incitement: 'آسف، ما أقدر أعلق على مواضيع تتعلق بالتحريض أو الكراهية. أحاول أكون إيجابي! 🌟',
    drugs: 'مع احترامي، ما أناقش مواضيع المخدرات أو المسكرات. الصحة أهم! 💪',
    medical: 'ما أنصح بمواضيع طبية لأنها حساسة وتحتاج متخصص. استشر طبيبك! 🏥',
    violence: 'ما أحب أتكلم عن العنف أو التهديد. خلنا نتكلم عن أشياء إيجابية! 😊',
    pattern_match: 'آسف، ما أقدر أرد على هالموضوع. خلني أعلق على شيء ثاني! 🙏'
  };

  return refusals[category] || refusals.pattern_match;
}

/**
 * فحص هل الفيديو نفسه يحتوي محتوى حساس بناءً على الوصف
 * @param {object} videoInfo - معلومات الفيديو
 * @returns {{isSafe: boolean, reasons: string[]}}
 */
export function checkVideoSafety(videoInfo) {
  const textsToCheck = [
    videoInfo.description || '',
    videoInfo.title || '',
    (videoInfo.tags || []).join(' '),
    videoInfo.music || ''
  ];

  const allReasons = [];

  for (const text of textsToCheck) {
    const result = checkContentSafety(text);
    if (!result.isSafe) {
      allReasons.push(...result.reasons);
    }
  }

  return {
    isSafe: allReasons.length === 0,
    reasons: [...new Set(allReasons)]
  };
}

export { BLOCKED_KEYWORDS, BLOCKED_PATTERNS };
