# 🤖 بوت تيك توك على Cloudflare Workers

## النشر على Cloudflare (مجاني - بدون بطاقة)

### الطريقة 1: من لوحة تحكم Cloudflare (الأسهل)

1. **سجل في Cloudflare**: https://dash.cloudflare.com/sign-up
2. **اذهب لـ Workers & Pages**
3. **اضغط "Create"**
4. **اختر "Hello World"**
5. **انسخ كود `worker.js` والصقه في المحرر**
6. **اضغط "Save and Deploy"**

### إضافة الإعدادات (Environment Variables)

في لوحة التحكم:
1. اذهب لـ **Workers & Pages** → اختر البوت
2. اضغط **Settings** → **Variables**
3. أضف:

| Variable | Value |
|----------|-------|
| `BOT_PERSONALITY` | `friendly` |
| `MAX_VIDEOS_PER_RUN` | `5` |
| `SAFE_MODE` | `true` |

### إضافة Cron Trigger (تشغيل تلقائي)

1. اذهب لـ **Settings** → **Triggers**
2. في قسم **Cron Triggers**
3. أضف: `*/30 * * * *` (كل 30 دقيقة)

### الطريقة 2: باستخدام Wrangler CLI

```bash
# تثبيت Wrangler
npm install -g wrangler

# تسجيل الدخول
wrangler login

# الذهاب لمجلد Cloudflare
cd cloudflare

# نشر البوت
wrangler deploy

# إضافة متغيرات بيئة
wrangler secret put BOT_PERSONALITY
wrangler secret put MAX_VIDEOS_PER_RUN
```

## الروابط

- `/` - صفحة الحالة
- `/health` - فحص الصحة
- `/run` - تشغيل البوت يدوياً
