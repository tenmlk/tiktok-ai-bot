// Run-once bot for GitHub Actions
// - Fetches pending Telegram updates
// - Supports commands: /start /help /2 /3 /4 /5 /6 /7 /8
//   /N -> generates 10 random usernames of length N, checks availability, streams results
// - Replies via Telegram sendMessage API
// - Exits cleanly so GitHub Action completes
//
// Called by .github/workflows/bot.yml every 5 minutes via cron.

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

// Format the platform status line for one username result
function formatPlatformsText(result) {
  return ['tiktok', 'snapchat', 'instagram']
    .map((k) => {
      const v = result[k] || { available: null };
      const icon = v.available === true ? '✅' : v.available === false ? '❌' : '❓';
      const word = v.available === true ? 'متاح' : v.available === false ? 'محجوز' : 'غير معروف';
      return `${PLATFORM_EMOJI[k]} ${PLATFORM_NAME[k]}: ${icon} ${word}`;
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
      `🔍 أبحث عن 10 يوزرات متاحة بطول ${length} حروف...\n` +
      `✨ كل يوزر متاح يظهر فوراً.\n` +
      `⏱️ الانتظار المتوقع: 1-4 دقائق.`,
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
        // Build inline keyboard with copy button
        const replyMarkup = {
          inline_keyboard: [[
            { text: `📋 نسخ:  ${item.username}`, copy_text: { text: item.username } },
          ]],
        };
        await tg('sendMessage', {
          chat_id: chatId,
          text:
            `✅ <b>#${foundCount}</b> متاح\n\n` +
            `<code>${item.username}</code>\n\n` +
            platformsText +
            `\n\n👇 اضغط على الزر بالأسفل لنسخ اليوزر`,
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
        `جرّب طول آخر (مثال: /4) أو حاول لاحقاً.`;
    } else {
      finalText =
        `✅ تم العثور على ${foundCount} يوزر متاح في ${elapsed}s\n` +
        `(فحصت ${checkedCount} خيار عشوائي)\n\n` +
        `💎 اضغط على أي زر "📋 نسخ" لنسخ اليوزر فوراً.`;
    }
    if (status && status.result && status.result.message_id) {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: status.result.message_id,
        text: finalText,
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
  const username = usernameRaw.toLowerCase().replace(/[^a-z0-9_\.\-]/g, '');
  if (!username) {
    await tg('sendMessage', { chat_id: chatId, text: 'أرسل يوزر. مثال: /check cool' });
    return;
  }
  const status = await tg('sendMessage', { chat_id: chatId, text: `🔍 أتحقق من "${username}"...` });
  try {
    const r = await checkAllPlatforms(username);
    const lines = formatPlatformsText(r);
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
          `🔍 النتيجة لليوزر:\n\n` +
          `<code>${username}</code>\n\n` +
          lines +
          `\n\n👇 اضغط على الزر بالأسفل لنسخ اليوزر`,
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

async function handleStart(chatId, name) {
  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `أهلاً ${name} 👋\n\n` +
      `أنا بوت يبحث عن يوزرات متاحة على:\n  🎵 TikTok\n  👻 Snapchat\n  📸 Instagram\n\n` +
      `كيف تستخدمني؟\n` +
      `  • أرسل /2 لـ 10 يوزرات من حرفين\n` +
      `  • أرسل /3 لـ 10 يوزرات من 3 حروف\n` +
      `  • أرسل /4 لـ 10 يوزرات من 4 حروف\n` +
      `  • أرسل /5 ... /6 ... /7 ... /8\n` +
      `  • /check <username> للتحقق من يوزر معيّن\n` +
      `  • /help لعرض المساعدة\n\n` +
      `⚠️ القواعد:\n` +
      `  • اليوزر يبدأ بحرف دائماً\n` +
      `  • ما ينتهي بـ . _ -\n` +
      `  • ما في رمزين متتاليين (.. __ --)\n` +
      `  • يدعم: حروف + أرقام + . _ -\n\n` +
      `⏱️ البوت يفحص رسائله كل 5 دقائق، فالرد قد يتأخر حتى 5 دقائق.\n` +
      `⏱️ كل بحث يستغرق 1-4 دقائق حسب الطول.`,
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
        `/5 - 10 يوزرات من 5 حروف\n` +
        `/6 - 10 يوزرات من 6 حروف\n` +
        `/7 - 10 يوزرات من 7 حروف\n` +
        `/8 - 10 يوزرات من 8 حروف\n` +
        `/check <username> - تحقق من يوزر معيّن\n\n` +
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

  const checkMatch = text.match(/^\/check\s+(\S+)/);
  if (checkMatch) {
    return handleCheck(chatId, fromId, checkMatch[1]);
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
  const MAX_PROCESS = 1; // Process only 1 message per run (each /N takes 1-4 min)

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
