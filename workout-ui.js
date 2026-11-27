/* AI Life Navi 筋トレコーチ：画面・保存・AI連携 v23
 * 画面：ホーム（今日のトレーニング）／筋トレ（セット単位の実行）／履歴（検索・分析・グラフ）／AIコーチ（会話・変更提案）／設定（本人の管理条件）
 * 依存：index.html の recs/setRecs/sets/writeSettings/storageKey/cloudClient/cloudUser/MEAL_ANALYSIS_API/fetchWithTimeout/
 *       ensureAiConsent/aiConsentRecord/appNowIso/today/readDraft/draftKey/removeDeletedRecord/syncNow/update/show/openRecordMode
 */
(function () {
  'use strict';
  const E = window.WorkoutEngine, Seed = window.HistorySeed || { CONFIRMED_SESSIONS: [] };
  const $ = id => document.getElementById(id);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readSettings = () => sets();
  const TIMEOUT = { plan: 60000, chat: 60000, review: 45000 };
  const ui = { store: '', part: '', minutes: 0, fatigue: null, pain: '', plan: null, aiState: {}, chat: [], proposal: null, finishing: false, saving: false, result: null,
    hist: { store: '', part: '', q: '', period: '90', open: '' }, graphEx: '', queuedKey: '', autoOpened: false, renderedFor: '' };
  let tick = null, mirrorTimer = null;

  /* ---------- 保存領域 ---------- */
  function isOwner(s = readSettings()) { return Math.abs((+s.startWeight || 0) - 127.4) < 0.05 || /慎/.test(String(s.displayName || '')); }
  function coach(s = readSettings()) {
    const c = s.workoutCoach && typeof s.workoutCoach === 'object' ? s.workoutCoach : {};
    const owner = isOwner(s);
    const profile = c.profile ? E.profileNormalized(c.profile) : owner ? E.profileNormalized(null) : { ...E.profileNormalized(null), age: null, heightCm: null, startWeight: +s.startWeight || null, goalWeight: +s.goalWeight || null, injuries: [], excluded: [], cautions: [] };
    return { prefs: E.prefsNormalized(c.prefs), profile, ratings: Array.isArray(c.ratings) ? c.ratings : owner ? E.DEFAULT_RATINGS.slice() : [], plans: c.plans && typeof c.plans === 'object' ? c.plans : {},
      active: c.active || null, activeClearedAt: c.activeClearedAt || '', lastStore: c.lastStore || '', updatedAt: c.updatedAt || '', imports: Array.isArray(c.imports) ? c.imports : [], brief: String(c.brief || ''), finishedIds: Array.isArray(c.finishedIds) ? c.finishedIds : [], today: c.today || null };
  }
  function writeCoach(mutator) {
    const s = readSettings(), c = coach(s);
    mutator(c);
    c.updatedAt = appNowIso();
    writeSettings({ ...s, workoutCoach: c, updatedAt: appNowIso() });
    return c;
  }
  const activeKey = () => storageKey('WorkoutActive');
  function readActive() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(activeKey()) || 'null'); } catch (e) { local = null; }
    const c = coach(), cloud = c.active, t = x => Date.parse(x && x.updatedAt || '') || 0;
    if (local && c.activeClearedAt && Date.parse(c.activeClearedAt) >= t(local)) { localStorage.removeItem(activeKey()); local = null; }
    if (local && c.finishedIds.includes(local.id)) { localStorage.removeItem(activeKey()); local = null; }
    const chosen = t(cloud) > t(local) ? cloud : local;
    return chosen && chosen.status === 'active' && !c.finishedIds.includes(chosen.id) ? chosen : null;
  }
  function saveActive(session, mirrorNow = false) {
    session.updatedAt = appNowIso();
    localStorage.setItem(activeKey(), JSON.stringify(session)); // 操作ごとに端末へ即時保存
    clearTimeout(mirrorTimer);
    const mirror = () => writeCoach(c => { c.active = JSON.parse(localStorage.getItem(activeKey()) || 'null'); });
    if (mirrorNow) mirror(); else mirrorTimer = setTimeout(mirror, 4000); // クラウドへは非同期で間引いて同期
    renderSaveState(session);
  }
  function clearActive(finishedId) {
    clearTimeout(mirrorTimer);
    localStorage.removeItem(activeKey());
    writeCoach(c => { c.active = null; c.activeClearedAt = appNowIso(); if (finishedId) c.finishedIds = [...c.finishedIds, finishedId].slice(-200); });
    if (typeof syncNow === 'function' && cloudUser && navigator.onLine !== false) setTimeout(() => syncNow(true), 0);
  }
  function analysis() { const c = coach(); return E.analyze(recs(), today(), { ...c.prefs, imports: c.imports }); }
  const planKey = (store, part) => `${store}:${part}`;

  /* ---------- メニューの準備（保存済み→即時、なければ前回実績から即時作成し、AIは裏で） ---------- */
  function defaults() {
    const c = coach(), a = analysis();
    const store = E.normalizeStore(ui.store || (c.today && c.today.date === today() && c.today.store) || c.lastStore) || 'honten';
    // 部位は本人が選ぶ（今日選んだ部位は日付つきで保存し、日付が変わったら未選択に戻す）
    const t = c.today && c.today.date === today() ? c.today : null;
    const part = E.PARTS[ui.part] ? ui.part : t && E.PARTS[t.part] ? t.part : '';
    const minutes = ui.minutes || c.prefs.defaultMinutes || 60;
    return { c, a, store, part, minutes };
  }
  function validCached(c, a, store, part) {
    const p = c.plans[planKey(store, part)];
    if (!p || p.version !== 2 || p.engineVersion !== E.ENGINE_VERSION || !Array.isArray(p.exercises) || !p.exercises.length) return null; // 古い版で作ったメニューは使わない
    if (Date.now() - Date.parse(p.createdAt || 0) > 3 * 86400000) return null; // 3日より前に作ったメニューは作り直す
    // 参照した履歴のバージョンが今と違う（その後に筋トレした）メニューは古いので使わない
    if (p.basedOnSessions !== a.totalSessions || (p.basedOnLastDate || null) !== (a.lastSession ? a.lastSession.date : null)) return null;
    return p;
  }
  function localPlan(d) { return E.planSession({ store: d.store, part: d.part, minutes: d.minutes, analysis: d.a, prefs: d.c.prefs, profile: d.c.profile, ratings: d.c.ratings, today: today(), fatigue: ui.fatigue, pain: ui.pain }); }
  function resolvePlan() {
    const d = defaults();
    ui.store = d.store; ui.part = d.part; ui.minutes = d.minutes;
    const dayInput = (ui.fatigue && ui.fatigue >= 4) || ui.pain.trim();
    const cached = !dayInput && validCached(d.c, d.a, d.store, d.part);
    if (!d.part) { ui.plan = null; ui.planKey = ''; return null; }
    ui.plan = cached ? E.fitPlanToTime(cached, d.minutes, d.a, { prefs: d.c.prefs, profile: d.c.profile, ratings: d.c.ratings }) : localPlan(d); // 時間に合わせて種目を増減（セットの水増しはしない）
    const key = planKey(ui.plan.store, ui.plan.part) + ':' + (dayInput ? 'day' : 'base');
    if (ui.queuedKey && ui.queuedKey !== key) { clearTimeout(resolvePlan.t); if (ui.aiState[ui.queuedKey] && ui.aiState[ui.queuedKey].state === 'queued') delete ui.aiState[ui.queuedKey]; ui.queuedKey = ''; }
    if (ui.plan.source === 'local') {
      if (!canAutoAi()) { if (!ui.aiState[key]) ui.aiState[key] = { state: cloudUser ? 'consent' : 'login' }; }
      else if (!ui.aiState[key]) {
        ui.aiState[key] = { state: 'queued' }; ui.queuedKey = key;
        resolvePlan.t = setTimeout(() => { ui.queuedKey = ''; if (ui.aiState[key] && ui.aiState[key].state === 'queued') delete ui.aiState[key]; const cur = ui.plan; if (cur && cur.source === 'local' && planKey(cur.store, cur.part) === planKey(d.store, d.part)) aiPlan(false, cur, key); }, 1000);
      }
    }
    ui.planKey = key;
    return ui.plan;
  }

  /* ---------- AI通信（タイムアウト付き・無期限待機なし） ---------- */
  async function aiPost(payload, timeoutMs) {
    if (!cloudClient || !cloudUser) throw new Error('AIの利用にはログインが必要です');
    if (navigator.onLine === false) throw new Error('オフラインです');
    const { data, error } = await cloudClient.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('ログイン状態を確認できません');
    const started = Date.now();
    const response = await fetchWithTimeout(MEAL_ANALYSIS_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.session.access_token}` }, body: JSON.stringify(payload) }, timeoutMs);
    const body = await response.json().catch(() => ({}));
    body._ms = Date.now() - started;
    if (!response.ok) throw new Error(body.error || `AI通信エラー（${response.status}）`);
    return body;
  }
  function canAutoAi() { return !!(cloudClient && cloudUser && typeof aiConsentRecord === 'function' && aiConsentRecord() && navigator.onLine !== false); }
  function contextFor(store, part) { const c = coach(), a = analysis(); return E.aiContext(a, store, part, c.prefs, c.profile, c.ratings); }
  async function aiPlan(userInitiated, target, key) {
    key = key || ui.planKey;
    if (!target || (ui.aiState[key] && ui.aiState[key].state === 'loading')) return;
    if (!userInitiated && ui.aiState[key] && ['done', 'error'].includes(ui.aiState[key].state)) return;
    if (userInitiated && !ensureAiConsent()) return;
    ui.aiState[key] = { state: 'loading', startedAt: Date.now() };
    renderStatus();
    const st = setInterval(() => { if (!ui.aiState[key] || ui.aiState[key].state !== 'loading') { clearInterval(st); return; } renderStatus(); }, 1000);
    const c = coach(), a = analysis(), s = readSettings();
    try {
      const body = await aiPost({ kind: 'workout_plan', store: target.store, part: target.part, minutes: target.minutes, fatigue: ui.fatigue, pain: ui.pain, healthNotes: s.healthNotes || '', brief: c.brief,
        context: E.aiContext(a, target.store, target.part, c.prefs, c.profile, c.ratings), baseline: target.exercises.map(e => ({ name: e.name, sets: e.sets, restSec: e.restSec, reason: e.reason })) }, TIMEOUT.plan);
      const plan = E.validatePlan(body, target, a, c.prefs, c.profile, c.ratings);
      if (!plan) throw new Error('AIの出力を検証できなかったため、前回実績からのメニューを使います');
      plan.aiModel = body.model || ''; plan.aiMs = body._ms; plan.basedOnSessions = a.totalSessions; plan.basedOnLastDate = a.lastSession ? a.lastSession.date : null; plan.minutes = target.minutes;
      if (key.endsWith(':base')) writeCoach(cc => { cc.plans[planKey(plan.store, plan.part)] = plan; });
      ui.aiState[key] = { state: 'done', ms: body._ms };
      if (!readActive() && ui.plan && planKey(ui.plan.store, ui.plan.part) === planKey(plan.store, plan.part)) { ui.plan = plan; renderAll(); } else renderStatus();
    } catch (error) {
      ui.aiState[key] = { state: 'error', message: error.message || 'AIの作成に失敗しました' };
      renderStatus();
    }
  }
  // 終了後：次回メニューを事前生成（次の部位×両店舗、今回の部位×両店舗）。プログラム版を即保存し、AIは次の部位だけ順に作成
  async function pregenerate(doneStore, donePart) {
    const c = coach(), a = analysis(), nextPart = E.recommendPart(a, c.profile, today());
    const targets = [[nextPart, 'honten'], [nextPart, 'shioda'], [donePart, 'honten'], [donePart, 'shioda']].filter((t, i, arr) => arr.findIndex(x => x[0] === t[0] && x[1] === t[1]) === i);
    const minutes = c.prefs.defaultMinutes || 60;
    writeCoach(cc => { targets.forEach(([part, store]) => { const p = E.planSession({ store, part, minutes, analysis: a, prefs: c.prefs, profile: c.profile, ratings: c.ratings, today: today() }); cc.plans[planKey(store, part)] = p; }); cc.lastStore = doneStore; });
    if (!canAutoAi()) return;
    for (const store of [doneStore, doneStore === 'honten' ? 'shioda' : 'honten']) {
      const base = coach().plans[planKey(store, nextPart)];
      if (base) await aiPlan(false, base, planKey(store, nextPart) + ':base').catch(() => {});
    }
  }

  /* ---------- セッション ---------- */
  function startSession() {
    if (ui.starting) return; ui.starting = true; setTimeout(() => { ui.starting = false; }, 1500); // 連打防止
    if (readActive()) return;
    const plan = ui.plan || resolvePlan();
    if (!plan.exercises.length) { toast('種目がありません。種目を追加してください。'); return; }
    const session = E.newSession(plan, today(), appNowIso(), { fatigue: ui.fatigue, pain: ui.pain });
    saveActive(session, true);
    writeCoach(c => { c.lastStore = plan.store; c.active = session; });
    ui.result = null; ui.finishing = false; ui.editMode = false;
    renderAll(false); // 同じ画面のまま、完了チェックが使える状態にする
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function mutate(fn, rerender = false) {
    const s = readActive(); if (!s) return null;
    fn(s); saveActive(s);
    if (rerender) renderAll(true); else renderProgress(s);
    return s;
  }
  const blankSet = (live, type, weight, reps) => live ? { id: Math.random().toString(36).slice(2), type, plannedWeight: null, plannedReps: null, weight, reps, done: false, doneAt: null, rir: null, memo: '', side: '' } : { type, weight, reps };
  function savePlanEdit() {
    const a = analysis(), p = ui.plan; if (!p) return;
    p.edited = true; p.basedOnSessions = a.totalSessions; p.basedOnLastDate = a.lastSession ? a.lastSession.date : null;
    clearTimeout(savePlanEdit.t); savePlanEdit.t = setTimeout(() => writeCoach(c => { c.plans[planKey(p.store, p.part)] = JSON.parse(JSON.stringify(p)); }), 800);
  }
  // 開始前は計画を、開始後は実施中セッションを同じ操作で編集する
  function edit(fn, rerender = true) {
    const active = readActive();
    if (active) return mutate(s => fn(s, true), rerender);
    if (!ui.plan) return null;
    fn(ui.plan, false); savePlanEdit();
    if (rerender) renderAll(true);
    return ui.plan;
  }
  function persistFinished(session) {
    const all = recs(), existing = all.find(r => r.date === session.date) || { date: session.date };
    if ((existing.workoutSessions || []).some(x => x.id === session.id && x.status === 'finished')) return false; // 二重保存防止
    const sessions = (Array.isArray(existing.workoutSessions) ? existing.workoutSessions : []).filter(x => x.id !== session.id).concat([session]);
    const finished = sessions.filter(x => x.status === 'finished').map(x => E.sessionRecordFields(x));
    const fields = finished.length > 1 ? { ...finished[finished.length - 1], workoutMinutes: finished.reduce((a, f) => a + f.workoutMinutes, 0), workoutExercises: finished.flatMap(f => f.workoutExercises), strength: finished.map(f => f.strength).join('\n') } : finished[0];
    fields.workoutExercisesJson = JSON.stringify(fields.workoutExercises);
    const kcal = session.summary && session.summary.calories ? session.summary.calories.extra : 0;
    const record = { ...existing, ...fields, restDay: false, workoutSessions: sessions, workoutPlan: E.planText({ summary: `${E.storeLabel(session.store)}・${E.PARTS[session.part] || ''}`, exercises: session.exercises.map(e => ({ name: e.name, restSec: e.restSec, sets: e.sets.map(s => ({ type: s.type, weight: s.plannedWeight, reps: s.plannedReps })) })) }),
      strengthCalories: kcal, strengthCalorieSource: 'estimated', exerciseTotal: (+existing.cardioCalories || 0) + (+existing.accessoryCalories || 0) + kcal, updatedAt: appNowIso() };
    if (session.fatigue) record.fatigue = session.fatigue;
    delete record.completedSets; delete record.plannedSets;
    const rest = all.filter(r => r.date !== session.date); rest.push(record); rest.sort((x, y) => x.date.localeCompare(y.date));
    removeDeletedRecord(session.date); setRecs(rest);
    const draft = readDraft(session.date);
    if (draft) { ['workoutPlace', 'workoutPart', 'workoutMinutes', 'workoutCompletion', 'workoutFeedback', 'workoutExercises', 'workoutExercisesJson', 'strength', 'strengthIntensity', 'workoutPlan'].forEach(k => { draft.record[k] = record[k]; }); draft.record.restDay = false; localStorage.setItem(draftKey(session.date), JSON.stringify(draft)); }
    return true;
  }
  async function finishSession(mode) {
    const s = readActive(); if (!s) return;
    if (mode === 'discard') { if (!confirm('この筋トレを記録せずに破棄しますか？')) return; clearActive(); ui.finishing = false; renderAll(); return; }
    if (ui.saving) return; ui.saving = true; // 終了ボタンの連打防止
    try {
      const before = analysis(), body = before.body ? before.body.weight : (coach().profile.startWeight || null);
      s.finishedAt = appNowIso(); s.status = 'finished';
      s.fatigue = ui.finishFatigue ?? s.fatigue; s.pain = ($('lvPain') || {}).value ?? s.pain; s.feedback = { ...(s.feedback || {}), note: ($('lvNote') || {}).value || '' };
      s.summary = E.summarizeSession(s, body);
      s.comparison = E.compareSession(s, before);
      if (!s.summary.totalSets && !confirm('完了したセットがありません。中止として記録しますか？')) { s.status = 'active'; s.finishedAt = null; return; }
      persistFinished(s);
      clearActive(s.id);
      stopRest();
      ui.finishing = false; ui.part = ''; ui.plan = null; ui.fatigue = null; ui.pain = '';
      ui.result = { session: s, review: E.localReview(s.summary, s.comparison), reviewSource: 'local', nextTargets: null };
      if (typeof update === 'function') update();
      renderAll();
      window.scrollTo({ top: 0, behavior: 'auto' });
      pregenerate(s.store, s.part);
      if (canAutoAi()) {
        aiPost({ kind: 'workout_review', summary: s.summary, comparison: s.comparison, session: s.exercises.map(e => ({ name: e.name, sets: e.sets.filter(x => x.done).map(x => `${x.type === 'warmup' ? '準' : '本'}${x.weight ?? '自重'}×${x.reps}`) })), context: contextFor(s.store, s.part), brief: coach().brief }, TIMEOUT.review)
          .then(body => { if (ui.result && ui.result.session.id === s.id) { ui.result.review = String(body.evaluation || ui.result.review); ui.result.reviewSource = 'ai'; ui.result.nextTargets = Array.isArray(body.nextTargets) ? body.nextTargets : null; renderAll(); } })
          .catch(() => {});
      }
    } finally { ui.saving = false; }
  }

  /* ---------- レストタイマー（実時刻で計算） ---------- */
  const restKey = () => storageKey('WorkoutRest');
  function readRest() { try { return JSON.parse(localStorage.getItem(restKey()) || 'null'); } catch (e) { return null; } }
  function startRest(sec) { if (coach().profile.restTimer === false) return; localStorage.setItem(restKey(), JSON.stringify({ endAt: Date.now() + sec * 1000, total: sec, pausedLeft: null })); renderRest(); }
  function stopRest() { localStorage.removeItem(restKey()); renderRest(); }
  function restLeft(r) { if (!r) return 0; return r.pausedLeft !== null && r.pausedLeft !== undefined ? r.pausedLeft : Math.max(0, Math.ceil((r.endAt - Date.now()) / 1000)); }
  function renderRest() {
    const el = $('lvRest'); if (!el) return;
    const r = readRest(), left = restLeft(r);
    if (!r || left <= 0) { el.innerHTML = ''; el.classList.remove('on'); if (r && left <= 0 && r.pausedLeft == null) { localStorage.removeItem(restKey()); try { navigator.vibrate && navigator.vibrate(200); } catch (e) {} } return; }
    el.classList.add('on');
    el.innerHTML = `<span class="lv-rest-time">休憩 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span><button type="button" data-act="restpause">${r.pausedLeft != null ? '再開' : '一時停止'}</button><button type="button" data-act="restplus">+30秒</button><button type="button" data-act="restskip">スキップ</button>`;
  }

  /* ---------- 描画共通 ---------- */
  function toast(msg) { const el = $('lvToast'); if (!el) return; el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000); }
  const fmtTime = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const md = date => { const [, m, d] = String(date).split('-'); return `${+m}月${+d}日`; };
  const wLabel = (w, equip) => w === null || w === undefined || w === '' ? (equip === 'bodyweight' ? '自重' : '未定') : `${w}`;
  function sourceBadge(p) {
    if (!p) return '';
    if (p.source === 'ai') return '<span class="lv-badge ai">AIコーチ作成</span>';
    if (p.source === 'chat') return '<span class="lv-badge ai">相談で変更</span>';
    if (p.source === 'import') return '<span class="lv-badge ai">取り込み</span>';
    return '<span class="lv-badge">前回実績から作成</span>';
  }
  function statusText() {
    const st = ui.aiState[ui.planKey] || {};
    if (!ui.plan || ui.plan.source !== 'local') return '';
    if (st.state === 'queued') return 'AIコーチが調整します（このまま開始できます）';
    if (st.state === 'loading') return `AIコーチが調整中…${Math.round((Date.now() - st.startedAt) / 1000)}秒（最大60秒・このまま開始できます）`;
    if (st.state === 'error') return `AIに接続できませんでした：${h(st.message)} <button type="button" class="lv-link" data-act="airetry">再試行</button>`;
    if (st.state === 'consent') return '<button type="button" class="lv-link" data-act="airetry">AIコーチに調整してもらう</button>';
    if (st.state === 'login') return '設定からログインするとAIコーチが調整します';
    return '';
  }
  function renderStatus() { document.querySelectorAll('[data-lv-status]').forEach(el => { el.innerHTML = statusText(); }); }
  function signature() { let id = ''; try { id = activeStorageId; } catch (e) {} return `${id}|${recs().length}|${coach().updatedAt}`; }
  function keepInputs(fn) {
    const ids = ['lvPainInput', 'lvChatInput', 'lvPain', 'lvNote', 'lvAddName', 'lvHistQ'];
    const kept = ids.map(id => [id, $(id) && $(id).value, document.activeElement && document.activeElement.id === id]).filter(([, v]) => v);
    const y = window.scrollY; fn();
    kept.forEach(([id, v, f]) => { const el = $(id); if (el) { el.value = v; if (f) el.focus(); } });
    window.scrollTo(0, y);
  }
  function renderAll(keepScroll) {
    ui.renderedFor = signature();
    const go = () => { renderHome(); renderTrain(); if ($('history') && $('history').classList.contains('active')) renderHistory(); if ($('aicoach') && $('aicoach').classList.contains('active')) renderCoach(); };
    if (keepScroll !== false) keepInputs(go); else go();
  }

  /* ---------- ホーム（今日の部位と前回情報） ---------- */
  function selectorsHtml() {
    return `<div class="lv-card"><div class="lv-seg" role="group" aria-label="店舗">${Object.values(E.STORES).map(s => `<button type="button" class="${s.id === ui.store ? 'on' : ''}" data-act="store" data-v="${s.id}" aria-pressed="${s.id === ui.store}">${s.label}</button>`).join('')}</div>
      <div class="lv-row-label">部位</div><div class="lv-chips five">${Object.entries(E.PARTS).map(([k, v]) => `<button type="button" class="${k === ui.part ? 'on' : ''}" data-act="part" data-v="${k}" aria-pressed="${k === ui.part}">${v}</button>`).join('')}</div>
      <div class="lv-row-label">予定時間</div><div class="lv-chips four">${[45, 60, 75, 90].map(m => `<button type="button" class="${m === ui.minutes ? 'on' : ''}" data-act="minutes" data-v="${m}">${m}分</button>`).join('')}</div>
      <div class="lv-row-label">疲労度</div><div class="lv-chips five">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n === ui.fatigue ? 'on' : ''}" data-act="fatigue" data-v="${n}">${n}</button>`).join('')}</div>
      <div class="lv-row-label">痛み・体調（任意）</div><input id="lvPainInput" placeholder="例：右肩2/10、寝不足" value="${h(ui.pain)}"></div>`;
  }
  function renderHome() {
    const box = $('trainHomeCard'); if (!box || !E) return;
    const active = readActive();
    if (active) { box.innerHTML = `<div class="lv-eyebrow">筋トレ実施中</div><div class="lv-title">${h(E.storeLabel(active.store))}・${h(E.PARTS[active.part] || '')}</div><div class="lv-muted">開始 ${fmtTime(active.startedAt)}｜下の表で完了チェックしてください</div>`; return; }
    if (!ui.plan) resolvePlan();
    const now = new Date(), dateText = `${now.getMonth() + 1}月${now.getDate()}日（${'日月火水木金土'[now.getDay()]}）`;
    if (!ui.part) { box.innerHTML = `<div class="lv-eyebrow">${dateText}</div><div class="lv-title">今日の部位を選択</div><div class="lv-muted">下の「部位」から今日の部位を押すと、その部位のメニューが出ます。</div>`; return; }
    const a = analysis(), lastPart = [...a.sessions].reverse().find(s => s.part === ui.part);
    box.innerHTML = `<div class="lv-eyebrow">${dateText}</div><div class="lv-title">今日は${h(E.PARTS[ui.part])}トレ</div>
      <div class="lv-muted">${lastPart ? `前回：${md(lastPart.date)}｜${h(lastPart.store ? E.storeLabel(lastPart.store) : '店舗未記録')}${lastPart.minutes ? `｜${lastPart.minutes}分` : ''}` : 'この部位の記録はまだありません'}</div>`;
  }

  /* ---------- 共通のセット単位コンポーネント（開始前＝確認・編集、開始後＝実行） ---------- */
  function exerciseCard(e, ei, live) {
    const all = live && e.sets.length && e.sets.every(x => x.done), collapsed = live && (e.collapsed ?? all) && !ui.editMode;
    let w = 0, m = 0;
    const head = `<div class="lv-ex-head"><button type="button" class="lv-ex-title" data-act="toggleex">${['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'][ei] || ei + 1} ${h(e.name)}${all ? ' ✓' : ''}</button><span class="lv-muted small">${h(E.EQUIP[e.equip] ? E.EQUIP[e.equip].label : '')}</span></div>`;
    if (collapsed) return `<section class="lv-ex done" data-ei="${ei}">${head}<div class="lv-muted small">${e.sets.filter(x => x.done).map(x => `${wLabel(x.weight, e.equip)}×${x.reps}`).join('、')}</div></section>`;
    return `<section class="lv-ex ${all ? 'done' : ''}" data-ei="${ei}">${head}
      <div class="lv-last">前回実績：${e.last ? h(e.last) : (e.isNew ? '記録なし（新種目）' : '—')}</div>
      <div class="lv-muted small">レスト：<button type="button" class="lv-link" data-act="restedit">${e.restSec}秒</button>${e.atStore === false && !e.isNew ? '｜この店舗では未実施' : ''}</div>
      ${e.reason ? `<details class="small lv-why"><summary>根拠</summary>${h(e.reason)}${e.newReason ? '<br>' + h(e.newReason) : ''}</details>` : ''}
      <table class="lv-sets"><thead><tr><th>区分</th><th>重量kg</th><th>回数</th><th>完了</th></tr></thead><tbody>
      ${e.sets.map((x, si) => { const label = x.type === 'warmup' ? `準備${++w}` : `本${++m}`; return `<tr class="${x.done ? 'done' : ''}" data-si="${si}">
        <td><button type="button" class="lv-type ${x.type}" data-act="settype" ${ui.editMode ? '' : 'tabindex="-1"'}>${label}${x.side || ''}</button></td>
        <td><input type="number" inputmode="decimal" step="0.5" min="0" data-f="weight" value="${x.weight ?? ''}" placeholder="${e.equip === 'bodyweight' ? '自重' : '—'}" aria-label="${label}の重量"></td>
        <td><input type="number" inputmode="numeric" step="1" min="0" data-f="reps" value="${x.reps ?? ''}" aria-label="${label}の回数"></td>
        <td><button type="button" class="lv-check" data-act="done" aria-pressed="${!!x.done}" ${live ? '' : 'disabled aria-disabled="true" title="開始後にチェックできます"'} aria-label="${label}を完了">${x.done ? '✓' : ''}</button></td></tr>
        ${live && e.showDetail ? `<tr class="lv-detail" data-si="${si}"><td></td><td><input type="number" inputmode="numeric" min="0" max="5" data-f="rir" value="${x.rir ?? ''}" placeholder="RIR"></td><td colspan="2"><input data-f="memo" value="${h(x.memo || '')}" placeholder="痛み・メモ"></td></tr>` : ''}`; }).join('')}
      </tbody></table>
      ${ui.editMode ? `<div class="lv-mini-actions"><button type="button" data-act="addwarm">＋準備</button><button type="button" data-act="addmain">＋本セット</button><button type="button" data-act="delset">−最後のセット</button>${live ? `<button type="button" data-act="detail">${e.showDetail ? 'RIR・メモを閉じる' : 'RIR・メモ'}</button>` : ''}</div>
      <div class="lv-mini-actions"><button type="button" data-act="up">↑ 上へ</button><button type="button" data-act="down">↓ 下へ</button><button type="button" data-act="lr">${e.lr ? '左右別：オン' : '左右別'}</button><button type="button" data-act="rename">種目を変更</button><button type="button" data-act="delex">削除</button></div>` : ''}
    </section>`;
  }
  function renderTrain() {
    const root = $('trainRoot'); if (!root) return;
    const active = readActive();
    clearInterval(tick);
    if (!active && ui.result) { root.innerHTML = resultHtml(ui.result); return; }
    if (!active && !ui.plan) resolvePlan();
    if (!active && !ui.plan) { root.innerHTML = `${selectorsHtml()}<div class="lv-card"><p class="lv-muted">今日の部位を選んでください。</p></div>`; return; }
    const p = active || ui.plan;
    const done = active ? active.exercises.reduce((a, e) => a + e.sets.filter(x => x.done).length, 0) : 0, total = p.exercises.reduce((a, e) => a + e.sets.length, 0);
    const warmN = p.exercises.reduce((a, e) => a + e.sets.filter(x => x.type === 'warmup').length, 0);
    const head = active
      ? `<div class="lv-live-head" id="lvLiveHead"><div class="lv-live-top"><b>${h(E.storeLabel(active.store))}・${h(E.PARTS[active.part] || '')}</b><span id="lvCount">${done}/${total}</span></div>
          <div class="lv-muted small">開始 ${fmtTime(active.startedAt)}｜経過 <span id="lvElapsed">0分</span>｜<span id="lvSaved">自動保存済み</span></div>
          <div class="lv-progress"><div id="lvBar" style="width:${total ? Math.round(done / total * 100) : 0}%"></div></div></div>`
      : `${selectorsHtml()}<div class="lv-card lv-plan-card"><div class="lv-plan-head">${sourceBadge(p)}<span class="lv-muted">${h(p.summary)}（準備${warmN}・本${total - warmN}）</span></div>
          <div class="lv-status" data-lv-status role="status" aria-live="polite">${statusText()}</div>
          ${(p.warnings || []).length ? `<details class="lv-note"><summary>注意 ${p.warnings.length}件</summary>${p.warnings.map(w => `<div>${h(w)}</div>`).join('')}</details>` : ''}
          ${(p.notes || []).length || (p.fixes || []).length ? `<details class="lv-note"><summary>メニュー作成の補足</summary>${[...(p.notes || []), ...(p.fixes || [])].map(n => `<div>${h(n)}</div>`).join('')}</details>` : ''}
          <p class="lv-muted small">開始前に重量・回数を直せます。完了チェックは開始後に使えます。</p></div>`;
    const editBtn = `<div class="lv-edit-toggle"><button type="button" class="lv-mini" data-act="editmode" aria-pressed="${!!ui.editMode}">${ui.editMode ? '編集を終える' : '編集（並べ替え・削除・セット追加）'}</button></div>`;
    root.innerHTML = `${head}${editBtn}
      ${p.exercises.map((e, ei) => exerciseCard(e, ei, !!active)).join('')}
      ${ui.editMode ? `<div class="lv-card">${addExerciseHtml(p.part)}</div>` : ''}
      ${active && ui.finishing ? finishHtml(active) : ''}
      <div class="lv-bar">${active ? `<div id="lvRest" class="lv-rest"></div><button type="button" class="lv-primary ${ui.finishing ? 'sub' : ''}" data-act="finish">${ui.finishing ? '入力に戻る' : '終了する'}</button>` : `<button type="button" class="lv-primary" data-act="start">この内容で筋トレを開始</button>`}</div>`;
    if (active) { tick = setInterval(() => { renderElapsed(active); renderRest(); }, 1000); renderElapsed(active); renderRest(); renderSaveState(active); }
  }
  function finishHtml(s) {
    const incomplete = s.exercises.reduce((a, e) => a + e.sets.filter(x => !x.done).length, 0);
    return `<div class="lv-card" id="lvFinish"><h3>筋トレを終了</h3>
      ${incomplete ? `<div class="lv-note">未完了のセットが${incomplete}セットあります。未完了のセットは実績に含めません。</div>` : ''}
      <div class="lv-row-label">疲労度</div><div class="lv-chips five">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n === (ui.finishFatigue ?? s.fatigue) ? 'on' : ''}" data-act="ffatigue" data-v="${n}">${n}</button>`).join('')}</div>
      <div class="lv-row-label">痛み（任意・未入力は「未申告」）</div><input id="lvPain" value="${h(s.pain || '')}" placeholder="例：右肩2/10">
      <div class="lv-row-label">メモ・種目の感想（任意）</div><input id="lvNote" placeholder="例：インクラインの方が効いた">
      <button type="button" class="lv-primary" data-act="save">${incomplete ? '未完了を含めずに終了・保存' : '保存して終了'}</button>
      <button type="button" class="lv-danger" data-act="discard">記録せずに破棄</button></div>`;
  }
  function renderElapsed(s) { const el = $('lvElapsed'); if (el) el.textContent = `${Math.floor((Date.now() - Date.parse(s.startedAt)) / 60000)}分`; }
  function renderProgress(s) {
    const done = s.exercises.reduce((a, e) => a + e.sets.filter(x => x.done).length, 0), total = s.exercises.reduce((a, e) => a + e.sets.length, 0);
    if ($('lvCount')) $('lvCount').textContent = `${done}/${total}`;
    if ($('lvBar')) $('lvBar').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
  }
  function renderSaveState(s) {
    const el = $('lvSaved'); if (!el) return;
    const pending = typeof pendingCloudChanges === 'function' ? pendingCloudChanges() : 0;
    el.textContent = navigator.onLine === false ? `端末に保存済み（オフライン・未同期）` : cloudUser ? (pending ? '端末に保存済み・同期待ち' : `保存済み ${fmtTime(s.updatedAt)}`) : '端末に保存済み（未ログイン）';
  }
  function addExerciseHtml(part) {
    const order = [part, ...Object.keys(E.PARTS).filter(k => k !== part)];
    return `<div class="lv-add"><div class="lv-row-label">種目を追加</div><div class="lv-add-row"><select id="lvAddSel" aria-label="追加する種目">${order.map(k => `<optgroup label="${h(E.PARTS[k])}">${E.CATALOG.filter(x => x.part === k).map(x => `<option>${h(x.name)}</option>`).join('')}</optgroup>`).join('')}</select><button type="button" data-act="addex">追加</button></div>
      <input id="lvAddName" placeholder="一覧にない種目名（例：ケーブルロー片手）" aria-label="一覧にない種目名"></div>`;
  }
  function resultHtml(r) {
    const s = r.session, m = s.summary, k = m.calories;
    const plan = coach().plans[planKey(s.store, s.part)];
    const targets = r.nextTargets && r.nextTargets.length ? r.nextTargets.map(t => `<tr><td>${h(t.exercise)}</td><td>${h(t.target)}</td></tr>`).join('') : plan ? plan.exercises.map(e => `<tr><td>${h(e.name)}</td><td>${h(e.sets.filter(x => x.type === 'main').map(x => `${wLabel(x.weight, e.equip)}×${x.reps}`).join('、'))}</td></tr>`).join('') : '';
    return `<div class="lv-card"><div class="lv-eyebrow">保存しました</div><h3>${md(s.date)} ${h(E.storeLabel(s.store))}・${h(E.PARTS[s.part] || '')}トレ</h3>
      <ul class="lv-stats"><li>トレーニング時間：<b>${m.minutes}分</b></li><li>総セット数：<b>${m.totalSets}セット</b></li><li>準備セット：<b>${m.warmupSets}セット</b></li><li>本セット：<b>${m.mainSets}セット</b></li>
      <li>総レップ数：<b>${m.totalReps}回</b></li><li>本セット：<b>${m.mainReps}回</b></li><li>疲労度：<b>${m.fatigue ? m.fatigue + '/5' : '未申告'}</b></li><li>痛み：<b>${h(m.pain || '未申告')}</b></li>
      <li>推定活動消費：<b>${k ? `約${k.extra}kcal` : '体重が未登録のため計算できません'}</b></li></ul>
      ${k ? `<details class="small"><summary>計算方法（推定値）</summary>${h(k.formula)}。総消費${k.total}kcal − 安静時${k.resting}kcal。体重${k.bodyWeight}kg（最新の記録）。METsは実測値ではありません。朝の有酸素は含みません。</details>` : ''}
      ${m.incompleteSets ? `<div class="lv-muted small">未完了${m.incompleteSets}セットは実績に含めていません。</div>` : ''}</div>
      <div class="lv-card"><h3>前回との比較</h3><table class="lv-table"><thead><tr><th>種目</th><th>前回</th><th>今回</th><th>評価</th></tr></thead><tbody>${(s.comparison || []).map(c => `<tr><td>${h(c.exercise)}</td><td>${h(c.prev)}</td><td>${h(c.now)}</td><td class="r-${c.result}">${h(c.result)}</td></tr>`).join('')}</tbody></table>
      <p class="lv-muted small">比較は同じ店舗・同じ機器（ダンベルは店舗共通）の、共通する最大重量の回数です。</p></div>
      <div class="lv-card"><h3>AI評価</h3><p class="lv-pre">${h(r.review)}</p><p class="lv-muted small">${r.reviewSource === 'ai' ? 'AIコーチの評価' : 'プログラムによる評価（AIの評価は取得でき次第表示）'}</p></div>
      ${targets ? `<div class="lv-card"><h3>次回目標</h3><table class="lv-table"><tbody>${targets}</tbody></table></div>` : ''}
      <div class="lv-bar"><button type="button" class="lv-primary" data-act="tohome">次回のメニューを見る</button></div>`;
  }

  /* ---------- 履歴・分析 ---------- */
  function renderHistory() {
    const root = $('historyRoot'); if (!root) return;
    const a = analysis(), f = ui.hist, now = Date.parse(today());
    const list = [...a.sessions].reverse().filter(s => (!f.store || s.store === f.store) && (!f.part || s.part === f.part) && (!f.q || s.exercises.some(e => e.name.includes(f.q) || (e.rawName || '').includes(f.q))) && (f.period === 'all' || now - Date.parse(s.date) <= +f.period * 86400000));
    const owner = isOwner(), registered = Seed.CONFIRMED_SESSIONS.every(c => recs().some(r => (r.workoutSessions || []).some(x => x.id === c.id)));
    const exNames = [...new Set(Object.values(a.byKey).filter(s => s.exposures.some(x => x.top)).map(s => s.key))];
    if (!ui.graphEx && exNames.length) ui.graphEx = exNames[0];
    root.innerHTML = `${owner && !registered ? `<div class="lv-card"><b>ChatGPTで確定した実績（11/17 脚・11/24 胸・11/25 背中・11/26 肩）</b><p class="lv-muted small">まだ登録されていません。重複しないように登録します（登録前に端末内へバックアップを作成）。</p><button type="button" class="lv-primary" data-act="seed">確定実績を登録する</button></div>` : ''}
      <div class="lv-card"><div class="lv-filters">
        <select data-hf="store"><option value="">全店舗</option>${Object.values(E.STORES).map(s => `<option value="${s.id}" ${f.store === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        <select data-hf="part"><option value="">全部位</option>${Object.entries(E.PARTS).map(([k, v]) => `<option value="${k}" ${f.part === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select data-hf="period">${[['30', '30日'], ['90', '90日'], ['365', '1年'], ['all', '全期間']].map(([v, l]) => `<option value="${v}" ${f.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input id="lvHistQ" data-hf="q" placeholder="種目名で検索" value="${h(f.q)}"></div>
        <p class="lv-muted small">${list.length}件（全${a.totalSessions}件の記録）</p>
        ${list.slice(0, 60).map(s => { const id = s.id || `${s.date}-${s.store}-${s.part}`; const mains = s.exercises.reduce((x, e) => x + e.sets.filter(t => t.type !== 'warmup').length, 0), total = s.exercises.reduce((x, e) => x + e.sets.length, 0);
          return `<div class="lv-hist"><button type="button" class="lv-hist-head" data-act="histopen" data-v="${h(id)}"><b>${md(s.date)}</b> ${h(E.storeLabel(s.store))}・${h(E.PART_LABELS[s.part] || '部位不明')}<span class="lv-muted small">${s.minutes ? s.minutes + '分・' : ''}${total}セット（本${mains}）</span></button>
          ${f.open === id ? `<div class="lv-hist-body">${s.exercises.map(e => `<div><b>${h(e.rawName || e.name)}</b><div class="lv-muted small">${e.sets.map(t => `${t.type === 'warmup' ? '準備' : '本'} ${wLabel(t.weight, e.equip)}×${t.reps}`).join('／')}</div></div>`).join('') || h(s.rawText || '')}</div>` : ''}</div>`; }).join('')}
      </div>
      <div class="lv-card"><h3>種目別の推移</h3><select data-act="graphex" id="lvGraphEx">${exNames.map(k => { const st = a.byKey[k]; return `<option value="${h(k)}" ${k === ui.graphEx ? 'selected' : ''}>${h(st.name)}（${k.startsWith('*|') ? '店舗共通' : h(E.storeLabel(st.store))}）</option>`; }).join('')}</select>${exerciseChart(a)}</div>
      <div class="lv-card"><h3>部位別の週間セット数（本セット）</h3>${weeklyChart(a)}</div>
      <div class="lv-card"><h3>頻度・時間・疲労度</h3>${sessionChart(a)}</div>
      <div class="lv-card"><h3>体重・体組成</h3>${bodyChart()}<p class="lv-muted small">体組成計の単日の変動は水分などの影響を受けるため、筋肉の増減とは断定しません。</p><button type="button" class="sub" data-act="body">体重・体組成を記録</button></div>`;
  }
  function lineSvg(series, opts = {}) {
    const pts = series.filter(p => p.y !== null && p.y !== undefined);
    if (pts.length < 1) return '<p class="lv-muted small">表示できる記録がありません。</p>';
    const W = 320, H = 150, pad = 28, ys = pts.map(p => p.y), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const x = i => pad + (W - pad * 2) * (pts.length === 1 ? 0.5 : i / (pts.length - 1)), y = v => H - pad - (H - pad * 2) * ((v - min) / span);
    return `<svg class="lv-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(opts.label || 'グラフ')}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts.map((p, i) => `${x(i)},${y(p.y)}`).join(' ')}"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3" fill="currentColor"><title>${h(p.x)}：${p.y}${opts.unit || ''}${p.t ? ' ' + h(p.t) : ''}</title></circle>`).join('')}
      <text x="${pad}" y="14" class="lv-axis">${max}${opts.unit || ''}</text><text x="${pad}" y="${H - 6}" class="lv-axis">${min}${opts.unit || ''}　${h(pts[0].x)}〜${h(pts[pts.length - 1].x)}</text></svg>`;
  }
  function exerciseChart(a) {
    const st = a.byKey[ui.graphEx]; if (!st) return '<p class="lv-muted small">重量の記録がある種目がまだありません。</p>';
    const ex = st.exposures.filter(x => x.top);
    return lineSvg(ex.map(x => ({ x: md(x.date), y: x.top.weight, t: `×${x.top.reps}回` })), { unit: 'kg', label: '最高重量の推移' }) + `<p class="lv-muted small">本セットの最高重量（点にふれると回数）。同重量での回数：${ex.slice(-5).map(x => `${md(x.date)} ${x.top.weight}×${x.top.reps}`).join('、')}</p>`;
  }
  function weeklyChart(a) {
    const weeks = [], now = Date.parse(today());
    for (let w = 7; w >= 0; w--) weeks.push({ label: `${w}週前`, from: now - (w + 1) * 7 * 86400000, to: now - w * 7 * 86400000, counts: {} });
    a.sessions.forEach(s => { const t = Date.parse(s.date); const wk = weeks.find(w => t > w.from && t <= w.to); if (!wk) return; s.exercises.forEach(e => { const p = (E.guessEntry(e.name) || {}).part || s.part; if (E.PARTS[p]) wk.counts[p] = (wk.counts[p] || 0) + e.sets.filter(x => x.type !== 'warmup').length; }); });
    return `<table class="lv-table small"><thead><tr><th></th>${Object.values(E.PARTS).map(v => `<th>${v}</th>`).join('')}</tr></thead><tbody>${weeks.slice(-4).map(w => `<tr><td>${w.label === '0週前' ? '今週' : w.label}</td>${Object.keys(E.PARTS).map(k => `<td>${w.counts[k] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function sessionChart(a) {
    const list = a.sessions.filter(s => s.minutes || s.fatigue).slice(-20);
    return `<div class="lv-muted small">トレーニング時間（分）</div>${lineSvg(list.map(s => ({ x: md(s.date), y: s.minutes })), { unit: '分', label: '時間' })}
      <div class="lv-muted small">疲労度</div>${lineSvg(list.map(s => ({ x: md(s.date), y: s.fatigue })), { label: '疲労度' })}
      <p class="lv-muted small">直近30日の実施回数：${a.sessions.filter(s => Date.parse(today()) - Date.parse(s.date) <= 30 * 86400000).length}回</p>`;
  }
  function bodyChart() {
    const list = recs().filter(r => +r.weight > 0).slice(-60);
    return `<div class="lv-muted small">体重</div>${lineSvg(list.map(r => ({ x: md(r.date), y: +r.weight })), { unit: 'kg', label: '体重' })}
      <div class="lv-muted small">体脂肪</div>${lineSvg(list.filter(r => r.fat).map(r => ({ x: md(r.date), y: +r.fat })), { label: '体脂肪' })}
      <div class="lv-muted small">筋肉量・骨格筋量</div>${lineSvg(list.filter(r => r.muscle).map(r => ({ x: md(r.date), y: +r.muscle })), { unit: 'kg', label: '筋肉量' })}`;
  }
  function autoRegister() {
    if (ui.autoRegistering || !isOwner() || !bootStorageReadySafe()) return;
    if (cloudUser && !window.__syncedThisSession) return; // クラウドの最新を取り込んでから登録（既存の記録を上書きしない）
    const missing = Seed.CONFIRMED_SESSIONS.filter(c => !recs().some(r => (r.workoutSessions || []).some(x => x.id === c.id)));
    const declined = coach().seedDeclined; if (!missing.length || declined) return;
    ui.autoRegistering = true; try { registerConfirmed(true); } finally { ui.autoRegistering = false; }
  }
  function bootStorageReadySafe() { try { return bootStorageReady; } catch (e) { return false; } }
  function registerConfirmed(silent) {
    const before = recs();
    try { localStorage.setItem(storageKey('RecordsBackup') + ':' + Date.now(), JSON.stringify(before)); } catch (e) {} // 登録前のバックアップ
    let added = 0, skipped = 0;
    const all = before.slice();
    Seed.CONFIRMED_SESSIONS.forEach(c => {
      let rec = all.find(r => r.date === c.date);
      const exists = rec && (rec.workoutSessions || []).some(x => x.id === c.id || (x.status === 'finished' && x.store === c.store && x.part === c.part));
      if (exists) { skipped++; return; }
      const iso = v => v ? new Date(v).toISOString() : null;
      const session = { id: c.id, schema: 2, source: 'confirmed', date: c.date, store: c.store, part: c.part, status: 'finished', startedAt: iso(c.startedAt), finishedAt: iso(c.finishedAt), updatedAt: appNowIso(), fatigue: c.fatigue, pain: c.pain, feedback: { note: c.note },
        exercises: c.exercises.map(e => ({ id: Math.random().toString(36).slice(2), name: e.name, part: (E.guessEntry(e.name) || {}).part || c.part, equip: E.equipOf(e.name), restSec: E.REST[c.store][E.kindOf(e.name)], note: e.note || '',
          sets: e.sets.map(x => ({ id: Math.random().toString(36).slice(2), type: x.type, plannedWeight: x.weight, plannedReps: x.reps, weight: x.weight, reps: x.reps, done: true, doneAt: iso(c.finishedAt), rir: null, memo: '', side: '' })) })) };
      session.summary = E.summarizeSession(session, (analysis().body || {}).weight || null);
      if (!rec) { rec = { date: c.date }; all.push(rec); }
      const fields = E.sessionRecordFields(session);
      Object.assign(rec, fields, { workoutSessions: [...(rec.workoutSessions || []), session], restDay: false, updatedAt: appNowIso() });
      delete rec.completedSets; delete rec.plannedSets;
      added++;
    });
    all.sort((x, y) => x.date.localeCompare(y.date));
    setRecs(all);
    // 本人評価（11/24：ベンチインクライン・ケーブルフライの方が効く）を保存
    writeCoach(c => { c.ratings = E.applyRatings(c.ratings, [{ exercise: 'ベンチインクライン・ケーブルフライ', aspect: 'effect', value: 'good', note: '通常のケーブルフライより効く（11/24 本人評価）', date: '2026-11-24' }]); c.plans = {}; });
    ui.plan = null;
    if (added) toast(`確定実績を登録しました（追加${added}件・重複のため省略${skipped}件）`);
    if (typeof update === 'function') update();
    renderAll();
  }

  /* ---------- AIコーチ（会話は実績と連動し、変更は承認後に反映） ---------- */
  function renderCoach() {
    const root = $('coachRoot'); if (!root) return;
    const active = readActive();
    root.innerHTML = `<div class="lv-card"><div class="lv-eyebrow">AIコーチ</div><p class="lv-muted small">${active ? `実施中：${h(E.storeLabel(active.store))}・${h(E.PARTS[active.part] || '')}。変更は残りの種目にだけ反映し、完了済みのセットは変えません。` : '今日の予定・体調・器具の状況・種目の感想を、そのまま伝えてください。'}</p>
      <div class="lv-quick">${['今日、塩田', '今日、本店', '今日は肩が少し痛い', 'ケーブルが空いてない', 'これよりインクラインの方が効く', '今日は45分しかない', '前回より伸びてる？'].map(q => `<button type="button" data-act="quick" data-v="${h(q)}">${h(q)}</button>`).join('')}</div>
      <div id="lvChatLog" class="lv-chat" aria-live="polite">${ui.chat.slice(-12).map(m => `<div class="lv-msg ${m.who}">${h(m.text)}</div>`).join('')}</div>
      ${ui.proposal ? `<div class="lv-proposal"><b>変更案（${ui.proposal.target === 'current' ? '実施中のメニュー' : '次回のメニュー'}）</b><div class="small">${h(ui.proposal.summary || '')}</div><ol class="lv-preview small">${ui.proposal.exercises.map(e => `<li>${h(e.name)}：${h(E.formatSets(e.sets))}</li>`).join('')}</ol><div class="lv-add-row"><button type="button" class="lv-primary" data-act="applyprop">反映する</button><button type="button" class="sub" data-act="dropprop">やめる</button></div></div>` : ''}
      <textarea id="lvChatInput" maxlength="12000" placeholder="例：今日は肩が少し痛い／ケーブルが空いてない／これよりインクラインの方が効く"></textarea>
      <button type="button" class="lv-primary" data-act="send" id="lvSend">送信</button></div>`;
  }
  function currentPlanForChat() {
    const active = readActive();
    if (active) return { active: true, plan: { store: active.store, part: active.part, minutes: active.plannedMinutes, exercises: active.exercises.map(e => ({ name: e.name, doneSets: e.sets.filter(x => x.done).length, restSec: e.restSec, sets: e.sets.map(x => ({ type: x.type, weight: x.weight, reps: x.reps, done: x.done })) })) } };
    if (!ui.plan) resolvePlan();
    return { active: false, plan: ui.plan };
  }
  function progressAnswer() {
    const a = analysis(), last = a.lastSession; if (!last) return 'まだ比較できる記録がありません。';
    const prevSame = [...a.sessions].reverse().find(s => s !== last && s.part === last.part);
    if (!prevSame) return `${md(last.date)}の${E.PART_LABELS[last.part] || ''}は初めての記録のため、比較できる前回がありません。`;
    const before = E.analyze(recs().filter(r => r.date < last.date), today(), coach().prefs);
    const rows = E.compareSession({ store: last.store, exercises: last.exercises.map(e => ({ name: e.name, sets: e.sets.map(s => ({ ...s, done: true })) })) }, before);
    const up = rows.filter(r => r.result === '更新'), same = rows.filter(r => r.result === '維持'), down = rows.filter(r => r.result === '低下');
    return `結論：${md(last.date)}（${E.storeLabel(last.store)}・${E.PART_LABELS[last.part]}）は前回（${md(prevSame.date)}）と比べて、更新${up.length}・維持${same.length}・低下${down.length}種目です。\n` + rows.map(r => `${r.exercise}：${r.prev}→${r.now}（${r.result}）`).join('\n') + '\n※マシンは同店舗・同機器、ダンベルは店舗共通で比較しています。';
  }
  async function sendChat(text) {
    const raw = String(text ?? (($('lvChatInput') || {}).value || '')).trim(); if (!raw) return;
    if ($('lvChatInput')) $('lvChatInput').value = '';
    ui.chat.push({ who: 'me', text: raw.slice(0, 600) + (raw.length > 600 ? '…' : '') });
    const store = E.normalizeStore(raw);
    // 店舗の宣言：前回部位から次の部位を判断し、その店舗のメニューを準備（AI不要・即時）
    if (store && raw.length <= 12 && /今日|きょう|行く|着いた|^本店$|^塩田/.test(raw)) {
      ui.store = store; ui.part = ''; ui.plan = null; resolvePlan();
      const a = analysis(), last = [...a.sessions].reverse().find(s => E.PARTS[s.part]);
      ui.chat.push({ who: 'coach', text: `${last ? `前回は${md(last.date)}の${E.PARTS[last.part]}。` : ''}今日は${E.storeLabel(store)}で${E.PARTS[ui.part]}です。${ui.plan.summary}を用意しました。ホームの「今日の筋トレを開始」ですぐ始められます。` });
      renderAll(); return;
    }
    if (/伸びて|成長|前回より|比較/.test(raw) && raw.length <= 30) { ui.chat.push({ who: 'coach', text: progressAnswer() }); renderAll(); return; }
    if (raw.length >= 200 && /あなたは|コーチ|ルール|プロンプト/.test(raw)) { writeCoach(c => { c.brief = raw.slice(0, 12000); c.plans = {}; }); ui.plan = null; ui.chat.push({ who: 'coach', text: '指示（プロンプト）を保存しました。今後のメニュー作成と相談に使います（設定画面で確認・変更できます）。' }); renderAll(); return; }
    const { active, plan } = currentPlanForChat();
    const btn = $('lvSend'); if (btn) { btn.disabled = true; btn.textContent = '確認中…'; }
    renderCoach();
    const c = coach(), a = analysis();
    let res;
    try {
      if (!canAutoAi() && !ensureAiConsent()) throw new Error('AI送信を中止しました');
      const body = await aiPost({ kind: 'workout_chat', message: raw.slice(0, 600), active, store: plan.store, part: plan.part, minutes: plan.minutes, fatigue: ui.fatigue, pain: ui.pain, brief: c.brief,
        plan: { exercises: plan.exercises.map(e => ({ name: e.name, doneSets: e.doneSets || 0, sets: e.sets, restSec: e.restSec })) }, context: E.aiContext(a, plan.store, plan.part, c.prefs, c.profile, c.ratings) }, TIMEOUT.chat);
      let proposal = null;
      if (body.proposal && Array.isArray(body.proposal.exercises) && body.proposal.exercises.length) {
        const v = E.validatePlan({ exercises: body.proposal.exercises, summary: body.proposal.summary }, { ...plan, id: 'p', source: 'local', minutes: plan.minutes || 60 }, a, E.applyPreferenceChanges(c.prefs, body.preferenceChanges), c.profile, E.applyRatings(c.ratings, body.ratings));
        if (v) proposal = { target: active ? 'current' : (body.proposal.target || 'next'), summary: body.proposal.summary, exercises: v.exercises, plan: v };
      }
      res = { reply: body.reply || '確認しました。', proposal, ratings: body.ratings || [], prefs: body.preferenceChanges || [] };
    } catch (error) {
      const l = E.localChat(raw, active ? { ...plan, exercises: plan.exercises.map(e => ({ ...e })) } : plan, c.prefs);
      res = { reply: `（AIに接続できないため端末内で処理：${error.message}）\n${l.reply}`, proposal: l.plan ? { target: active ? 'current' : 'next', summary: '端末内の変更案', exercises: l.plan.exercises, plan: l.plan } : null, ratings: l.ratings, prefs: l.preferenceChanges };
    }
    if (res.ratings.length || res.prefs.length) {
      writeCoach(cc => { cc.ratings = E.applyRatings(cc.ratings, res.ratings); cc.prefs = E.applyPreferenceChanges(cc.prefs, res.prefs); cc.plans = {}; });
      res.reply += `\n保存しました：${[...res.ratings.map(r => `${r.exercise}（${{ effect: '効き方', pain: '痛み', preference: '好み', equipment: '設備', priority: '優先度' }[r.aspect] || r.aspect}）`), ...res.prefs.map(p => `${p.value}`)].join('、')}`;
      if (!active) ui.plan = null;
    }
    ui.proposal = res.proposal;
    ui.chat.push({ who: 'coach', text: res.reply + (res.proposal ? '\n変更案を下に表示しました。「反映する」で反映します。' : '') });
    if (btn) { btn.disabled = false; btn.textContent = '送信'; }
    renderAll();
  }
  function applyProposal() {
    const p = ui.proposal; if (!p) return;
    const active = readActive();
    if (active && p.target === 'current') {
      mutate(s => {
        const done = s.exercises.filter(e => e.sets.some(x => x.done)); // 完了済みの種目・セットは変更しない
        const doneNames = new Set(done.map(e => e.name));
        const rest = p.exercises.filter(e => !doneNames.has(e.name)).map(e => E.sessionExercise(e));
        s.exercises = [...done, ...rest];
      }, true);
    } else {
      const plan = { ...p.plan, source: 'chat' }, a = analysis();
      plan.basedOnSessions = a.totalSessions; plan.basedOnLastDate = a.lastSession ? a.lastSession.date : null;
      writeCoach(c => { c.plans[planKey(plan.store, plan.part)] = plan; });
      ui.store = plan.store; ui.part = plan.part; ui.plan = plan;
    }
    ui.proposal = null; ui.chat.push({ who: 'coach', text: '変更を反映しました。' });
    renderAll();
  }

  /* ---------- 設定（本人の管理条件） ---------- */
  function renderSettings() {
    const root = $('trainSettingsRoot'); if (!root) return;
    const c = coach(), p = c.profile, eq = E.STORE_EQUIPMENT;
    const aspects = { effect: '効き方', pain: '痛み', preference: '好み', equipment: '設備', priority: '優先度' };
    root.innerHTML = `<div class="lv-card"><h3>本人のプロフィール</h3><p class="lv-muted small">AIコーチが毎回参照します。訂正すると次のメニューから反映します。</p>
      <div class="lv-grid2"><label>年齢<input data-pf="age" type="number" inputmode="numeric" value="${p.age ?? ''}"></label><label>身長cm<input data-pf="heightCm" type="number" inputmode="decimal" value="${p.heightCm ?? ''}"></label>
      <label>減量開始時体重kg<input data-pf="startWeight" type="number" inputmode="decimal" value="${p.startWeight ?? ''}"></label><label>最終目標体重kg<input data-pf="goalWeight" type="number" inputmode="decimal" value="${p.goalWeight ?? ''}"></label>
      <label>通常の時間（分）<input data-pf="minutes" value="${h((p.minutes || []).join('〜'))}"></label><label>基本の総セット数<input data-pf="setsTarget" value="${h((p.setsTarget || []).join('〜'))}"></label></div>
      <label>目的<input data-pf="goal" value="${h(p.goal)}"></label><label>頻度<input data-pf="frequency" value="${h(p.frequency)}"></label>
      <label>ローテーション（胸→背中→肩→脚→腕）<input data-pf="rotation" value="${h((p.rotation || []).map(x => E.PARTS[x]).join('→'))}"></label>
      <label>既往・痛み（1行1件）<textarea data-pf="injuries">${h((p.injuries || []).join('\n'))}</textarea></label>
      <label>除外する種目（1行1件）<textarea data-pf="excluded">${h((p.excluded || []).join('\n'))}</textarea></label>
      <label class="lv-check-row"><input type="checkbox" data-pf="restTimer" ${p.restTimer !== false ? 'checked' : ''}> セット完了時にレストタイマーを使う</label>
      <button type="button" class="lv-primary" data-act="saveprofile">プロフィールを保存</button></div>
      <div class="lv-card"><h3>種目の評価（${c.ratings.length}件）</h3><p class="lv-muted small">効き方・痛み・好み・設備を別々に保存します。AIコーチとの会話でも自動で追加・更新されます。</p>
      ${c.ratings.map((r, i) => `<div class="lv-rating"><div><b>${h(r.exercise)}</b>［${h(aspects[r.aspect] || r.aspect)}］<div class="lv-muted small">${h(r.note || r.value)}</div></div><button type="button" class="lv-mini" data-act="delrating" data-i="${i}">削除</button></div>`).join('')}
      <div class="lv-add-row"><input id="lvRatingEx" placeholder="種目名"><select id="lvRatingAspect">${Object.entries(aspects).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <input id="lvRatingNote" placeholder="内容（例：胸に効く／肘が痛む）"><button type="button" class="sub" data-act="addrating">評価を追加</button></div>
      <div class="lv-card"><h3>店舗の設備</h3>${Object.entries(eq).map(([id, e]) => `<div><b>${E.storeLabel(id)}</b><div class="lv-muted small">${h(e.notes.join('／'))}${c.prefs.stores[id].missing.length ? `／本人申告でなし：${h(c.prefs.stores[id].missing.join('、'))}` : ''}</div></div>`).join('')}
      <p class="lv-muted small">ダンベルは本店・塩田店で共通、マシン・ケーブル・プレート式は店舗・機器ごとに重量を管理します。</p></div>
      <div class="lv-card"><h3>AIコーチへの指示（任意）</h3><p class="lv-muted small">以前のコーチと決めた指示があれば保存できます。毎回貼る必要はありません。</p><textarea id="lvBrief" maxlength="12000">${h(c.brief)}</textarea><button type="button" class="sub" data-act="savebrief">指示を保存</button></div>`;
  }
  function saveProfile() {
    const get = k => document.querySelector(`[data-pf="${k}"]`);
    const range = v => String(v || '').split(/[〜~\-－, ]+/).map(Number).filter(Number.isFinite).slice(0, 2);
    const partMap = Object.fromEntries(Object.entries(E.PARTS).map(([k, v]) => [v, k]));
    writeCoach(c => {
      c.profile = { ...c.profile, age: +get('age').value || null, heightCm: +get('heightCm').value || null, startWeight: +get('startWeight').value || null, goalWeight: +get('goalWeight').value || null,
        minutes: range(get('minutes').value), setsTarget: range(get('setsTarget').value), goal: get('goal').value.trim(), frequency: get('frequency').value.trim(),
        rotation: get('rotation').value.split(/[→>、, ]+/).map(x => partMap[x.trim()]).filter(Boolean), injuries: get('injuries').value.split('\n').map(x => x.trim()).filter(Boolean),
        excluded: get('excluded').value.split('\n').map(x => x.trim()).filter(Boolean), restTimer: get('restTimer').checked };
      c.plans = {};
    });
    ui.plan = null; toast('プロフィールを保存しました'); renderAll();
  }

  /* ---------- 操作 ---------- */
  function openTab(id) { const label = { home: 'ホーム', train: '筋トレ', history: '履歴', aicoach: 'AIコーチ', settings: '設定' }[id]; const tab = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes(label)); if (typeof show === 'function' && tab) show(id, tab); }
  function onClick(ev) {
    const btn = ev.target.closest('[data-act]'); if (!btn) return;
    const scope = btn.closest('#trainRoot, #trainHomeCard, #historyRoot, #coachRoot, #trainSettingsRoot'); if (!scope) return;
    const act = btn.dataset.act, v = btn.dataset.v;
    const exEl = btn.closest('[data-ei]'), setEl = btn.closest('tr[data-si]');
    const ei = exEl ? +exEl.dataset.ei : -1, si = setEl ? +setEl.dataset.si : -1;
    const replan = () => { ui.plan = null; ui.result = null; resolvePlan(); renderAll(); };
    switch (act) {
      case 'store': ui.store = v; if (ui.part) writeCoach(c => { c.today = { date: today(), part: ui.part, store: v }; }); replan(); break;
      case 'part': ui.part = v; writeCoach(c => { c.today = { date: today(), part: v, store: ui.store || c.lastStore || 'honten' }; }); replan(); break;
      case 'minutes': ui.minutes = +v; replan(); break;
      case 'fatigue': ui.fatigue = ui.fatigue === +v ? null : +v; replan(); break;
      case 'start': ui.pain = ($('lvPainInput') || {}).value ?? ui.pain; startSession(); break;
      case 'tohome': ui.result = null; ui.plan = null; renderAll(false); window.scrollTo({ top: 0 }); break;
      case 'airetry': aiPlan(true, ui.plan, ui.planKey); break;
      case 'pup': case 'pdown': case 'pdel': {
        const p = JSON.parse(JSON.stringify(ui.plan)), i = +btn.dataset.i;
        if (act === 'pdel') p.exercises.splice(i, 1); else { const j = act === 'pup' ? i - 1 : i + 1; if (j < 0 || j >= p.exercises.length) break; [p.exercises[i], p.exercises[j]] = [p.exercises[j], p.exercises[i]]; }
        p.source = p.source === 'local' ? 'chat' : p.source; ui.plan = p; const a = analysis(); ui.plan.basedOnSessions = a.totalSessions; ui.plan.basedOnLastDate = a.lastSession ? a.lastSession.date : null;
        writeCoach(c => { c.plans[planKey(ui.plan.store, ui.plan.part)] = ui.plan; }); renderAll(); break;
      }
      case 'addex': addExercise(); break;
      case 'done': {
        const s = mutate(st => { const x = st.exercises[ei].sets[si]; x.done = !x.done; x.doneAt = x.done ? appNowIso() : null; const nx = st.exercises[ei].sets[si + 1]; if (x.done && nx && !nx.done && (nx.weight === null || nx.weight === undefined) && x.type === nx.type) nx.weight = x.weight; });
        if (!s) break;
        const x = s.exercises[ei].sets[si];
        setEl.classList.toggle('done', x.done); btn.textContent = x.done ? '✓' : ''; btn.setAttribute('aria-pressed', x.done);
        if (x.done) { startRest(s.exercises[ei].restSec || 90); const nx = setEl.nextElementSibling; const w = nx && nx.querySelector('[data-f="weight"]'); if (w && !w.value && x.weight !== null) w.value = x.weight; }
        if (s.exercises[ei].sets.every(t => t.done)) { exEl.classList.add('done'); }
        break;
      }
      case 'editmode': ui.editMode = !ui.editMode; renderAll(); break;
      case 'settype': edit((t) => { const x = t.exercises[ei].sets[si]; x.type = x.type === 'warmup' ? 'main' : 'warmup'; }); break;
      case 'addwarm': edit((t, live) => { const e = t.exercises[ei]; const first = e.sets.find(x => x.type === 'main'); const at = e.sets.filter(x => x.type === 'warmup').length; e.sets.splice(at, 0, blankSet(live, 'warmup', first && first.weight ? Math.round(first.weight * 0.6 / 5) * 5 || null : null, 10)); }); break;
      case 'addmain': edit((t, live) => { const e = t.exercises[ei]; const last = [...e.sets].reverse().find(x => x.type === 'main') || {}; e.sets.push(blankSet(live, 'main', last.weight ?? null, last.reps ?? 10)); }); break;
      case 'delset': edit((t) => { const e = t.exercises[ei]; const idx = [...e.sets.keys()].reverse().find(i => !e.sets[i].done); if (idx !== undefined) e.sets.splice(idx, 1); else toast('完了済みのセットは削除できません（チェックを外してから削除）'); }); break;
      case 'detail': edit((t) => { t.exercises[ei].showDetail = !t.exercises[ei].showDetail; }); break;
      case 'toggleex': if (readActive()) mutate(st => { const e = st.exercises[ei]; const all = e.sets.length && e.sets.every(x => x.done); e.collapsed = !(e.collapsed ?? all); }, true); break;
      case 'up': case 'down': edit((t) => { const j = act === 'up' ? ei - 1 : ei + 1; if (j < 0 || j >= t.exercises.length) return; [t.exercises[ei], t.exercises[j]] = [t.exercises[j], t.exercises[ei]]; }); break;
      case 'delex': { const s = readActive(); if (s && s.exercises[ei].sets.some(x => x.done) && !confirm('完了済みのセットがある種目です。削除するとこの種目の記録も消えます。削除しますか？')) break; edit((t) => { t.exercises.splice(ei, 1); }); break; }
      case 'rename': { const cur = (readActive() || ui.plan).exercises[ei]; const name = prompt('種目名を変更（別の種目に変える場合も入力）', cur.name); if (name && name.trim()) edit((t) => { const e = t.exercises[ei]; e.name = name.trim().slice(0, 40); e.equip = E.equipOf(e.name); }); break; }
      case 'lr': edit((t, live) => { const e = t.exercises[ei]; e.lr = !e.lr; if (e.lr) e.sets = e.sets.flatMap(x => x.side ? [x] : [{ ...x, side: '左' }, { ...x, id: Math.random().toString(36).slice(2), side: '右', done: false, doneAt: null }]); else e.sets = e.sets.filter(x => x.side !== '右' || x.done).map(x => ({ ...x, side: x.done ? x.side : '' })); }); break;
      case 'restedit': { const cur = (readActive() || ui.plan).exercises[ei]; const sec = prompt('この種目のレスト（秒）', cur.restSec); if (sec && +sec > 0) edit((t) => { t.exercises[ei].restSec = Math.min(600, Math.round(+sec)); }); break; }
      case 'restpause': { const r = readRest(); if (!r) break; if (r.pausedLeft != null) { r.endAt = Date.now() + r.pausedLeft * 1000; r.pausedLeft = null; } else r.pausedLeft = restLeft(r); localStorage.setItem(restKey(), JSON.stringify(r)); renderRest(); break; }
      case 'restplus': { const r = readRest(); if (!r) break; if (r.pausedLeft != null) r.pausedLeft += 30; else r.endAt += 30000; localStorage.setItem(restKey(), JSON.stringify(r)); renderRest(); break; }
      case 'restskip': stopRest(); break;
      case 'finish': ui.finishing = !ui.finishing; renderAll(); if (ui.finishing && $('lvFinish')) $('lvFinish').scrollIntoView({ block: 'start' }); break;
      case 'ffatigue': ui.finishFatigue = +v; document.querySelectorAll('[data-act="ffatigue"]').forEach(b => b.classList.toggle('on', b.dataset.v === v)); break;
      case 'save': finishSession('save'); break;
      case 'discard': finishSession('discard'); break;
      case 'histopen': ui.hist.open = ui.hist.open === v ? '' : v; renderHistory(); break;
      case 'seed': registerConfirmed(); break;
      case 'body': { const tab = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes('履歴')); if (typeof openRecordMode === 'function') openRecordMode('body', tab); break; }
      case 'quick': sendChat(v); break;
      case 'send': sendChat(); break;
      case 'applyprop': applyProposal(); break;
      case 'dropprop': ui.proposal = null; renderCoach(); break;
      case 'saveprofile': saveProfile(); break;
      case 'delrating': writeCoach(c => { c.ratings = c.ratings.filter((r, i) => i !== +btn.dataset.i); c.plans = {}; }); ui.plan = null; renderSettings(); break;
      case 'addrating': { const ex = ($('lvRatingEx') || {}).value || '', note = ($('lvRatingNote') || {}).value || ''; if (!ex.trim()) break; writeCoach(c => { c.ratings = E.applyRatings(c.ratings, [{ exercise: ex.trim(), aspect: $('lvRatingAspect').value, value: 'note', note: note.trim() }]); c.plans = {}; }); ui.plan = null; renderSettings(); break; }
      case 'savebrief': writeCoach(c => { c.brief = ($('lvBrief') || {}).value.trim().slice(0, 12000); c.plans = {}; }); ui.plan = null; toast('指示を保存しました'); break;
    }
  }
  function addExercise() {
    const typed = (($('lvAddName') || {}).value || '').trim().slice(0, 40), name = typed || ($('lvAddSel') || {}).value;
    if (!name) return;
    const active = readActive(), store = active ? active.store : ui.store, a = analysis(), ref = E.latestFor(a, store, name), stat = ref.exposure ? { last: ref.exposure } : null;
    const lastMain = stat ? stat.last.main : [];
    const entry = E.exactEntry(name) || E.guessEntry(name);
    const ex = { name, part: entry ? entry.part : ui.part, equip: E.equipOf(name), restSec: E.REST[store][E.kindOf(name)], reason: stat ? `前回：${E.formatSets(stat.last.sets)}` : '追加した種目。準備セットで重量を確認してください。', last: stat ? E.formatSets(stat.last.sets) : '', isNew: !stat,
      sets: lastMain.length ? lastMain.map(s => ({ type: 'main', weight: s.weight, reps: s.reps })) : [{ type: 'warmup', weight: null, reps: 10 }, ...[0, 1, 2].map(() => ({ type: 'main', weight: null, reps: entry ? entry.reps[0] : 10 }))] };
    if (active) mutate(s => { s.exercises.push(E.sessionExercise(ex)); }, true);
    else edit(t => { t.exercises.push({ ...ex, id: Math.random().toString(36).slice(2), atStore: true }); });
    toast(`「${name}」を追加しました`);
  }
  function onInput(ev) {
    const t = ev.target;
    if (t.id === 'lvPainInput') { ui.pain = t.value; return; }
    if (t.dataset && t.dataset.hf) { ui.hist[t.dataset.hf] = t.value; renderHistory(); const q = $('lvHistQ'); if (t.id === 'lvHistQ' && q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } return; }
    if (t.id === 'lvGraphEx') { ui.graphEx = t.value; renderHistory(); return; }
    if (!t.dataset || !t.dataset.f) return;
    const exEl = t.closest('[data-ei]'), setEl = t.closest('tr[data-si]'); if (!exEl || !setEl) return;
    edit(s => { const x = s.exercises[+exEl.dataset.ei].sets[+setEl.dataset.si]; const f = t.dataset.f; x[f] = f === 'memo' ? t.value : (t.value === '' ? null : +t.value); }, false);
  }

  /* ---------- 公開API・起動 ---------- */
  window.WorkoutUI = {
    open() { openTab(readActive() ? 'train' : 'home'); },
    render: () => renderAll(), renderHome, renderTrain, renderHistory, renderCoach, renderSettings,
    onShow(id) {
      if (id === 'home' || id === 'train') { const root = $('trainRoot'), target = $(id); if (root && target && root.parentElement !== target) target.appendChild(root); renderHome(); renderTrain(); return; } if (id === 'history') renderHistory(); if (id === 'aicoach') renderCoach(); if (id === 'settings') renderSettings(); },
    onDataChanged() {
      autoRegister();
      if (!ui.autoOpened && readActive()) { ui.autoOpened = true; renderAll(false); return; }
      const focused = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (focused || ui.renderedFor === signature()) return;
      if (!readActive() && !ui.result) ui.plan = null;
      renderAll();
    },
    _ui: ui
  };
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', ev => { if (ev.target && (ev.target.dataset.hf || ev.target.id === 'lvGraphEx')) onInput(ev); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderRest(); }); // 復帰時は実時刻から残りを再計算
  window.addEventListener('online', () => { const s = readActive(); if (s) saveActive(s, true); });
  window.addEventListener('pagehide', () => { const s = readActive(); if (s) { clearTimeout(mirrorTimer); writeCoach(c => { c.active = s; }); } });
  { const root = $('trainRoot'), home = $('home'); if (root && home) home.appendChild(root); } // 起動時はホームに同じ画面を表示
  renderHome(); renderTrain();
  if (readActive()) ui.autoOpened = true;
})();
