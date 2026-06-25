// Run-once bot for GitHub Actions
// - Fetches pending Telegram updates (messages)
// - Processes each (handles /start, /help, /check, /find, plain text)
// - Replies via Telegram sendMessage API
// - Exits cleanly so GitHub Action completes
//
// This is called by .github/workflows/bot.yml every 5 minutes via cron.

const axios = require('axios');
const { findAvailableStreaming, checkAllPlatforms } = require('./checker.js');

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

// Per-user in-process lock (just to avoid concurrent /find from same user in one run)
const userLocks = new Map();
async function withLock(userId, fn) {
  if (userLocks.has(userId)) return { __locked: true };
  userLocks.set(userId, true);
  try {
    return await fn();
  } finally {
    userLocks.delete(userId);
  }
}

async function handleFind(chatId, fromId, baseRaw) {
  const base = baseRaw.toLowerCase().replace(/[^a-z0-9_\.\-]/g, '');
  if (!base || base.length < 2) {
    await tg('sendMessage', { chat_id: chatId, text: 'أرسل كلمة (حرفين على الأقل). مثال: cool' });
    return;
  }

  const status = await tg('sendMessage', {
    chat_id: chatId,
    text: `🔍 أبحث عن يوزرات متاحة من "${base}"...\n✨ راح أرسل كل يوزر متاح فور ما ألقاه.`,
  });

  let foundCount = 0;
  let checkedCount = 0;
  const TARGET = 5;
  const t0 = Date.now();

  try {
    const r = await findAvailableStreaming(base, TARGET, { verbose: true }, async (item) => {
      foundCount++;
      const plat = item.availableOn.map((p) => `${PLATFORM_EMOJI[p]} ${PLATFORM_NAME[p]}`).join('  ');
      await tg('sendMessage', {
        chat_id: chatId,
        text: `✅ #${foundCount} متاح:\n\n👉 <b>${item.username}</b>\n\nمتاح على: ${plat}`,
        parse_mode: 'HTML',
      });
    });
    checkedCount = r.checkedCount;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    let finalText;
    if (foundCount === 0) {
      finalText = `😔 ما لقيت يوزر متاح من "${base}" بعد فحص ${checkedCount} خيار.\nجرّب كلمة أخرى أو أطول.`;
    } else {
      finalText = `✅ تم العثور على ${foundCount} يوزر متاح في ${elapsed}s\n(فحصت ${checkedCount} خيار)`;
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
    const lines = ['tiktok', 'snapchat', 'instagram']
      .map((k) => {
        const v = r[k];
        const icon = v.available === true ? '✅' : v.available === false ? '❌' : '❓';
        const word = v.available === true ? 'متاح' : v.available === false ? 'محجوز' : 'غير معروف';
        return `${PLATFORM_EMOJI[k]} ${PLATFORM_NAME[k]}: ${word}`;
      })
      .join('\n');
    if (status && status.result && status.result.message_id) {
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: status.result.message_id,
        text: `النتيجة لليوزر "${username}":\n\n${lines}`,
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
      `  • أرسل أي كلمة (مثال: cool) وسأبحث عن 5 يوزرات متاحة منها\n` +
      `  • /check <username> للتحقق من يوزر معيّن\n` +
      `  • /help لعرض المساعدة\n\n` +
      `⚠️ ملاحظة: البوت يعمل بنوبات كل 5 دقائق، فالرد قد يتأخر حتى 5 دقائق.\n` +
      `⏱️ كل بحث يستغرق 30-90 ثانية.`,
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
        `/find <base> - ابحث عن 5 يوزرات متاحة\n` +
        `/check <username> - تحقق من يوزر معيّن\n\n` +
        `أو أرسل أي كلمة مباشرة.`,
    });
  }

  const checkMatch = text.match(/^\/check\s+(\S+)/);
  if (checkMatch) {
    const lock = await withLock(fromId, () => handleCheck(chatId, fromId, checkMatch[1]));
    if (lock && lock.__locked) {
      await tg('sendMessage', { chat_id: chatId, text: 'لديك طلب آخر قيد المعالجة. انتظر.' });
    }
    return;
  }

  const findMatch = text.match(/^\/find\s+(\S+)/);
  if (findMatch) {
    const lock = await withLock(fromId, () => handleFind(chatId, fromId, findMatch[1]));
    if (lock && lock.__locked) {
      await tg('sendMessage', { chat_id: chatId, text: 'لديك بحث آخر جاري. انتظر.' });
    }
    return;
  }

  // Plain text → treat as /find
  if (!text.startsWith('/')) {
    const lock = await withLock(fromId, () => handleFind(chatId, fromId, text.trim()));
    if (lock && lock.__locked) {
      await tg('sendMessage', { chat_id: chatId, text: 'لديك بحث آخر جاري. انتظر.' });
    }
    return;
  }

  // Unknown command
  await tg('sendMessage', { chat_id: chatId, text: 'أمر غير معروف. أرسل /help لعرض الأوامر.' });
}

async function main() {
  console.log(`[bot] run-once started at ${new Date().toISOString()}`);
  let processed = 0;
  const MAX_PROCESS = 5; // Process max 5 messages per run (to stay under GitHub Action timeout)

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
