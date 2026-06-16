/**
 * ===================================
 * نظام توليد الردود بالذكاء الاصطناعي
 * ===================================
 * يستخدم z-ai-web-dev-sdk لتوليد ردود ذكية
 * على فيديوهات تيك توك مع الحفاظ على شخصية البوت
 */

import ZAI from 'z-ai-web-dev-sdk';
import { checkContentSafety, getRefusalResponse } from './contentFilter.js';

// شخصيات البوت المتاحة
const BOT_PERSONALITIES = {
  friendly: {
    name: 'صديق ودود',
    description: 'شخصية مرحبة وإيجابية تحب تشجيع الناس',
    tone: 'ودود ومشجع'
  },
  funny: {
    name: 'فكاهي',
    description: 'شخصية مرحة تحط نكات خفيفة',
    tone: 'مرح وخفيف'
  },
  critic: {
    name: 'ناقد بنّاء',
    description: 'يعطي آراء صريحة لكن بأدب واحترام',
    tone: 'صريح ومحترم'
  },
  informative: {
    name: 'مثقف',
    description: 'يضيف معلومات قيمة ومفيدة',
    tone: 'مثقف ومفيد'
  }
};

// رسالة النظام الأساسية
function buildSystemPrompt(personality = 'friendly', language = 'ar') {
  const persona = BOT_PERSONALITIES[personality] || BOT_PERSONALITIES.friendly;

  return `أنت بوت تيك توك ذكي بشخصية "${persona.name}".
صفاتك: ${persona.description}
نبرتك: ${persona.tone}

القواعد الصارمة:
1. ترد باللغة ${language === 'ar' ? 'العربية' : 'الإنجليزية'} فقط
2. الرد يكون قصير ومناسب لتعليق تيك توك (أقل من 150 حرف)
3. تبدأ الرد بـ @{username} دائماً
4. تعطي رأيك في الفيديو أو تضيف معلومة مفيدة
5. تستخدم إيموجي بشكل معتدل (1-3 إيموجي فقط)
6. ما تتكلم عن أي موضوع يتعلق بـ:
   - التحريض أو الكراهية أو العنف
   - المخدرات أو المسكرات
   - النصائح الطبية أو التشخيصات
7. إذا سُئلت عن شيء محظور، تعتذر بأدب وتحول الموضوع
8. ما تسوي سبام أو تكرر نفس الرد
9. تكون طبيعي وما تبين إنك بوت

أمثلة على ردود جيدة:
- "@ahmed هالفيديو رهيب! الطريقة اللي سويت فيها الأكل تبدو لذيذة 😍🔥"
- "@sara واو! عندك موهبة حلوة بالرسم، استمري! 🎨✨"
- "@mohammed معلومة حلوة! ما كنت أعرف هالشيء قبل، يسلمو 🙏"

أمثلة على ردود مرفوضة (ما تسويها):
- "@user جرب المخدرات عشان تسترخي" ❌
- "@user هالشيء يسبب سرطان" ❌
- "@user لازم تنتقم منهم" ❌`;
}

/**
 * كلاس مولد الردود الذكي
 */
export class AIResponder {
  constructor(options = {}) {
    this.personality = options.personality || 'friendly';
    this.language = options.language || 'ar';
    this.zai = null;
    this.conversationHistory = new Map(); // تخزين تاريخ المحادثات لكل مستخدم
    this.maxHistoryPerUser = 5;
  }

  /**
   * تهيئة الاتصال بالذكاء الاصطناعي
   */
  async init() {
    try {
      this.zai = await ZAI.create();
      console.log('✅ تم الاتصال بالذكاء الاصطناعي بنجاح');
      return true;
    } catch (error) {
      console.error('❌ فشل الاتصال بالذكاء الاصطناعي:', error.message);
      return false;
    }
  }

