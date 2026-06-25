// Username availability checker — pure axios (no Z.ai dependency)
// Works on GitHub Actions with a normal public IP.
//
// Username rules (compatible with TikTok / Snapchat / Instagram):
//   - First char MUST be a letter
//   - Last char MUST be a letter or digit (never '.', '_', '-')
//   - No two consecutive symbol chars ('..', '__', '--', etc.)
//   - Allowed: [a-z] [0-9] . _ -
//   - Length range: 2..15

const axios = require('axios');

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INTER_REQUEST_MS = 1200; // throttle slightly
let _chain = Promise.resolve();
function serialize(task) {
  const next = _chain.then(() => task());
  _chain = next.then(() => sleep(INTER_REQUEST_MS), () => sleep(INTER_REQUEST_MS));
  return next;
}

async function fetchRaw(url, opts = {}) {
  const headers = {
    'User-Agent': opts.ua || UA_DESKTOP,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  if (opts.referer) headers['Referer'] = opts.referer;

  try {
    const r = await axios.get(url, {
      timeout: 15000,
      headers,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'text',
      decompress: true,
    });
    return { status: r.status, data: typeof r.data === 'string' ? r.data : '', headers: r.headers || {} };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Snapchat ──────────────────────────────────────────────────────────────
// snapchat.com/add/{u} → 200 (taken) or 404 (available). Clean signal.
async function checkSnapchat(username) {
  const r = await serialize(() => fetchRaw(`https://www.snapchat.com/add/${username}`, { ua: UA_MOBILE }));
  if (r.error) return { available: null, source: 'error' };
  if (r.status === 404) return { available: true, source: 'http404' };
  if (r.status === 200) {
    const html = r.data;
    if (html.toLowerCase().includes('is on snapchat')) return { available: false, source: 'desc' };
    if (html.toLowerCase().includes('page not found')) return { available: true, source: 'title' };
    // Default: 200 means page exists => taken
    return { available: false, source: 'http200' };
  }
  return { available: null, source: 'http' + r.status };
}

// ─── TikTok ────────────────────────────────────────────────────────────────
// tiktok.com/@{u} → taken page has "unique_id":"..." or "@u On TikTok"
//                   not-found page has "Couldn't find this account"
async function checkTikTok(username) {
  const r = await serialize(() => fetchRaw(`https://www.tiktok.com/@${username}?lang=en`, { ua: UA_DESKTOP, referer: 'https://www.tiktok.com/' }));
  if (r.error) return { available: null, source: 'error' };
  if (r.status === 404) return { available: true, source: 'http404' };
  if (r.status === 200) {
    const html = r.data;
    const lower = html.toLowerCase();
    // Not found indicators
    if (lower.includes('couldn\'t find this account') ||
        lower.includes('couldn’t find this account') ||
        lower.includes('page not available') ||
        lower.includes('this page could not be found')) {
      return { available: true, source: 'notfound' };
    }
    // Taken indicators (from SIGI_STATE / __UNIVERSAL_DATA)
    if (html.includes('"unique_id":"' + username + '"') ||
        html.includes('"unique_id": "' + username + '"') ||
        html.includes('webapp.user-detail') ||
        html.toLowerCase().includes('@' + username + ' on tiktok') ||
        html.toLowerCase().includes('on tiktok |')) {
      return { available: false, source: 'desc' };
    }
    // Cloudflare challenge page (small body, contains cf-challenge)
    if (lower.includes('cf-challenge') || lower.includes('just a moment') || html.length < 30000) {
      return { available: null, source: 'cf-block' };
    }
    // Default: unknown (don't assume taken — could be a challenge page we don't recognize)
    return { available: null, source: 'ambiguous' };
  }
  return { available: null, source: 'http' + r.status };
}

// ─── Instagram ─────────────────────────────────────────────────────────────
// instagram.com/{u}/ → taken page contains "log_in" link + meta og:title with username
//                     not-found page returns 404 OR contains "Sorry, this page isn't available"
async function checkInstagram(username) {
  const r = await serialize(() => fetchRaw(`https://www.instagram.com/${username}/`, { ua: UA_DESKTOP, referer: 'https://www.instagram.com/' }));
  if (r.error) return { available: null, source: 'error' };
  if (r.status === 404) return { available: true, source: 'http404' };
  if (r.status === 200) {
    const html = r.data;
    const lower = html.toLowerCase();
    if (lower.includes('sorry, this page isn\'t available') ||
        lower.includes('sorry, this page isn’t available') ||
        lower.includes('page may have been removed')) {
      return { available: true, source: 'notfound' };
    }
    if (lower.includes('cf-challenge') || lower.includes('just a moment') || html.length < 30000) {
      return { available: null, source: 'cf-block' };
    }
    // Taken indicators
    if (lower.includes('og:title" content="@' + username + '"') ||
        lower.includes('"username":"' + username + '"') ||
        lower.includes('@' + username + ' • instagram photos')) {
      return { available: false, source: 'meta' };
    }
    // Default: unknown
    return { available: null, source: 'ambiguous' };
  }
  return { available: null, source: 'http' + r.status };
}

// ─── Fast check: Snapchat first (cheap). If taken, skip TikTok+IG ───────
async function checkFast(username, opts = {}) {
  const verbose = opts.verbose;
  if (verbose) console.log(`  [${username}] snap...`);
  const sc = await checkSnapchat(username);
  if (sc.available === false) {
    if (verbose) console.log(`  [${username}] snap=TAKEN, skipping rest`);
    return { username, tiktok: { available: null }, snapchat: sc, instagram: { available: null }, __skipped: true };
  }
  if (verbose) console.log(`  [${username}] snap=${sc.available}, checking tt+ig...`);
  const [tt, ig] = await Promise.all([checkTikTok(username), checkInstagram(username)]);
  return { username, tiktok: tt, snapchat: sc, instagram: ig };
}

// ─── Random generator by length ───────────────────────────────────────────
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '._-';
const ALNUM = LETTERS + DIGITS;
const ALL_MID = ALNUM + SYMBOLS;

function isValidUsername(u) {
  if (!u) return false;
  if (u.length < 2 || u.length > 15) return false;
  if (!/^[a-z]/.test(u)) return false;
  if (!/[a-z0-9]$/.test(u)) return false;
  if (!/^[a-z0-9._-]+$/.test(u)) return false;
  if (/[\._\-]{2,}/.test(u)) return false;
  return true;
}

function randomFrom(str) {
  return str[Math.floor(Math.random() * str.length)];
}

function generateOne(length) {
  let u = randomFrom(LETTERS);
  for (let i = 1; i < length; i++) {
    const lastChar = u[u.length - 1];
    const pool = SYMBOLS.includes(lastChar) ? ALNUM : ALL_MID;
    u += randomFrom(pool);
  }
  if (SYMBOLS.includes(u[u.length - 1])) {
    u = u.slice(0, -1) + randomFrom(ALNUM);
  }
  return u;
}

function generateByLength(length, count) {
  if (length < 2 || length > 15) return [];
  const out = new Set();
  let attempts = 0;
  const maxAttempts = count * 50;
  while (out.size < count && attempts < maxAttempts) {
    attempts++;
    const u = generateOne(length);
    if (isValidUsername(u)) out.add(u);
  }
  return [...out];
}

// ─── Find available usernames of a given length ──────────────────────────
async function findAvailableByLength(length, targetCount, opts = {}, onAvailable) {
  const batchSize = Math.max(targetCount * 3, 30);
  const candidates = generateByLength(length, batchSize);
  if (opts.verbose) console.log(`Generated ${candidates.length} candidates (len=${length}): ${candidates.slice(0, 10).join(', ')}${candidates.length > 10 ? '...' : ''}`);

  const found = [];
  let taken = 0;
  let checked = 0;
  const t0 = Date.now();
  const TIME_BUDGET_MS = (opts.timeBudgetSec || 240) * 1000;

  for (const u of candidates) {
    if (found.length >= targetCount) break;
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      if (opts.verbose) console.log(`  [time-budget] hit ${TIME_BUDGET_MS / 1000}s, stopping early (found ${found.length}/${targetCount})`);
      break;
    }
    const r = await checkFast(u, opts);
    checked++;
    const platforms = ['tiktok', 'snapchat', 'instagram'];
    const availOn = platforms.filter((p) => r[p].available === true);
    const takenOn = platforms.filter((p) => r[p].available === false);

    if (opts.verbose) {
      console.log(`  ${u}: avail=[${availOn.join(',')}] taken=[${takenOn.join(',')}] ${r.__skipped ? '(skipped)' : ''}`);
    }

    if (availOn.length >= 1 && takenOn.length === 0) {
      const item = {
        username: u,
        availableOn: availOn,
        result: {
          tiktok: r.tiktok,
          snapchat: r.snapchat,
          instagram: r.instagram,
        },
      };
      found.push(item);
      if (onAvailable) await onAvailable(item);
    } else if (takenOn.length > 0) {
      taken++;
    }
    await sleep(80);
  }

  return { found, takenCount: taken, checkedCount: checked, candidatesTotal: candidates.length };
}

async function checkAllPlatforms(username) {
  const tt = await checkTikTok(username);
  const sc = await checkSnapchat(username);
  const ig = await checkInstagram(username);
  return { username, tiktok: tt, snapchat: sc, instagram: ig };
}

module.exports = {
  checkAllPlatforms,
  checkTikTok,
  checkSnapchat,
  checkInstagram,
  checkFast,
  generateByLength,
  isValidUsername,
  findAvailableByLength,
};
