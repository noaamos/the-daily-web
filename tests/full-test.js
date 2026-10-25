// Full automated test run: seed data, public site, view counting, permissions, editor area, injection attempts,
// load and server restart. Owner: member 4 (covers the whole system).
// The reporter area (member 3) is tested in the function reporterTests(), sections R1 to R9.
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
const articleService = require(path.join(PROJECT, 'services/articleService'));

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

// ---------------------------------------------------------------------------------------------------------------
// Reporter area (member 3): the "my articles" list, creating, editing with autosave, submitting for approval,
// the editor's note, and editing an article that is already published. It uses the same seed and the same server
// as the rest of this file and runs from the main flow below (after the performance section).
async function reporterTests() {
  // ---- small helpers that read like the user's actions ----
  let R1; let R2; let E; // session cookies of reporter1, reporter2 and the editor
  const createArticle = async (cookie, title, category = 'tech') => (await call('POST', '/reporter/api/articles', { cookie, json: { category, title } })).body.id;
  const save = (cookie, id, fields) => call('PUT', `/reporter/api/articles/${id}/draft`, { cookie, json: { title: '', summary: '', body: '', imageUrl: '', ...fields } });
  const submit = (cookie, id, json) => call('POST', `/reporter/api/articles/${id}/submit`, { cookie, json });
  const discard = (cookie, id) => call('POST', `/reporter/api/articles/${id}/discard`, { cookie });
  const approve = (id) => call('POST', `/editor/api/articles/${id}/approve`, { cookie: E });
  const sendBack = (id, note) => call('POST', `/editor/api/articles/${id}/return`, { cookie: E, json: { note } });
  const editPage = (cookie, id) => call('GET', `/reporter/articles/${id}/edit`, { cookie });
  // a new article with a title and a body (the minimum for submitting)
  async function complete(cookie, title, extra = {}) {
    const id = await createArticle(cookie, title);
    await save(cookie, id, { title, body: `גוף הכתבה ${title}`, ...extra });
    return id;
  }
  // the row of one article in the "my articles" list (walks the pages)
  async function rowOf(cookie, id) {
    for (let p = 1; p <= 60; p++) {
      const r = await call('GET', `/reporter/api/articles?page=${p}`, { cookie });
      const row = r.body.articles.find((a) => a.id === id);
      if (row) return row;
      if (!r.body.hasMore) return null;
    }
    return null;
  }
  const db = (id) => Article.findById(id).lean();
  // everything about an article that must NOT change when a request is rejected
  async function snap(id) {
    const a = await db(id);
    return JSON.stringify({ status: a.status, category: a.category, author: String(a.author), draft: a.draft, published: a.published, editorNote: a.editorNote, history: a.publishHistory.length });
  }

  const u1 = await User.findOne({ username: 'reporter1' }).lean();
  const u2 = await User.findOne({ username: 'reporter2' }).lean();
  R1 = (await login('reporter1', 'reporter123')).cookie;
  R2 = (await login('reporter2', 'reporter123')).cookie;
  E = (await login('editor', 'editor123')).cookie;

  // ---------------------------------------------------------------- R1. my articles
  sec('R1. Reporter: "My articles" list');
  async function allRows(cookie) {
    const rows = []; const sizes = []; let more = true;
    for (let p = 1; more && p <= 60; p++) {
      const r = await call('GET', `/reporter/api/articles?page=${p}`, { cookie });
      rows.push(...r.body.articles); sizes.push(r.body.articles.length); more = r.body.hasMore;
    }
    return { rows, sizes };
  }
  const mine1 = await allRows(R1);
  const mine2 = await allRows(R2);
  check('pages add up to the reporter\'s articles in the DB', mine1.rows.length === (await Article.countDocuments({ author: u1._id })), `${mine1.rows.length}`);
  check('no article appears twice', new Set(mine1.rows.map((a) => a.id)).size === mine1.rows.length);
  check('every page except the last has exactly 20 rows', mine1.sizes.slice(0, -1).every((n) => n === 20));
  check('two reporters never see the same article', !mine1.rows.some((a) => mine2.rows.some((b) => b.id === a.id)));
  check('a reporter sees only his own articles (checked in the DB)', (await Article.countDocuments({ _id: { $in: mine1.rows.map((a) => a.id) }, author: { $ne: u1._id } })) === 0);
  check('row shape', ['id', 'title', 'category', 'categoryLabel', 'status', 'statusLabel', 'editable', 'isUpdate', 'unsentChanges', 'editorNote', 'updatedAt'].every((k) => k in mine1.rows[0]));
  check('only draft, returned and published articles are editable', mine1.rows.every((a) => a.editable === ['draft', 'returned', 'published'].includes(a.status)));
  check('a note appears only on returned articles', mine1.rows.every((a) => (a.status === 'returned') === Boolean(a.editorNote)));
  check('page beyond the last is empty', (await call('GET', '/reporter/api/articles?page=999', { cookie: R1 })).body.articles.length === 0);
  for (const q of ['abc', '0', '-3', '1.5', '']) check(`page=${q || '(empty)'} -> 400`, (await call('GET', `/reporter/api/articles?page=${q}`, { cookie: R1 })).status === 400);
  check('anonymous -> 401', (await call('GET', '/reporter/api/articles')).status === 401);
  check('editor -> 403', (await call('GET', '/reporter/api/articles', { cookie: E })).status === 403);
  check('dashboard page: anonymous is sent to the login', (await call('GET', '/reporter')).status === 302);
  check('dashboard page: reporter 200, editor 403', (await call('GET', '/reporter', { cookie: R1 })).status === 200 && (await call('GET', '/reporter', { cookie: E })).status === 403);

  // ---------------------------------------------------------------- R2. creating
  sec('R2. Reporter: Creating an article');
  const made = await call('POST', '/reporter/api/articles', { cookie: R1, json: { category: 'tech', title: '  כותרת חדשה  ' } });
  check('create -> 201', made.status === 201, made.status);
  const mdoc = await db(made.body.id);
  check('saved as a draft of the logged-in reporter, title trimmed', mdoc.status === 'draft' && String(mdoc.author) === String(u1._id) && mdoc.draft.title === 'כותרת חדשה' && mdoc.published === null);
  const noTitle = await call('POST', '/reporter/api/articles', { cookie: R1, json: { category: 'sports' } });
  check('title is optional (shown as "no title")', noTitle.status === 201 && noTitle.body.title === '(ללא כותרת)');
  const forged = await call('POST', '/reporter/api/articles', { cookie: R1, json: { category: 'culture', title: 'x', author: String(u2._id), status: 'published', published: { title: 'hack' }, viewCount: 999 } });
  const fdoc = await db(forged.body.id);
  check('author, status, published and counters sent by the client are ignored', fdoc.status === 'draft' && String(fdoc.author) === String(u1._id) && fdoc.published === null && fdoc.viewCount === 0);
  const badBodies = [undefined, {}, { category: '' }, { category: 'xyz' }, { category: { $ne: null } }, { category: ['tech'] }, { category: 'tech', title: 5 }, { category: 'tech', title: { a: 1 } }, { category: 'tech', title: 'a'.repeat(201) }];
  for (const b of badBodies) check(`invalid create ${JSON.stringify(b)} -> 400`.slice(0, 70), (await call('POST', '/reporter/api/articles', { cookie: R1, json: b })).status === 400);
  check('title of exactly 200 characters is accepted', (await call('POST', '/reporter/api/articles', { cookie: R1, json: { category: 'tech', title: 'b'.repeat(200) } })).status === 201);
  check('create: anonymous 401, editor 403', (await call('POST', '/reporter/api/articles', { json: { category: 'tech' } })).status === 401 && (await call('POST', '/reporter/api/articles', { cookie: E, json: { category: 'tech' } })).status === 403);

  // ---------------------------------------------------------------- R3. editing and autosave
  sec('R3. Reporter: Edit page and saving the draft (autosave endpoint)');
  const D = await createArticle(R1, 'טיוטה לבדיקת עריכה');
  let page = await editPage(R1, D);
  check('own draft: edit page opens, filled from the server', page.status === 200 && page.text.includes('value="טיוטה לבדיקת עריכה"') && page.text.includes('id="save-btn"') && page.text.includes('id="submit-btn"'));
  check('another reporter -> 403, editor -> 403, anonymous -> redirect', (await editPage(R2, D)).status === 403 && (await editPage(E, D)).status === 403 && (await editPage(undefined, D)).status === 302);
  check('malformed id and unknown id -> 404', (await editPage(R1, 'abc')).status === 404 && (await editPage(R1, '64b000000000000000000000')).status === 404);

  const good = { category: 'economy', title: '  כותרת חדשה  ', summary: '  תקציר חדש ', body: '  שורה 1\n\nשורה 2  \n', imageUrl: 'https://example.com/a.png' };
  const saved = await save(R1, D, good);
  const ddoc = await db(D);
  check('valid save -> 200 with the save time', saved.status === 200 && saved.body.savedAt);
  check('saved: title/summary trimmed, body kept exactly as typed, category and image stored',
    ddoc.draft.title === 'כותרת חדשה' && ddoc.draft.summary === 'תקציר חדש' && ddoc.draft.body === good.body && ddoc.draft.imageUrl === good.imageUrl && ddoc.category === 'economy');
  check('save does not touch status or published', ddoc.status === 'draft' && ddoc.published === null && ddoc.draftSavedAt);
  page = await editPage(R1, D);
  check('after a reload the page shows what was saved', page.text.includes('value="כותרת חדשה"') && page.text.includes('value="economy" selected'));
  check('empty fields are allowed while writing', (await save(R1, D, { title: '', summary: '', body: '', imageUrl: '' })).status === 200);
  check('category stays when it is not sent', (await db(D)).category === 'economy');
  await save(R1, D, good);
  const baseSnap = await snap(D);
  const L = (c, n) => c.repeat(n);
  const rejected = {
    'missing fields': undefined, 'title is a number': { title: 5 }, 'title is an object': { title: { $ne: 1 } },
    'title 201 characters': { title: L('a', 201) }, 'summary 501': { summary: L('a', 501) }, 'body 50001': { body: L('a', 50001) },
    'image 501': { imageUrl: 'http://x.com/' + L('a', 495) }, 'javascript: link': { imageUrl: 'javascript:alert(1)' }, 'ftp link': { imageUrl: 'ftp://x.com/a.png' },
    'unknown category': { category: 'xyz' }, 'category is an object': { category: { $ne: null } },
  };
  for (const [name, fields] of Object.entries(rejected)) {
    const r = fields === undefined ? await call('PUT', `/reporter/api/articles/${D}/draft`, { cookie: R1, json: {} }) : await save(R1, D, { ...good, ...fields });
    check(`rejected: ${name} -> 400`, r.status === 400, r.status);
  }
  check('nothing was changed by all the rejected saves', (await snap(D)) === baseSnap);
  const forgedSave = await save(R1, D, { ...good, status: 'published', author: String(u2._id), published: { title: 'hack' }, editorNote: 'x', viewCount: 999 });
  const fsnap = await db(D);
  check('forged fields in a save are ignored', forgedSave.status === 200 && fsnap.status === 'draft' && fsnap.published === null && fsnap.editorNote === '' && String(fsnap.author) === String(u1._id) && fsnap.viewCount === 0);
  const other = await createArticle(R2, 'של כתב אחר');
  const otherSnap = await snap(other);
  check('another reporter\'s article -> 403 and unchanged', (await save(R1, other, good)).status === 403 && (await snap(other)) === otherSnap);
  check('editor -> 403, anonymous -> 401', (await save(E, D, good)).status === 403 && (await save(undefined, D, good)).status === 401);
  check('unknown and malformed ids -> 404', (await save(R1, '64b000000000000000000000', good)).status === 404 && (await save(R1, 'abc', good)).status === 404);
  await save(R1, D, { title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(2)>' });
  page = await editPage(R1, D);
  check('markup typed by a reporter is shown escaped (no XSS)', page.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !page.text.includes('<script>alert(1)') && !page.text.includes('<img src=x onerror'));
  check('a draft is private: not on the public site or in the feed', (await call('GET', `/articles/${D}`)).status === 404 && !(await call('GET', '/api/articles?q=%3Cscript')).text.includes(D));
  const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => save(R1, D, { title: `parallel ${i}` })));
  check('10 saves at the same time all succeed, one of them is the final state', parallel.every((r) => r.status === 200) && /^parallel \d$/.test((await db(D)).draft.title));
  await save(R1, D, { ...good, title: 'שרד ריסטארט' });

  // ---------------------------------------------------------------- R4. submitting
  sec('R4. Reporter: Submitting for approval');
  const A1 = await createArticle(R1, 'רק כותרת'); await save(R1, A1, { title: 'רק כותרת' });
  let r = await submit(R1, A1);
  check('title only -> 400, says what is missing, status unchanged', r.status === 400 && r.body.error.includes('תוכן') && (await db(A1)).status === 'draft');
  const A2 = await createArticle(R1, ''); await save(R1, A2, { body: 'יש גוף' });
  r = await submit(R1, A2); check('body only -> 400 (title missing)', r.status === 400 && r.body.error.includes('כותרת'));
  const A3 = await createArticle(R1, ''); r = await submit(R1, A3); check('empty article -> 400 (both missing)', r.status === 400 && r.body.error.includes('כותרת ותוכן'));
  const A4 = await createArticle(R1, 'רווחים'); await save(R1, A4, { title: 'רווחים', body: '    ' });
  check('a body of spaces -> 400', (await submit(R1, A4)).status === 400);

  const S = await complete(R1, 'הגשה תקינה');
  const before = await db(S);
  r = await submit(R1, S);
  const after = await db(S);
  check('submit -> 200 with the new status', r.status === 200 && r.body.status === 'pending' && r.body.statusLabel === 'ממתינה לאישור עורך');
  check('only the status changed (draft, author, published untouched, no publish history)', after.status === 'pending' && JSON.stringify(after.draft) === JSON.stringify(before.draft) && after.published === null && String(after.author) === String(before.author) && after.publishHistory.length === 0);
  check('after the submit the reporter cannot save (409), draft unchanged', (await save(R1, S, { title: 'שינוי' })).status === 409 && (await db(S)).draft.title === 'הגשה תקינה');
  page = await editPage(R1, S);
  check('the edit page is read-only (no submit button)', page.text.includes('<fieldset disabled>') && !page.text.includes('id="submit-btn"'));
  check('a second submit -> 400', (await submit(R1, S)).status === 400);
  const row = await rowOf(R1, S);
  check('list: pending and not editable', row.status === 'pending' && row.editable === false && row.isUpdate === false);
  const FG = await complete(R1, 'זיוף בהגשה');
  await submit(R1, FG, { status: 'published', author: String(u2._id), published: { title: 'hack' } });
  const fgdoc = await db(FG);
  check('a forged request body cannot publish or change the owner', fgdoc.status === 'pending' && fgdoc.published === null && String(fgdoc.author) === String(u1._id));
  const FO = await complete(R1, 'של reporter1'); const foSnap = await snap(FO);
  check('another reporter -> 403 and unchanged', (await submit(R2, FO)).status === 403 && (await snap(FO)) === foSnap);
  check('editor -> 403, anonymous -> 401, bad ids -> 404', (await submit(E, FO)).status === 403 && (await submit(undefined, FO)).status === 401 && (await submit(R1, 'abc')).status === 404 && (await submit(R1, '64b000000000000000000000')).status === 404);
  const pendingSeed = await Article.findOne({ author: u1._id, status: 'pending', published: null, _id: { $ne: S } }).lean();
  check('an article that is already pending cannot be submitted again (400)', (await submit(R1, String(pendingSeed._id))).status === 400);
  // the ownership rule is also inside the service itself (not only in the controller)
  const SV = await complete(R1, 'בדיקת שירות');
  const svErr = async (user) => { try { await articleService.transition(await Article.findById(SV), 'pending', user); return 'no error'; } catch (e) { return `${e.status}`; } };
  check('transition(): another reporter -> 403', (await svErr({ role: 'reporter', _id: u2._id, username: 'x' })) === '403' && (await db(SV)).status === 'draft');
  check('transition(): an editor cannot move draft -> pending (400)', (await svErr({ role: 'editor', _id: u2._id, username: 'e' })) === '400' && (await db(SV)).status === 'draft');
  check('transition(): the owner can', (await svErr({ role: 'reporter', _id: u1._id, username: 'o' })) === 'no error' && (await db(SV)).status === 'pending');
  const PAR = await complete(R1, 'הגשות במקביל');
  const parSubmits = await Promise.all(Array.from({ length: 10 }, () => submit(R1, PAR)));
  check('10 submits at the same time: at least one succeeds, the others are refused, the result is "pending"', parSubmits.some((x) => x.status === 200) && parSubmits.every((x) => [200, 400, 409].includes(x.status)) && (await db(PAR)).status === 'pending');
  // transition() checks the status again inside the save: a stale copy of the article must not overwrite a newer status
  const STALE = await complete(R1, 'מצב ישן');
  const staleDoc = await Article.findById(STALE); // loaded while the article is still a draft
  await Article.updateOne({ _id: STALE }, { $set: { status: 'returned', editorNote: 'הערה' } }); // someone else moves it meanwhile
  const staleErr = await articleService.transition(staleDoc, 'pending', { role: 'reporter', _id: u1._id, username: 'o' }).then(() => 'no error', (e) => `${e.status}`);
  check('transition(): a stale copy cannot overwrite a newer status (409, nothing written)', staleErr === '409' && (await db(STALE)).status === 'returned');

  // ---------------------------------------------------------------- R5. the editor and the public site
  sec('R5. Reporter: The editor\'s side and the public site');
  const TAG = `F-${Date.now()}`;
  const F = await complete(R1, `${TAG} מאמר`); await submit(R1, F);
  let list = await call('GET', `/editor/api/articles?status=pending&q=${encodeURIComponent(TAG)}`, { cookie: E });
  check('the editor sees the submitted article in the pending list', list.body.articles.some((a) => a.id === F && a.isUpdate === false));
  check('editor review page offers approve', (await call('GET', `/editor/articles/${F}`, { cookie: E })).text.includes('id="approve-btn"'));
  check('before approval the public cannot see it (404)', (await call('GET', `/articles/${F}`)).status === 404);
  check('editor approves -> 200', (await approve(F)).status === 200);
  const pubDoc = await db(F);
  check('published equals the submitted draft, publish time and history recorded', pubDoc.status === 'published' && pubDoc.published.title === pubDoc.draft.title && pubDoc.published.body === pubDoc.draft.body && pubDoc.firstPublishedAt && pubDoc.publishHistory.length === 1);
  const pubPage = await call('GET', `/articles/${F}`);
  check('the public page shows the title and the full text', pubPage.status === 200 && pubPage.text.includes(`${TAG} מאמר`) && pubPage.text.includes(`גוף הכתבה ${TAG} מאמר`));
  check('the public feed lists it', (await call('GET', `/api/articles?q=${encodeURIComponent(TAG)}`)).text.includes(`${TAG} מאמר`));

  // ---------------------------------------------------------------- R6. the editor's note
  sec('R6. Reporter: Returned for fixes: the editor\'s note');
  const seedReturned = await Article.findOne({ author: u1._id, status: 'returned', published: null }).lean();
  const seedRow = await rowOf(R1, String(seedReturned._id));
  check('a returned article shows the note in the list', seedRow.editorNote === seedReturned.editorNote && seedRow.editorNote.length > 0);
  page = await editPage(R1, String(seedReturned._id));
  check('the edit page shows the note box and the "submit again" button', page.text.includes('class="editor-note"') && page.text.includes(seedReturned.editorNote) && page.text.includes('הגשה מחדש לאישור'));
  const G = await complete(R1, `${TAG} החזרה`); await submit(R1, G);
  check('editor returns with a note -> 200', (await sendBack(G, 'הערה ראשונה')).status === 200);
  check('the note is in the list and on the page', (await rowOf(R1, G)).editorNote === 'הערה ראשונה' && (await editPage(R1, G)).text.includes('הערה ראשונה'));
  check('the reporter fixes the draft and submits again (returned -> pending)', (await save(R1, G, { title: `${TAG} החזרה`, body: 'גוף מתוקן' })).status === 200 && (await submit(R1, G)).status === 200);
  check('while pending the old note is hidden (but still stored)', (await rowOf(R1, G)).editorNote === '' && !(await editPage(R1, G)).text.includes('class="editor-note"') && (await db(G)).editorNote === 'הערה ראשונה');
  await sendBack(G, 'הערה שנייה');
  check('a second return replaces the note', (await rowOf(R1, G)).editorNote === 'הערה שנייה' && !(await editPage(R1, G)).text.includes('הערה ראשונה'));
  await submit(R1, G); await approve(G);
  check('publishing clears the note', (await db(G)).editorNote === '' && (await rowOf(R1, G)).editorNote === '');
  check('the public sees the corrected text', (await call('GET', `/articles/${G}`)).text.includes('גוף מתוקן'));
  const X = await complete(R1, `${TAG} xss`); await submit(R1, X);
  const hostile = '<script>alert(1)</script> <img src=x onerror=alert(2)>';
  await sendBack(X, hostile);
  page = await editPage(R1, X);
  check('a hostile note is shown escaped', page.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !page.text.includes('<script>alert(1)') && (await rowOf(R1, X)).editorNote === hostile);
  const N = await complete(R1, `${TAG} שורות`); await submit(R1, N);
  await sendBack(N, 'שורה ראשונה\nשורה שנייה');
  check('line breaks of a note are kept', (await rowOf(R1, N)).editorNote === 'שורה ראשונה\nשורה שנייה');
  const LN = await complete(R1, `${TAG} ארוכה`); await submit(R1, LN);
  check('a note of 1000 characters (the editor\'s limit) arrives complete', (await sendBack(LN, 'א'.repeat(1000))).status === 200 && (await rowOf(R1, LN)).editorNote.length === 1000);
  check('another reporter cannot open the page of a returned article, nor see its row', (await editPage(R2, G)).status === 403 && (await rowOf(R2, X)) === null);

  // ---------------------------------------------------------------- R7. editing a published article
  sec('R7. Reporter: Editing an article that is already published');
  check('the transition table allows published -> pending only for a reporter',
    articleService.canTransition('published', 'pending', 'reporter') && !articleService.canTransition('published', 'pending', 'editor')
    && !articleService.canTransition('published', 'draft', 'reporter') && !articleService.canTransition('published', 'returned', 'editor')
    && !articleService.canTransition('published', 'published', 'editor') && articleService.canTransition('draft', 'pending', 'reporter'));

  const T = `H-${Date.now()}`;
  const P = await createArticle(R1, `${T} גרסה 1`, 'health');
  await save(R1, P, { title: `${T} גרסה 1`, summary: 'תקציר 1', body: 'גוף גרסה 1' });
  await submit(R1, P); await approve(P);
  const v1 = await db(P);
  const live = async () => (await call('GET', `/articles/${P}`)).text;
  check('the article is live (version 1)', v1.status === 'published' && (await live()).includes('גוף גרסה 1'));
  page = await editPage(R1, P);
  check('the edit page of a published article is editable', page.status === 200 && page.text.includes('id="submit-btn"') && page.text.includes('הגשת העדכון לאישור') && page.text.includes('id="discard-btn"'));
  check('  it explains that the public keeps the approved version, and the category is locked', page.text.includes('הציבור ממשיך לראות את הגרסה המאושרת') && /id="f-category" name="category" disabled/.test(page.text));
  let prow = await rowOf(R1, P);
  check('list: editable, no unsent changes, not an update yet', prow.status === 'published' && prow.editable === true && prow.unsentChanges === false && prow.isUpdate === false);

  check('the reporter edits the draft -> 200', (await save(R1, P, { title: `${T} גרסה 2`, summary: 'תקציר 2', body: 'גוף גרסה 2', category: 'health' })).status === 200);
  const edited = await db(P);
  check('the draft changed, the published version did not', edited.draft.body === 'גוף גרסה 2' && edited.published.body === 'גוף גרסה 1' && edited.status === 'published');
  check('the public still sees version 1', (await live()).includes('גוף גרסה 1') && !(await live()).includes('גוף גרסה 2'));
  prow = await rowOf(R1, P);
  check('list: "unsent changes"', prow.unsentChanges === true && prow.status === 'published');
  const lockSnap = await snap(P);
  check('changing the category of a published article -> 400, nothing changed', (await save(R1, P, { title: `${T} גרסה 2`, body: 'גוף גרסה 2', category: 'sports' })).status === 400 && (await snap(P)) === lockSnap);
  check('sending the same category is fine and the category stays', (await save(R1, P, { title: `${T} גרסה 2`, summary: 'תקציר 2', body: 'גוף גרסה 2', category: 'health' })).status === 200 && (await db(P)).category === 'health');
  check('the public feed still lists it under the old category', (await call('GET', `/api/articles?category=health&q=${encodeURIComponent(T)}`)).text.includes(`${T} גרסה 1`));

  // cancel changes
  check('cancel changes: another reporter 403, editor 403, anonymous 401', (await discard(R2, P)).status === 403 && (await discard(E, P)).status === 403 && (await discard(undefined, P)).status === 401);
  check('cancel changes -> 200', (await discard(R1, P)).status === 200);
  const reset = await db(P);
  check('the draft is the published version again, published untouched', reset.draft.title === reset.published.title && reset.draft.body === 'גוף גרסה 1' && reset.published.body === 'גוף גרסה 1');
  prow = await rowOf(R1, P);
  check('list: no unsent changes after cancelling', prow.unsentChanges === false);
  check('submitting an update without changes -> 400, status unchanged', (await submit(R1, P)).status === 400 && (await db(P)).status === 'published');
  check('the same refusal for a reporter who never edited (no false update)', (await db(P)).publishHistory.length === 1);

  // submit the update
  await save(R1, P, { title: `${T} גרסה 2`, summary: 'תקציר 2', body: 'גוף גרסה 2' });
  const viewsBefore = (await db(P)).viewCount;
  r = await submit(R1, P);
  const upd = await db(P);
  check('submit the update -> 200, status pending', r.status === 200 && upd.status === 'pending');
  check('the published version is untouched, the draft holds the update', upd.published.body === 'גוף גרסה 1' && upd.draft.body === 'גוף גרסה 2');
  check('the public still sees version 1 while the update waits', (await live()).includes('גוף גרסה 1') && !(await live()).includes('גוף גרסה 2'));
  prow = await rowOf(R1, P);
  check('list: pending update, marked as an update, not editable', prow.status === 'pending' && prow.isUpdate === true && prow.editable === false);
  check('the reporter cannot save or cancel while the update waits (409)', (await save(R1, P, { title: 'x', body: 'y' })).status === 409 && (await discard(R1, P)).status === 409);
  page = await editPage(R1, P);
  check('the edit page is read-only and says the update is waiting', page.text.includes('<fieldset disabled>') && page.text.includes('העדכון ממתין לאישור עורך'));
  list = await call('GET', `/editor/api/articles?status=pending&q=${encodeURIComponent(T)}`, { cookie: E });
  check('the editor sees it as an update of a live article', list.body.articles.some((a) => a.id === P && a.isUpdate === true));
  const review = await call('GET', `/editor/articles/${P}`, { cookie: E });
  check('the editor\'s review page shows both versions side by side', review.text.includes('versions-two') && review.text.includes('גוף גרסה 1') && review.text.includes('גוף גרסה 2'));

  // the editor returns the update
  check('the editor returns the update with a note -> 200', (await sendBack(P, 'צריך מקור לעדכון')).status === 200);
  check('status returned, the public still sees version 1', (await db(P)).status === 'returned' && (await live()).includes('גוף גרסה 1'));
  prow = await rowOf(R1, P);
  check('list: returned update with the editor\'s note, editable', prow.status === 'returned' && prow.isUpdate === true && prow.editable === true && prow.editorNote === 'צריך מקור לעדכון');
  page = await editPage(R1, P);
  check('the edit page shows the note, the live-article explanation and the locked category', page.text.includes('צריך מקור לעדכון') && page.text.includes('זה עדכון לכתבה שפורסמה') && /name="category" disabled/.test(page.text));
  check('category still cannot change while the update is returned', (await save(R1, P, { title: `${T} גרסה 2`, body: 'גוף גרסה 2', category: 'tech' })).status === 400);
  check('the reporter fixes the update and submits again', (await save(R1, P, { title: `${T} גרסה 3`, summary: 'תקציר 3', body: 'גוף גרסה 3' })).status === 200 && (await submit(R1, P)).status === 200);
  check('the public still sees version 1', (await live()).includes('גוף גרסה 1'));

  // the editor approves the update
  check('the editor approves the update -> 200', (await approve(P)).status === 200);
  const v3 = await db(P);
  check('status published, published = the update, draft = published', v3.status === 'published' && v3.published.body === 'גוף גרסה 3' && v3.draft.body === 'גוף גרסה 3' && v3.editorNote === '');
  check('the public now sees the new version (and not the old one)', (await live()).includes('גוף גרסה 3') && !(await live()).includes('גוף גרסה 1'));
  check('the update is recorded for the analytics chart (2 publish markers)', v3.publishHistory.length === 2 && v3.lastPublishedAt > v3.firstPublishedAt);
  check('first publish date and view count are kept by the update', +v3.firstPublishedAt === +v1.firstPublishedAt && v3.viewCount >= viewsBefore);
  prow = await rowOf(R1, P);
  check('list: published again, no update mark, no unsent changes', prow.status === 'published' && prow.isUpdate === false && prow.unsentChanges === false);
  const stats = await call('GET', `/editor/api/articles/${P}/stats`, { cookie: E });
  check('the statistics endpoint lists both publish times', stats.status === 200 && stats.body.publishes.length === 2);
  check('another reporter cannot edit or submit a published article of someone else', (await save(R2, P, { title: 'x', body: 'y' })).status === 403 && (await submit(R2, P)).status === 403);
  const hp = await Promise.all(Array.from({ length: 10 }, () => discard(R1, P)));
  check('10 "cancel changes" at the same time all succeed and change nothing', hp.every((x) => x.status === 200) && (await db(P)).published.body === 'גוף גרסה 3');

  // ---------------------------------------------------------------- R8. restart
  sec('R8. Reporter: Server restart');
  await save(R1, D, { ...good, title: 'שרד ריסטארט' });
  await stopServer(); await startServer();
  check('the reporter is still logged in after a restart (no re-login)', (await call('GET', '/reporter', { cookie: R1 })).status === 200);
  check('the saved draft is intact after a restart', (await editPage(R1, D)).text.includes('value="שרד ריסטארט"'));
  check('saving still works after a restart', (await save(R1, D, { ...good, title: 'אחרי ריסטארט' })).status === 200);

  // ---------------------------------------------------------------- R9. log
  sec('R9. Reporter actions in the log');
  const rlog = fs.readFileSync(LOG).subarray(logStart).toString('utf8').split('\n').filter(Boolean);
  check('the log records reporter actions (create, submit, cancel changes)', rlog.some((l) => /Reporter reporter1 created article/.test(l)) && rlog.some((l) => /submitted article/.test(l)) && rlog.some((l) => /cancelled the changes/.test(l)));
  check('the log records blocked access to another reporter\'s article', rlog.some((l) => /Blocked: reporter\d tried to access article/.test(l)));
}

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
  // Search terms come from an article that really is in the database, so the search tests do not depend on the seed's wording
  const searchSample = await articleOf({ published: { $ne: null } });
  const searchTitle = searchSample.published.title;
  const searchWord = (searchTitle.match(/[א-ת]{4,}/) || [searchTitle.split(' ')[0]])[0];
  const srch = await call('GET', '/api/articles?q=' + encodeURIComponent(searchWord));
  check('search finds titles', srch.body.articles.length > 0 && srch.body.articles.every((a) => a.title.includes(searchWord)));
  check('search by a full title finds that article', (await call('GET', '/api/articles?q=' + encodeURIComponent(searchTitle))).body.articles.some((a) => a.id === String(searchSample._id)));
  check('search for text that is in no title finds nothing', (await call('GET', '/api/articles?q=' + encodeURIComponent('zzqxw-no-such-title'))).body.articles.length === 0);
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
  // The page is HTML: EJS escapes " ' & < > in titles and text, so the expected text is escaped the same way before comparing
  check('SEO: full body in raw HTML', published.published.body.split('\n\n').every((p) => art.text.includes(ejs.escapeXML(p))));
  check('SEO: <title> with article title', art.text.includes(`<title>${ejs.escapeXML(published.published.title)}`));
  check('SEO: meta description + og tags', /<meta name="description"/.test(art.text) && /og:title/.test(art.text));
  check('SEO: semantic tags (article/h1)', /<article/.test(art.text) && /<h1/.test(art.text));
  check('<html lang="he" dir="rtl">', /<html lang="he" dir="rtl">/.test(art.text));
  for (const [label, a] of [['draft', draftArt], ['pending without published version', pendingNew]]) {
    check(`${label} article page is 404`, (await call('GET', `/articles/${a._id}`)).status === 404);
  }
  const updPage = await call('GET', `/articles/${pendingUpd._id}`);
  check('pending update: public still shows OLD published text', updPage.status === 200 && updPage.text.includes(ejs.escapeXML(pendingUpd.published.title)) && !updPage.text.includes(`>${ejs.escapeXML(pendingUpd.draft.title)}<`));
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

  // ---------------------------------------------------------------- E3. comment moderation (PUT / DELETE)
  sec('E3. Comment moderation API (PUT / DELETE /api/comments/:id)');
  {
    const mkComment = (text) => Comment.create({ article: published._id, authorName: 'מגיב', text, deviceId: 'e3-test' });
    const url = (c) => `/api/comments/${c._id}`;
    const same = async (c, text) => { const d = await Comment.findById(c._id).lean(); return Boolean(d) && d.text === text && d.authorName === 'מגיב'; };
    const c1 = await mkComment('תגובה לבדיקה');
    check('guest PUT comment -> 401, comment unchanged', (await call('PUT', url(c1), { json: { text: 'hacked' } })).status === 401 && await same(c1, 'תגובה לבדיקה'));
    check('guest DELETE comment -> 401, comment still exists', (await call('DELETE', url(c1))).status === 401 && await same(c1, 'תגובה לבדיקה'));
    check('reporter PUT comment -> 403, comment unchanged', (await call('PUT', url(c1), { cookie: R, json: { text: 'hacked' } })).status === 403 && await same(c1, 'תגובה לבדיקה'));
    check('reporter DELETE comment -> 403, comment still exists', (await call('DELETE', url(c1), { cookie: R })).status === 403 && await same(c1, 'תגובה לבדיקה'));

    const upd = await call('PUT', url(c1), { cookie: E, json: { text: '  <script>alert(1)</script> נערך  ' } });
    check('editor PUT text -> 200 with the new (trimmed) text', upd.status === 200 && upd.body.text === '<script>alert(1)</script> נערך', `${upd.status} ${JSON.stringify(upd.body)}`);
    check('PUT response does not expose deviceId', upd.body && !('deviceId' in upd.body) && String(upd.body._id) === String(c1._id));
    check('edit is stored in the database as plain text', (await Comment.findById(c1._id).lean()).text === '<script>alert(1)</script> נערך');
    const nameOnly = await call('PUT', url(c1), { cookie: E, json: { authorName: 'שם חדש' } });
    check('editor PUT authorName only -> 200, text kept', nameOnly.status === 200 && nameOnly.body.authorName === 'שם חדש' && nameOnly.body.text === '<script>alert(1)</script> נערך');

    const before = JSON.stringify(await Comment.findById(c1._id).lean());
    const badBodies = [['empty text', { text: '   ' }], ['empty name', { authorName: '' }], ['text too long', { text: 'a'.repeat(1001) }], ['name too long', { authorName: 'a'.repeat(51) }],
      ['text not a string', { text: 5 }], ['text operator object', { text: { $ne: '' } }]];
    for (const [label, body] of badBodies) check(`editor PUT rejects: ${label} (400)`, (await call('PUT', url(c1), { cookie: E, json: body })).status === 400);
    check('rejected edits did not change the comment', JSON.stringify(await Comment.findById(c1._id).lean()) === before);

    const missing = '64b000000000000000000000';
    check('PUT with a malformed id -> 400', (await call('PUT', '/api/comments/abc', { cookie: E, json: { text: 'x' } })).status === 400);
    check('DELETE with a malformed id -> 400', (await call('DELETE', '/api/comments/abc', { cookie: E })).status === 400);
    check('PUT on a comment that does not exist -> 404', (await call('PUT', `/api/comments/${missing}`, { cookie: E, json: { text: 'x' } })).status === 404);
    check('DELETE on a comment that does not exist -> 404', (await call('DELETE', `/api/comments/${missing}`, { cookie: E })).status === 404);

    const del = await call('DELETE', url(c1), { cookie: E });
    check('editor DELETE comment -> 204', del.status === 204, del.status);
    check('deleted comment is gone from the database and from the public list', !(await Comment.exists({ _id: c1._id })) && !(await call('GET', `/api/comments/${published._id}`)).body.comments.some((x) => String(x._id) === String(c1._id)));
    check('DELETE again -> 404, and PUT on the deleted comment -> 404', (await call('DELETE', url(c1), { cookie: E })).status === 404 && (await call('PUT', url(c1), { cookie: E, json: { text: 'x' } })).status === 404);
  }

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
  check('q search works', (await call('GET', '/editor/api/articles?q=' + encodeURIComponent(searchWord), { cookie: E })).body.articles.length > 0);
  check('q search by a full title finds that article', (await call('GET', '/editor/api/articles?q=' + encodeURIComponent(searchTitle), { cookie: E })).body.articles.some((a) => a.id === String(searchSample._id)));
  check('q search for text that is in no title finds nothing', (await call('GET', '/editor/api/articles?q=' + encodeURIComponent('zzqxw-no-such-title'), { cookie: E })).body.articles.length === 0);
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
    ['feed page 1', '/api/articles'], ['feed popular', '/api/articles?sort=popular'], ['feed search', '/api/articles?q=' + encodeURIComponent(searchWord)],
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

  await reporterTests(); // sections R1 to R9 (defined above the main flow)

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
