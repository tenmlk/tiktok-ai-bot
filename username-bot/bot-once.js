// Run-once bot for GitHub Actions
// - Fetches pending Telegram updates
// - Supports commands: /start /help /2 /3 /4 /5 /6 /7 /8 /verify
//   /N -> generates 10 random usernames of length N, checks availability, streams results
//   /verify <username> -> thorough single-username check with full details
// - Replies via Telegram sendMessage API
// - Exits cleanly so GitHub Action completes
//
// CALLED BY .github/workflows/bot.yml every 5 minutes via cron.

const axios = require('axios');
const { findAvailableByLength, checkAllPlatforms } = require('./checker.js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN env var not set.');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${TOKEN}`;
const PLATFORM_EMOJI = { tiktok: '🎵', snapchat: '👻', instagram: '📸' };
const PLATFORM_NAME = { tiktok: 'TikTok', snapchat: 'Snapchat', instagram: 'Instagram' };

async function tg(method, params) {
  try {
    const r = await axios.post(`${TG_API}/${method}`, params, { timeout: 60000 });
    return r.data;
  } catch (e) {
    console.log(`  [tg.${method}] error: ${e.message}`);
    return null;
  }
}

// Format platform status with confidence percentage and verification method
function formatPlatformsText(result) {
  return ['tiktok', 'snapchat', 'instagram']
    .map((k) => {
      const v = result[k] || { available: null, confidence: 0, source: '', methods: [] };
      let icon, word, conf;
      if (v.available === true) {
        icon = '✅';
        word = 'متاح';
        conf = v.confidence + '%';
      } else if (v.available === false) {
        icon = '❌';
        word = 'محجوز';
        conf = v.confidence + '%';
      } else {
        icon = '⚠️';
        word = 'غير متأكد';
        conf = '—';
      }
      const methods = (v.methods || []).map(m => m.method).join(', ');
      const methodsLine = methods ? `\n      └ الطرق: ${methods}` : '';
      return `${PLATFORM_EMOJI[k]} ${PLATFORM_NAME[k]}: ${icon} ${word} (${conf})${methodsLine}`;
    })
    .join('\n');
}

// ─── /N handler: generate 10 random usernames of length N, check availability ──
async function handleByLength(chatId, length) {
  if (length < 2 || length > 8) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '⚠️ الطول لازم يكون بين 2 و 8.\nمثال: /3 لليوزرات من 3 حروف.',
    });
    return;
  }

  const status = await tg('sendMessage', {
    chat_id: chatId,
    text:
      `🔍 أبحث عن 10 يوزرات متاحة بطول ${length} حروف...\n\n` +
      `📋 <b>منهجية الفحص:</b>\n` +
      `• Snapchat: فحص مزدوج (صفحة + snapcode SVG) — موثوق 100%\n` +
      `• TikTok: فحص صفحة + إشارات JSON — موثوق جزئياً\n` +
      `• Instagram: فحص صفحة + إشارات — موثوق جزئياً\n\n` +
      `✨ اليوزر يظهر فوراً عند التأكد من Snapchat.\n` +
      `⏱️ الانتظار: 1-4 دقائق.`,
    parse_mode: 'HTML',
  });

  let foundCount = 0;
  let checkedCount = 0;
  const TARGET = 10;
  const t0 = Date.now();

  try {
    const r = await findAvailableByLength(
      length,
      TARGET,
      { verbose: true, timeBudgetSec: 240 },
      async (item) => {
        foundCount++;
        const platformsText = formatPlatformsText(item.result || {});
        const replyMarkup = {
          inline_keyboard: [[
            { text: `📋 نسخ:  ${item.username}`, copy_text: { text: item.username } },
          ]],
        };
        await tg('sendMessage', {
          chat_id: chatId,
          text:
            `✅ <b>#${foundCount}</b>  —  الثقة الإجمالية: ${item.confidence}%\n\n` +
            `<code>${item.username}</code>\n\n` +
            platformsText +
            `\n\n👇 اضغط على الزر لنسخ اليوزر`,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
      }
    );
    checkedCount = r.checkedCount;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    let finalText;
    if (foundCount === 0) {
      finalText =
        `😔 ما لقيت يوزر متاح بطول ${length} بعد فحص ${checkedCount} خيار.\n` +
        `جرّب طول آخر (مثال: /4) أو حاول لاحقاً.\n\n` +
        `ℹ️ ملاحظة: البوت يتطلب تأكيد Snapchat 100%. TikTok و Instagram قد يظهران "غير متأكد" بسبب حظر السيرفرات.`;
    } else {
      finalText =
        `✅ تم العثور على ${foundCount} يوزر متاح في ${elapsed}s\n` +
        `(فحصت ${checkedCount} خيار عشوائي)\n\n` +
        `💎 اضغط على أي زر "📋 نسخ" لنسخ اليوزر.\n\n` +
        `ℹ️ <b>ملاحظة مهمة:</b>\n` +
        `• Snapchat: متاح 100% (موثوق بفحص مزدوج)\n` +
        `• TikTok/Instagram: قد يظهران "⚠️ غير متأكد" — راجعها يدوياً قبل التسجيل\n` +
        `• التحقق النهائي الوحيد: محاولة التسجيل في المنصة`;
    }
    if (status && status.result && status.result.message_id) {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: status.result.message_id,
        text: finalText,
        parse_mode: typeof finalText === 'string' && finalText.includes('<') ? 'HTML' : undefined,
      });
    }
  } catch (e) {
    if (status && status.result && status.result.message_id) {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: status.result.message_id,
        text: `حدث خطأ: ${e.message}`,
      });
    }
  }
}

