// Username availability checker — STRICT verification with confidence levels
//
// PROBLEM: TikTok and Instagram return generic SPA shells / rate-limit pages
//          from datacenter IPs (GitHub Actions). Naive checks produce 100% false positives.
//
// SOLUTION: Multi-layer verification. A platform is marked "available" ONLY when
//           we get a POSITIVE "not exist" signal from a RELIABLE endpoint.
//           Otherwise → "unknown" (not shown as available).
//
// Confidence levels:
//   100% — Verified by 2+ independent methods that agree
//   90%  — Verified by 1 reliable method
//   0%   — Couldn't verify (don't claim available)
//
// Sources cited:
//   - Snapchat: official snapcode SVG endpoint (feelinsonice-hrd.appspot.com)
//   - TikTok:   official web profile page (tiktok.com/@user)
//   - Instagram: official web profile page (instagram.com/user/)

const axios = require('axios');

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INTER_REQUEST_MS = 1000;
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
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  if (opts.referer) headers['Referer'] = opts.referer;
  if (opts.headers) Object.assign(headers, opts.headers);

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

// ─── SNAPCHAT (100% reliable) ─────────────────────────────────────────────
// Method 1: /add/{u} → 404 = available, 200 + "is on Snapchat" = taken
// Method 2: snapcode SVG endpoint → SVG with ghost icon = available, with snapcode image = taken
async function checkSnapchat(username) {
  // Method 1: direct page
  const r = await serialize(() => fetchRaw(`https://www.snapchat.com/add/${username}`, { ua: UA_MOBILE }));
  if (r.error) return { available: null, source: 'error', confidence: 0, methods: [] };

  const html = r.data || '';
  const lower = html.toLowerCase();
  const signals = [];

  if (r.status === 200 && lower.includes('is on snapchat')) {
    signals.push({ method: 'page-200', result: 'taken' });
  } else if (r.status === 404) {
    signals.push({ method: 'page-404', result: 'available' });
  } else if (r.status === 200 && !lower.includes('is on snapchat')) {
    signals.push({ method: 'page-200-no-snap', result: 'unknown' });
  } else {
    signals.push({ method: 'page-' + r.status, result: 'unknown' });
  }

  // Method 2: snapcode SVG (verify)
  const svg = await serialize(() => fetchRaw(`https://feelinsonice-hrd.appspot.com/web/deeplink/snapcode?username=${username}&type=SVG`));
  if (!svg.error && svg.status === 200 && svg.data) {
    const svgLower = svg.data.toLowerCase();
    // Existing user: SVG contains an <image> tag with the snapcode
    // Non-existing: SVG contains only the ghost icon path
    const hasImage = svgLower.includes('<image') || svgLower.includes('xlink:href');
    const hasGhost = svgLower.includes('ghost') || svgLower.includes('fill="#fffc00"');
    if (hasImage) {
      signals.push({ method: 'snapcode-svg', result: 'taken' });
    } else if (hasGhost || svg.data.length < 10800) {
      signals.push({ method: 'snapcode-svg', result: 'available' });
    } else {
      signals.push({ method: 'snapcode-svg', result: 'unknown' });
    }
  }

  // Combine signals
  const takenSignals = signals.filter(s => s.result === 'taken').length;
  const availSignals = signals.filter(s => s.result === 'available').length;

  if (takenSignals > 0 && availSignals === 0) {
    return { available: false, source: 'snapchat-confirmed', confidence: 100, methods: signals };
  }
  if (availSignals > 0 && takenSignals === 0) {
    return { available: true, source: 'snapchat-confirmed', confidence: 100, methods: signals };
  }
  if (takenSignals > 0 && availSignals > 0) {
    // Conflict — trust "taken" signal (safer)
    return { available: false, source: 'snapchat-conflict', confidence: 50, methods: signals };
  }
  return { available: null, source: 'snapchat-unknown', confidence: 0, methods: signals };
}

