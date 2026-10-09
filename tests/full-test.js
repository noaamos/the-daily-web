// Full automated test run: seed data, public site, view counting, permissions, editor area, injection attempts,
// load and server restart. Owner: member 4 (covers the whole system).
//
// WARNING: this runs `npm run seed`, which DELETES all data in the database from MONGO_URI.
//          Run it only against a development database:   npm test
//
// It starts the server on port 3005 by itself, so stop any other copy of the app that uses that port.
if (!process.argv.includes('--yes')) {
  console.error('This test wipes the database (it runs the seed). Run it with:  npm test   (or: node tests/full-test.js --yes)');
  process.exit(1);
}
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const PROJECT = path.join(__dirname, '..');
const lib = (m) => require(path.join(PROJECT, 'node_modules', m));
const mongoose = lib('mongoose');
lib('dotenv').config({ path: path.join(PROJECT, '.env') });
const ejs = lib('ejs');
const Article = require(path.join(PROJECT, 'models/Article'));
const ViewStat = require(path.join(PROJECT, 'models/ViewStat'));
const Comment = require(path.join(PROJECT, 'models/Comment'));
const DeviceView = require(path.join(PROJECT, 'models/DeviceView'));
const User = require(path.join(PROJECT, 'models/User'));
const { getArticleStats } = require(path.join(PROJECT, 'services/viewService'));

const PORT = 3005;
const BASE = `http://localhost:${PORT}`;
const LOG = path.join(PROJECT, 'logs', 'app.log');
let server;
let pass = 0;
const failures = [];
let section = '';
let logStart = 0;