// ─── /verify handler: thorough single-username check ──
async function handleVerify(chatId, usernameRaw) {
  const username = usernameRaw.toLowerCase().replace(/[^a-z0-9_\.\-]/g, '');
  if (!username) {
    await tg('sendMessage', { chat_id: chatId, text: 'أرسل يوزر. مثال: /verify cool' });
    return;
  }
  const status = await tg('sendMessage', {
    chat_id: chatId,
    text: `🔍 فحص دقيق لليوزر "${username}"...\n⏱️ يأخذ 10-30 ثانية.`,
  });
  try {
    const r = await checkAllPlatforms(username);
    const lines = formatPlatformsText(r);

    // Detailed method breakdown
    const detailLines = ['tiktok', 'snapchat', 'instagram']
      .map((k) => {
        const v = r[k] || {};
        const methods = (v.methods || []).map(m => `  • ${m.method}: ${m.result}`).join('\n');
        return `${PLATFORM_EMOJI[k]} ${PLATFORM_NAME[k]}:\n${methods || '  • لا توجد بيانات'}`;
      })
      .join('\n\n');

    const replyMarkup = {
      inline_keyboard: [[
        { text: `📋 نسخ:  ${username}`, copy_text: { text: username } },
      ]],
    };
    if (status && status.result && status.result.message_id) {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: status.result.message_id,
        text:
          `🔍 فحص دقيق لليوزر:\n\n` +
          `<code>${username}</code>\n\n` +
          lines +
          `\n\n📋 <b>تفاصيل الطرق المستخدمة:</b>\n\n${detailLines}` +
          `\n\n👇 اضغط على الزر لنسخ اليوزر`,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    }
  } catch (e) {
    if (status && status.result && status.result.message_id) {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: status.result.message_id,
        text: `حدث خطأ: ${e.message}`,
      });
    }
  }
}

async function handleCheck(chatId, fromId, usernameRaw) {
  // Alias for /verify
  return handleVerify(chatId, usernameRaw);
}

