/* AI Life Navi 筋トレコーチ：計画エンジン（DOM非依存・オフライン動作）
 * 役割：全履歴の分析、店舗別メニューの即時生成、AI応答の検証、オフライン時の会話変更。
 * AIが使えない時でもこのエンジンの計画で筋トレを継続できる。
 */
(function (root) {
  'use strict';

  const STORES = {
    honten: { id: 'honten', label: '本店' },
    shioda: { id: 'shioda', label: '塩田店' }
  };
  const PARTS = { chest: '胸', back: '背中', shoulders: '肩', arms: '腕', legs: '脚', fullbody: '全身' };
  const PART_ORDER = ['chest', 'back', 'legs', 'shoulders', 'arms'];

  // 種目カタログ：名前・別名・部位・種類・回数域。店舗ごとの有無は履歴と本人の申告で判定する。
  const CATALOG = [
    { name: 'チェストプレス', aliases: ['マシンチェストプレス', 'chestpress'], part: 'chest', kind: 'compound', reps: [8, 12], moves: ['press'] },
    { name: 'インクラインチェストプレス', aliases: ['インクラインプレス', 'インクラインマシンプレス'], part: 'chest', kind: 'compound', reps: [8, 12], moves: ['press'] },
    { name: 'ベンチプレス', aliases: ['バーベルベンチプレス'], part: 'chest', kind: 'compound', reps: [6, 10], moves: ['press'] },
    { name: 'ダンベルプレス', aliases: ['ダンベルベンチプレス'], part: 'chest', kind: 'compound', reps: [8, 12], moves: ['press'] },
    { name: 'ペックフライ', aliases: ['ペクトラルフライ', 'バタフライ', 'ペックデック', 'マシンフライ'], part: 'chest', kind: 'isolation', reps: [10, 15], moves: ['fly'] },
    { name: 'ケーブルフライ', aliases: ['ケーブルクロスオーバー', 'クロスオーバー'], part: 'chest', kind: 'isolation', reps: [12, 15], moves: ['fly'] },
    { name: 'ラットプルダウン', aliases: ['ラットプル', 'プルダウン', 'latpulldown'], part: 'back', kind: 'compound', reps: [8, 12], moves: ['pull'] },
    { name: 'シーテッドロー', aliases: ['シーテッドロウ', 'ローイング', 'マシンロー', 'ケーブルロー', 'シーテッドケーブルロー'], part: 'back', kind: 'compound', reps: [8, 12], moves: ['row'] },
    { name: 'ワンハンドロー', aliases: ['ダンベルロー', 'ワンハンドダンベルロー'], part: 'back', kind: 'compound', reps: [8, 12], moves: ['row'] },
    { name: 'ストレートアームプルダウン', aliases: ['ストレートアーム', 'プルオーバー'], part: 'back', kind: 'isolation', reps: [12, 15], moves: ['pull'] },
    { name: 'バックエクステンション', aliases: ['背筋', 'ハイパーエクステンション'], part: 'back', kind: 'isolation', reps: [10, 15], moves: ['lowback'] },
    { name: 'ショルダープレス', aliases: ['マシンショルダープレス', 'ダンベルショルダープレス'], part: 'shoulders', kind: 'compound', reps: [8, 12], moves: ['overhead'] },
    { name: 'サイドレイズ', aliases: ['ラテラルレイズ', 'サイドレイズマシン', 'ダンベルサイドレイズ'], part: 'shoulders', kind: 'isolation', reps: [12, 20], moves: ['raise'] },
    { name: 'ケーブルサイドレイズ', aliases: ['ケーブルレイズ', 'ケーブルラテラルレイズ'], part: 'shoulders', kind: 'isolation', reps: [12, 20], moves: ['raise'] },
    { name: 'リアデルトフライ', aliases: ['リアレイズ', 'リバースフライ', 'リアデルト'], part: 'shoulders', kind: 'isolation', reps: [12, 20], moves: ['raise'] },
    { name: 'ケーブルカール', aliases: ['ケーブルアームカール'], part: 'arms', kind: 'isolation', reps: [10, 15], moves: ['curl'] },
    { name: 'ダンベルカール', aliases: ['アームカール', 'バイセップスカール', 'インクラインカール'], part: 'arms', kind: 'isolation', reps: [10, 15], moves: ['curl'] },
    { name: 'ハンマーカール', aliases: [], part: 'arms', kind: 'isolation', reps: [10, 15], moves: ['curl'] },
    { name: 'プレスダウン', aliases: ['トライセプスプレスダウン', 'ケーブルプレスダウン', 'プッシュダウン'], part: 'arms', kind: 'isolation', reps: [10, 15], moves: ['extension'] },
    { name: 'オーバーヘッドエクステンション', aliases: ['フレンチプレス', 'オーバーヘッドトライセプス'], part: 'arms', kind: 'isolation', reps: [10, 15], moves: ['extension'] },
    { name: 'レッグプレス', aliases: ['マシンレッグプレス', 'legpress'], part: 'legs', kind: 'compound', reps: [8, 12], moves: ['knee'] },
    { name: 'スクワット', aliases: ['バーベルスクワット', 'スミススクワット', 'ゴブレットスクワット'], part: 'legs', kind: 'compound', reps: [6, 10], moves: ['knee', 'lowback'] },
    { name: 'レッグカール', aliases: ['シーテッドレッグカール', 'ライイングレッグカール'], part: 'legs', kind: 'isolation', reps: [10, 15], moves: ['hamstring'] },
    { name: 'レッグエクステンション', aliases: [], part: 'legs', kind: 'isolation', reps: [10, 15], moves: ['knee'] },
    { name: 'アダクション', aliases: ['アダクター', 'ヒップアダクション'], part: 'legs', kind: 'isolation', reps: [12, 15], moves: ['hip'] },
    { name: 'カーフレイズ', aliases: ['カーフ'], part: 'legs', kind: 'isolation', reps: [12, 20], moves: ['calf'] }
  ];
  const FULLBODY = ['レッグプレス', 'チェストプレス', 'ラットプルダウン', 'ショルダープレス', 'シーテッドロー', 'レッグカール'];

  // 痛み部位 → 避けたい動作（安全方針。医学的診断ではない）
  const PAIN_MOVES = {
    '肩': ['press', 'overhead', 'raise', 'fly'], '肘': ['curl', 'extension', 'press'], '手首': ['curl', 'press'],
    '二頭': ['curl', 'pull', 'row'], '三頭': ['extension', 'press'], '腰': ['lowback', 'row', 'knee'],
    '膝': ['knee', 'hamstring'], '股関節': ['hip', 'knee'], '首': ['overhead', 'raise'], '背中': ['row', 'lowback'], '胸': ['press', 'fly']
  };

  const clean = s => String(s ?? '').replace(/[\s　＊*_`「」『』]/g, '').replace(/[：:]$/, '').toLowerCase();
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v)) ? null : +v;
  const firstInt = v => { if (Number.isFinite(+v) && v !== '' && v !== null) return Math.round(+v); const m = String(v ?? '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).match(/\d+/); return m ? +m[0] : null; };
  const round = (v, step = 0.5) => Math.round(v / step) * step;
  const dayIndex = date => Math.floor(Date.parse(String(date).slice(0, 10) + 'T00:00:00Z') / 86400000);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function normalizeStore(text) {
    const value = String(text || '');
    if (STORES[value]) return value;
    if (/塩田/.test(value)) return 'shioda';
    if (/本店/.test(value)) return 'honten';
    return '';
  }
  function storeLabel(id) { return STORES[id] ? STORES[id].label : (id || '店舗不明'); }

  function catalogEntry(name) {
    const key = clean(name);
    if (!key) return null;
    let hit = CATALOG.find(e => clean(e.name) === key || e.aliases.some(a => clean(a) === key));
    if (hit) return hit;
    // 「マシン」「（Life Fitness）」などの付加語を許容した部分一致（長い名前を優先）
    const sorted = CATALOG.flatMap(e => [e.name, ...e.aliases].map(n => [clean(n), e])).sort((a, b) => b[0].length - a[0].length);
    hit = sorted.find(([n]) => n.length >= 3 && key.includes(n));
    return hit ? hit[1] : null;
  }
  function canonicalName(name) { const e = catalogEntry(name); return e ? e.name : String(name || '').trim(); }
  function inferPart(text) {
    const v = String(text || '');
    const e = catalogEntry(v); if (e) return e.part;
    if (/胸|チェスト|ベンチ|ペック/.test(v)) return 'chest';
    if (/背中|ラット|ローイング|ロウ|ロー$/.test(v)) return 'back';
    if (/肩|ショルダー|レイズ|デルト/.test(v)) return 'shoulders';
    if (/腕|二頭|三頭|カール|プレスダウン|トライセプス/.test(v)) return 'arms';
    if (/脚|下半身|レッグ|スクワット|カーフ/.test(v)) return 'legs';
    return '';
  }

  /* ---------- 痛み・疲労の抽出 ---------- */
  function parsePain(text) {
    const out = {};
    const value = String(text || '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).replace(/／/g, '/');
    const re = /(右|左|両)?(肩|肘|手首|二頭|三頭|腰|膝|股関節|首|背中|胸)[^0-9\n、。,]{0,6}?(\d{1,2})\s*\/\s*10/g;
    let m;
    while ((m = re.exec(value))) { const score = Math.min(10, +m[3]); out[m[2]] = Math.max(out[m[2]] || 0, score); }
    const re2 = /(肩|肘|手首|二頭|三頭|腰|膝|股関節|首|背中|胸)[^。\n]{0,4}(痛|違和感|張り)/g;
    while ((m = re2.exec(value))) { if (!out[m[1]]) out[m[1]] = 3; }
    return out;
  }

  /* ---------- 自由記述の筋トレ記録（v21.1より前の「胸25セット　1時間」形式など） ---------- */
  const PART_WORDS = [['chest', '胸'], ['back', '背中'], ['shoulders', '肩'], ['arms', '腕|二頭|三頭'], ['legs', '脚|足|下半身'], ['fullbody', '全身']];
  function toHalf(v) { return String(v || '').replace(/[０-９．]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).replace(/[ｘＸ✕＊]/g, '×'); }
  function parseFreeText(text) {
    const value = toHalf(text);
    if (!value.trim()) return null;
    const partSets = {};
    PART_WORDS.forEach(([id, words]) => {
      const re = new RegExp(`(?:${words})[^0-9\\n、。]{0,6}?(\\d{1,3})\\s*セット`, 'g');
      let m; while ((m = re.exec(value))) partSets[id] = (partSets[id] || 0) + Math.min(60, +m[1]);
      if (!partSets[id] && new RegExp(`(?:${words})(?:の日|トレ|を|中心|[・、\\s]|$)`).test(value)) partSets[id] = partSets[id] || 0;
    });
    const exercises = [];
    const re = /([ァ-ヶーA-Za-z一-龥]{2,20}?)\s*[：:]?\s*(\d{1,3}(?:\.\d)?)\s*(?:kg|キロ)(?:[（(][^）)]*[）)])?\s*[×x*]?\s*(\d{1,2})\s*回?(?:\s*[×x*]\s*(\d{1,2})\s*(?:セット|set)?|\s*(\d{1,2})\s*(?:セット|set))?/gi;
    let m;
    while ((m = re.exec(value))) {
      const entry = catalogEntry(m[1]); if (!entry) continue;
      const count = Math.max(1, Math.min(10, +(m[4] || m[5] || 1)));
      exercises.push({ name: entry.name, rawName: m[1], equipment: '', loadType: 'total', rating: '', legacy: true, fromText: true, sets: Array.from({ length: count }, () => ({ weight: +m[2], reps: +m[3] })) });
    }
    const hm = value.match(/(\d+(?:\.\d+)?)\s*時間/), mm = value.match(/(\d{1,3})\s*分/);
    const minutes = hm ? Math.round(+hm[1] * 60) : mm ? +mm[1] : null;
    if (!exercises.length && !Object.keys(partSets).length) return null;
    return { partSets, exercises, minutes };
  }

  /* ---------- 履歴の抽出 ---------- */
  // 新形式（workoutSessions：セット単位）・旧形式（workoutExercises：種目単位）・自由記述（strength）をすべて読む。
  // 店舗名が本店/塩田店と判別できない記録は、恒久設定 unknownStoreAs があればその店舗として扱う。
  function extractSessions(records, prefs) {
    const sessions = [];
    const unknownAs = prefs && STORES[prefs.unknownStoreAs] ? prefs.unknownStoreAs : '';
    const storeOf = place => normalizeStore(place) || unknownAs;
    (Array.isArray(records) ? records : []).filter(r => r && r.date && !r._deleted).forEach(r => {
      const finished = Array.isArray(r.workoutSessions) ? r.workoutSessions.filter(s => s && s.status === 'finished') : [];
      if (finished.length) {
        finished.forEach(s => sessions.push({
          date: r.date, store: storeOf(s.store), part: s.part || '', source: 'session',
          startedAt: s.startedAt, finishedAt: s.finishedAt, rating: s.feedback && s.feedback.overall || '',
          pain: parsePain(`${s.feedback && s.feedback.pain || ''} ${s.feedback && s.feedback.note || ''}`),
          fatigue: num(r.fatigue),
          exercises: (s.exercises || []).map(e => ({
            name: canonicalName(e.name), rawName: e.name, equipment: e.equipment || '', loadType: e.loadType || 'total', rating: e.rating || '',
            target: e.repsTarget || null, plannedSets: e.sets && e.sets.length || 0,
            sets: (e.sets || []).filter(x => x && x.done).map(x => ({ weight: num(x.weight), reps: firstInt(x.reps) })).filter(x => x.reps)
          })).filter(e => e.name)
        }));
        return;
      }
      let items = r.workoutExercises;
      if (!Array.isArray(items)) { try { items = JSON.parse(r.workoutExercisesJson || '[]'); } catch (e) { items = []; } }
      if (!Array.isArray(items) || !items.length) {
        const text = parseFreeText(r.strength);
        if (!text || /^(?:今日は)?(?:完全)?休養日/.test(String(r.strength || '').trim()) || r.restDay) return;
        const parts = Object.keys(text.partSets);
        sessions.push({ date: r.date, store: storeOf(r.workoutPlace), part: r.workoutPart || (parts.length === 1 ? parts[0] : parts.length > 1 ? 'fullbody' : inferPart(text.exercises.map(e => e.name).join(' '))), source: 'text',
          partSets: text.partSets, minutes: text.minutes, rating: /余裕|楽/.test(r.strength) ? 'easy' : /きつ|限界/.test(r.strength) ? 'hard' : '',
          pain: parsePain(`${r.strength || ''} ${r.condition || ''}`), fatigue: num(r.fatigue), exercises: text.exercises, rawText: String(r.strength).slice(0, 80) });
        return;
      }
      if (r.workoutCompletion === 'stopped' && !items.some(i => num(i.weight) !== null)) return;
      const store = storeOf(r.workoutPlace);
      const exercises = items.map(i => {
        const reps = firstInt(i.reps), count = Math.max(1, Math.min(10, firstInt(i.sets) || 1)), weight = num(i.weight);
        const planned = /メニューから自動入力/.test(String(i.note || '')) && weight === null;
        return { name: canonicalName(i.name), rawName: i.name, equipment: i.equipment || r.workoutEquipment || '', loadType: i.loadType || 'total', rating: '', legacy: true, planned,
          sets: reps && !planned ? Array.from({ length: count }, () => ({ weight, reps })) : [] };
      }).filter(e => e.name && e.sets.length);
      if (!exercises.length) return;
      const feedbackText = `${r.workoutFeedback || ''} ${r.workoutRequest || ''} ${r.condition || ''}`;
      sessions.push({ date: r.date, store, part: r.workoutPart || inferPart(exercises.map(e => e.name).join(' ')), source: 'legacy',
        rating: /余裕|楽|軽/.test(r.workoutFeedback || '') ? 'easy' : /きつ|上がらず|限界|潰れ/.test(r.workoutFeedback || '') ? 'hard' : '',
        pain: parsePain(feedbackText), fatigue: num(r.fatigue), completion: r.workoutCompletion || '', exercises });
    });
    return sessions.sort((a, b) => a.date.localeCompare(b.date));
  }

  const e1rm = (w, r) => (w > 0 && r > 0) ? w * (1 + Math.min(r, 20) / 30) : null;

  // 種目×店舗ごとの成長・停滞を集計（全履歴）
  function analyze(records, todayDate, prefs) {
    const sessions = extractSessions(records, prefs);
    const now = dayIndex(todayDate || new Date().toISOString().slice(0, 10));
    const byKey = {};
    sessions.forEach(s => s.exercises.forEach(e => {
      const key = `${s.store}|${e.name}`;
      const top = e.sets.reduce((best, x) => { const v = e1rm(x.weight, x.reps); return v && (!best || v > best.e1rm) ? { ...x, e1rm: v } : best; }, null);
      (byKey[key] = byKey[key] || { store: s.store, name: e.name, part: (catalogEntry(e.name) || {}).part || s.part, exposures: [] }).exposures.push({
        date: s.date, sets: e.sets, top, rating: e.rating || s.rating || '', target: e.target, plannedSets: e.plannedSets, legacy: !!e.legacy, equipment: e.equipment, loadType: e.loadType
      });
    }));
    Object.values(byKey).forEach(stat => {
      const ex = stat.exposures;
      stat.count = ex.length;
      stat.last = ex[ex.length - 1];
      const pts = ex.filter(x => x.top).slice(-8).map(x => [dayIndex(x.date), x.top.e1rm]);
      stat.bestE1rm = Math.max(0, ...ex.filter(x => x.top).map(x => x.top.e1rm));
      if (pts.length >= 2 && pts[pts.length - 1][0] > pts[0][0]) {
        const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
        stat.growthPctPerWeek = my > 0 ? Math.round(slope * 7 / my * 1000) / 10 : 0;
      } else stat.growthPctPerWeek = null;
      const lastTops = ex.filter(x => x.top).slice(-3).map(x => x.top.e1rm);
      stat.stalled = lastTops.length >= 3 && Math.max(...lastTops.slice(1)) <= lastTops[0] * 1.005;
      const weights = [...new Set(ex.flatMap(x => x.sets.map(s => s.weight)).filter(w => w > 0))].sort((a, b) => a - b);
      const diffs = weights.slice(1).map((w, i) => Math.round((w - weights[i]) * 100) / 100).filter(d => d > 0);
      stat.increment = diffs.length ? Math.max(1, Math.min(...diffs)) : null;
      stat.daysSince = now - dayIndex(stat.last.date);
    });
    const partLast = {}, weekSets = {};
    sessions.forEach(s => {
      const parts = new Set(s.exercises.map(e => (catalogEntry(e.name) || {}).part || s.part).filter(Boolean));
      if (s.part && s.part !== 'fullbody') parts.add(s.part);
      Object.keys(s.partSets || {}).forEach(p => parts.add(p));
      parts.forEach(p => { partLast[p] = s.date; });
      if (now - dayIndex(s.date) < 7) {
        s.exercises.forEach(e => { const p = (catalogEntry(e.name) || {}).part || s.part; if (p) weekSets[p] = (weekSets[p] || 0) + e.sets.length; });
        if (!s.exercises.length) Object.entries(s.partSets || {}).forEach(([p, n]) => { weekSets[p] = (weekSets[p] || 0) + n; });
      }
    });
    const recent = (Array.isArray(records) ? records : []).filter(r => r && r.date && now - dayIndex(r.date) <= 2 && now - dayIndex(r.date) >= 0);
    const fatigue = Math.max(0, ...recent.map(r => num(r.fatigue) || 0));
    // 痛みは「最新の報告」を採用する。後のセッションで痛みの記載がなければ以前の痛みは解除。
    let pain = {};
    sessions.filter(s => now - dayIndex(s.date) <= 10).forEach(s => { pain = { ...(s.pain || {}) }; });
    recent.forEach(r => Object.entries(parsePain(`${r.condition || ''} ${r.workoutRequest || ''}`)).forEach(([k, v]) => { pain[k] = Math.max(pain[k] || 0, v); }));
    const storeExercises = {};
    sessions.forEach(s => { if (!s.store) return; const set = storeExercises[s.store] = storeExercises[s.store] || new Set(); s.exercises.forEach(e => set.add(e.name)); });
    const counts = { total: sessions.length, withWeights: sessions.filter(x => x.exercises.some(e => e.sets.some(t => t.weight > 0))).length, textOnly: sessions.filter(x => x.source === 'text' && !x.exercises.length).length, unknownStore: sessions.filter(x => !x.store).length, byStore: { honten: sessions.filter(x => x.store === 'honten').length, shioda: sessions.filter(x => x.store === 'shioda').length } };
    return { sessions, byKey, partLast, weekSets, fatigue, pain, counts, storeExercises: Object.fromEntries(Object.entries(storeExercises).map(([k, v]) => [k, [...v]])), totalSessions: sessions.length };
  }

  function recommendPart(analysis, prefs, todayDate) {
    const order = (prefs && Array.isArray(prefs.split) && prefs.split.length ? prefs.split : PART_ORDER).filter(p => PARTS[p]);
    const now = dayIndex(todayDate || new Date().toISOString().slice(0, 10));
    let best = order[0], bestScore = -Infinity;
    order.forEach((p, i) => {
      const last = analysis.partLast[p];
      const score = (last ? now - dayIndex(last) : 99) - i * 0.01;
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
  }

  function prefsNormalized(prefs) {
    const p = prefs && typeof prefs === 'object' ? prefs : {};
    const list = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
    const stores = {};
    Object.keys(STORES).forEach(id => { const s = p.stores && p.stores[id] || {}; stores[id] = { missing: list(s.missing).map(canonicalName), available: list(s.available).map(canonicalName) }; });
    return { unknownStoreAs: STORES[p.unknownStoreAs] ? p.unknownStoreAs : '', avoid: list(p.avoid).map(canonicalName), prefer: list(p.prefer).map(canonicalName), notes: list(p.notes), split: list(p.split).filter(x => PARTS[x]), stores, defaultMinutes: num(p.defaultMinutes), level: ['beginner', 'intermediate', 'high'].includes(p.level) ? p.level : '' };
  }

  function painPenalty(entry, pain) {
    let worst = 0;
    Object.entries(pain || {}).forEach(([site, score]) => { if ((PAIN_MOVES[site] || []).some(m => entry.moves.includes(m))) worst = Math.max(worst, score); });
    return worst;
  }

  /* ---------- ローカル計画（即時・オフライン） ---------- */
  function planSession(opts) {
    const o = opts || {};
    const store = normalizeStore(o.store) || 'honten', part = PARTS[o.part] ? o.part : 'fullbody';
    const prefs = prefsNormalized(o.prefs);
    const level = ['beginner', 'intermediate', 'high'].includes(o.level) ? o.level : (prefs.level || 'intermediate');
    const minutes = Math.max(20, Math.min(120, num(o.minutes) || prefs.defaultMinutes || 60));
    const analysis = o.analysis || analyze(o.records || [], o.today, o.prefs);
    const pain = { ...analysis.pain, ...parsePain(o.request || '') };
    const fatigue = Math.max(analysis.fatigue || 0, /疲れ|だる|寝不足|睡眠不足/.test(o.request || '') ? 4 : 0);
    const missing = new Set(prefs.stores[store].missing), avoid = new Set(prefs.avoid), prefer = prefs.prefer;
    const known = new Set([...(analysis.storeExercises[store] || []), ...prefs.stores[store].available]);
    const warnings = [];

    let pool = part === 'fullbody' ? FULLBODY.map(n => CATALOG.find(e => e.name === n)) : CATALOG.filter(e => e.part === part);
    // 店舗で実施実績のある未登録種目（カタログ外）も候補に含める
    Object.values(analysis.byKey).filter(s => s.store === store && !catalogEntry(s.name) && (part === 'fullbody' || inferPart(s.name) === part || s.part === part))
      .forEach(s => pool.push({ name: s.name, aliases: [], part: s.part || part, kind: 'isolation', reps: [10, 15], moves: [] }));
    pool = pool.filter(e => e && !missing.has(e.name) && !avoid.has(e.name));
    const scored = pool.map((e, i) => {
      const stat = analysis.byKey[`${store}|${e.name}`];
      const pen = painPenalty(e, pain);
      let score = 100 - i;
      if (prefer.includes(e.name)) score += 60;
      if (known.has(e.name)) score += 40;
      if (stat) score += Math.min(20, stat.count * 2);
      if (stat && stat.stalled && stat.count >= 4) score -= 15; // 停滞種目は入替候補
      if (e.kind === 'compound') score += 10;
      if (pen >= 6) score -= 200; else if (pen >= 3) score -= 40;
      return { e, stat, pen, score };
    }).filter(x => x.score > -50).sort((a, b) => b.score - a.score);

    const base = { beginner: { sets: 2, rir: 3 }, intermediate: { sets: 3, rir: 2 }, high: { sets: 4, rir: 1 } }[level];
    let baseSets = base.sets;
    const weekly = part === 'fullbody' ? 0 : (analysis.weekSets[part] || 0);
    if (fatigue >= 4) { baseSets = Math.max(2, baseSets - 1); warnings.push(`疲労感${fatigue}/5のため、セット数を1減らし余力を多めに残します。`); }
    if (weekly >= 14) { baseSets = Math.max(2, baseSets - 1); warnings.push(`この7日間で${PARTS[part]}は${weekly}セット実施済みのため、量を増やしません。`); }

    // 時間配分：1セット≒作業45秒＋休憩、種目間移動60秒、準備5分
    const budget = (minutes - 5) * 60;
    const chosen = [];
    let used = 0;
    for (const x of scored) {
      const rest = x.e.kind === 'compound' ? 150 : 75;
      const n = baseSets;
      const cost = n * (45 + rest) + 60;
      if (chosen.length >= 2 && used + cost > budget) continue;
      if (chosen.length >= (part === 'fullbody' ? 6 : 5)) break;
      chosen.push({ ...x, rest, n }); used += cost;
    }
    const painSites = Object.entries(pain).filter(([site, v]) => v >= 3 && (part === 'fullbody' ? true : pool.some(e => (PAIN_MOVES[site] || []).some(m => e.moves.includes(m)))));
    painSites.forEach(([k, v]) => warnings.push(`${k}の痛み${v}/10：関連する種目は重量を下げるか除外しています。痛みが強くなる場合は中止してください。`));
    if (!chosen.length) warnings.push('この店舗で選べる種目がありません。恒久設定の「ない器具」を確認してください。');

    const exercises = chosen.map(({ e, stat, pen, rest, n }) => prescribe(e, stat, { store, level, rir: base.rir + (fatigue >= 4 ? 1 : 0), sets: n, rest, pen, analysis }));
    const totalSets = exercises.reduce((a, x) => a + x.sets, 0);
    const estMinutes = Math.round((used / 60) + 5);
    return {
      id: uid(), store, part, minutes, level, source: 'local', createdAt: new Date().toISOString(),
      basedOnSessions: analysis.totalSessions,
      summary: `${storeLabel(store)}・${PARTS[part]}｜${exercises.length}種目 合計${totalSets}セット｜約${estMinutes}分`,
      warnings, exercises,
      evidence: ['volume-dose', 'progression-reps-or-load', 'rir-near-failure', 'rest-strength'].concat(fatigue >= 4 ? ['failure-fatigue'] : [])
    };
  }

  function prescribe(entry, stat, ctx) {
    const [lo, hi] = entry.reps;
    const ex = { id: uid(), name: entry.name, part: entry.part, kind: entry.kind, loadType: 'total', weight: null, repsTarget: [lo, hi], reps: lo, sets: ctx.sets, restSec: ctx.rest, rir: Math.min(4, ctx.rir), reason: '', evidence: [], unconfirmed: false, reference: '' };
    const known = (ctx.analysis.storeExercises[ctx.store] || []).includes(entry.name);
    if (ctx.pen >= 3) { ex.rir = Math.max(ex.rir, 3); ex.repsTarget = [Math.max(lo, 12), Math.max(hi, 15)]; ex.reps = ex.repsTarget[0]; ex.evidence.push('load-range'); }
    if (!stat || !stat.last.top || stat.last.top.weight === null) {
      // 同じ店舗の重量実績がない → 重量を作らない。他店舗の実績は参考表示のみ。
      const other = Object.values(ctx.analysis.byKey).filter(s => s.name === entry.name && s.store !== ctx.store && s.last.top && s.last.top.weight).sort((a, b) => a.daysSince - b.daysSince)[0];
      ex.reference = other ? `${storeLabel(other.store)}では${other.last.top.weight}kg×${other.last.top.reps}回（器具が違うため参考のみ）` : '';
      ex.unconfirmed = !known;
      ex.reason = stat ? `${storeLabel(ctx.store)}での重量記録がないため、1セット目で確認重量を決めます（目標：残り${ex.rir}回で${ex.repsTarget[0]}〜${ex.repsTarget[1]}回）。` : `${storeLabel(ctx.store)}での実施記録がない種目です。軽めから確認し、残り${ex.rir}回で${ex.repsTarget[0]}〜${ex.repsTarget[1]}回になる重量を探してください。`;
      ex.evidence.push('rir-scale');
      return ex;
    }
    const last = stat.last, top = last.top, w = top.weight, r = top.reps;
    ex.loadType = last.loadType || 'total';
    // 増量幅：記録上の最小刻み、なければ重量の約5%（2.5kg単位）。いずれも前回比10%以内に制限。
    const step = Math.min(Math.max(1, w * 0.1), stat.increment || Math.max(1.25, Math.round(w * 0.05 / 2.5) * 2.5));
    const completedAll = last.sets.length >= Math.max(1, (last.plannedSets || last.sets.length)) && last.sets.every(s => s.reps >= hi);
    const minReps = Math.min(...last.sets.map(s => s.reps));
    const lastDesc = `前回（${last.date.slice(5).replace('-', '/')}）${w}kg×${last.sets.map(s => s.reps).join('/')}回`;
    if (ctx.pen >= 3) {
      ex.weight = round(w * 0.8, step >= 2.5 ? 2.5 : 0.5); ex.reps = ex.repsTarget[0];
      ex.reason = `${lastDesc}。痛みがあるため重量を約2割下げ、回数を増やして刺激を保ちます。`;
    } else if (stat.stalled && stat.count >= 4) {
      ex.weight = round(w * 0.9, step >= 2.5 ? 2.5 : 0.5); ex.reps = Math.min(hi, r + 2);
      ex.reason = `${lastDesc}。直近3回で推定最大筋力が伸びていないため、重量を約1割下げて回数を伸ばし直します。`;
      ex.evidence.push('progression-reps-or-load');
    } else if (last.rating === 'hard' || minReps < lo) {
      ex.weight = w; ex.reps = Math.max(lo, Math.min(hi, minReps));
      ex.reason = `${lastDesc}${last.rating === 'hard' ? '（きつい）' : ''}。同じ重量で全セット${lo}回以上をそろえることを優先します。`;
    } else if (completedAll || (last.rating === 'easy' && r >= hi - 1)) {
      ex.weight = Math.round((w + step) * 100) / 100; ex.reps = lo;
      ex.reason = `${lastDesc}${last.rating === 'easy' ? '（余裕）' : ''}。回数域上限${hi}回に達したため+${step}kg、${lo}回から再スタート。`;
      ex.evidence.push('progression-reps-or-load');
    } else {
      ex.weight = w; ex.reps = Math.min(hi, r + (last.rating === 'easy' ? 2 : 1));
      ex.reason = `${lastDesc}${last.rating === 'easy' ? '（余裕）' : ''}。同じ重量で回数を${ex.reps}回へ伸ばします（上限${hi}回で重量アップ）。`;
      ex.evidence.push('progression-reps-or-load');
    }
    if (stat.growthPctPerWeek !== null && stat.count >= 3) ex.reason += ` 成長率：推定最大筋力 週${stat.growthPctPerWeek > 0 ? '+' : ''}${stat.growthPctPerWeek}%。`;
    if (last.legacy) ex.reason += '（前回は旧形式の記録のため、セットごとの差は不明）';
    ex.evidence.push('rir-near-failure');
    return ex;
  }

  /* ---------- AI応答の検証 ---------- */
  // AIの計画を、同店舗の実績に照らして安全範囲へ補正する。根拠のない重量は消す。
  function validateAiPlan(aiPlan, localPlan, analysis, prefs) {
    if (!aiPlan || !Array.isArray(aiPlan.exercises) || !aiPlan.exercises.length) return null;
    const p = prefsNormalized(prefs), store = localPlan.store;
    const missing = new Set(p.stores[store].missing), avoid = new Set(p.avoid);
    const notes = [];
    const exercises = aiPlan.exercises.slice(0, 8).map(raw => {
      const name = canonicalName(raw.name), entry = catalogEntry(name);
      if (!name || missing.has(name) || avoid.has(name)) { if (name) notes.push(`${name}は恒久設定で除外しているため外しました。`); return null; }
      const stat = analysis.byKey[`${store}|${name}`];
      const lo = Math.max(1, Math.min(30, firstInt(raw.repsMin) || firstInt(raw.reps) || (entry ? entry.reps[0] : 8)));
      const hi = Math.max(lo, Math.min(30, firstInt(raw.repsMax) || (entry ? entry.reps[1] : lo + 4)));
      let weight = num(raw.weight);
      const lastW = stat && stat.last.top ? stat.last.top.weight : null;
      if (weight !== null) {
        if (lastW === null) { weight = null; notes.push(`${name}：${storeLabel(store)}の重量実績がないため、AIの重量は採用せず確認重量にしました。`); }
        else if (weight > lastW * 1.1 + 0.01) { weight = Math.round(lastW * 1.1 * 2) / 2; notes.push(`${name}：前回比+10%を超える増量は安全のため${weight}kgへ補正しました。`); }
        else if (weight < lastW * 0.5) { weight = lastW; }
      }
      return {
        id: uid(), name, part: entry ? entry.part : (inferPart(name) || localPlan.part), kind: entry ? entry.kind : 'isolation',
        loadType: ['total', 'per_side', 'bodyweight', 'assistance', 'other'].includes(raw.loadType) ? raw.loadType : (stat && stat.last.loadType) || 'total',
        weight, repsTarget: [lo, hi], reps: Math.max(lo, Math.min(hi, firstInt(raw.reps) || lo)),
        sets: Math.max(1, Math.min(6, firstInt(raw.sets) || 3)), restSec: Math.max(30, Math.min(300, firstInt(raw.restSec) || 90)),
        rir: Math.max(0, Math.min(4, num(raw.rir) ?? 2)), reason: String(raw.reason || '').slice(0, 300),
        evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).slice(0, 4) : [], unconfirmed: !(analysis.storeExercises[store] || []).includes(name) && !p.stores[store].available.includes(name),
        reference: weight === null ? ((localPlan.exercises || []).find(x => x.name === name) || {}).reference || '' : ''
      };
    }).filter(Boolean);
    if (!exercises.length) return null;
    const totalSets = exercises.reduce((a, x) => a + x.sets, 0);
    return {
      ...localPlan, id: uid(), source: 'ai', createdAt: new Date().toISOString(),
      summary: String(aiPlan.summary || '').slice(0, 300) || `${storeLabel(store)}・${PARTS[localPlan.part]}｜${exercises.length}種目 合計${totalSets}セット`,
      warnings: [...(Array.isArray(aiPlan.warnings) ? aiPlan.warnings.map(String).slice(0, 5) : []), ...notes],
      exercises, evidence: Array.isArray(aiPlan.evidence) ? aiPlan.evidence.map(String).slice(0, 8) : localPlan.evidence
    };
  }

  /* ---------- AIへ渡す要約（全履歴を圧縮） ---------- */
  function aiContext(analysis, store, part, prefs) {
    const stats = Object.values(analysis.byKey)
      .filter(s => part === 'fullbody' || s.part === part || inferPart(s.name) === part)
      .sort((a, b) => a.daysSince - b.daysSince).slice(0, 30)
      .map(s => ({
        store: storeLabel(s.store), exercise: s.name, sessions: s.count, daysSince: s.daysSince, growthPctPerWeek: s.growthPctPerWeek, stalled: s.stalled, incrementKg: s.increment,
        recent: s.exposures.slice(-4).map(x => ({ date: x.date, sets: x.sets.map(t => `${t.weight ?? '?'}x${t.reps}`).join(','), rating: x.rating || undefined, legacy: x.legacy || undefined }))
      }));
    const recentSessions = analysis.sessions.slice(-8).map(s => ({ date: s.date, store: storeLabel(s.store), part: PARTS[s.part] || s.part, rating: s.rating || undefined, exercises: s.exercises.map(e => e.name).join('・') }));
    return { totalSessions: analysis.totalSessions, store: storeLabel(store), part: PARTS[part], weeklySetsByPart: analysis.weekSets, fatigue: analysis.fatigue, pain: analysis.pain,
      storeConfirmedExercises: analysis.storeExercises[store] || [], prefs: prefsNormalized(prefs), exerciseStats: stats, recentSessions };
  }

  /* ---------- オフライン会話（AI不通時の最低限の変更） ---------- */
  function localChat(message, plan, prefs) {
    const text = String(message || '').trim();
    const p = prefsNormalized(prefs);
    const permanent = /今後|いつも|毎回|ずっと|恒久|これから|次から/.test(text);
    const changes = [];
    let newPlan = plan ? JSON.parse(JSON.stringify(plan)) : null;
    const replies = [];
    const names = CATALOG.flatMap(e => [e.name, ...e.aliases].map(n => [n, e.name])).sort((a, b) => b[0].length - a[0].length);
    const findName = s => { const k = clean(s); const hit = names.find(([n]) => k.includes(clean(n))); return hit ? hit[1] : (newPlan && newPlan.exercises.find(e => k.includes(clean(e.name))) || {}).name || ''; };
    const storeId = normalizeStore(text) || (plan && plan.store) || '';
    let m;
    if ((m = text.match(/(.+?)(?:が|は)(?:ない|無い|なかった|置いてない|使えない|壊れて)/)) && /店|ジム|ここ/.test(text)) {
      const name = findName(m[1].replace(/^.*?(?:本店|塩田店|店)(?:に|で|には|では)/, ''));
      if (name && storeId) { changes.push({ action: 'add', type: 'missing_equipment', value: name, store: storeId }); replies.push(`${storeLabel(storeId)}には「${name}」がない設定にしました（次回以降も反映）。`); }
    } else if ((m = text.match(/(.+?)(?:を|は)?(?:外して|抜いて|なしで|無しで|やめ|やらない|削除|カット)/))) {
      const name = findName(m[1]);
      if (name) {
        if (newPlan) newPlan.exercises = newPlan.exercises.filter(e => e.name !== name);
        if (permanent) changes.push({ action: 'add', type: 'avoid', value: name, store: null });
        replies.push(`「${name}」を${permanent ? '今後のメニューからも' : '今日のメニューから'}外しました。`);
      }
    } else if ((m = text.match(/(.+?)(?:を|は)?(?:入れて|追加|やりたい|優先)/))) {
      const name = findName(m[1]);
      if (name) {
        if (permanent || /優先/.test(text)) changes.push({ action: 'add', type: 'prefer', value: name, store: null });
        if (newPlan && !newPlan.exercises.some(e => e.name === name)) {
          const entry = catalogEntry(name);
          newPlan.exercises.push({ id: uid(), name, part: entry ? entry.part : newPlan.part, kind: entry ? entry.kind : 'isolation', loadType: 'total', weight: null, repsTarget: entry ? entry.reps : [10, 15], reps: entry ? entry.reps[0] : 10, sets: 3, restSec: entry && entry.kind === 'compound' ? 150 : 75, rir: 2, reason: '会話で追加。1セット目で確認重量を決めてください。', evidence: [], unconfirmed: true, reference: '' });
        }
        replies.push(`「${name}」を${newPlan ? '今日のメニューに追加しました' : '優先する設定にしました'}${permanent ? '（今後も優先）' : ''}。`);
      }
    }
    if ((m = text.match(/(\d{2,3})\s*分/)) && newPlan) { newPlan.minutes = Math.max(20, Math.min(120, +m[1])); replies.push(`時間を${newPlan.minutes}分に変更します。`); if (permanent) changes.push({ action: 'set', type: 'default_minutes', value: String(newPlan.minutes), store: null }); }
    if (/軽め|軽く|控えめ/.test(text) && newPlan) { newPlan.exercises.forEach(e => { e.sets = Math.max(1, e.sets - 1); e.rir = Math.min(4, e.rir + 1); }); replies.push('全種目を1セット減らし、余力を多めに残す設定にしました。'); }
    if (permanent && !changes.length && text.length >= 4) { changes.push({ action: 'add', type: 'note', value: text.slice(0, 120), store: null }); replies.push('今後のメニュー作成で考慮するメモとして保存しました。'); }
    if (newPlan) newPlan.summary = `${storeLabel(newPlan.store)}・${PARTS[newPlan.part]}｜${newPlan.exercises.length}種目 合計${newPlan.exercises.reduce((a, x) => a + x.sets, 0)}セット（会話で変更）`;
    return { reply: replies.join('\n') || 'AIに接続できないため、この内容は自動で反映できませんでした。種目カードの「変更」「削除」で直接調整できます。', plan: replies.length && newPlan ? newPlan : null, preferenceChanges: changes, offline: true };
  }

  function applyPreferenceChanges(prefs, changes) {
    const p = prefsNormalized(prefs);
    (Array.isArray(changes) ? changes : []).forEach(c => {
      if (!c || !c.type) return;
      const value = c.type === 'note' ? String(c.value || '').trim().slice(0, 160) : canonicalName(c.value);
      if (!value) return;
      const remove = c.action === 'remove';
      const edit = (arr) => { const i = arr.indexOf(value); if (remove) { if (i >= 0) arr.splice(i, 1); } else if (i < 0) arr.push(value); };
      if (c.type === 'avoid') { edit(p.avoid); if (!remove) p.prefer = p.prefer.filter(x => x !== value); }
      else if (c.type === 'prefer') { edit(p.prefer); if (!remove) p.avoid = p.avoid.filter(x => x !== value); }
      else if (c.type === 'note') edit(p.notes);
      else if (c.type === 'default_minutes') p.defaultMinutes = remove ? null : Math.max(20, Math.min(120, firstInt(c.value) || 60));
      else if (c.type === 'missing_equipment' || c.type === 'available_equipment') {
        const ids = normalizeStore(c.store) ? [normalizeStore(c.store)] : Object.keys(STORES);
        ids.forEach(id => {
          const s = p.stores[id];
          if (c.type === 'missing_equipment') { const i = s.missing.indexOf(value); if (remove) { if (i >= 0) s.missing.splice(i, 1); } else { if (i < 0) s.missing.push(value); s.available = s.available.filter(x => x !== value); } }
          else { const i = s.available.indexOf(value); if (remove) { if (i >= 0) s.available.splice(i, 1); } else { if (i < 0) s.available.push(value); s.missing = s.missing.filter(x => x !== value); } }
        });
      }
    });
    return p;
  }

  /* ---------- セッション ---------- */
  function newSession(plan, date, nowIso) {
    return {
      id: uid(), planId: plan.id, planSource: plan.source, store: plan.store, part: plan.part, date, status: 'active',
      startedAt: nowIso, updatedAt: nowIso, finishedAt: null,
      exercises: plan.exercises.map(e => ({
        id: e.id || uid(), name: e.name, part: e.part, loadType: e.loadType, repsTarget: e.repsTarget, rir: e.rir, restSec: e.restSec, reason: e.reason, unconfirmed: e.unconfirmed,
        sets: Array.from({ length: e.sets }, () => ({ weight: e.weight, reps: e.reps, done: false, doneAt: null })), rating: ''
      })),
      feedback: { overall: '', pain: '', note: '' }
    };
  }

  // 終了したセッションを日別記録の既存項目（旧形式）へ要約する。旧画面・既存AI相談と互換。
  function sessionRecordFields(session) {
    const done = session.exercises.map(e => ({ e, sets: e.sets.filter(s => s.done) })).filter(x => x.sets.length);
    const minutes = Math.max(1, Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 60000) || 0);
    const planned = session.exercises.reduce((a, e) => a + e.sets.length, 0), completed = done.reduce((a, x) => a + x.sets.length, 0);
    const workoutExercises = done.map(({ e, sets }) => {
      const top = sets.reduce((b, s) => (num(s.weight) || 0) >= (num(b.weight) || 0) ? s : b, sets[0]);
      return { name: e.name, equipment: '', loadType: e.loadType || 'total', weight: num(top.weight), reps: firstInt(top.reps), sets: sets.length, restSeconds: e.restSec || null, note: `実績 ${sets.map(s => `${num(s.weight) ?? '自重'}×${firstInt(s.reps)}`).join(' / ')}${e.rating ? `（${{ easy: '余裕', ok: 'ちょうど', hard: 'きつい' }[e.rating]}）` : ''}` };
    });
    const ratingText = { easy: '余裕あり', ok: 'ちょうど良い', hard: 'きつかった' }[session.feedback.overall] || '';
    return {
      workoutPlace: storeLabel(session.store), workoutPart: session.part, workoutMinutes: minutes,
      workoutCompletion: completed === 0 ? 'stopped' : completed >= planned ? 'completed' : 'partial',
      workoutFeedback: [ratingText, session.feedback.pain, session.feedback.note].filter(Boolean).join('。').slice(0, 500),
      workoutExercises, workoutExercisesJson: JSON.stringify(workoutExercises),
      strength: done.map(({ e, sets }) => `${e.name}：${sets.map(s => `${num(s.weight) ?? '自重'}kg×${firstInt(s.reps)}`).join('、')}`).join('\n'),
      strengthIntensity: session.feedback.overall === 'hard' ? 'hard' : session.feedback.overall === 'easy' ? 'light' : 'moderate',
      completedSets: completed, plannedSets: planned
    };
  }

  function planText(plan) {
    return `【${plan.summary}】\n` + plan.exercises.map((e, i) => `${i + 1}. ${e.name}：${e.weight === null ? '確認重量' : e.weight + 'kg'}／${e.reps}回（${e.repsTarget[0]}〜${e.repsTarget[1]}）×${e.sets}セット／休憩${e.restSec}秒／残り${e.rir}回`).join('\n');
  }

  const api = { parseFreeText, STORES, PARTS, PART_ORDER, CATALOG, normalizeStore, storeLabel, catalogEntry, canonicalName, inferPart, parsePain, extractSessions, analyze, recommendPart, prefsNormalized, planSession, validateAiPlan, aiContext, localChat, applyPreferenceChanges, newSession, sessionRecordFields, planText, e1rm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WorkoutEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