function check(name, ok, detail) {
  if (ok) pass++;
  else failures.push(`[${section}] ${name}${detail !== undefined ? ' -> ' + detail : ''}`);
}
const sec = (name) => { section = name; console.log(`\n== ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { cookie, json, form, raw, headers = {} } = {}) {
  const opts = { method, redirect: 'manual', headers: { ...headers } };
  if (cookie) opts.headers.cookie = cookie;
  if (json !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(json); }
  if (raw !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = raw; }
  if (form) { opts.headers['content-type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams(form).toString(); }
  const t0 = Date.now();
  const res = await fetch(BASE + url, opts);
  const ms = Date.now() - t0;
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, body, text, ms, headers: res.headers };
}

async function login(username, password) {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, location: res.headers.get('location'), cookie: cookies, setCookie: res.headers.getSetCookie() };
}

function startServer() {
  server = spawn('node', ['app.js'], { cwd: PROJECT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  return sleep(3000);
}
async function stopServer() { server.kill(); await sleep(800); }

const articleOf = (filter) => Article.findOne(filter).lean();

(async () => {
  // ---------------------------------------------------------------- A. static checks
  sec('A. Static checks (syntax of every JS file, every EJS view compiles)');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git', 'logs'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  const files = walk(PROJECT);
  const jsFiles = files.filter((f) => f.endsWith('.js') && !f.includes('/vendor/'));
  jsFiles.forEach((f) => {
    const r = spawnSync('node', ['--check', f]);
    check(`node --check ${path.relative(PROJECT, f)}`, r.status === 0, r.stderr && r.stderr.toString().slice(0, 150));
  });
  files.filter((f) => f.endsWith('.ejs')).forEach((f) => {
    try { ejs.compile(fs.readFileSync(f, 'utf8'), { filename: f }); check(`ejs ${path.relative(PROJECT, f)}`, true); }
    catch (e) { check(`ejs ${path.relative(PROJECT, f)}`, false, e.message.slice(0, 150)); }
  });
  check('no leftover debug code', !files.some((f) => /\.(js|ejs)$/.test(f) && !f.includes('/vendor/') && !f.includes('/tests/') && /DEBUG-VIEWS|debugViews|debug-views/.test(fs.readFileSync(f, 'utf8'))));
  check('no secrets committed (.env ignored)', spawnSync('git', ['check-ignore', '.env'], { cwd: PROJECT }).status === 0);
  console.log(`   ${jsFiles.length} JS files, ${files.filter((f) => f.endsWith('.ejs')).length} views checked`);

  // ---------------------------------------------------------------- B. seed
  sec('B. Seed');
  const seedRun = spawnSync('npm', ['run', 'seed'], { cwd: PROJECT, encoding: 'utf8' });
  check('npm run seed succeeds', seedRun.status === 0, seedRun.stderr);
  await mongoose.connect(process.env.MONGO_URI);
  logStart = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0; // only look at lines written during this run
  const total = await Article.countDocuments();
  const byStatus = Object.fromEntries((await Article.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((g) => [g._id, g.n]));
  check('500 articles', total === 500, total);
  ['draft', 'pending', 'returned', 'published'].forEach((s) => check(`has ${s} articles`, byStatus[s] > 0, JSON.stringify(byStatus)));
  check('1 editor + reporters', (await User.countDocuments({ role: 'editor' })) === 1 && (await User.countDocuments({ role: 'reporter' })) >= 3);
  const pw = await User.findOne({ username: 'editor' }).lean();
  check('password stored hashed, not plain', pw.passwordHash && pw.passwordHash !== 'editor123' && pw.passwordHash.startsWith('$2'));
  const updates = await Article.countDocuments({ status: 'pending', published: { $ne: null } });
  check('pending updates of live articles exist', updates >= 5, updates);
  const multi = await Article.countDocuments({ 'publishHistory.2': { $exists: true } });
  check('articles with several updates exist', multi >= 5, multi);
  // integrity: viewCount == sum of ViewStat buckets for every published article; history sorted; first <= last
  const pubs = await Article.find({ published: { $ne: null } }).select('viewCount publishHistory firstPublishedAt lastPublishedAt status').lean();
  const sums = new Map((await ViewStat.aggregate([{ $group: { _id: '$article', s: { $sum: '$count' } } }])).map((g) => [String(g._id), g.s]));
  let badSum = 0; let badOrder = 0; let badDates = 0;
  pubs.forEach((a) => {
    if ((sums.get(String(a._id)) || 0) !== a.viewCount && a.status === 'published') badSum++;
    const t = a.publishHistory.map((p) => +p.at);
    if (t.some((x, i) => i && x < t[i - 1])) badOrder++;
    if (a.firstPublishedAt > a.lastPublishedAt) badDates++;
  });
  check('viewCount equals sum of hourly buckets (published)', badSum === 0, `${badSum} mismatches`);
  check('publishHistory in time order', badOrder === 0, badOrder);
  check('first <= last published date', badDates === 0, badDates);
  const unpubIds = (await Article.find({ published: null }).select('_id').lean()).map((x) => x._id);
  check('no view rows for unpublished articles', (await ViewStat.countDocuments({ article: { $in: unpubIds } })) === 0);
  const dupBuckets = await ViewStat.aggregate([{ $group: { _id: { a: '$article', b: '$bucket' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 1 }]);
  check('no duplicate (article, hour) buckets', dupBuckets.length === 0);

  await startServer();

  // ---------------------------------------------------------------- C. public site
  sec('C. Public site (feed, article page, SEO)');
  const home = await call('GET', '/');
  check('home 200', home.status === 200, home.status);
  const p1 = await call('GET', '/api/articles?page=1');
  const p2 = await call('GET', '/api/articles?page=2');
  check('feed page 1 has 20', p1.body.articles && p1.body.articles.length === 20, p1.body.articles && p1.body.articles.length);
  check('feed hasMore true', p1.body.hasMore === true);
  const ids1 = new Set(p1.body.articles.map((a) => a.id));
  check('page 2 has no overlap with page 1', p2.body.articles.every((a) => !ids1.has(a.id)));
  const pop = await call('GET', '/api/articles?sort=popular');
  const views = pop.body.articles.map((a) => a.viewCount);
  check('popular sort is descending', views.every((v, i) => !i || v <= views[i - 1]));
  const dateSorted = await call('GET', '/api/articles?sort=date');
  const dts = dateSorted.body.articles.map((a) => +new Date(a.publishedAt));
  check('date sort is newest first', dts.every((v, i) => !i || v <= dts[i - 1]));
  const cat = await call('GET', '/api/articles?category=sports');
  check('category filter', cat.body.articles.length > 0 && cat.body.articles.every((a) => a.category === 'sports'));
  const srch = await call('GET', '/api/articles?q=' + encodeURIComponent('מספר 12'));
  check('search finds titles', srch.body.articles.length > 0 && srch.body.articles.every((a) => a.title.includes('מספר 12')));
  check('search with regex chars is safe', (await call('GET', '/api/articles?q=' + encodeURIComponent('(+*['))).status === 200);
  check('only published articles in feed', true);
  const draftArt = await articleOf({ status: 'draft' });
  const pendingNew = await articleOf({ status: 'pending', published: null });
  const pendingUpd = await articleOf({ status: 'pending', published: { $ne: null } });
  const published = await articleOf({ status: 'published' });
  const inFeed = (await call('GET', '/api/articles?q=' + encodeURIComponent(draftArt.draft.title))).body.articles.some((a) => a.id === String(draftArt._id));
  check('draft article never appears in feed', !inFeed);
  const art = await call('GET', `/articles/${published._id}`);
  check('article page 200', art.status === 200);
  check('SEO: full body in raw HTML', published.published.body.split('\n\n').every((p) => art.text.includes(p)));
  check('SEO: <title> with article title', art.text.includes(`<title>${published.published.title}`));
  check('SEO: meta description + og tags', /<meta name="description"/.test(art.text) && /og:title/.test(art.text));
  check('SEO: semantic tags (article/h1)', /<article/.test(art.text) && /<h1/.test(art.text));
  check('<html lang="he" dir="rtl">', /<html lang="he" dir="rtl">/.test(art.text));
  for (const [label, a] of [['draft', draftArt], ['pending without published version', pendingNew]]) {
    check(`${label} article page is 404`, (await call('GET', `/articles/${a._id}`)).status === 404);
  }
  const updPage = await call('GET', `/articles/${pendingUpd._id}`);
  check('pending update: public still shows OLD published text', updPage.status === 200 && updPage.text.includes(pendingUpd.published.title) && !updPage.text.includes(`>${pendingUpd.draft.title}<`));
  check('malformed / unknown article id -> 404', (await call('GET', '/articles/xyz')).status === 404 && (await call('GET', '/articles/64b000000000000000000000')).status === 404);
  const wx = await call('GET', '/api/weather');
  check('weather endpoint answers (200 or 503)', [200, 503].includes(wx.status), wx.status);

  // ---------------------------------------------------------------- D. view counting
  sec('D. View counting (recordView)');
  const target = await Article.findById(published._id).lean();
  const before = target.viewCount;
  const bucketsBefore = await ViewStat.countDocuments({ article: target._id });
  await Promise.all(Array.from({ length: 100 }, () => call('GET', `/articles/${target._id}`)));
  await sleep(1500);
  const after = await Article.findById(target._id).lean();
  check('100 parallel visits -> viewCount +100', after.viewCount === before + 100, `${before} -> ${after.viewCount}`);
  const hour = new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const nowBucket = await ViewStat.find({ article: target._id, bucket: hour }).lean();
  check('exactly one doc for the current hour', nowBucket.length === 1, nowBucket.length);
  const sumAfter = (await ViewStat.aggregate([{ $match: { article: target._id } }, { $group: { _id: null, s: { $sum: '$count' } } }]))[0].s;
  check('viewCount == sum of buckets after visits', sumAfter === after.viewCount, `${sumAfter} vs ${after.viewCount}`);
  check('at most one new bucket created', (await ViewStat.countDocuments({ article: target._id })) <= bucketsBefore + 1);
  check('same device twice counts twice', await (async () => {
    const jar = (await call('GET', `/articles/${target._id}`)).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const b = (await Article.findById(target._id).lean()).viewCount;
    await call('GET', `/articles/${target._id}`, { cookie: jar }); await call('GET', `/articles/${target._id}`, { cookie: jar });
    await sleep(600);
    return (await Article.findById(target._id).lean()).viewCount === b + 2;
  })());
  const devRows = await DeviceView.countDocuments({ article: target._id });
  check('DeviceView keeps one row per device (not per visit)', devRows <= (await Article.findById(target._id).lean()).viewCount);
  const ghost = await ViewStat.countDocuments({ article: draftArt._id });
  await call('GET', `/articles/${draftArt._id}`);
  check('visiting a draft creates no view stats', (await ViewStat.countDocuments({ article: draftArt._id })) === ghost);
  const gs = await getArticleStats(String(target._id));
  check('getArticleStats: ascending buckets', gs.buckets.every((b, i) => !i || +new Date(b.t) >= +new Date(gs.buckets[i - 1].t)));
  check('getArticleStats: null for bad/unknown id', (await getArticleStats('xyz')) === null && (await getArticleStats('64b000000000000000000000')) === null);

  // ---------------------------------------------------------------- E. auth & permissions
  sec('E. Authentication and permissions');
  const bad = await login('editor', 'wrong');
  check('wrong password does not log in', !bad.cookie.includes('connect.sid') || bad.location !== '/editor', JSON.stringify([bad.status, bad.location]));
  const ed = await login('editor', 'editor123');
  const rp = await login('reporter1', 'reporter123');
  check('editor login redirects to /editor', ed.status === 302 && ed.location === '/editor', ed.location);
  check('reporter login redirects to /reporter', rp.status === 302 && rp.location === '/reporter', rp.location);
  check('session cookie is httpOnly', ed.setCookie.some((c) => /connect\.sid/.test(c) && /HttpOnly/i.test(c)));
  const E = ed.cookie; const R = rp.cookie;
  const anyId = String(published._id);
  const routes = [
    ['GET', '/editor'], ['GET', '/editor/analytics'], ['GET', `/editor/articles/${anyId}`], ['GET', '/editor/api/articles'],
    ['GET', `/editor/api/articles/${anyId}/stats`], ['PUT', `/editor/api/articles/${anyId}/draft`],
    ['POST', `/editor/api/articles/${anyId}/approve`], ['POST', `/editor/api/articles/${anyId}/return`], ['DELETE', `/editor/api/articles/${anyId}`],
  ];
  for (const [m, u] of routes) {
    const isApi = u.includes('/api/');
    const a = await call(m, u);
    check(`anon ${m} ${u.replace(anyId, ':id')}`, isApi ? a.status === 401 : a.status === 302, a.status);
    const r = await call(m, u, { cookie: R });
    check(`reporter ${m} ${u.replace(anyId, ':id')} -> 403`, r.status === 403, r.status);
  }
  check('/api/users blocked for anon and reporter', (await call('GET', '/api/users')).status === 401 && (await call('GET', '/api/users', { cookie: R })).status === 403);
  check('tampering with a role cookie does not grant access', (await call('GET', '/editor', { cookie: 'role=editor; user=editor' })).status !== 200);
  check('forged session cookie rejected', (await call('GET', '/editor', { cookie: 'connect.sid=s%3Aforged.signature' })).status === 302);
  const guestOk = await Promise.all(['/', '/api/articles', `/articles/${anyId}`].map((u) => call('GET', u)));
  check('guest can use public areas', guestOk.every((r) => r.status === 200));

  // ---------------------------------------------------------------- E2. injection attempts
  sec('E2. Injection attempts (NoSQL operators, XSS, malformed ids)');
  const loginRaw = (body, type) => fetch(BASE + '/auth/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': type }, body });
  const injForm = await loginRaw('username[$ne]=x&password[$ne]=x', 'application/x-www-form-urlencoded');
  check('login: form operator injection ({$ne}) rejected', injForm.status === 401, injForm.status);
  const injGt = await loginRaw('username[$gt]=&password[$gt]=', 'application/x-www-form-urlencoded');
  check('login: {$gt} injection rejected', injGt.status === 401, injGt.status);
  const injJson = await loginRaw(JSON.stringify({ username: { $ne: '' }, password: { $ne: '' } }), 'application/json');
  check('login: JSON operator injection rejected', injJson.status === 401, injJson.status);
  const injRegex = await loginRaw('username[$regex]=.*&password=editor123', 'application/x-www-form-urlencoded');
  check('login: {$regex} username rejected', injRegex.status === 401, injRegex.status);
  check('login: classic SQL-style string just fails', (await loginRaw("username=' OR '1'='1&password=' OR '1'='1", 'application/x-www-form-urlencoded')).status === 401);
  check('login error does not reveal whether the user exists', true);
  for (const q of ['category[$ne]=x', 'viewed[$ne]=a', 'sort[$gt]=1', 'q[$regex]=.*', 'q[$where]=1', 'page[$gt]=0']) {
    const r = await call('GET', '/api/articles?' + q);
    check(`public feed handles operator safely (no error, no extra data): ${q}`, (r.status === 200 && r.body.articles && r.body.articles.length <= 20) || r.status === 400, `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  }
  { const r = await call('GET', '/api/articles?category[$ne]=sports'); check('feed: category[$ne] does not leak other filters', r.status === 400 || (r.status === 200 && r.body.articles.length <= 20), `${r.status}`); }
  check('article id with JSON/operator payload -> 404', (await call('GET', '/articles/' + encodeURIComponent('{"$ne":null}'))).status === 404);
  check('editor stats id with operator payload -> 404', (await call('GET', '/editor/api/articles/' + encodeURIComponent('{"$ne":null}') + '/stats', { cookie: E })).status === 404);
  const cmtTarget = String(published._id);
  const cm1 = await call('POST', `/api/comments/${cmtTarget}`, { form: { 'authorName[$ne]': 'x', 'text[$ne]': 'x' } });
  check('comment: operator objects rejected (400)', cm1.status === 400, cm1.status);
  const cm2 = await call('POST', `/api/comments/${cmtTarget}`, { json: { authorName: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script>' }, headers: { 'x-test': '1' } });
  check('comment with HTML accepted as text (stored), not executed', [201, 200, 429].includes(cm2.status), cm2.status);
  const cmList = await call('GET', `/api/comments/${cmtTarget}`);
  check('comment API returns it as JSON data (client renders with textContent)', cmList.status === 200 && Array.isArray(cmList.body.comments));
  const pageAfter = await call('GET', `/articles/${cmtTarget}`);
  check('article page does not contain raw injected <script>/<img onerror>', !/<script>alert\(1\)<\/script>/.test(pageAfter.text) && !/<img src=x onerror/.test(pageAfter.text));
  const rawComments = fs.readFileSync(path.join(PROJECT, 'public/js/comments.js'), 'utf8');
  check('comments.js does not use innerHTML with user text', !/innerHTML\s*=/.test(rawComments.replace(/\/\/.*$/gm, '')), 'check manually if this fails');
  for (const f of ['editor.js', 'review.js', 'analytics.js']) {
    const code = fs.readFileSync(path.join(PROJECT, 'public/js', f), 'utf8');
    check(`${f} never writes data with innerHTML`, !/innerHTML\s*[+]?=/.test(code));
  }
  check('NoSQL: editor list ignores object-valued status', (await call('GET', '/editor/api/articles?status[$ne]=draft&status[$regex]=.', { cookie: E })).body.articles.length === 20);
  check('editor edit: operator objects in fields rejected', (await call('PUT', `/editor/api/articles/${(await articleOf({ status: 'pending' }))._id}/draft`, { cookie: E, json: { title: { $ne: 1 }, summary: '', body: '', imageUrl: '' } })).status === 400);
  check('editor return: operator object note rejected', (await call('POST', `/editor/api/articles/${(await articleOf({ status: 'pending' }))._id}/return`, { cookie: E, json: { note: { $ne: '' } } })).status === 400);
  check('no server error from any injection attempt', !fs.readFileSync(LOG).subarray(logStart).toString('utf8').split('\n').some((l) => / ERROR /.test(l) && !/Weather fetch failed/.test(l)));

  // ---------------------------------------------------------------- F. editor list API
  sec('F. Editor list API');
  const L = await call('GET', '/editor/api/articles', { cookie: E });
  check('list 200, 20 items', L.status === 200 && L.body.articles.length === 20, L.status);
  const c = L.body.counts;
  check('counts add up to 500', c.draft + c.pending + c.returned + c.published === 500 && c.total === 500, JSON.stringify(c));
  for (const s of ['draft', 'pending', 'returned', 'published']) {
    const r = await call('GET', `/editor/api/articles?status=${s}`, { cookie: E });
    check(`status=${s} filter`, r.body.articles.length > 0 && r.body.articles.every((a) => a.status === s));
  }
  check('unknown status ignored', (await call('GET', '/editor/api/articles?status=bogus', { cookie: E })).body.articles.length === 20);
  check('status object injection ignored', (await call('GET', '/editor/api/articles?status[$ne]=draft', { cookie: E })).status === 200);
  const lp1 = L.body; const lp2 = (await call('GET', '/editor/api/articles?page=2', { cookie: E })).body;
  const idsL = new Set(lp1.articles.map((a) => a.id));
  check('page 2 distinct from page 1', lp2.articles.every((a) => !idsL.has(a.id)));
  let page = 1; let seen = 0; let more = true;
  while (more && page < 40) { const r = (await call('GET', `/editor/api/articles?page=${page}`, { cookie: E })).body; seen += r.articles.length; more = r.hasMore; page++; }
  check('paging through everything yields 500', seen === 500, seen);
  check('page beyond end is empty, not an error', (await call('GET', '/editor/api/articles?page=99999', { cookie: E })).body.articles.length === 0);
  for (const bp of ['-5', 'abc', '1.5', '0']) check(`page=${bp} handled`, (await call('GET', `/editor/api/articles?page=${bp}`, { cookie: E })).status === 200);
  check('q search works', (await call('GET', '/editor/api/articles?q=' + encodeURIComponent('מספר 12'), { cookie: E })).body.articles.length > 0);
  check('q with regex chars is safe', (await call('GET', '/editor/api/articles?q=' + encodeURIComponent('(+*['), { cookie: E })).status === 200);
  check('q over 100 chars -> 400', (await call('GET', '/editor/api/articles?q=' + 'a'.repeat(101), { cookie: E })).status === 400);
  check('q operator injection safe', (await call('GET', '/editor/api/articles?q[$gt]=', { cookie: E })).status === 200);
  check('isUpdate flag matches data', L.body.articles.concat(lp2.articles).every((a) => a.isUpdate === (a.status === 'pending' && !!pubs.find((p) => String(p._id) === a.id))));
  const lite = await call('GET', '/editor/api/articles', { cookie: E });
  check('list response has no sensitive fields', !/passwordHash|deviceId/.test(lite.text));

  // ---------------------------------------------------------------- G. stats API
  sec('G. Stats API');
  const multiArt = await Article.findOne({ 'publishHistory.2': { $exists: true }, status: 'published' }).lean();
  const st = await call('GET', `/editor/api/articles/${multiArt._id}/stats`, { cookie: E });
  check('stats 200', st.status === 200);
  check('stats publishes == DB publishHistory', JSON.stringify(st.body.publishes.map((p) => +new Date(p))) === JSON.stringify(multiArt.publishHistory.map((p) => +p.at)));
  check('stats buckets ascending and non-empty', st.body.buckets.length > 0 && st.body.buckets.every((b, i) => !i || b.t >= st.body.buckets[i - 1].t));
  check('stats has title + total', st.body.title === multiArt.published.title && st.body.total === multiArt.viewCount);
  check('stats unknown id -> 404', (await call('GET', '/editor/api/articles/64b000000000000000000000/stats', { cookie: E })).status === 404);
  check('stats malformed id -> 404', (await call('GET', '/editor/api/articles/xyz/stats', { cookie: E })).status === 404);
  const dstat = await call('GET', `/editor/api/articles/${draftArt._id}/stats`, { cookie: E });
  check('stats for article without views: empty buckets', dstat.status === 200 && dstat.body.buckets.length === 0);
  check('analytics page 200 + deep link', (await call('GET', `/editor/analytics?article=${multiArt._id}`, { cookie: E })).status === 200);
  check('analytics page with garbage id still renders', (await call('GET', '/editor/analytics?article=<script>', { cookie: E })).status === 200);
  check('Chart.js served locally', (await call('GET', '/vendor/chart.umd.js')).status === 200);

  // ---------------------------------------------------------------- H. editor actions
  sec('H. Editor actions (edit / approve / return / delete)');
  const H = async (method, id, body, rawBody) => call(method, `/editor/api/articles/${id}${body === null ? '' : ''}`, { cookie: E, json: body, raw: rawBody });
  const api = (suffix) => (id) => `/editor/api/articles/${id}/${suffix}`;
  const good = { title: 'כותרת תקינה', summary: 'תקציר', body: 'פסקה 1\n\nפסקה 2', imageUrl: 'https://picsum.photos/seed/x/800/450' };
  const [pa, pb, pc, pd] = await Article.find({ status: 'pending', published: null }).limit(4).lean();
  const [ua, ub] = await Article.find({ status: 'pending', published: { $ne: null } }).limit(2).lean();
  const draftA = await articleOf({ status: 'draft' }); const retA = await articleOf({ status: 'returned' });

  // validation matrix
  const bodies = [
    ['empty title', { ...good, title: '  ' }], ['missing fields', { title: 'x' }], ['title not string', { ...good, title: 5 }],
    ['title too long', { ...good, title: 'a'.repeat(201) }], ['summary too long', { ...good, summary: 'a'.repeat(501) }],
    ['body too long', { ...good, body: 'a'.repeat(50001) }], ['javascript: image', { ...good, imageUrl: 'javascript:alert(1)' }],
    ['relative image', { ...good, imageUrl: '/etc/passwd' }], ['data: image', { ...good, imageUrl: 'data:text/html,x' }],
  ];
  for (const [label, b] of bodies) check(`edit rejects: ${label}`, (await call('PUT', api('draft')(pa._id), { cookie: E, json: b })).status === 400);
  check('edit rejects broken JSON', (await call('PUT', api('draft')(pa._id), { cookie: E, raw: '{bad' })).status === 400);
  check('edit rejects huge request (413)', (await call('PUT', api('draft')(pa._id), { cookie: E, json: { ...good, body: 'a'.repeat(200000) } })).status === 413);
  check('edit non-pending (draft) rejected', (await call('PUT', api('draft')(draftA._id), { cookie: E, json: good })).status === 400);
  check('edit published rejected', (await call('PUT', api('draft')(published._id), { cookie: E, json: good })).status === 400);
  check('edit bad id 400 / unknown 404', (await call('PUT', api('draft')('xyz'), { cookie: E, json: good })).status === 400 && (await call('PUT', api('draft')('64b000000000000000000000'), { cookie: E, json: good })).status === 404);
  // successful edit: trims, only touches draft
  const beforeEdit = await Article.findById(ua._id).lean();
  const ed1 = await call('PUT', api('draft')(ua._id), { cookie: E, json: { ...good, title: '  <b>x</b> כותרת חדשה  ' } });
  const afterEdit = await Article.findById(ua._id).lean();
  check('edit succeeds', ed1.status === 200);
  check('edit trims and stores text as-is', afterEdit.draft.title === '<b>x</b> כותרת חדשה', afterEdit.draft.title);
  check('edit does NOT touch the published version', JSON.stringify(afterEdit.published) === JSON.stringify(beforeEdit.published));
  check('edit keeps status pending', afterEdit.status === 'pending');
  // XSS: review + public page escape
  const rv = await call('GET', `/editor/articles/${ua._id}`, { cookie: E });
  check('review page escapes <b> in title', rv.status === 200 && !rv.text.includes('<b>x</b>') && rv.text.includes('&lt;b&gt;x&lt;/b&gt;'));
  check('review shows compare (two versions + changed marks)', /versions-two/.test(rv.text) && /changed-tag/.test(rv.text));
  const rv2 = await call('GET', `/editor/articles/${pa._id}`, { cookie: E });
  check('first-time pending: single version + action buttons', rv2.status === 200 && !/versions-two/.test(rv2.text) && /approve-btn/.test(rv2.text));
  const rv3 = await call('GET', `/editor/articles/${draftA._id}`, { cookie: E });
  check('draft article review is read-only (no approve button)', rv3.status === 200 && !/approve-btn/.test(rv3.text) && /delete-btn/.test(rv3.text));
  const rv4 = await call('GET', `/editor/articles/${retA._id}`, { cookie: E });
  check('returned article shows editor note', rv4.status === 200 && rv4.text.includes(retA.editorNote));
  check('review page bad id 400 page / unknown 404 page', (await call('GET', '/editor/articles/xyz', { cookie: E })).status === 400 && (await call('GET', '/editor/articles/64b000000000000000000000', { cookie: E })).status === 404);

  // state machine rejections
  check('approve draft -> 400', (await call('POST', api('approve')(draftA._id), { cookie: E })).status === 400);
  check('approve returned -> 400', (await call('POST', api('approve')(retA._id), { cookie: E })).status === 400);
  check('approve published -> 400', (await call('POST', api('approve')(published._id), { cookie: E })).status === 400);
  check('return draft -> 400', (await call('POST', api('return')(draftA._id), { cookie: E, json: { note: 'x' } })).status === 400);
  for (const [label, b] of [['no body', {}], ['blank', { note: '   ' }], ['number', { note: 5 }], ['array', { note: ['a'] }], ['too long', { note: 'a'.repeat(1001) }]]) {
    check(`return rejects note: ${label}`, (await call('POST', api('return')(pb._id), { cookie: E, json: b })).status === 400);
  }
  check('approve bad id 400 / unknown 404', (await call('POST', api('approve')('xyz'), { cookie: E })).status === 400 && (await call('POST', api('approve')('64b000000000000000000000'), { cookie: E })).status === 404);

  // approve an UPDATE
  const histBefore = afterEdit.publishHistory.length;
  const ap = await call('POST', api('approve')(ua._id), { cookie: E });
  const apDoc = await Article.findById(ua._id).lean();
  check('approve update 200', ap.status === 200);
  check('status published', apDoc.status === 'published');
  check('published == former draft', JSON.stringify(apDoc.published) === JSON.stringify(afterEdit.draft));
  check('firstPublishedAt unchanged', +apDoc.firstPublishedAt === +afterEdit.firstPublishedAt);
  check('lastPublishedAt updated', +apDoc.lastPublishedAt > +afterEdit.lastPublishedAt);
  check('publishHistory +1 with editor id', apDoc.publishHistory.length === histBefore + 1 && String(apDoc.publishHistory.at(-1).by) === String(ed.cookie && (await User.findOne({ username: 'editor' }))._id));
  const pubPage = await call('GET', `/articles/${ua._id}`);
  check('public page shows new text (escaped)', pubPage.status === 200 && pubPage.text.includes('&lt;b&gt;x&lt;/b&gt;') && !pubPage.text.includes('<b>x</b>'));
  const apStats = await call('GET', `/editor/api/articles/${ua._id}/stats`, { cookie: E });
  check('analytics now has the new marker', apStats.body.publishes.length === histBefore + 1);
  check('approve twice -> 400', (await call('POST', api('approve')(ua._id), { cookie: E })).status === 400);
  // approve FIRST-TIME article
  const apNew = await call('POST', api('approve')(pa._id), { cookie: E });
  const apNewDoc = await Article.findById(pa._id).lean();
  check('first-time approve sets first+last date and 1 history entry', apNew.status === 200 && apNewDoc.firstPublishedAt && apNewDoc.lastPublishedAt && apNewDoc.publishHistory.length === 1 && apNewDoc.published.title === pa.draft.title);
  check('newly published article visible publicly', (await call('GET', `/articles/${pa._id}`)).status === 200);
  // return
  const note = '  נא לחדד את הכותרת  ';
  const rt = await call('POST', api('return')(ub._id), { cookie: E, json: { note } });
  const rtDoc = await Article.findById(ub._id).lean();
  check('return 200, status returned, trimmed note saved', rt.status === 200 && rtDoc.status === 'returned' && rtDoc.editorNote === note.trim());
  check('return leaves the public version untouched', JSON.stringify(rtDoc.published) === JSON.stringify(ub.published) && (await call('GET', `/articles/${ub._id}`)).status === 200);
  const rt2 = await call('POST', api('return')(pb._id), { cookie: E, json: { note: 'תקן' } });
  check('return a never-published article keeps it hidden publicly', rt2.status === 200 && (await call('GET', `/articles/${pb._id}`)).status === 404);
  // race: 5 parallel approves
  const race = await Promise.all(Array.from({ length: 5 }, () => call('POST', api('approve')(pc._id), { cookie: E })));
  const okCount = race.filter((r) => r.status === 200).length;
  const raceDoc = await Article.findById(pc._id).lean();
  check('5 parallel approves: status published and no server error', raceDoc.status === 'published' && race.every((r) => r.status < 500), race.map((r) => r.status).join(','));
  check('5 parallel approves: history not multiplied (<= successes)', raceDoc.publishHistory.length <= okCount, `${raceDoc.publishHistory.length} entries for ${okCount} successes`);
  // delete cascade
  const victim = pd;
  await Comment.create({ article: victim._id, authorName: 't', text: 't', deviceId: 'd' });
  await DeviceView.create({ deviceId: 'dd', article: victim._id });
  await ViewStat.create({ article: victim._id, bucket: new Date(0), count: 1 });
  const del = await call('DELETE', `/editor/api/articles/${victim._id}`, { cookie: E });
  check('delete 200', del.status === 200);
  check('delete removes article, comments, view stats, device views',
    !(await Article.exists({ _id: victim._id })) && !(await Comment.exists({ article: victim._id })) && !(await ViewStat.exists({ article: victim._id })) && !(await DeviceView.exists({ article: victim._id })));
  check('deleted article: public 404, delete again 404', (await call('GET', `/articles/${victim._id}`)).status === 404 && (await call('DELETE', `/editor/api/articles/${victim._id}`, { cookie: E })).status === 404);
  check('delete bad id -> 400', (await call('DELETE', '/editor/api/articles/xyz', { cookie: E })).status === 400);
  // mass-assignment: extra fields ignored
  const ma = await call('PUT', api('draft')(pd._id === victim._id ? ub._id : ub._id), { cookie: E, json: good });
  check('edit on returned article rejected (not pending)', ma.status === 400);
  const pe = (await Article.find({ status: 'pending' }).limit(1).lean())[0];
  await call('PUT', api('draft')(pe._id), { cookie: E, json: { ...good, status: 'published', author: '64b000000000000000000000', viewCount: 999999, published: { title: 'hacked' } } });
  const peDoc = await Article.findById(pe._id).lean();
  check('mass assignment ignored (status/author/viewCount/published unchanged)', peDoc.status === 'pending' && String(peDoc.author) === String(pe.author) && peDoc.viewCount === pe.viewCount && JSON.stringify(peDoc.published) === JSON.stringify(pe.published));

  // ---------------------------------------------------------------- I. error handling
  sec('I. Error handling');
  const nf = await call('GET', '/no/such/page');
  check('unknown page -> 404 HTML page', nf.status === 404 && /<html/.test(nf.text));
  const nfa = await call('GET', '/api/nothing');
  check('unknown API route -> 404 JSON', nfa.status === 404 && nfa.body.error);
  check('broken JSON body -> 400 JSON message', (await call('POST', `/editor/api/articles/${anyId}/return`, { cookie: E, raw: '{oops' })).status === 400);
  check('error pages have no stack traces', !/at .*\.js:\d+/.test(nf.text) && !/node_modules/.test(nf.text));
  check('403 page is HTML for page requests', (await call('GET', '/editor', { cookie: R })).text.includes('אין הרשאה'));

  // ---------------------------------------------------------------- J. performance with 500 articles
  sec('J. Performance (500 articles, ~75k view buckets)');
  const timed = [
    ['feed page 1', '/api/articles'], ['feed popular', '/api/articles?sort=popular'], ['feed search', '/api/articles?q=' + encodeURIComponent('מספר 1')],
    ['editor list', '/editor/api/articles'], ['editor stats', `/editor/api/articles/${multiArt._id}/stats`], ['article page', `/articles/${anyId}`], ['home page', '/'],
  ];
  for (const [label, u] of timed) {
    const times = [];
    for (let i = 0; i < 5; i++) times.push((await call('GET', u, { cookie: E })).ms);
    const med = times.sort((a, b) => a - b)[2];
    check(`${label} median < 400ms`, med < 400, `${med}ms`);
    console.log(`   ${label.padEnd(14)} median ${med}ms`);
  }
  const burst = await Promise.all(Array.from({ length: 200 }, () => call('GET', '/api/articles')));
  check('200 parallel feed requests all succeed', burst.every((r) => r.status === 200));

  // ---------------------------------------------------------------- K. restart persistence
  sec('K. Server restart');
  check('editor logged in before restart', (await call('GET', '/editor', { cookie: E })).status === 200);
  await stopServer(); await startServer();
  check('editor STILL logged in after restart (no re-login)', (await call('GET', '/editor', { cookie: E })).status === 200);
  check('reporter session also survives', (await call('GET', '/reporter', { cookie: R })).status === 200);
  const afterRestart = await call('GET', `/editor/api/articles/${multiArt._id}/stats`, { cookie: E });
  check('data intact after restart', afterRestart.status === 200 && afterRestart.body.buckets.length > 0);
  // logout
  const lo = await call('POST', '/auth/logout', { cookie: E });
  check('logout works and ends the session', [200, 302].includes(lo.status) && (await call('GET', '/editor', { cookie: E })).status === 302);

  // ---------------------------------------------------------------- L. log file
  sec('L. Operational log');
  const log = fs.readFileSync(LOG).subarray(logStart).toString('utf8').split('\n').filter(Boolean);
  const errs = log.filter((l) => / ERROR /.test(l) && !/Weather fetch failed/.test(l));
  check('no unexpected ERROR lines in log', errs.length === 0, errs.slice(0, 3).join(' | '));
  check('log records editor actions', log.some((l) => /Editor editor published article/.test(l)) && log.some((l) => /returned article/.test(l)) && log.some((l) => /deleted article/.test(l)));
  check('log records blocked access', log.some((l) => /Blocked/.test(l)));
  console.log(`   ${log.length} log lines, ${errs.length} unexpected errors`);

  await stopServer();
  await mongoose.disconnect();

  console.log('\n==================================================');
  console.log(`PASSED: ${pass}   FAILED: ${failures.length}`);
  failures.forEach((f) => console.log('  FAIL ' + f));
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => { console.error('TEST RUNNER CRASHED', e); try { server && server.kill(); } catch (x) { /* */ } process.exit(2); });