  /**
   * توليد رد على فيديو
   * @param {object} videoInfo - معلومات الفيديو
   * @param {string} videoInfo.username - اسم صاحب الفيديو
   * @param {string} videoInfo.description - وصف الفيديو
   * @param {string} videoInfo.title - عنوان الفيديو
   * @param {string[]} videoInfo.tags - هاشتاقات الفيديو
   * @param {string} videoInfo.music - الموسيقى المستخدمة
   * @returns {Promise<string>} الرد المولد
   */
  async generateVideoResponse(videoInfo) {
    // فحص أمان المحتوى
    const safetyCheck = checkContentSafety(
      `${videoInfo.description || ''} ${videoInfo.title || ''} ${(videoInfo.tags || []).join(' ')}`
    );

    if (!safetyCheck.isSafe) {
      console.log(`⚠️ محتوى حساس مكتشف: ${safetyCheck.reasons.join(', ')}`);
      return getRefusalResponse(safetyCheck.category);
    }

    const username = videoInfo.username || 'user';
    const systemPrompt = buildSystemPrompt(this.personality, this.language);

    // بناء سياق الفيديو
    const videoContext = `
معلومات الفيديو:
- صاحب الفيديو: @${username}
- الوصف: ${videoInfo.description || 'لا يوجد وصف'}
- العنوان: ${videoInfo.title || 'لا يوجد عنوان'}
- الهاشتاقات: ${(videoInfo.tags || []).join(', ') || 'لا يوجد'}
- الموسيقى: ${videoInfo.music || 'غير محدد'}
${videoInfo.commentToReply ? `- تعليق للرد عليه: "${videoInfo.commentToReply}"` : ''}

اكتب تعليق مناسب على هالفيديو. تذكر تبدأ بـ @${username}`;

    // الحصول على تاريخ المحادثة
    const history = this.conversationHistory.get(username) || [];

    // بناء الرسائل
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-4), // آخر رسالتين فقط للحفاظ على السياق
      { role: 'user', content: videoContext }
    ];

    try {
      const completion = await this.zai.chat.completions.create({
        messages,
        temperature: 0.8, // إبداع معتدل
        max_tokens: 100,   // تعليق قصير
        top_p: 0.9
      });

      const response = completion.choices[0]?.message?.content?.trim();

      if (!response) {
        return this.getFallbackResponse(username);
      }

      // فحص أمان الرد المولد
      const responseSafety = checkContentSafety(response);
      if (!responseSafety.isSafe) {
        console.log(`⚠️ الرد المولد فيه محتوى حساس، يتم الرفض`);
        return getRefusalResponse(responseSafety.category);
      }

      // التأكد إن الرد يبدأ بالمنشن
      const finalResponse = response.startsWith(`@${username}`)
        ? response
        : `@${username} ${response}`;

      // تحديث تاريخ المحادثة
      this.updateHistory(username, videoContext, finalResponse);

      return finalResponse;

    } catch (error) {
      console.error('❌ خطأ في توليد الرد:', error.message);
      return this.getFallbackResponse(username);
    }
  }

  /**
   * توليد رد على تعليق
   * @param {string} username - اسم المستخدم
   * @param {string} commentText - نص التعليق
   * @param {object} videoInfo - معلومات الفيديو
   * @returns {Promise<string>}
   */
  async generateCommentReply(username, commentText, videoInfo = {}) {
    // فحص أمان التعليق
    const safetyCheck = checkContentSafety(commentText);

    if (!safetyCheck.isSafe) {
      console.log(`⚠️ تعليق فيه محتوى حساس من @${username}: ${safetyCheck.reasons.join(', ')}`);
      return getRefusalResponse(safetyCheck.category);
    }

    const systemPrompt = buildSystemPrompt(this.personality, this.language);

    const context = `
فيديو @${videoInfo.username || username}: ${videoInfo.description || 'محتوى عام'}
التعليق من @${username}: "${commentText}"

رد على هالتعليق بطريقة ودودة. ابدأ بـ @${username}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context }
    ];

    try {
      const completion = await this.zai.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.9
      });

      let response = completion.choices[0]?.message?.content?.trim();

      if (!response) {
        return this.getFallbackResponse(username);
      }

      // فحص أمان الرد
      const responseSafety = checkContentSafety(response);
      if (!responseSafety.isSafe) {
        return getRefusalResponse(responseSafety.category);
      }

      if (!response.startsWith(`@${username}`)) {
        response = `@${username} ${response}`;
      }

      this.updateHistory(username, context, response);

      return response;

    } catch (error) {
      console.error('❌ خطأ في توليد رد التعليق:', error.message);
      return this.getFallbackResponse(username);
    }
  }

  /**
   * تحديث تاريخ المحادثة
   */
  updateHistory(username, userMessage, botResponse) {
    if (!this.conversationHistory.has(username)) {
      this.conversationHistory.set(username, []);
    }

    const history = this.conversationHistory.get(username);
    history.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: botResponse }
    );

    // الحفاظ على آخر N رسائل فقط
    if (history.length > this.maxHistoryPerUser * 2) {
      this.conversationHistory.set(username, history.slice(-this.maxHistoryPerUser * 2));
    }
  }

  /**
   * ردود احتياطية في حالة فشل الذكاء الاصطناعي
   */
  getFallbackResponse(username) {
    const fallbacks = [
      `@${username} فيديو حلو! 🔥`,
      `@${username} يستاهل لايك! 👍`,
      `@${username} محتوى ممتاز، استمر! 💪`,
      `@${username} عجبني! ✨`,
      `@${username} واو رهيب! 🌟`
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  /**
   * مسح تاريخ محادثة مستخدم
   */
  clearHistory(username) {
    this.conversationHistory.delete(username);
  }

  /**
   * مسح كل تواريخ المحادثات
   */
  clearAllHistory() {
    this.conversationHistory.clear();
  }
}

export { BOT_PERSONALITIES };