async function handleStart(chatId, name) {
  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `أهلاً ${name} 👋\n\n` +
      `أنا بوت يبحث عن يوزرات متاحة على:\n  🎵 TikTok\n  👻 Snapchat\n  📸 Instagram\n\n` +
      `📝 <b>كيف تستخدمني؟</b>\n` +
      `  • /2 لـ 10 يوزرات من حرفين\n` +
      `  • /3 لـ 10 يوزرات من 3 حروف\n` +
      `  • /4 ... /5 ... /6 ... /7 ... /8\n` +
      `  • /verify &lt;username&gt; لفحص يوزر معيّن بتفصيل كامل\n` +
      `  • /help لعرض المساعدة\n\n` +
      `🔒 <b>منهجية الفحص (موثوقة):</b>\n` +
      `  • Snapchat: فحص مزدوج (صفحة + snapcode SVG) — موثوق 100%\n` +
      `  • TikTok: فحص صفحة + إشارات JSON في HTML\n` +
      `  • Instagram: فحص صفحة + إشارات og:title/JSON\n` +
      `  • المصادر الرسمية: snapchat.com, tiktok.com, instagram.com\n\n` +
      `⚠️ <b>ملاحظات مهمة:</b>\n` +
      `  • اليوزر يبدأ بحرف دائماً\n` +
      `  • ما ينتهي بـ . _ -\n` +
      `  • ما في رمزين متتاليين (.. __ --)\n` +
      `  • يدعم: حروف + أرقام + . _ -\n\n` +
      `⏱️ البوت يفحص رسائله كل 5 دقائق.\n` +
      `⏱️ كل بحث يستغرق 1-4 دقائق.\n\n` +
      `💡 <b>للحصول على 100% ضمان:</b> حاول التسجيل باليوزر في المنصة بعد ما يعطيك البوت نتيجة "متاح".`,
    parse_mode: 'HTML',
  });
}

async function processUpdate(update) {
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const fromId = msg.from.id;
  const text = msg.text;
  const name = msg.from.first_name || 'there';

  console.log(`[msg] from=${fromId} chat=${chatId} text="${text.slice(0, 60)}"`);

  if (/^\/start\b/.test(text)) return handleStart(chatId, name);
  if (/^\/help\b/.test(text)) {
    return tg('sendMessage', {
      chat_id: chatId,
      text:
        `الأوامر:\n\n` +
        `/start - ترحيب\n` +
        `/help - هذه الرسالة\n` +
        `/2 - 10 يوزرات من حرفين\n` +
        `/3 - 10 يوزرات من 3 حروف\n` +
        `/4 - 10 يوزرات من 4 حروف\n` +
        `/5 ... /6 ... /7 ... /8\n` +
        `/verify <username> - فحص دقيق بيوزر معيّن\n` +
        `/check <username> - اختصار لـ /verify\n\n` +
        `أو أرسل رقم طول (مثال: 3) مباشرة.`,
    });
  }

  // /N where N is length (2..8)
  const lengthMatch = text.match(/^\/(\d{1,2})$/);
  if (lengthMatch) {
    const length = parseInt(lengthMatch[1], 10);
    if (length >= 2 && length <= 8) {
      return handleByLength(chatId, length);
    } else {
      return tg('sendMessage', {
        chat_id: chatId,
        text: '⚠️ الطول لازم يكون بين 2 و 8. مثال: /3',
      });
    }
  }

  // Plain number → treat as length
  const plainNumberMatch = text.match(/^(\d{1,2})$/);
  if (plainNumberMatch) {
    const length = parseInt(plainNumberMatch[1], 10);
    if (length >= 2 && length <= 8) {
      return handleByLength(chatId, length);
    }
  }

  const verifyMatch = text.match(/^\/(?:verify|check)\s+(\S+)/);
  if (verifyMatch) {
    return handleVerify(chatId, verifyMatch[1]);
  }

  // Unknown command
  await tg('sendMessage', {
    chat_id: chatId,
    text: 'أمر غير معروف. أرسل /help لعرض الأوامر.\nأو أرسل /2 ... /8 لعرض يوزرات متاحة.',
  });
}

async function main() {
  console.log(`[bot] run-once started at ${new Date().toISOString()}`);
  let processed = 0;
  const MAX_PROCESS = 1;

  let offset = 0;
  while (processed < MAX_PROCESS) {
    const r = await tg('getUpdates', { offset, timeout: 0, limit: 10 });
    if (!r || !r.ok) {
      console.log('[bot] getUpdates failed, exiting');
      break;
    }
    if (!r.result || r.result.length === 0) {
      console.log('[bot] no more updates');
      break;
    }
    for (const u of r.result) {
      offset = u.update_id + 1;
      try {
        await processUpdate(u);
        processed++;
        if (processed >= MAX_PROCESS) break;
      } catch (e) {
        console.log(`[bot] error processing update: ${e.message}`);
      }
    }
  }

  console.log(`[bot] processed ${processed} updates, exiting cleanly`);
}

main().catch((e) => {
  console.error('[bot] fatal:', e);
  process.exit(1);
});
