// Username availability checker — fast version for GitHub Actions
// Uses Z.ai page_reader as primary fetch (bypasses Cloudflare, geo-blocks)

const ZAI = require('z-ai-web-dev-sdk').default;

let zaiInstance = null;
async function getZai() {
  if (!zaiInstance) zaiInstance = await ZAI.create();
  return zaiInstance;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INTER_REQUEST_MS = 2500;
let _chain = Promise.resolve();
function serialize(task) {
  const next = _chain.then(() => task());
  _chain = next.then(() => sleep(INTER_REQUEST_MS), () => sleep(INTER_REQUEST_MS));
  return next;
}

async function fetchViaZai(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await serialize(async () => {
        const zai = await getZai();
        return zai.functions.invoke('page_reader', { url });
      });
      if (r && r.code === 200 && r.data) {
        return {
          code: 200,
          title: r.data.title || '',
          description: r.data.description || '',
          html: r.data.html || '',
        };
      }
      return null;
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) {
        const wait = 20000 * (attempt + 1);
        console.log(`  [zai] 429, waiting ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      if (attempt < 2) {
        await sleep(3000);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function checkTikTok(username) {
  const r = await fetchViaZai(`https://www.tiktok.com/@${username}`);
  if (!r) return { available: null, source: 'zai-error' };
  if (r.description && r.description.includes(`@${username}`) && r.description.toLowerCase().includes('on tiktok')) {
    return { available: false, source: 'zai-desc' };
  }
  if (!r.description || r.description.trim() === '') {
    return { available: true, source: 'zai-empty' };
  }
  return { available: false, source: 'zai-other' };
}

async function checkSnapchat(username) {
  const r = await fetchViaZai(`https://www.snapchat.com/add/${username}`);
  if (!r) return { available: null, source: 'zai-error' };
  if (r.description && r.description.toLowerCase().includes('is on snapchat')) {
    return { available: false, source: 'zai-desc' };
  }
  if (!r.description || r.description.trim() === '') {
    return { available: true, source: 'zai-empty' };
  }
  return { available: false, source: 'zai-other' };
}

async function checkInstagram(username) {
  const r = await fetchViaZai(`https://www.picnob.com/profile/${username}/`);
  if (!r) return { available: null, source: 'zai-error' };
  if (r.title && r.title.toLowerCase().includes('page not found')) {
    return { available: true, source: 'zai-picnob' };
  }
  if (r.title && r.title.toLowerCase().includes(username.toLowerCase())) {
    return { available: false, source: 'zai-picnob' };
  }
  return { available: null, source: 'zai-ambiguous' };
}

// Fast check: Snapchat first (cheap), skip rest if taken.
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

function generateCandidates(base, count = 20) {
  const b = base.toLowerCase().replace(/[^a-z0-9_\.\-]/g, '');
  if (!b) return [];
  const seen = new Set();
  const out = [];
  const push = (u) => {
    if (u.length < 3 || u.length > 24) return;
    if (!/^[a-z]/.test(u)) return;
    if (!/[a-z0-9]$/.test(u)) return;
    if (/[\._\-]{2,}/.test(u)) return;
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  };

  push(b);
  const rand2 = () => Math.floor(10 + Math.random() * 89);
  const rand3 = () => Math.floor(100 + Math.random() * 899);
  const rand4 = () => Math.floor(1000 + Math.random() * 8999);
  const randAZ = () => String.fromCharCode(97 + Math.floor(Math.random() * 26));

  for (let i = 0; i < 4; i++) push(`${b}${rand2()}`);
  for (let i = 0; i < 3; i++) push(`${b}${rand3()}`);
  push(`${b}${randAZ()}${randAZ()}`);
  push(`${b}${randAZ()}${randAZ()}${randAZ()}`);

  const dotWords = ['official', 'real', 'hq', 'tv', 'me', 'world', 'x', '01', '007'];
  for (const w of dotWords) push(`${b}.${w}`);
  const usWords = ['official', 'real', 'hq', 'tv', 'me', 'world', 'x', '01', '007'];
  for (const w of usWords) push(`${b}_${w}`);
  const dashWords = ['official', 'real', 'hq', 'tv', 'me', 'world', 'x'];
  for (const w of dashWords) push(`${b}-${w}`);

  const prefixes = ['the', 'its', 'real', 'iam', 'thisis', 'im', 'hey'];
  for (const p of prefixes) {
    push(`${p}${b}`);
    push(`${p}_${b}`);
    push(`${p}.${b}`);
  }
  push(`${b}${rand4()}${randAZ()}`);
  push(`${b}_${randAZ()}${randAZ()}${randAZ()}`);

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, count);
}

async function findAvailableStreaming(base, targetCount, opts = {}, onAvailable) {
  const candidates = generateCandidates(base, 25);
  if (opts.verbose) console.log(`Generated ${candidates.length} candidates: ${candidates.join(', ')}`);

  const found = [];
  let taken = 0;
  let checked = 0;
  const t0 = Date.now();
  const TIME_BUDGET_MS = (opts.timeBudgetSec || 180) * 1000; // 3 min hard cap by default

  for (const u of candidates) {
    if (found.length >= targetCount) break;
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      if (opts.verbose) console.log(`  [time-budget] hit ${TIME_BUDGET_MS/1000}s, stopping early`);
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
      const item = { username: u, availableOn: availOn };
      found.push(item);
      if (onAvailable) await onAvailable(item);
    } else if (takenOn.length > 0) {
      taken++;
    }
    await sleep(200);
  }

  return { found, takenCount: taken, checkedCount: checked, candidatesTotal: candidates.length };
}

async function checkAllPlatforms(username, opts = {}) {
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
  generateCandidates,
  findAvailableStreaming,
};
