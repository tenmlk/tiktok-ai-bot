# 🤖 بوت تيك توك الذكي v2.0 - Puppeteer

## تشغيل البوت على GitHub Codespaces (مجاني - بدون بطاقة)

### الخطوة 1: افتح Codespaces

1. روح على المستودع: https://github.com/tenmlk/tiktok-ai-bot
2. اضغط الزر الأخضر **"Code"**
3. اختر تبويب **"Codespaces"**
4. اضغط **"Create codespace on main"**
5. بيفتح لك محرر كود + طرفية Linux

### الخطوة 2: ثبّت المكتبات

في الطرفية (Terminal):

```bash
# نسخ ملف الحزم المناسب
cp package-puppeteer.json package.json

# تثبيت المكتبات
npm install

# تثبيت Chrome
npx puppeteer browsers install chrome
```

### الخطوة 3: أضف بيانات حسابك

```bash
# نسخ ملف الإعدادات
cp .env.puppeteer .env

# تعديل الإعدادات - حط بيانات حساب تيك توك بتاعك
nano .env
```

غيّر:
- `TIKTOK_USERNAME` = اسم المستخدم
- `TIKTOK_PASSWORD` = كلمة المرور

اضغط `Ctrl+X` ثم `Y` ثم `Enter` للحفظ

### الخطوة 4: شغّل البوت

```bash
npm start
```

### الخطوة 5: خليه يشتغل دائماً

```bash
# ثبّت PM2
npm install -g pm2

# شغّل البوت
pm2 start src/puppeteer/bot.js --name tiktok-bot

# تابع السجلات
pm2 logs tiktok-bot
```

> ⚠️ GitHub Codespaces ينطفئ بعد 30 دقيقة عدم نشاط.
> عشان تمنع ذلك: استخدم الكمبيوتر وافتح الصفحة بين فترة وأخرى.

## ⚠️ تحذيرات مهمة

1. **لا تفرط في الردود** - تيك توك يحظر الحسابات اللي ترد كثير
2. **التأخير بين الردود** - البوت ينتظر 2-5 دقائق تلقائياً
3. **CAPTCHA** - أحياناً تيك توك يطلب تحقق، لازم تحله يدوياً
4. **الحساب** - استخدم حساب ثانوي مو حسابك الرئيسي

## 🛡️ فلترة المحتوى

البوت يرفض الرد على:
- ❌ التحريض والكراهية
- ❌ المخدرات والمسكرات
- ❌ المواضيع الطبية
- ❌ العنف والتهديد