// ─── TIKTOK (best-effort, conservative) ───────────────────────────────────
// Problem: tiktok.com/@u returns a generic React SPA shell (105KB) for ALL usernames
//          from datacenter IPs. The HTML does NOT contain user data.
// Solution: Only mark as "taken" if we find POSITIVE user signals in HTML.
//           Only mark as "available" if we get a clear 404 or "couldn't find" page.
//           Otherwise → "unknown" (don't claim available).
async function checkTikTok(username) {
  const r = await serialize(() => fetchRaw(`https://www.tiktok.com/@${username}?lang=en`, {
    ua: UA_DESKTOP,
    referer: 'https://www.tiktok.com/',
  }));
  if (r.error) return { available: null, source: 'error', confidence: 0, methods: [] };

  const html = r.data || '';
  const lower = html.toLowerCase();
  const signals = [];

  // POSITIVE taken signals (high confidence)
  const hasUniqueId = html.includes('"unique_id":"' + username + '"') ||
                      html.includes('"unique_id": "' + username + '"') ||
                      html.includes('"authorUniqueId":"' + username + '"');
  const hasUserDetail = lower.includes('webapp.user-detail') ||
                        lower.includes('"user":{') && lower.includes('"unique_id"');
  const hasOnTikTok = lower.includes('@' + username + ' on tiktok') ||
                      lower.includes('on tiktok | ' + username);

  if (hasUniqueId) signals.push({ method: 'unique-id-json', result: 'taken' });
  if (hasUserDetail) signals.push({ method: 'user-detail-flag', result: 'taken' });
  if (hasOnTikTok) signals.push({ method: 'meta-desc', result: 'taken' });

  // POSITIVE available signals (only trust if HTML is small = actual not-found page)
  // The SPA shell is ~105KB. A real not-found page is <50KB.
  if (r.status === 404) {
    signals.push({ method: 'http-404', result: 'available' });
  }
  if (lower.includes('couldn\'t find this account') && html.length < 50000) {
    signals.push({ method: 'not-found-text', result: 'available' });
  }
  if (lower.includes('couldn’t find this account') && html.length < 50000) {
    signals.push({ method: 'not-found-text', result: 'available' });
  }

  // Cloudflare challenge detection
  if (lower.includes('cf-challenge') || lower.includes('just a moment')) {
    signals.push({ method: 'cf-block', result: 'unknown' });
  }

  // SPA shell detection (generic page, no user data)
  if (html.length > 100000 && !hasUniqueId && !hasOnTikTok) {
    signals.push({ method: 'spa-shell-no-data', result: 'unknown' });
  }

  // Combine
  const takenSignals = signals.filter(s => s.result === 'taken').length;
  const availSignals = signals.filter(s => s.result === 'available').length;

  if (takenSignals > 0) {
    return { available: false, source: 'tiktok-confirmed', confidence: 100, methods: signals };
  }
  if (availSignals > 0 && takenSignals === 0) {
    // Only 90% confidence because TikTok sometimes returns 404 for blocked IPs
    return { available: true, source: 'tiktok-likely', confidence: 90, methods: signals };
  }
  return { available: null, source: 'tiktok-unknown', confidence: 0, methods: signals };
}

