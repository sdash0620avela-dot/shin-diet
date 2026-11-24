/* AI Life Navi 筋トレコーチ：画面・保存・AI連携
 * 依存：index.html の recs/setRecs/sets/writeSettings/storageKey/cloudClient/cloudUser/MEAL_ANALYSIS_API/
 *       fetchWithTimeout/ensureAiConsent/aiConsentRecord/appNowIso/today/readDraft/draftKey/removeDeletedRecord/
 *       strengthEstimatedCalories/loadRecordForDate/update、workout-engine.js の WorkoutEngine。
 */
(function () {
  'use strict';
  const E = window.WorkoutEngine;
  const readSettings = () => sets();
  const $ = id => document.getElementById(id);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AI_PLAN_TIMEOUT = 60000, AI_CHAT_TIMEOUT = 45000;
  const ui = { store: '', part: '', minutes: 0, request: '', plan: null, aiState: {}, chatLog: [], finishing: false, renderedFor: '', restUntil: 0, evidence: null };
  let timer = null, mirrorTimer = null;

  /* ---------- 保存領域 ---------- */
  function coach(s = readSettings()) {
    const c = s.workoutCoach && typeof s.workoutCoach === 'object' ? s.workoutCoach : {};
    return { prefs: E.prefsNormalized(c.prefs), plans: c.plans && typeof c.plans === 'object' ? c.plans : {}, active: c.active || null, activeClearedAt: c.activeClearedAt || '', lastStore: c.lastStore || '', next: c.next || null, updatedAt: c.updatedAt || '' };
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
    const c = coach(), cloud = c.active;
    const t = x => Date.parse(x && x.updatedAt || '') || 0;
    if (local && c.activeClearedAt && Date.parse(c.activeClearedAt) >= t(local)) { localStorage.removeItem(activeKey()); local = null; }
    const chosen = t(cloud) > t(local) ? cloud : local;
    return chosen && chosen.status === 'active' ? chosen : null;
  }
  function saveActive(session, mirrorNow = false) {
    session.updatedAt = appNowIso();
    localStorage.setItem(activeKey(), JSON.stringify(session)); // 入力ごとに即時保存（端末内）
    clearTimeout(mirrorTimer);
    const mirror = () => writeCoach(c => { c.active = JSON.parse(localStorage.getItem(activeKey()) || 'null'); });
    if (mirrorNow) mirror(); else mirrorTimer = setTimeout(mirror, 4000); // クラウドへは間引いて同期
  }
  function clearActive() {
    clearTimeout(mirrorTimer);
    localStorage.removeItem(activeKey());
    writeCoach(c => { c.active = null; c.activeClearedAt = appNowIso(); });
    if (typeof syncNow === 'function' && cloudUser && navigator.onLine !== false) setTimeout(() => syncNow(true), 0); // 他端末での誤復元を防ぐため即時同期
  }

  /* ---------- 計画 ---------- */
  const planKey = (store, part) => `${store}:${part}`;
  function analysis() { return E.analyze(recs(), today()); }
  function currentDefaults() {
    const c = coach(), a = analysis();
    const store = E.normalizeStore(ui.store || c.lastStore) || 'honten';
    const part = (E.PARTS[ui.part] && ui.part) || (c.next && c.next.store === store && E.PARTS[c.next.part] && c.next.part) || E.recommendPart(a, c.prefs, today());
    return { store, part, minutes: ui.minutes || c.prefs.defaultMinutes || 60, a, c };
  }
  function cachedPlan(c, a, store, part, minutes) {
    const p = c.plans[planKey(store, part)];
    if (!p || !Array.isArray(p.exercises) || !p.exercises.length) return null;
    const ageDays = (Date.now() - Date.parse(p.createdAt || 0)) / 86400000;
    if (p.basedOnSessions !== a.totalSessions || ageDays > 21 || (minutes && p.minutes !== minutes)) return null;
    return p;
  }
  function resolvePlan() {
    const d = currentDefaults();
    ui.store = d.store; ui.part = d.part; ui.minutes = d.minutes;
    const cached = !ui.request && cachedPlan(d.c, d.a, d.store, d.part, d.minutes);
    ui.plan = cached || E.planSession({ store: d.store, part: d.part, minutes: d.minutes, request: ui.request, prefs: d.c.prefs, analysis: d.a, today: today(), level: d.c.prefs.level });
    clearTimeout(resolvePlan.t);
    Object.keys(ui.aiState).forEach(k => { if (ui.aiState[k].state === 'queued') delete ui.aiState[k]; }); // 取り消された予約を消す
    if (ui.plan.source === 'local') { // 保存済みでもアプリ設計のままならAI最適化の対象
      const target = ui.plan, key = planKey(target.store, target.part) + ':' + target.minutes;
      if (!canAutoAi()) { if (!ui.aiState[key]) ui.aiState[key] = { state: cloudUser ? 'consent' : 'login' }; }
      else if (!ui.aiState[key]) {
        ui.aiState[key] = { state: 'queued' };
        resolvePlan.t = setTimeout(() => { if (ui.aiState[key] && ui.aiState[key].state === 'queued') delete ui.aiState[key]; if (ui.plan === target) maybeAiPlan(false); }, 1200); // 選択が落ち着いてからAIへ（連続タップで送信しない）
      }
    }
    return ui.plan;
  }
  function storePlan(plan) { writeCoach(c => { c.plans[planKey(plan.store, plan.part)] = plan; }); }

  async function aiPost(payload, timeoutMs) {
    if (!cloudClient || !cloudUser) throw new Error('AI調整にはログインが必要です（アプリ設計のメニューは使えます）。');
    if (navigator.onLine === false) throw new Error('オフラインのため、保存済み・アプリ設計のメニューを使います。');
    const { data, error } = await cloudClient.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('ログイン状態を確認できません。');
    const response = await fetchWithTimeout(MEAL_ANALYSIS_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.session.access_token}` }, body: JSON.stringify(payload) }, timeoutMs);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `AI通信エラー（${response.status}）`);
    return body;
  }
  function canAutoAi() { return !!(cloudClient && cloudUser && typeof aiConsentRecord === 'function' && aiConsentRecord() && navigator.onLine !== false); }

  async function maybeAiPlan(userInitiated, target = ui.plan) {
    if (!target) return;
    const key = planKey(target.store, target.part) + ':' + target.minutes;
    if (ui.aiState[key] && ui.aiState[key].state === 'loading') return;
    if (!userInitiated && ui.aiState[key] && ['done', 'error', 'consent', 'login'].includes(ui.aiState[key].state)) return; // 自動再送はしない
    if (!userInitiated && !canAutoAi()) { ui.aiState[key] = { state: cloudUser ? 'consent' : 'login' }; return; }
    if (userInitiated && !ensureAiConsent()) return;
    ui.aiState[key] = { state: 'loading', startedAt: Date.now() };
    renderPlanStatus();
    const s = readSettings(), c = coach(s), a = analysis();
    try {
      const body = await aiPost({ kind: 'workout_plan', store: target.store, part: target.part, minutes: target.minutes, level: target.level, request: ui.request, healthNotes: s.healthNotes || '', context: E.aiContext(a, target.store, target.part, c.prefs), baseline: target.exercises.map(x => ({ name: x.name, weight: x.weight, reps: x.reps, repsTarget: x.repsTarget, sets: x.sets, restSec: x.restSec, rir: x.rir, reason: x.reason })) }, AI_PLAN_TIMEOUT);
      const plan = E.validateAiPlan(body, target, a, c.prefs);
      if (!plan) throw new Error('AIの計画を検証できなかったため、アプリ設計のメニューを使います。');
      plan.aiModel = body.model || '';
      plan.basedOnSessions = a.totalSessions;
      storePlan(plan);
      ui.aiState[key] = { state: 'done', model: body.model || '' };
      const same = ui.plan && planKey(ui.plan.store, ui.plan.part) === planKey(plan.store, plan.part) && ui.plan.minutes === plan.minutes;
      if (same && !readActive()) { ui.plan = plan; render(); } else renderPlanStatus();
      renderHome();
    } catch (error) {
      ui.aiState[key] = { state: 'error', message: error.message || 'AI調整に失敗しました。' };
      renderPlanStatus();
    }
  }

  /* ---------- セッション操作 ---------- */
  function startSession() {
    if (readActive()) return render();
    const plan = ui.plan || resolvePlan();
    if (!plan.exercises.length) return toast('種目がありません。会話か「種目を追加」で追加してください。');
    const session = E.newSession(plan, today(), appNowIso());
    session.request = ui.request;
    saveActive(session, true);
    writeCoach(c => { c.lastStore = plan.store; c.active = session; });
    ui.chatLog = [];
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function mutateSession(fn, rerender = false) {
    const s = readActive(); if (!s) return null;
    fn(s); saveActive(s);
    if (rerender) render(); else { renderProgress(s); }
    return s;
  }
  function finishSession(save) {
    const s = readActive(); if (!s) return;
    if (!save) { if (!confirm('この筋トレを記録せずに破棄しますか？入力したセットは保存されません。')) return; clearActive(); ui.finishing = false; render(); renderHome(); return; }
    s.finishedAt = appNowIso(); s.status = 'finished';
    s.feedback = { overall: ui.finishOverall || '', pain: ($('wcFinishPain') || {}).value || '', note: ($('wcFinishNote') || {}).value || '' };
    const fields = E.sessionRecordFields(s);
    if (!fields.completedSets && !confirm('完了チェックのあるセットがありません。中止として記録しますか？')) { s.status = 'active'; s.finishedAt = null; return; }
    persistFinished(s, fields);
    clearActive();
    ui.finishing = false; ui.finishOverall = ''; ui.request = ''; ui.part = ''; ui.plan = null;
    // 次回メニューを自動生成（即時：アプリ設計→保存、バックグラウンド：AI最適化→保存）
    const a = analysis(), c = coach();
    const nextPart = E.recommendPart(a, c.prefs, today());
    const next = E.planSession({ store: s.store, part: nextPart, minutes: c.prefs.defaultMinutes || ui.minutes || 60, prefs: c.prefs, analysis: a, today: today(), level: c.prefs.level });
    writeCoach(cc => { cc.next = { store: s.store, part: nextPart, createdAt: appNowIso() }; cc.lastStore = s.store; cc.plans[planKey(next.store, next.part)] = next; });
    ui.store = s.store; ui.part = nextPart; ui.minutes = next.minutes; ui.plan = next;
    ui.lastResult = { date: s.date, fields, store: s.store, part: s.part };
    render(); renderHome();
    if (canAutoAi()) maybeAiPlan(false, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function persistFinished(session, fields) {
    const all = recs(), existing = all.find(r => r.date === session.date) || { date: session.date };
    const sessions = (Array.isArray(existing.workoutSessions) ? existing.workoutSessions : []).filter(x => x.id !== session.id).concat([session]);
    const weight = +(existing.weight || (all.filter(r => +r.weight > 0).slice(-1)[0] || {}).weight || readSettings().startWeight || 0);
    // 同日に複数回実施した場合は要約を合算
    const finished = sessions.filter(x => x.status === 'finished').map(x => E.sessionRecordFields(x));
    const merged = finished.length > 1 ? {
      ...fields,
      workoutMinutes: finished.reduce((a, f) => a + f.workoutMinutes, 0),
      workoutExercises: finished.flatMap(f => f.workoutExercises),
      strength: finished.map(f => f.strength).join('\n'),
      workoutFeedback: finished.map(f => f.workoutFeedback).filter(Boolean).join(' / ').slice(0, 500)
    } : fields;
    merged.workoutExercisesJson = JSON.stringify(merged.workoutExercises);
    const manualStrength = existing.strengthCalorieSource === 'manual' && +existing.exerciseCal > 0;
    const strengthCalories = manualStrength ? +existing.exerciseCal : strengthEstimatedCalories(merged.strengthIntensity, merged.workoutMinutes, weight);
    const record = {
      ...existing, ...merged, restDay: false, workoutSessions: sessions,
      workoutPlan: E.planText({ summary: `${E.storeLabel(session.store)}・${E.PARTS[session.part] || ''}`, exercises: session.exercises.map(e => ({ name: e.name, weight: e.sets[0] ? e.sets[0].weight : null, reps: e.sets[0] ? e.sets[0].reps : '', repsTarget: e.repsTarget || ['', ''], sets: e.sets.length, restSec: e.restSec, rir: e.rir })) }),
      strengthCalories, strengthCalorieSource: manualStrength ? 'manual' : 'estimated',
      exerciseTotal: (+existing.cardioCalories || 0) + (+existing.accessoryCalories || 0) + strengthCalories,
      updatedAt: appNowIso()
    };
    delete record.completedSets; delete record.plannedSets;
    const rest = all.filter(r => r.date !== session.date); rest.push(record); rest.sort((x, y) => x.date.localeCompare(y.date));
    removeDeletedRecord(session.date); setRecs(rest);
    // 記録画面の下書きにも反映（下書きの古い筋トレ欄で上書きされるのを防ぐ）
    const draft = readDraft(session.date);
    if (draft) { const keys = ['workoutPlace', 'workoutPart', 'workoutMinutes', 'workoutCompletion', 'workoutFeedback', 'workoutExercises', 'workoutExercisesJson', 'strength', 'strengthIntensity', 'workoutPlan']; keys.forEach(k => { draft.record[k] = record[k]; }); draft.record.restDay = false; localStorage.setItem(draftKey(session.date), JSON.stringify(draft)); }
    if (typeof update === 'function') update();
    if ($('record') && $('record').classList.contains('active') && $('date').value === session.date && typeof loadRecordForDate === 'function') loadRecordForDate();
  }

  /* ---------- 会話 ---------- */
  async function sendChat() {
    const input = $('wcChatInput'); const message = (input && input.value || '').trim(); if (!message) return;
    const active = readActive();
    const plan = active ? sessionAsPlan(active) : (ui.plan || resolvePlan());
    ui.chatLog.push({ who: 'me', text: message }); input.value = '';
    const btn = $('wcChatSend'); if (btn) { btn.disabled = true; btn.textContent = '確認中…'; }
    renderChat();
    const c = coach(), a = analysis();
    let result;
    try {
      if (!canAutoAi() && !ensureAiConsent()) throw new Error('AI送信を中止しました');
      const body = await aiPost({ kind: 'workout_chat', message, store: plan.store, part: plan.part, minutes: plan.minutes, plan: { summary: plan.summary, exercises: plan.exercises.map(x => ({ name: x.name, weight: x.weight, reps: x.reps, sets: x.sets, restSec: x.restSec, rir: x.rir, done: x.doneSets || 0 })) }, context: E.aiContext(a, plan.store, plan.part, c.prefs) }, AI_CHAT_TIMEOUT);
      const updated = Array.isArray(body.exercises) && body.exercises.length ? E.validateAiPlan({ summary: '', exercises: body.exercises, warnings: [], evidence: plan.evidence }, plan, a, E.applyPreferenceChanges(c.prefs, body.preferenceChanges)) : null;
      result = { reply: body.reply || '変更内容を確認しました。', plan: updated, preferenceChanges: Array.isArray(body.preferenceChanges) ? body.preferenceChanges : [] };
    } catch (error) {
      result = E.localChat(message, plan, c.prefs);
      result.reply = `（AIに接続できないため端末内で処理：${error.message}）\n` + result.reply;
    }
    if (result.preferenceChanges.length) {
      writeCoach(cc => { cc.prefs = E.applyPreferenceChanges(cc.prefs, result.preferenceChanges); Object.keys(cc.plans).forEach(k => { if (!active || k !== planKey(plan.store, plan.part)) delete cc.plans[k]; }); });
      result.reply += '\n恒久設定を更新しました：' + result.preferenceChanges.map(describeChange).join('、');
    }
    if (result.plan) {
      if (active) applyPlanToSession(result.plan);
      else { result.plan.source = 'chat'; result.plan.basedOnSessions = a.totalSessions; ui.plan = result.plan; storePlan(result.plan); }
    } else if (result.preferenceChanges.length && !active) { ui.plan = null; resolvePlan(); }
    ui.chatLog.push({ who: 'coach', text: result.reply });
    render();
    const log = $('wcChatLog'); if (log) log.scrollIntoView({ block: 'nearest' });
  }
  function describeChange(c) {
    const store = c.store ? E.storeLabel(c.store) : '全店舗';
    return { avoid: `${c.value}を避ける`, prefer: `${c.value}を優先`, missing_equipment: `${store}に${c.value}なし`, available_equipment: `${store}に${c.value}あり`, note: `メモ「${c.value}」`, default_minutes: `標準${c.value}分` }[c.type] + (c.action === 'remove' ? '（解除）' : '');
  }
  function sessionAsPlan(s) {
    return { store: s.store, part: s.part, minutes: ui.minutes || 60, summary: '実施中', evidence: [], exercises: s.exercises.map(e => ({ name: e.name, weight: e.sets[0] ? e.sets[0].weight : null, reps: e.sets[0] ? e.sets[0].reps : null, repsTarget: e.repsTarget, sets: e.sets.length, restSec: e.restSec, rir: e.rir, doneSets: e.sets.filter(x => x.done).length, loadType: e.loadType })) };
  }
  // 実施中は、完了セットのある種目を残し、未着手の種目だけを入れ替える
  function applyPlanToSession(plan) {
    mutateSession(s => {
      const started = s.exercises.filter(e => e.sets.some(x => x.done));
      const keepNames = new Set(started.map(e => e.name));
      const fresh = E.newSession({ ...plan, exercises: plan.exercises.filter(e => !keepNames.has(e.name)) }, s.date, appNowIso()).exercises;
      started.forEach(e => { const p = plan.exercises.find(x => x.name === e.name); if (p && p.sets > e.sets.length) for (let i = e.sets.length; i < p.sets; i++) e.sets.push({ weight: e.sets[e.sets.length - 1].weight, reps: e.sets[e.sets.length - 1].reps, done: false, doneAt: null }); });
      s.exercises = [...started, ...fresh];
    }, true);
  }

  /* ---------- 描画 ---------- */
  function toast(msg) { const el = $('wcToast'); if (!el) return; el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200); }
  function fmtTime(iso) { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  function loadLabel(e) { return e.loadType === 'bodyweight' ? '自重' : e.weight === null || e.weight === undefined ? '確認重量' : `${e.weight}kg${e.loadType === 'per_side' ? '（片側）' : ''}`; }
  function sourceBadge(plan) {
    if (plan.source === 'ai') return `<span class="wc-badge ai">AI設計${plan.aiModel ? '' : ''}</span>`;
    if (plan.source === 'chat') return '<span class="wc-badge chat">会話で調整</span>';
    return '<span class="wc-badge local">アプリ設計（履歴分析）</span>';
  }
  function planStatusHtml() {
    if (!ui.plan) return '';
    const st = ui.aiState[planKey(ui.plan.store, ui.plan.part) + ':' + ui.plan.minutes] || {};
    if (ui.plan.source === 'ai') return `AIが全${ui.plan.basedOnSessions}回の履歴・痛み・店舗設備・根拠を統合して設計しました。`;
    if (st.state === 'queued') return 'まもなくAIが全履歴から最適化します。待たずにこのまま開始できます。';
    if (st.state === 'loading') return 'AIが全履歴から最適化中です。待たずにこのまま開始できます。';
    if (st.state === 'error') return `${h(st.message)} このメニューで開始できます。 <button type="button" class="wc-link" data-act="ai">AIで再調整</button>`;
    if (st.state === 'consent') return 'AI最適化は初回だけ送信確認が必要です。 <button type="button" class="wc-link" data-act="ai">AIで最適化</button>';
    if (st.state === 'login') return '設定からログインするとAIが最適化します。このメニューはオフラインでも使えます。';
    return '';
  }
  function renderPlanStatus() { const el = $('wcPlanStatus'); if (el) el.innerHTML = planStatusHtml(); }

  function render() {
    const root = $('trainRoot'); if (!root || !E) return;
    ui.renderedFor = signature();
    const active = readActive();
    clearInterval(timer);
    if (active) { root.innerHTML = sessionHtml(active); startTimer(active); }
    else { if (!ui.plan || ui.plan.store !== ui.store || ui.plan.part !== ui.part) resolvePlan(); root.innerHTML = planHtml(); }
    renderChat();
  }
  function signature() { return `${activeStorageIdSafe()}|${recs().length}|${coach().updatedAt}`; }
  function activeStorageIdSafe() { try { return activeStorageId; } catch (e) { return ''; } }

  function planHtml() {
    const p = ui.plan, c = coach(), a = analysis();
    const rec = E.recommendPart(a, c.prefs, today());
    const stores = Object.values(E.STORES).map(s => `<button type="button" class="wc-seg ${s.id === ui.store ? 'on' : ''}" data-act="store" data-v="${s.id}" aria-pressed="${s.id === ui.store}">${s.label}</button>`).join('');
    const parts = Object.entries(E.PARTS).map(([k, v]) => `<button type="button" class="wc-chip ${k === ui.part ? 'on' : ''}" data-act="part" data-v="${k}" aria-pressed="${k === ui.part}">${v}${k === rec ? '<small>おすすめ</small>' : ''}</button>`).join('');
    const mins = [45, 60, 75, 90].map(m => `<button type="button" class="wc-chip small ${m === ui.minutes ? 'on' : ''}" data-act="minutes" data-v="${m}">${m}分</button>`).join('');
    const result = ui.lastResult ? `<div class="card wc-result"><b>✓ ${h(ui.lastResult.date)} の筋トレを保存しました</b><div class="small">${h(E.storeLabel(ui.lastResult.store))}・${h(E.PARTS[ui.lastResult.part] || '')}｜${ui.lastResult.fields.workoutMinutes}分｜${ui.lastResult.fields.completedSets}/${ui.lastResult.fields.plannedSets}セット完了</div><div class="small">次回メニューを下に用意しました。</div></div>` : '';
    const history = a.totalSessions ? `全${a.totalSessions}回の記録を分析` : '筋トレ記録がまだないため、確認重量から始めます';
    return `${result}
    <div class="card wc-card">
      <div class="wc-title">店舗</div><div class="wc-segs" role="group" aria-label="店舗">${stores}</div>
      <div class="wc-title">部位</div><div class="wc-chips" role="group" aria-label="部位">${parts}</div>
      <div class="wc-title">時間</div><div class="wc-chips">${mins}</div>
      <details class="wc-request" ${ui.request ? 'open' : ''}><summary>今日の痛み・体調・希望（任意）</summary>
        <textarea id="wcRequest" placeholder="例：右肩3/10、寝不足。ケーブルから始めたい">${h(ui.request)}</textarea>
        <button type="button" class="sub" data-act="request">この内容でメニューを作り直す</button></details>
    </div>
    <div class="card wc-card" id="wcPlanCard">
      <div class="wc-plan-head">${sourceBadge(p)}<span class="small">${h(history)}</span></div>
      <h3 class="wc-summary">${h(p.summary)}</h3>
      <div id="wcPlanStatus" class="small wc-status" role="status" aria-live="polite">${planStatusHtml()}</div>
      ${p.warnings.length ? `<div class="wc-warn">${p.warnings.map(w => `<div>⚠️ ${h(w)}</div>`).join('')}</div>` : ''}
      <ol class="wc-list">${p.exercises.map((e, i) => `<li class="wc-ex">
        <div class="wc-ex-head"><b>${h(e.name)}</b>${e.unconfirmed ? '<span class="wc-tag">設備未確認</span>' : ''}</div>
        <div class="wc-ex-main">${h(loadLabel(e))} × ${e.reps}回 × ${e.sets}セット</div>
        <div class="small">目標${e.repsTarget[0]}〜${e.repsTarget[1]}回・残り${e.rir}回・休憩${e.restSec}秒</div>
        ${e.reason ? `<div class="small wc-reason">${h(e.reason)}</div>` : ''}${e.reference ? `<div class="small wc-ref">参考：${h(e.reference)}</div>` : ''}
        <div class="wc-ex-actions"><button type="button" class="wc-mini" data-act="swap" data-i="${i}">入替</button><button type="button" class="wc-mini" data-act="nostore" data-i="${i}">この店にない</button><button type="button" class="wc-mini danger" data-act="remove" data-i="${i}">今日は外す</button></div>
      </li>`).join('')}</ol>
      ${evidenceHtml(p.evidence)}
    </div>
    ${chatHtml()}
    ${prefsHtml(c.prefs)}
    <p class="small" style="text-align:center"><button type="button" class="wc-link" data-act="legacy">従来の詳細入力（記録画面）を開く</button></p>
    <div class="wc-bar"><button type="button" id="wcStart" data-act="start">▶ この内容で筋トレ開始</button></div>`;
  }

  function sessionHtml(s) {
    const done = s.exercises.reduce((a, e) => a + e.sets.filter(x => x.done).length, 0), total = s.exercises.reduce((a, e) => a + e.sets.length, 0);
    return `<div class="card wc-card wc-live">
      <div class="wc-live-head"><div><b>${h(E.storeLabel(s.store))}・${h(E.PARTS[s.part] || '')}</b><div class="small">開始 ${fmtTime(s.startedAt)}｜経過 <span id="wcElapsed">--</span></div></div><div class="wc-progress-num" id="wcProgress">${done}/${total}</div></div>
      <div class="small wc-saved" id="wcSaved">入力は自動保存されます（通信が切れても端末に残ります）</div>
    </div>
    ${s.exercises.map((e, ei) => `<div class="card wc-card wc-live-ex" data-ei="${ei}">
      <div class="wc-ex-head"><b>${ei + 1}. ${h(e.name)}</b>${e.unconfirmed ? '<span class="wc-tag">設備未確認</span>' : ''}</div>
      <div class="small">目標${e.repsTarget ? `${e.repsTarget[0]}〜${e.repsTarget[1]}回` : ''}・残り${e.rir ?? 2}回・休憩${e.restSec || 90}秒</div>
      ${e.reason ? `<details class="small"><summary>この設定の理由</summary>${h(e.reason)}</details>` : ''}
      <div class="wc-sets">${e.sets.map((x, si) => `<div class="wc-set ${x.done ? 'done' : ''}" data-si="${si}">
        <span class="wc-set-no">${si + 1}</span>
        <div class="wc-step"><button type="button" class="wc-pm" data-act="w-" aria-label="重量を減らす">−</button><input type="number" inputmode="decimal" step="0.5" min="0" data-f="weight" value="${x.weight ?? ''}" placeholder="kg" aria-label="${si + 1}セット目の重量"><button type="button" class="wc-pm" data-act="w+" aria-label="重量を増やす">＋</button></div>
        <div class="wc-step"><button type="button" class="wc-pm" data-act="r-" aria-label="回数を減らす">−</button><input type="number" inputmode="numeric" step="1" min="0" data-f="reps" value="${x.reps ?? ''}" placeholder="回" aria-label="${si + 1}セット目の回数"><button type="button" class="wc-pm" data-act="r+" aria-label="回数を増やす">＋</button></div>
        <button type="button" class="wc-check" data-act="done" aria-pressed="${x.done}" aria-label="${si + 1}セット目を完了">${x.done ? '✓' : ''}</button>
      </div>`).join('')}</div>
      <div class="wc-ex-actions"><button type="button" class="wc-mini" data-act="addset">＋セット</button>${['easy', 'ok', 'hard'].map(r => `<button type="button" class="wc-mini ${e.rating === r ? 'on' : ''}" data-act="rate" data-v="${r}">${{ easy: '余裕', ok: 'ちょうど', hard: 'きつい' }[r]}</button>`).join('')}</div>
    </div>`).join('')}
    ${chatHtml()}
    ${ui.finishing ? `<div class="card wc-card" id="wcFinishCard"><h3>筋トレを終了</h3>
      <div class="wc-title">全体の感想</div><div class="wc-chips">${['easy', 'ok', 'hard'].map(r => `<button type="button" class="wc-chip ${ui.finishOverall === r ? 'on' : ''}" data-act="overall" data-v="${r}">${{ easy: '余裕あり', ok: 'ちょうど', hard: 'きつかった' }[r]}</button>`).join('')}</div>
      <div class="wc-title">痛み（任意）</div><input id="wcFinishPain" placeholder="例：右肩2/10" value="${h(s.feedback && s.feedback.pain || '')}">
      <div class="wc-title">メモ（任意）</div><input id="wcFinishNote" placeholder="例：チェストプレスはもう1段いけそう" value="${h(s.feedback && s.feedback.note || '')}">
      <button type="button" id="wcSaveFinish" data-act="save" style="margin-top:12px">保存して終了・次回メニュー作成</button>
      <button type="button" class="sub" data-act="cancelfinish" style="margin-top:8px">続ける</button>
      <button type="button" class="danger" data-act="discard" style="margin-top:8px">記録せず破棄</button></div>` : ''}
    <div class="wc-bar"><div id="wcRest" class="wc-rest"></div><button type="button" id="wcFinish" data-act="finish" class="${ui.finishing ? 'sub' : ''}">■ 終了する</button></div>`;
  }
  function chatHtml() {
    return `<div class="card wc-card" id="wcChatCard"><div class="wc-title">コーチに伝える（会話でメニュー変更）</div>
      <div id="wcChatLog" class="wc-chat-log" aria-live="polite"></div>
      <textarea id="wcChatInput" maxlength="600" placeholder="例：塩田店にはペックフライがない／今日は肩が痛いので軽めに／今後スクワットは外して"></textarea>
      <button type="button" id="wcChatSend" data-act="chat">伝える</button>
      <p class="small">「今後」「いつも」などの希望や器具の有無は恒久設定に保存し、次回以降のメニューにも反映します。</p></div>`;
  }
  function renderChat() { const log = $('wcChatLog'); if (!log) return; log.innerHTML = ui.chatLog.slice(-8).map(m => `<div class="wc-msg ${m.who}">${h(m.text)}</div>`).join(''); }
  function prefsHtml(p) {
    const items = [
      ...p.avoid.map(v => ({ type: 'avoid', value: v, store: null })), ...p.prefer.map(v => ({ type: 'prefer', value: v, store: null })),
      ...Object.entries(p.stores).flatMap(([id, s]) => [...s.missing.map(v => ({ type: 'missing_equipment', value: v, store: id })), ...s.available.map(v => ({ type: 'available_equipment', value: v, store: id }))]),
      ...p.notes.map(v => ({ type: 'note', value: v, store: null })), ...(p.defaultMinutes ? [{ type: 'default_minutes', value: String(p.defaultMinutes), store: null }] : [])
    ];
    return `<details class="card wc-card" id="wcPrefs"><summary><b>恒久設定（${items.length}件）</b></summary>
      ${items.length ? items.map((it, i) => `<div class="wc-pref"><span>${h(describeChange({ ...it, action: 'add' }))}</span><button type="button" class="wc-mini danger" data-act="prefdel" data-i="${i}">解除</button></div>`).join('') : '<p class="small">会話で「今後〜」「〇〇店には〜がない」と伝えると、ここに保存されます。</p>'}
    </details>`;
  }
  function prefItems() { const p = coach().prefs; return [...p.avoid.map(v => ({ type: 'avoid', value: v, store: null })), ...p.prefer.map(v => ({ type: 'prefer', value: v, store: null })), ...Object.entries(p.stores).flatMap(([id, s]) => [...s.missing.map(v => ({ type: 'missing_equipment', value: v, store: id })), ...s.available.map(v => ({ type: 'available_equipment', value: v, store: id }))]), ...p.notes.map(v => ({ type: 'note', value: v, store: null })), ...(p.defaultMinutes ? [{ type: 'default_minutes', value: String(p.defaultMinutes), store: null }] : [])]; }
  function evidenceHtml(ids) {
    const list = (ui.evidence || []).filter(x => (ids || []).includes(x.id));
    if (!list.length) return '';
    return `<details class="small wc-evidence"><summary>科学的根拠（原典照合済み ${list.length}件）</summary>${list.map(x => `<div><b>${h(x.finding)}</b><br>${h(x.citation)}　<a href="https://pubmed.ncbi.nlm.nih.gov/${h(x.pmid)}/" target="_blank" rel="noopener">PubMed ${h(x.pmid)}</a></div>`).join('')}</details>`;
  }
  function renderProgress(s) {
    const done = s.exercises.reduce((a, e) => a + e.sets.filter(x => x.done).length, 0), total = s.exercises.reduce((a, e) => a + e.sets.length, 0);
    const el = $('wcProgress'); if (el) el.textContent = `${done}/${total}`;
    const saved = $('wcSaved'); if (saved) saved.textContent = `自動保存 ${fmtTime(s.updatedAt)}${navigator.onLine === false ? '（オフライン：端末に保存済み）' : ''}`;
  }
  function startTimer(s) {
    const tick = () => {
      const el = $('wcElapsed'); if (!el) { clearInterval(timer); return; }
      const m = Math.floor((Date.now() - Date.parse(s.startedAt)) / 60000); el.textContent = `${m}分`;
      const rest = $('wcRest'); if (rest) { const left = Math.ceil((ui.restUntil - Date.now()) / 1000); rest.textContent = left > 0 ? `休憩 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''; rest.classList.toggle('on', left > 0); }
    };
    tick(); timer = setInterval(tick, 1000);
  }

  function renderHome() {
    const box = $('trainHomeCard'); if (!box || !E) return;
    const active = readActive();
    if (active) { box.innerHTML = `<div class="card-title">筋トレ実施中</div><b>${h(E.storeLabel(active.store))}・${h(E.PARTS[active.part] || '')}</b><div class="small">開始 ${fmtTime(active.startedAt)}。入力内容は保存されています。</div><button type="button" style="margin-top:10px" onclick="WorkoutUI.open()">▶ 筋トレを再開</button>`; return; }
    const c = coach(), a = analysis(), store = E.normalizeStore(c.lastStore) || 'honten', nextPart = c.next && c.next.store === store && E.PARTS[c.next.part] ? c.next.part : '', part = nextPart || E.recommendPart(a, c.prefs, today());
    const plan = cachedPlan(c, a, store, part, 0) || E.planSession({ store, part, minutes: c.prefs.defaultMinutes || 60, prefs: c.prefs, analysis: a, today: today(), level: c.prefs.level });
    box.innerHTML = `<div class="card-title">次回の筋トレ</div><b>${h(plan.summary)}</b><div class="small">${plan.exercises.slice(0, 4).map(e => h(`${e.name} ${loadLabel(e)}×${e.reps}`)).join('／')}</div><button type="button" style="margin-top:10px" onclick="WorkoutUI.open('${store}','${part}')">このメニューを開く</button>`;
  }

  /* ---------- 操作 ---------- */
  function onClick(ev) {
    const btn = ev.target.closest('[data-act]'); if (!btn || !$('trainRoot').contains(btn)) return;
    const act = btn.dataset.act, v = btn.dataset.v;
    const exEl = btn.closest('[data-ei]'), setEl = btn.closest('[data-si]');
    const ei = exEl ? +exEl.dataset.ei : -1, si = setEl ? +setEl.dataset.si : -1;
    if (act === 'store') { ui.store = v; ui.lastResult = null; ui.plan = null; resolvePlan(); render(); }
    else if (act === 'part') { ui.part = v; ui.lastResult = null; ui.plan = null; resolvePlan(); render(); }
    else if (act === 'minutes') { ui.minutes = +v; ui.plan = null; resolvePlan(); render(); }
    else if (act === 'request') { ui.request = ($('wcRequest').value || '').trim(); ui.plan = null; resolvePlan(); render(); }
    else if (act === 'ai') maybeAiPlan(true);
    else if (act === 'start') startSession();
    else if (act === 'legacy') { const tab = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes('食事など')); if (typeof openRecordMode === 'function') openRecordMode('workout', tab); }
    else if (act === 'remove' || act === 'swap' || act === 'nostore') editPlanExercise(act, +btn.dataset.i);
    else if (act === 'prefdel') { const it = prefItems()[+btn.dataset.i]; if (it) { writeCoach(c => { c.prefs = E.applyPreferenceChanges(c.prefs, [{ ...it, action: 'remove' }]); c.plans = {}; }); ui.plan = null; resolvePlan(); render(); } }
    else if (act === 'chat') sendChat();
    else if (act === 'finish') { ui.finishing = !ui.finishing; render(); if (ui.finishing) $('wcFinishCard').scrollIntoView({ behavior: 'smooth' }); }
    else if (act === 'cancelfinish') { ui.finishing = false; render(); }
    else if (act === 'overall') { ui.finishOverall = v; document.querySelectorAll('[data-act="overall"]').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
    else if (act === 'save') finishSession(true);
    else if (act === 'discard') finishSession(false);
    else if (act === 'addset') mutateSession(s => { const e = s.exercises[ei], last = e.sets[e.sets.length - 1] || {}; e.sets.push({ weight: last.weight ?? null, reps: last.reps ?? null, done: false, doneAt: null }); }, true);
    else if (act === 'rate') mutateSession(s => { s.exercises[ei].rating = s.exercises[ei].rating === v ? '' : v; }, true);
    else if (act === 'done') {
      const s = mutateSession(st => {
        const e = st.exercises[ei], x = e.sets[si]; x.done = !x.done; x.doneAt = x.done ? appNowIso() : null;
        // 次の未完了セットへ重量・回数を引き継ぐ（未入力の場合のみ）
        const nx = e.sets[si + 1]; if (x.done && nx && !nx.done) { if (nx.weight === null || nx.weight === undefined || nx.weight === '') nx.weight = x.weight; }
        if (x.done) ui.restUntil = Date.now() + (e.restSec || 90) * 1000;
      });
      if (s) { const row = setEl, x = s.exercises[ei].sets[si]; row.classList.toggle('done', x.done); btn.textContent = x.done ? '✓' : ''; btn.setAttribute('aria-pressed', x.done); const nextRow = row.nextElementSibling; if (nextRow && x.done) { const w = nextRow.querySelector('[data-f="weight"]'); if (w && !w.value && x.weight !== null) w.value = x.weight; } }
    }
    else if (/^[wr][+-]$/.test(act)) {
      const field = act[0] === 'w' ? 'weight' : 'reps', delta = (act[1] === '+' ? 1 : -1) * (field === 'weight' ? 2.5 : 1);
      const s = mutateSession(st => { const x = st.exercises[ei].sets[si]; const cur = +x[field] || 0; x[field] = Math.max(0, Math.round((cur + delta) * 100) / 100); });
      if (s) setEl.querySelector(`[data-f="${field}"]`).value = s.exercises[ei].sets[si][field];
    }
  }
  function onInput(ev) {
    const input = ev.target; if (!input.dataset || !input.dataset.f) return;
    const exEl = input.closest('[data-ei]'), setEl = input.closest('[data-si]'); if (!exEl || !setEl) return;
    mutateSession(s => { const x = s.exercises[+exEl.dataset.ei].sets[+setEl.dataset.si]; x[input.dataset.f] = input.value === '' ? null : +input.value; });
  }
  function editPlanExercise(act, i) {
    const plan = ui.plan; const e = plan && plan.exercises[i]; if (!e) return;
    if (act === 'remove') plan.exercises.splice(i, 1);
    else if (act === 'nostore') {
      writeCoach(c => { c.prefs = E.applyPreferenceChanges(c.prefs, [{ action: 'add', type: 'missing_equipment', value: e.name, store: plan.store }]); delete c.plans[planKey(plan.store, plan.part)]; });
      toast(`${E.storeLabel(plan.store)}に「${e.name}」はない設定にしました（恒久設定）`);
      ui.plan = null; resolvePlan(); render(); return;
    } else {
      const used = new Set(plan.exercises.map(x => x.name)), c = coach();
      const missing = new Set(c.prefs.stores[plan.store].missing.concat(c.prefs.avoid));
      const alt = E.CATALOG.find(x => x.part === e.part && !used.has(x.name) && !missing.has(x.name));
      if (!alt) return toast('入れ替えられる種目がありません。会話で希望を伝えてください。');
      const repl = E.planSession({ store: plan.store, part: plan.part, minutes: plan.minutes, prefs: { ...c.prefs, prefer: [alt.name] }, analysis: analysis(), today: today() }).exercises.find(x => x.name === alt.name);
      plan.exercises.splice(i, 1, repl || { ...e, name: alt.name, weight: null, reason: '入替：1セット目で確認重量を決めてください。' });
    }
    plan.source = plan.source === 'ai' ? 'ai' : 'chat';
    plan.summary = `${E.storeLabel(plan.store)}・${E.PARTS[plan.part]}｜${plan.exercises.length}種目 合計${plan.exercises.reduce((a, x) => a + x.sets, 0)}セット（手動調整）`;
    plan.basedOnSessions = analysis().totalSessions;
    storePlan(plan);
    render();
  }

  /* ---------- 公開API ---------- */
  window.WorkoutUI = {
    open(store, part) {
      if (store) ui.store = store; if (part) ui.part = part; if (store || part) ui.plan = null;
      const tab = [...document.querySelectorAll('.tab')].find(x => x.textContent.includes('筋トレ'));
      if (typeof show === 'function' && tab) show('train', tab); else render();
    },
    render, renderHome,
    onDataChanged() {
      renderHome();
      if (!ui.autoOpened && readActive()) { ui.autoOpened = true; window.WorkoutUI.open(); return; }
      const page = $('train'); if (!page || !page.classList.contains('active')) return;
      const focused = document.activeElement && page.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (focused || ui.renderedFor === signature()) return;
      if (!readActive() && !ui.lastResult) ui.plan = null;
      render();
    },
    _ui: ui
  };
  document.addEventListener('click', ev => { if (ev.target.closest('#trainRoot')) onClick(ev); });
  document.addEventListener('input', ev => { if (ev.target.closest('#trainRoot')) onInput(ev); });
  window.addEventListener('online', () => { const s = readActive(); if (s) saveActive(s, true); });
  window.addEventListener('pagehide', () => { const s = readActive(); if (s) { clearTimeout(mirrorTimer); writeCoach(c => { c.active = s; }); } });
  fetch('./science/evidence.json').then(r => r.json()).then(d => { ui.evidence = (d.items || []).filter(x => x.verified); if ($('train') && $('train').classList.contains('active') && !readActive()) render(); }).catch(() => { ui.evidence = []; });
  renderHome();
  if (readActive() && $('train')) { /* 再起動直後：実施中なら筋トレ画面を開いて復元 */ ui.autoOpened = true; setTimeout(() => { if (readActive()) window.WorkoutUI.open(); }, 0); }
})();
