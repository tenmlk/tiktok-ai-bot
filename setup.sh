#!/bin/bash
# ===================================
# سكريبت تثبيت بوت تيك توك الذكي
# ===================================
# شغّل هذا السكريبت في GitHub Codespaces:
#   bash setup.sh
# ===================================

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║                                          ║"
echo "║      🤖 بوت تيك توك الذكي               ║"
echo "║      سكريبت التثبيت التلقائي             ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 1. نسخ package.json المناسب
echo "📦 [1/4] تجهيز الحزم..."
cp package-puppeteer.json package.json

# 2. تثبيت الحزم
echo "📥 [2/4] تثبيت الحزم (هذا ياخذ وقت)... "
npm install

# 3. تثبيت Chrome
echo "🌐 [3/4] تثبيت Chrome..."
npx puppeteer browsers install chrome

# 4. إعداد ملف .env
echo "⚙️  [4/4] إعداد ملف .env..."
if [ ! -f .env ]; then
  cp .env.puppeteer .env
  echo ""
  echo "⚠️  مهم! لازم تحط بيانات حسابك في تيك توك"
  echo "افتح ملف .env وحط اسم المستخدم وكلمة المرور"
  echo ""
  echo "  TIKTOK_USERNAME=اسم_المستخدم"
  echo "  TIKTOK_PASSWORD=كلمة_المرور"
  echo ""
else
  echo "✅ ملف .env موجود بالفعل"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║                                          ║"
echo "║      ✅ التثبيت انتهى بنجاح!            ║"
echo "║                                          ║"
echo "║  لتشغيل البوت:                           ║"
echo "║    npm start                             ║"
echo "║                                          ║"
echo "║  لا تنسى تعديل ملف .env!                ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