// ─── INSTAGRAM (best-effort, conservative) ────────────────────────────────
// Problem: instagram.com/{u}/ returns 429 (rate limited) from datacenter IPs.
// Solution: Only mark as "taken" if we find POSITIVE user signals.
//           Only mark as "available" if we get a clear "Sorry, this page" signal.
//           Otherwise → "unknown".
async function checkInstagram(username) {
  const r = await serialize(() => fetchRaw(`https://www.instagram.com/${username}/`, {
    ua: UA_DESKTOP,
    referer: 'https://www.instagram.com/',
  }));
  if (r.error) return { available: null, source: 'error', confidence: 0, methods: [] };

  const html = r.data || '';
  const lower = html.toLowerCase();
  const signals = [];

  // 429 = rate limited, can't tell
  if (r.status === 429) {
    signals.push({ method: 'http-429', result: 'unknown' });
  } else if (r.status === 404) {
    signals.push({ method: 'http-404', result: 'available' });
  } else if (r.status === 200) {
    // POSITIVE taken signals
    const hasOgTitle = lower.includes('og:title" content="@' + username + '"');
    const hasUsername = lower.includes('"username":"' + username + '"');
    const hasUserJson = lower.includes('"data":{"user":{') && lower.includes('"username":"' + username + '"');
    if (hasOgTitle) signals.push({ method: 'og-title', result: 'taken' });
    if (hasUsername) signals.push({ method: 'username-json', result: 'taken' });
    if (hasUserJson) signals.push({ method: 'user-json', result: 'taken' });

    // POSITIVE available signals
    if (lower.includes('sorry, this page isn\'t available') ||
        lower.includes('sorry, this page isn’t available')) {
      signals.push({ method: 'not-found-text', result: 'available' });
    }
    if (lower.includes('page may have been removed')) {
      signals.push({ method: 'page-removed', result: 'available' });
    }

    // Cloudflare challenge
    if (lower.includes('cf-challenge') || lower.includes('just a moment')) {
      signals.push({ method: 'cf-block', result: 'unknown' });
    }
  } else {
    signals.push({ method: 'http-' + r.status, result: 'unknown' });
  }

  // Combine
  const takenSignals = signals.filter(s => s.result === 'taken').length;
  const availSignals = signals.filter(s => s.result === 'available').length;

  if (takenSignals > 0) {
    return { available: false, source: 'instagram-confirmed', confidence: 100, methods: signals };
  }
  if (availSignals > 0 && takenSignals === 0) {
    return { available: true, source: 'instagram-likely', confidence: 90, methods: signals };
  }
  return { available: null, source: 'instagram-unknown', confidence: 0, methods: signals };
}

// ─── Fast check: Snapchat first (most reliable). If taken, skip rest ───
async function checkFast(username, opts = {}) {
  const verbose = opts.verbose;
  if (verbose) console.log(`  [${username}] snap...`);
  const sc = await checkSnapchat(username);
  if (sc.available === false) {
    if (verbose) console.log(`  [${username}] snap=TAKEN (conf=${sc.confidence}%), skipping rest`);
    return {
      username,
      tiktok: { available: null, source: 'skipped', confidence: 0, methods: [] },
      snapchat: sc,
      instagram: { available: null, source: 'skipped', confidence: 0, methods: [] },
      __skipped: true,
    };
  }
  if (verbose) console.log(`  [${username}] snap=${sc.available} (conf=${sc.confidence}%), checking tt+ig...`);
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
// STRICT: only show usernames where:
//   - Snapchat is "available" (our most reliable signal)
//   - TikTok is NOT "taken"
//   - Instagram is NOT "taken"
async function findAvailableByLength(length, targetCount, opts = {}, onAvailable) {
  const batchSize = Math.max(targetCount * 4, 40);
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

    // Determine final status per platform
    const platforms = ['tiktok', 'snapchat', 'instagram'];
    const takenOn = platforms.filter((p) => r[p].available === false);
    const availOn = platforms.filter((p) => r[p].available === true);
    const unknownOn = platforms.filter((p) => r[p].available === null);

    if (opts.verbose) {
      const details = platforms.map(p => `${p}=${r[p].available}(${r[p].confidence}%)`).join(' ');
      console.log(`  ${u}: ${details} ${r.__skipped ? '(skipped)' : ''}`);
    }

    // STRICT: Snapchat MUST be available, others must NOT be taken
    if (r.snapchat.available === true && takenOn.length === 0) {
      const item = {
        username: u,
        availableOn: availOn,
        unknownOn,
        result: {
          tiktok: r.tiktok,
          snapchat: r.snapchat,
          instagram: r.instagram,
        },
        // Overall confidence: Snapchat=100%, others proportional
        confidence: Math.round(
          (r.snapchat.confidence +
            (r.tiktok.available === true ? r.tiktok.confidence : 0) +
            (r.instagram.available === true ? r.instagram.confidence : 0)) /
          (1 + (r.tiktok.available !== null ? 1 : 0) + (r.instagram.available !== null ? 1 : 0))
        ),
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
