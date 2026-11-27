/* AI Life Navi 筋トレコーチ：計画エンジン v23（DOM非依存・オフライン動作）
 * プログラムが担当：履歴の抽出・集計、店舗/重量方式の照合、セット単位の計画、時間配分、動線、
 *                   集計（セット数・レップ数・消費kcal）、前回比較、AI出力の検証。
 * AIが担当（Worker）：全体の判断・種目選択・会話・評価。AIが失敗してもこのエンジンだけで筋トレを継続できる。
 */
(function (root) {
  'use strict';

  const STORES = {
    honten: { id: 'honten', label: '本店' },
    shioda: { id: 'shioda', label: '塩田店' }
  };
  const PARTS = { chest: '胸', back: '背中', shoulders: '肩', legs: '脚', arms: '腕' };
  const PART_LABELS = { ...PARTS, fullbody: '全身' };
  const ROTATION = ['chest', 'back', 'shoulders', 'legs', 'arms'];

  // 重量方式（spec 3）：ダンベルは片手・店舗共通、プレート式は片側、バーベルは総重量、マシン/ケーブルは店舗・機器別
  const EQUIP = {
    machine: { label: 'マシン', unit: 'kg', shared: false },
    cable: { label: 'ケーブル', unit: 'kg', shared: false },
    plate: { label: 'プレート式・片側', unit: 'kg（片側）', shared: false },
    dumbbell: { label: 'ダンベル・片手', unit: 'kg（片手）', shared: true },
    barbell: { label: 'バーベル・総重量', unit: 'kg（総重量）', shared: false },
    smith: { label: 'スミス', unit: 'kg（本人の記録方式）', shared: false },
    ez: { label: 'EZバー', unit: 'kg（片側プレート）', shared: false },
    bodyweight: { label: '自重', unit: '自重', shared: true }
  };

  const C = (name, part, equip, kind, reps, extra = {}) => ({ name, part, equip, kind, reps, aliases: [], moves: [], ...extra });
  const CATALOG = [
    // 胸
    C('インクラインDBプレス', 'chest', 'dumbbell', 'compound', [8, 12], { aliases: ['インクラインダンベルプレス', 'インクラインDBベンチ'], moves: ['press'] }),
    C('ISOデクラインプレス', 'chest', 'plate', 'compound', [10, 15], { aliases: ['アイソデクラインプレス', 'ISOデクライン', 'ISOデクラインプレス片側'], moves: ['press'] }),
    C('チェストプレス', 'chest', 'machine', 'compound', [10, 15], { aliases: ['マシンチェストプレス'], moves: ['press'] }),
    C('ペックフライ', 'chest', 'machine', 'isolation', [12, 15], { aliases: ['ペクトラルフライ', 'ペックデック', 'マシンフライ'], moves: ['fly'] }),
    C('ベンチインクライン・ケーブルフライ', 'chest', 'cable', 'isolation', [12, 15], { aliases: ['ベンチインクラインケーブルフライ', 'インクラインケーブルフライ', 'ベンチインクライン・ケーブルフライ片側'], moves: ['fly'], needs: { cable: 1, bench: true } }),
    C('ケーブルフライ', 'chest', 'cable', 'isolation', [12, 15], { aliases: ['ケーブルクロスオーバー'], moves: ['fly'] }),
    C('ベンチプレス', 'chest', 'barbell', 'compound', [6, 10], { moves: ['press'] }),
    C('スミスインクライン', 'chest', 'smith', 'compound', [8, 12], { aliases: ['スミスインクラインプレス'], moves: ['press'] }),
    C('ダンベルフライ', 'chest', 'dumbbell', 'isolation', [10, 15], { moves: ['fly'] }),
    C('ディップス', 'chest', 'bodyweight', 'compound', [6, 12], { moves: ['press'] }),
    // 背中
    C('ラットプルダウン・ワイド', 'back', 'machine', 'compound', [10, 12], { aliases: ['ラットプルダウン（ワイド）', 'ワイドグリップラットプルダウン'], moves: ['pull'] }),
    C('ニュートラルグリッププルダウン', 'back', 'machine', 'compound', [10, 12], { aliases: ['ナローグリッププルダウン', 'パラレルグリッププルダウン'], moves: ['pull'] }),
    C('ラットプルダウン', 'back', 'machine', 'compound', [10, 12], { moves: ['pull'] }),
    C('シーテッドロー', 'back', 'machine', 'compound', [10, 13], { aliases: ['シーテッドロウ', 'マシンロー'], moves: ['row'] }),
    C('ワイドラットプルダウン・プレート式', 'back', 'plate', 'compound', [10, 12], { aliases: ['ワイドラットプルダウン（プレート式）', 'プレート式ワイドラットプルダウン'], moves: ['pull'] }),
    C('ケーブルプルオーバー', 'back', 'cable', 'isolation', [12, 15], { moves: ['pull'] }),
    C('マシンプルオーバー', 'back', 'machine', 'isolation', [12, 15], { aliases: ['プルオーバーマシン'], moves: ['pull'] }),
    C('ローロウ', 'back', 'plate', 'compound', [10, 12], { aliases: ['ローロー', 'ロウロウ'], moves: ['row'] }),
    C('チェストサポートDBロー', 'back', 'dumbbell', 'compound', [10, 12], { aliases: ['チェストサポートダンベルロー'], moves: ['row'] }),
    C('ワンハンドロー', 'back', 'dumbbell', 'compound', [10, 12], { aliases: ['ワンハンドダンベルロー'], moves: ['row'] }),
    C('バーベルベントオーバーロウ', 'back', 'barbell', 'compound', [6, 10], { aliases: ['ベントオーバーロウ', 'ベントオーバーロー', 'バーベルロー'], moves: ['row', 'lowback'] }),
    C('チンニング', 'back', 'bodyweight', 'compound', [5, 10], { aliases: ['懸垂'], moves: ['pull'] }),
    C('アシストチンニング', 'back', 'machine', 'compound', [8, 12], { aliases: ['アシスト懸垂', 'アシストプルアップ'], moves: ['pull'] }),
    // 肩
    C('マシンショルダープレス', 'shoulders', 'machine', 'compound', [8, 12], { aliases: ['ショルダープレス'], moves: ['overhead'] }),
    C('DBサイドレイズ', 'shoulders', 'dumbbell', 'isolation', [12, 20], { aliases: ['ダンベルサイドレイズ', 'サイドレイズ'], moves: ['raise'] }),
    C('Hammer Strengthラテラルレイズ', 'shoulders', 'plate', 'isolation', [12, 16], { aliases: ['HSラテラルレイズ', 'ハンマーストレングスラテラルレイズ', 'Hammer Strength ラテラルレイズ'], moves: ['raise'] }),
    C('リアデルトマシン', 'shoulders', 'machine', 'isolation', [12, 20], { moves: ['raise'] }),
    C('リアデルトフライ', 'shoulders', 'machine', 'isolation', [10, 15], { aliases: ['リアデルトフライマシン'], moves: ['raise'] }),
    C('片手ケーブルサイドレイズ', 'shoulders', 'cable', 'isolation', [12, 16], { aliases: ['ケーブルサイドレイズ', 'ケーブルサイドレイズ片手'], moves: ['raise'] }),
    C('ケーブルリアレイズ', 'shoulders', 'cable', 'isolation', [12, 20], { aliases: ['ケーブルリアデルトレイズ'], moves: ['raise'] }),
    C('フェイスプル', 'shoulders', 'cable', 'isolation', [10, 15], { moves: ['raise'] }),
    // 脚
    C('レッグプレス', 'legs', 'plate', 'compound', [12, 15], { moves: ['knee', 'lowback'], station: 'legpress' }),
    C('カーフプレス', 'legs', 'plate', 'isolation', [12, 20], { aliases: ['カーフ', 'レッグプレスカーフ', 'カーフプレス（レッグプレス）'], moves: ['calf'], station: 'legpress' }),
    C('レッグエクステンション', 'legs', 'machine', 'isolation', [12, 15], { moves: ['knee'] }),
    C('レッグカール', 'legs', 'machine', 'isolation', [12, 15], { aliases: ['シーテッドレッグカール', 'ライイングレッグカール'], moves: ['hamstring'] }),
    C('アダクション', 'legs', 'machine', 'isolation', [12, 20], { aliases: ['アダクター', 'ヒップアダクション'], moves: ['hip'] }),
    C('アブダクション', 'legs', 'machine', 'isolation', [12, 20], { aliases: ['アブダクター', 'ヒップアブダクション'], moves: ['hip'] }),
    C('ハックスクワット', 'legs', 'plate', 'compound', [8, 12], { moves: ['knee', 'lowback'] }),
    C('スクワット', 'legs', 'barbell', 'compound', [6, 10], { aliases: ['バーベルスクワット'], moves: ['knee', 'lowback'] }),
    // 腕（二頭・三頭・前腕）
    C('EZバーカール', 'arms', 'ez', 'isolation', [10, 12], { aliases: ['EZカール'], moves: ['curl'], muscle: 'biceps' }),
    C('ライイングEX', 'arms', 'ez', 'isolation', [10, 12], { aliases: ['ライイングエクステンション', 'ライイングトライセプスエクステンション'], moves: ['extension'], muscle: 'triceps' }),
    C('ケーブルカール', 'arms', 'cable', 'isolation', [12, 15], { moves: ['curl'], muscle: 'biceps' }),
    C('ケーブルプレスダウン', 'arms', 'cable', 'isolation', [12, 15], { aliases: ['プレスダウン', 'トライセプスプレスダウン'], moves: ['extension'], muscle: 'triceps' }),
    C('ハンマーカール', 'arms', 'dumbbell', 'isolation', [10, 15], { moves: ['curl'], muscle: 'biceps' }),
    C('ダンベルカール', 'arms', 'dumbbell', 'isolation', [10, 15], { aliases: ['DBカール'], moves: ['curl'], muscle: 'biceps' }),
    C('インクラインカール', 'arms', 'dumbbell', 'isolation', [10, 12], { moves: ['curl'], muscle: 'biceps' }),
    C('オーバーヘッドエクステンション', 'arms', 'cable', 'isolation', [12, 15], { aliases: ['ケーブルオーバーヘッドエクステンション'], moves: ['extension'], muscle: 'triceps' }),
    C('プリーチャーカール', 'arms', 'machine', 'isolation', [10, 15], { aliases: ['マシンカール'], moves: ['curl'], muscle: 'biceps' }),
    C('リストカール', 'arms', 'dumbbell', 'isolation', [15, 20], { moves: ['wrist'], muscle: 'forearm' }),
    C('リバースカール', 'arms', 'ez', 'isolation', [12, 15], { moves: ['wrist', 'curl'], muscle: 'forearm' })
  ];

  // 本人の管理条件（spec 2）：設定画面で訂正できる初期値
  const DEFAULT_PROFILE = {
    sex: 'male', age: 47, heightCm: 181, startWeight: 127.4, goalWeight: 95,
    goal: '減量中の筋量維持と筋肥大', frequency: '週5〜6回', rotation: ROTATION.slice(),
    minutes: [50, 75], setsTarget: [20, 25],
    injuries: ['頸部ヘルニアの既往', '肩の痛み', '肘の内側・外側の痛み', '腰痛', '足底の痛みの既往'],
    excluded: ['バーベルベントオーバーロウ'],
    cautions: [{ exercise: 'ベンチプレス', note: '肩痛を誘発することがある' }, { exercise: 'スミスインクライン', note: '肩痛を誘発することがある' }],
    restTimer: true
  };
  // 本人固有の種目評価（spec 7）：効き方・痛み・好み・設備を別々に保存
  const DEFAULT_RATINGS = [
    { exercise: 'インクラインDBプレス', aspect: 'effect', value: 'good', note: '胸への刺激が良い' },
    { exercise: 'ベンチプレス', aspect: 'pain', value: 'caution', note: '肩痛に注意' },
    { exercise: 'スミスインクライン', aspect: 'pain', value: 'caution', note: '肩痛に注意' },
    { exercise: 'ベンチインクライン・ケーブルフライ', aspect: 'effect', value: 'good', note: '通常のケーブルフライより胸に効く。ベンチとケーブルが空いていれば優先' },
    { exercise: 'ケーブルフライ', aspect: 'priority', value: 'low', note: 'ベンチインクライン方式を優先（別種目として管理）' },
    { exercise: 'バーベルベントオーバーロウ', aspect: 'priority', value: 'exclude', note: '腰への負担のため除外' },
    { exercise: 'チェストサポートDBロー', aspect: 'effect', value: 'low', note: '効き方の評価が低い。優先度を下げる' },
    { exercise: 'シーテッドロー', aspect: 'effect', value: 'note', note: '本店では75kgまでが効かせやすい。高重量より効かせられる重量を優先' },
    { exercise: 'ローロウ', aspect: 'preference', value: 'note', note: '疲労が大きいので休憩を十分に確保' },
    { exercise: 'ケーブルリアレイズ', aspect: 'priority', value: 'high', note: '優先候補' },
    { exercise: 'DBサイドレイズ', aspect: 'preference', value: 'note', note: '反動とフォームに注意' },
    { exercise: 'マシンショルダープレス', aspect: 'pain', value: 'caution', note: '重量は肩の痛みを確認しながら決める。前日の胸・背中の疲労を考慮' },
    { exercise: 'レッグプレス', aspect: 'priority', value: 'high', note: '主力。腰への負担に注意' },
    { exercise: 'カーフプレス', aspect: 'equipment', value: 'note', note: 'レッグプレスと同じ器具なら連続で実施' },
    { exercise: 'ライイングEX', aspect: 'equipment', value: 'note', note: 'プレート交換の手間を考慮' },
    { exercise: '腕全般', aspect: 'preference', value: 'note', note: '二頭と三頭を交互に。肘の痛みを考慮。三頭の刺激の重複を避ける。前腕も必要に応じて' }
  ];
  // 店舗設備（spec 3）
  const STORE_EQUIPMENT = {
    honten: { cables: 2, missing: [], notes: ['ケーブル2台', 'ベンチインクライン・ケーブルフライを優先候補にできる'] },
    shioda: { cables: 1, cableBlockMinutes: 15, missing: ['マシンプルオーバー'], substitutes: { 'マシンプルオーバー': 'ケーブルプルオーバー' }, notes: ['ケーブル1台（1ブロック15分以内を目安）', 'マシンプルオーバーなし→ケーブルプルオーバーで代替'] }
  };
  // 休憩の目安（spec 5-5）
  const REST = { honten: { compound: 120, isolation: 90 }, shioda: { compound: 135, isolation: 105 } };

  const PAIN_MOVES = {
    '肩': ['press', 'overhead', 'raise', 'fly'], '肘': ['curl', 'extension', 'press'], '手首': ['curl', 'press', 'wrist'],
    '二頭': ['curl', 'pull', 'row'], '三頭': ['extension', 'press'], '腰': ['lowback', 'row', 'knee'],
    '膝': ['knee', 'hamstring'], '股関節': ['hip', 'knee'], '首': ['overhead', 'raise'], '背中': ['row', 'lowback'], '胸': ['press', 'fly']
  };

  const clean = s => String(s ?? '').replace(/[\s　＊*_`「」『』・･]/g, '').replace(/[：:]$/, '').toLowerCase();
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v)) ? null : +v;
  const firstInt = v => { if (Number.isFinite(+v) && v !== '' && v !== null) return Math.round(+v); const m = String(v ?? '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).match(/\d+/); return m ? +m[0] : null; };
  const r1 = v => Math.round(v * 10) / 10;
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

  // 種目名は「完全一致（正式名・別名）」だけを同一種目とみなす。似た名前の別機器を勝手に統合しない（spec 3・16）
  function exactEntry(name) { const k = clean(String(name ?? '').normalize('NFKC')); if (!k) return null; return CATALOG.find(e => clean(e.name) === k || e.aliases.some(a => clean(a) === k)) || null; }
  // 部位・器具の推定だけに使う部分一致（重量の統合には使わない）
  function guessEntry(name) {
    const k = clean(name); if (!k) return null;
    const exact = exactEntry(name); if (exact) return exact;
    const list = CATALOG.flatMap(e => [e.name, ...e.aliases].map(n => [clean(n), e])).sort((a, b) => b[0].length - a[0].length);
    const hit = list.find(([n]) => n.length >= 3 && k.includes(n));
    return hit ? hit[1] : null;
  }
  const catalogEntry = exactEntry;
  // 表記揺れの正規化：全角半角・空白・末尾の店舗名やメーカー名の括弧書きをそろえる（「ワイド」「プレート式」など機器を区別する語は残す）
  function normName(name) {
    let v = String(name ?? '').normalize('NFKC').replace(/[\s　]+/g, '').trim();
    v = v.replace(/[(（]([^()（）]*)[)）]$/, (m, inner) => /本店|塩田|店舗|lifefitness|ライフフィットネス|テクノジム|technogym|マトリックス|matrix|マシン$/i.test(inner.replace(/\s/g, '')) ? '' : m);
    return v;
  }
  function canonicalName(name) { const n = normName(name); const e = exactEntry(n); return e ? e.name : n; }
  function equipOf(name) {
    const e = exactEntry(name); if (e) return e.equip;
    const v = String(name || '');
    if (/DB|ダンベル/.test(v)) return 'dumbbell';
    if (/ケーブル|プーリー/.test(v)) return 'cable';
    if (/プレート|Hammer|ハンマーストレングス|ISO|アイソ/i.test(v)) return 'plate';
    if (/スミス/.test(v)) return 'smith';
    if (/EZ/i.test(v)) return 'ez';
    if (/バーベル/.test(v)) return 'barbell';
    if (/自重|懸垂|ディップス|腕立て/.test(v)) return 'bodyweight';
    const g = guessEntry(name); return g ? g.equip : 'machine';
  }
  function kindOf(name) { const e = exactEntry(name) || guessEntry(name); return e ? e.kind : 'isolation'; }
  function inferPart(text) {
    const v = String(text || '');
    const e = guessEntry(v); if (e) return e.part;
    if (/胸|チェスト|ベンチ|ペック/.test(v)) return 'chest';
    if (/背中|ラット|ロー|ロウ|プルダウン|プルオーバー/.test(v)) return 'back';
    if (/肩|ショルダー|レイズ|デルト/.test(v)) return 'shoulders';
    if (/腕|二頭|三頭|カール|プレスダウン|トライセプス|EX/.test(v)) return 'arms';
    if (/脚|下半身|レッグ|スクワット|カーフ/.test(v)) return 'legs';
    return '';
  }
  // 重量の比較キー：ダンベル・自重は店舗共通、それ以外は店舗別（spec 3）
  function weightKey(store, name) { const eq = equipOf(name); return `${EQUIP[eq] && EQUIP[eq].shared ? '*' : (store || '?')}|${canonicalName(name)}`; }

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
      const entry = guessEntry(m[1]); if (!entry) continue;
      const count = Math.max(1, Math.min(10, +(m[4] || m[5] || 1)));
      const sets = Array.from({ length: count }, () => ({ weight: +m[2], reps: +m[3] }));
      // 続けて「、170kg×12、150kg×15」と書かれたセットも同じ種目として読む
      const tail = /^\s*[、,／/]\s*(\d{1,3}(?:\.\d)?)\s*(?:kg|キロ)?\s*[×x*]\s*(\d{1,2})\s*回?/i;
      let rest = value.slice(re.lastIndex), t;
      while ((t = rest.match(tail))) { sets.push({ weight: +t[1], reps: +t[2] }); rest = rest.slice(t[0].length); re.lastIndex += t[0].length; }
      exercises.push({ name: entry.name, rawName: m[1], rating: '', legacy: true, fromText: true, sets });
    }
    const hm = value.match(/(\d+(?:\.\d+)?)\s*時間/), mm = value.match(/(\d{1,3})\s*分/);
    const minutes = hm ? Math.round(+hm[1] * 60) : mm ? +mm[1] : null;
    if (!exercises.length && !Object.keys(partSets).length) return null;
    return { partSets, exercises, minutes };
  }

  const NOT_EXERCISE = /合計|休憩|時間|体重|目標|kcal|カロリー|有酸素|ウォーミング|アップ$|ストレッチ|睡眠|食事|たんぱく|プロテイン|総セット|消費/;
  function parseImport(text, defaultStore) {
    const lines = toHalf(text).replace(/[①-⑳]/g, ' ').split(/\r?\n/);
    let store = normalizeStore(defaultStore) || '', part = '';
    const entries = [], notes = [];
    for (const raw of lines) {
      const line = raw.replace(/\*\*/g, '').trim();
      if (!line) continue;
      const st = normalizeStore(line);
      // 店舗の切り替えは見出し行（「【塩田店】」「塩田店：背中」など短い行）か、種目行の中の店舗名だけ
      const hasLoadLine = /\d+(?:\.\d+)?\s*(?:kg|キロ)|\d+\s*回|自重/.test(line);
      const stripped = line.replace(/[【】\[\]（）()\s:：・\-|#*]/g, '').replace(/胸|背中|肩|腕|脚|足|全身|下半身|の日|メニュー|編|トレ/g, '');
      if (st && (/^(?:本店|塩田店?)$/.test(stripped) || hasLoadLine)) store = st;
      const hasLoad = /\d+(?:\.\d+)?\s*(?:kg|キロ)|\d+\s*回|自重/.test(line);
      if (!hasLoad) {
        const head = line.length <= 24 ? PART_WORDS.find(([, w]) => new RegExp(w).test(line)) : null;
        if (head) part = head[0];
        else if (line.length >= 6 && !st) notes.push(line.slice(0, 200));
        continue;
      }
      const body = line.replace(/^[\s\-・*●○◆■□▶>#|]*(?:\d{1,2}\s*[.．)）、:]\s*)?/, '');
      const nm = body.match(/^(.{2,30}?)[\s：:｜|(（\[]*(?=\d|自重)/);
      if (!nm) { notes.push(line.slice(0, 200)); continue; }
      let name = nm[1].replace(/[\s：:｜|(（\[【】]+$/g, '').replace(/^[【\[]|[】\]]$/g, '').replace(/[\s　]*(?:補助|自重|片側|重量|約)$/, '').trim();
      if (!name || NOT_EXERCISE.test(name) || /^\d/.test(name) || normalizeStore(name)) { notes.push(line.slice(0, 200)); continue; }
      // 一覧にない名前は、カタカナ・英字中心の種目名らしいものだけを種目として扱う（「前回全セット」等のルール文を除外）
      const looksExercise = /^[ァ-ヶーA-Za-z0-9・\s（）()一-龥]+$/.test(name) && (/^[ァ-ヶーA-Za-z0-9・\s（）()]+$/.test(name) || /懸垂|腕立て|プレス|カール|ロー|ロウ|レイズ|プル|フライ|スクワット|ディップ|エクステンション|ランジ|デッド|カーフ|シュラッグ/.test(name));
      if (!guessEntry(name) && (!looksExercise || /セット|回|前回|全/.test(name))) { notes.push(line.slice(0, 200)); continue; }
      if (guessEntry(name) && !/^[ァ-ヶーA-Za-z0-9・\s（）()一-龥]+$/.test(name)) { notes.push(line.slice(0, 200)); continue; }
      const rest = body.slice(nm[1].length);
      const w = rest.match(/(\d+(?:\.\d+)?)\s*(?:kg|キロ)/i);
      const reps = rest.match(/(\d{1,2})\s*(?:[〜~\-]\s*(\d{1,2}))?\s*回/) || rest.match(/(?:kg|キロ)\s*[×x*]\s*(\d{1,2})(?:\s*[〜~\-]\s*(\d{1,2}))?/i);
      const sets = rest.match(/(\d{1,2})\s*(?:セット|set)/i) || rest.match(/回\s*[×x*]\s*(\d{1,2})/i) || rest.match(/[×x*]\s*\d{1,2}(?:\s*[〜~\-]\s*\d{1,2})?\s*回?\s*[×x*]\s*(\d{1,2})/i);
      const restSec = rest.match(/休憩\s*(\d{2,3})\s*秒|(\d{2,3})\s*秒/);
      // 取り込みでは本人の書いた種目名を残す（一覧の正式名・別名と完全一致する時だけ正式名にそろえる）
      const key = clean(name), exact = CATALOG.find(e => clean(e.name) === key || e.aliases.some(a => clean(a) === key));
      const canon = name, entry = exact || guessEntry(name) || null; // 表示は本人の書いた名前のまま
      entries.push({ store, part: entry ? entry.part : (part || inferPart(name) || ''), name: canon.slice(0, 30),
        weight: w ? Math.min(500, +w[1]) : null, reps: reps ? Math.min(50, +reps[1]) : null, repsMax: reps && reps[2] ? Math.min(50, +reps[2]) : null,
        sets: sets ? Math.min(10, +sets[1]) : null, restSec: restSec ? Math.min(600, +(restSec[1] || restSec[2])) : null, note: /自重/.test(rest) ? '自重' : /補助|アシスト/.test(line) && w ? '補助' : '' });
    }
    // 方針として残すのは、避ける・痛み・好み・分割などの指示だけ（役割指定や依頼文は残さない）
    const directive = /避け|痛|違和感|しびれ|NG|禁止|しない|やらない|優先|好き|嫌い|苦手|分割|曜日|週\d|頻度|やりたい|注意/;
    const roleLine = /あなたは|コーチです|してください|作って|ください|メニューです|以下/;
    return { entries, notes: notes.filter(n => directive.test(n) && !roleLine.test(n)).slice(0, 10) };
  }


  /* ---------- 履歴の抽出（全履歴） ----------
   * v23セッション（セット単位・準備/本・予定/実績）、v22セッション、旧形式（種目単位）、自由記述、取り込みをすべて読む。
   * 実績として扱うのは完了チェック済みのセットだけ（spec 5-3）。 */
  function extractSessions(records, prefs) {
    const sessions = [];
    const unknownAs = prefs && STORES[prefs.unknownStoreAs] ? prefs.unknownStoreAs : '';
    const storeOf = place => normalizeStore(place) || unknownAs;
    (Array.isArray(records) ? records : []).filter(r => r && r.date && !r._deleted).forEach(r => {
      const finished = Array.isArray(r.workoutSessions) ? r.workoutSessions.filter(s => s && s.status === 'finished') : [];
      if (finished.length) {
        finished.forEach(s => sessions.push({
          id: s.id, date: r.date, store: storeOf(s.store), part: s.part || '', source: 'session', startedAt: s.startedAt, finishedAt: s.finishedAt,
          rating: s.feedback && s.feedback.overall || '', fatigue: num(s.fatigue ?? r.fatigue),
          pain: parsePain(`${s.pain || ''} ${s.feedback && s.feedback.pain || ''} ${s.feedback && s.feedback.note || ''}`), painText: s.pain || (s.feedback && s.feedback.pain) || '',
          minutes: s.finishedAt && s.startedAt ? Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000) : null,
          exercises: (s.exercises || []).map(e => ({
            name: canonicalName(e.name), rawName: e.name, equip: e.equip || equipOf(e.name), rating: e.rating || '',
            sets: (e.sets || []).filter(x => x && x.done).map(x => ({ type: x.type === 'warmup' ? 'warmup' : 'main', weight: num(x.weight), reps: firstInt(x.reps), rir: num(x.rir) })).filter(x => x.reps)
          })).filter(e => e.name)
        }));
        return;
      }
      let items = r.workoutExercises;
      if (!Array.isArray(items)) { try { items = JSON.parse(r.workoutExercisesJson || '[]'); } catch (e) { items = []; } }
      if (!Array.isArray(items) || !items.length) {
        const text = parseFreeText(r.strength);
        if (!text || /^(?:今日は)?(?:完全)?休養日/.test(String(r.strength || '').trim()) || r.restDay) return;
        const parts = Object.keys(text.partSets).filter(p => PARTS[p]);
        sessions.push({ date: r.date, store: storeOf(r.workoutPlace), part: r.workoutPart || (parts.length === 1 ? parts[0] : inferPart(text.exercises.map(e => e.name).join(' '))), source: 'text',
          partSets: text.partSets, minutes: text.minutes, rating: '', pain: parsePain(`${r.strength || ''} ${r.condition || ''}`), fatigue: num(r.fatigue),
          exercises: text.exercises.map(e => ({ ...e, equip: equipOf(e.name), sets: e.sets.map(x => ({ type: 'main', ...x })) })), rawText: String(r.strength).slice(0, 80) });
        return;
      }
      if (r.workoutCompletion === 'stopped' && !items.some(i => num(i.weight) !== null)) return;
      const exercises = items.map(i => {
        const reps = firstInt(i.reps), count = Math.max(1, Math.min(10, firstInt(i.sets) || 1)), weight = num(i.weight);
        const planned = /メニューから自動入力/.test(String(i.note || '')) && weight === null;
        return { name: canonicalName(i.name), rawName: i.name, equip: equipOf(i.name), rating: '', legacy: true,
          sets: reps && !planned ? Array.from({ length: count }, () => ({ type: 'main', weight, reps })) : [] };
      }).filter(e => e.name && e.sets.length);
      if (!exercises.length) return;
      sessions.push({ date: r.date, store: storeOf(r.workoutPlace), part: r.workoutPart || inferPart(exercises.map(e => e.name).join(' ')), source: 'legacy',
        rating: /余裕|楽|軽/.test(r.workoutFeedback || '') ? 'easy' : /きつ|上がらず|限界|潰れ/.test(r.workoutFeedback || '') ? 'hard' : '',
        pain: parsePain(`${r.workoutFeedback || ''} ${r.workoutRequest || ''} ${r.condition || ''}`), fatigue: num(r.fatigue), minutes: num(r.workoutMinutes), exercises });
    });
    (prefs && Array.isArray(prefs.imports) ? prefs.imports : []).forEach(imp => {
      const groups = {};
      (imp.entries || []).forEach(en => { const st = STORES[en.store] ? en.store : unknownAs; const k = `${st}|${en.part || ''}`; (groups[k] = groups[k] || []).push(en); });
      Object.entries(groups).forEach(([k, list]) => {
        const [st, part] = k.split('|');
        sessions.push({ date: imp.date, store: st, part: part || inferPart(list.map(x => x.name).join(' ')), source: 'import', rating: '', pain: {}, fatigue: null,
          exercises: list.map(en => ({ name: canonicalName(en.name), rawName: en.name, equip: equipOf(en.name), rating: '', imported: true,
            sets: en.weight !== null && en.reps ? Array.from({ length: Math.max(1, Math.min(10, en.sets || 1)) }, () => ({ type: 'main', weight: en.weight, reps: en.reps })) : [] })) });
      });
    });
    return sessions.sort((a, b) => a.date.localeCompare(b.date) || String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  }

  const e1rm = (w, r) => (w > 0 && r > 0) ? w * (1 + Math.min(r, 20) / 30) : null;
  const mainSets = sets => (sets || []).filter(s => s.type !== 'warmup');

  // 全履歴を集計：種目×重量キーごとの全実績（長期）と直近（spec 6-1）
  function analyze(records, todayDate, prefs) {
    const sessions = extractSessions(records, prefs);
    const now = dayIndex(todayDate || new Date().toISOString().slice(0, 10));
    const byKey = {};
    sessions.forEach(s => s.exercises.forEach(e => {
      if (!e.sets.length) return; // 完了セットがない種目は「実施した実績」として数えない（以前の実績を隠さない）
      const key = weightKey(s.store, e.name);
      const mains = mainSets(e.sets);
      const top = mains.reduce((best, x) => { const v = e1rm(x.weight, x.reps); return v && (!best || v > best.e1rm) ? { ...x, e1rm: v } : best; }, null);
      (byKey[key] = byKey[key] || { key, store: s.store, name: e.name, equip: e.equip, part: (guessEntry(e.name) || {}).part || s.part, exposures: [] }).exposures.push({
        date: s.date, store: s.store, sets: e.sets, main: mains, top, rating: e.rating || s.rating || '', legacy: !!e.legacy, sessionPart: s.part
      });
    }));
    Object.values(byKey).forEach(stat => {
      const ex = stat.exposures;
      stat.count = ex.length; stat.last = ex[ex.length - 1]; stat.recent = ex.slice(-5);
      stat.first = ex[0];
      const tops = ex.filter(x => x.top);
      stat.best = tops.reduce((b, x) => !b || x.top.weight > b.weight || (x.top.weight === b.weight && x.top.reps > b.reps) ? { weight: x.top.weight, reps: x.top.reps, date: x.date } : b, null);
      const pts = tops.slice(-8).map(x => [dayIndex(x.date), x.top.e1rm]);
      if (pts.length >= 2 && pts[pts.length - 1][0] > pts[0][0]) {
        const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
        stat.growthPctPerWeek = my > 0 ? Math.round(slope * 7 / my * 1000) / 10 : 0;
      } else stat.growthPctPerWeek = null;
      const weights = [...new Set(ex.flatMap(x => x.main.map(s => s.weight)).filter(w => w > 0))].sort((a, b) => a - b);
      const diffs = weights.slice(1).map((w, i) => Math.round((w - weights[i]) * 100) / 100).filter(d => d > 0);
      stat.increment = diffs.length ? Math.min(...diffs) : null;
      stat.daysSince = now - dayIndex(stat.last.date);
    });
    const partLast = {}, weekSets = {};
    sessions.forEach(s => {
      if (PARTS[s.part]) partLast[s.part] = s.date;
      if (now - dayIndex(s.date) < 7) {
        s.exercises.forEach(e => { const p = (guessEntry(e.name) || {}).part || s.part; if (p) weekSets[p] = (weekSets[p] || 0) + mainSets(e.sets).length; });
        if (!s.exercises.length) Object.entries(s.partSets || {}).forEach(([p, n]) => { weekSets[p] = (weekSets[p] || 0) + n; });
      }
    });
    const recs = (Array.isArray(records) ? records : []).filter(r => r && r.date && !r._deleted);
    const recent = recs.filter(r => now - dayIndex(r.date) <= 2 && now - dayIndex(r.date) >= 0);
    const fatigue = Math.max(0, ...recent.map(r => num(r.fatigue) || 0));
    let pain = {};
    sessions.filter(s => now - dayIndex(s.date) <= 10).forEach(s => { pain = { ...(s.pain || {}) }; });
    const bodyRecords = recs.filter(r => +r.weight > 0).sort((a, b) => a.date.localeCompare(b.date));
    const latestBody = bodyRecords[bodyRecords.length - 1] || null;
    const body = latestBody ? { weight: +latestBody.weight, date: latestBody.date, fat: num(latestBody.fat), muscle: num(latestBody.muscle),
      trend30: (() => { const old = bodyRecords.filter(r => now - dayIndex(r.date) >= 28)[bodyRecords.filter(r => now - dayIndex(r.date) >= 28).length - 1]; return old ? r1(+latestBody.weight - +old.weight) : null; })() } : null;
    const storeExercises = {};
    sessions.forEach(s => { if (!s.store) return; const set = storeExercises[s.store] = storeExercises[s.store] || new Set(); s.exercises.forEach(e => set.add(e.name)); });
    const counts = { total: sessions.length, withWeights: sessions.filter(x => x.exercises.some(e => e.sets.some(t => t.weight > 0))).length, textOnly: sessions.filter(x => x.source === 'text' && !x.exercises.length).length, unknownStore: sessions.filter(x => !x.store).length, byStore: { honten: sessions.filter(x => x.store === 'honten').length, shioda: sessions.filter(x => x.store === 'shioda').length } };
    return { sessions, byKey, partLast, weekSets, fatigue, pain, body, counts, storeExercises: Object.fromEntries(Object.entries(storeExercises).map(([k, v]) => [k, [...v]])), totalSessions: sessions.length, lastSession: sessions[sessions.length - 1] || null };
  }

  // 次回部位：最後に実施した部位の次（spec 2 基本ローテーション）。直近2日以内に実施済みの部位は飛ばす
  function recommendPart(analysis, prefsOrProfile, todayDate) {
    const order = (prefsOrProfile && Array.isArray(prefsOrProfile.rotation) && prefsOrProfile.rotation.length ? prefsOrProfile.rotation : ROTATION).filter(p => PARTS[p]);
    const now = dayIndex(todayDate || new Date().toISOString().slice(0, 10));
    const last = [...analysis.sessions].reverse().find(s => PARTS[s.part]);
    let idx = last ? (order.indexOf(last.part) + 1) % order.length : 0;
    for (let i = 0; i < order.length; i++) {
      const p = order[(idx + i) % order.length], d = analysis.partLast[p];
      if (!d || now - dayIndex(d) >= 2) return p;
    }
    return order[idx];
  }

  function prefsNormalized(prefs) {
    const p = prefs && typeof prefs === 'object' ? prefs : {};
    const list = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
    const stores = {};
    Object.keys(STORES).forEach(id => { const s = p.stores && p.stores[id] || {}; stores[id] = { missing: list(s.missing).map(canonicalName), available: list(s.available).map(canonicalName) }; });
    return { unknownStoreAs: STORES[p.unknownStoreAs] ? p.unknownStoreAs : '', avoid: list(p.avoid).map(canonicalName), prefer: list(p.prefer).map(canonicalName), notes: list(p.notes), split: list(p.split).filter(x => PARTS[x]), stores, defaultMinutes: num(p.defaultMinutes), level: '' };
  }
  function profileNormalized(profile) { return { ...DEFAULT_PROFILE, ...(profile && typeof profile === 'object' ? profile : {}) }; }
  function ratingsNormalized(ratings) { return Array.isArray(ratings) ? ratings.filter(r => r && r.exercise && r.aspect) : DEFAULT_RATINGS.slice(); }

  function storeEquipment(store, prefs) {
    const base = STORE_EQUIPMENT[store] || { cables: 1, missing: [] };
    const p = prefsNormalized(prefs);
    const missing = new Set([...(base.missing || []), ...p.stores[store].missing].filter(n => !p.stores[store].available.includes(n)));
    return { ...base, missing: [...missing] };
  }
  function exerciseExcluded(name, ctx) {
    const n = canonicalName(name);
    if (ctx.excluded.has(n) || ctx.missing.has(n)) return true;
    return ctx.ratings.some(r => canonicalName(r.exercise) === n && r.aspect === 'priority' && r.value === 'exclude');
  }
  function ratingFor(name, ratings, aspect) { const n = canonicalName(name); return ratings.filter(r => canonicalName(r.exercise) === n && (!aspect || r.aspect === aspect)).slice(-1)[0] || null; }
  function painHit(name, pain) {
    const e = exactEntry(name) || guessEntry(name); const moves = e ? e.moves : [];
    let worst = 0; Object.entries(pain || {}).forEach(([site, score]) => { if ((PAIN_MOVES[site] || []).some(m => moves.includes(m))) worst = Math.max(worst, score); });
    return worst;
  }
  function restFor(store, name) { const r = REST[store] || REST.honten; return kindOf(name) === 'compound' ? r.compound : r.isolation; }
  function stepFor(name, stat, w) {
    if (stat && stat.increment) return Math.min(stat.increment, Math.max(1, w * 0.1));
    const eq = equipOf(name);
    return eq === 'dumbbell' ? 2 : eq === 'plate' ? 5 : eq === 'barbell' || eq === 'smith' || eq === 'ez' ? 2.5 : w >= 60 ? 5 : 2.5;
  }

  /* ---------- 本セットの漸進（ダブルプログレッションを候補に、一部セットだけ更新） spec 6-3 ---------- */
  function progressMain(last, name, stat, opts) {
    const entry = exactEntry(name) || guessEntry(name);
    const hi = Math.max(entry ? entry.reps[1] : 12, 1);
    const sets = last.map(s => ({ type: 'main', weight: s.weight, reps: s.reps }));
    if (!sets.length) return { sets, note: '' };
    if (opts.hold) return { sets, note: opts.holdReason || '維持' };
    const weighted = sets.filter(s => s.weight > 0);
    const topW = weighted.length ? Math.max(...weighted.map(s => s.weight)) : null;
    const group = sets.map((s, i) => ({ s, i })).filter(x => x.s.weight === topW);
    if (topW !== null && group.length >= 2 && group.every(x => x.s.reps >= hi) && !opts.noLoadIncrease) {
      const step = stepFor(name, stat, topW), first = group[0];
      first.s.weight = r1(topW + step); first.s.reps = Math.max(entry ? entry.reps[0] : 8, first.s.reps - 3);
      return { sets, note: `${topW}kgで${hi}回以上を${group.length}セット達成→1セット目だけ${first.s.weight}kgへ` };
    }
    // 回数を伸ばすのは1セットだけ：最重量のセットのうち、回数が最も少ないセット（同数なら後のセット）
    const pool = group.length ? group : sets.map((s, i) => ({ s, i }));
    const target = pool.reduce((b, x) => !b || x.s.reps <= b.s.reps ? x : b, null);
    if (target.s.reps >= hi + 6) return { sets, note: '回数は十分。重量の変更は本人の感覚と痛みを確認して判断' };
    target.s.reps += 1;
    return { sets, note: `${target.i + 1}セット目だけ+1回（${target.s.weight ?? '自重'}×${target.s.reps}）` };
  }

  function formatSets(sets) { return (sets || []).map(s => `${s.type === 'warmup' ? '準' : ''}${s.weight ?? '未定'}×${s.reps}`).join('、'); }

  /* ---------- セット単位の計画（即時・オフライン） ----------
   * 1) 同部位の直近セッション（同店舗を優先）を土台に、本人の種目構成・準備セットの付け方を引き継ぐ
   * 2) 除外・設備・痛み・疲労を反映 3) 本セットを一部だけ漸進 4) 時間配分 5) 動線 */
  const DEFAULT_TEMPLATES = {
    chest: ['インクラインDBプレス', 'ISOデクラインプレス', 'チェストプレス', 'ペックフライ', 'ベンチインクライン・ケーブルフライ'],
    back: ['ラットプルダウン・ワイド', 'ニュートラルグリッププルダウン', 'シーテッドロー', 'ワイドラットプルダウン・プレート式', 'マシンプルオーバー'],
    shoulders: ['マシンショルダープレス', 'DBサイドレイズ', 'Hammer Strengthラテラルレイズ', 'リアデルトマシン', 'ケーブルリアレイズ', 'フェイスプル'],
    legs: ['レッグプレス', 'カーフプレス', 'レッグエクステンション', 'レッグカール', 'アダクション', 'アブダクション'],
    arms: ['EZバーカール', 'ライイングEX', 'ケーブルカール', 'ケーブルプレスダウン', 'ハンマーカール', 'オーバーヘッドエクステンション', 'リストカール']
  };
  function estimateSeconds(exercises) {
    return exercises.reduce((a, e) => a + 60 + e.sets.reduce((b, s) => b + (s.type === 'warmup' ? 30 + 45 : 40 + (e.restSec || 90)), 0), 0);
  }
  function orderForFlow(exercises, store, prefs) {
    let list = exercises.slice();
    // 同じ器具（レッグプレス→カーフプレス等）は連続
    const stationOf = e => (exactEntry(e.name) || {}).station || '';
    for (let i = 0; i < list.length; i++) { const st = stationOf(list[i]); if (!st) continue; const j = list.findIndex((x, k) => k > i + 1 && stationOf(x) === st); if (j > 0) { const [m] = list.splice(j, 1); list.splice(i + 1, 0, m); } }
    // ケーブル種目・ダンベル種目はまとめる（最初に出た位置へ寄せる）
    ['cable', 'dumbbell'].forEach(eq => {
      const idx = list.map((e, i) => equipOf(e.name) === eq ? i : -1).filter(i => i >= 0);
      if (idx.length < 2) return;
      const first = idx[0], moving = idx.slice(1).filter((v, k) => v !== first + k + 1);
      if (!moving.length) return;
      const items = list.filter((e, i) => idx.includes(i));
      const rest = list.filter((e, i) => !idx.includes(i));
      const insertAt = rest.findIndex((e, i) => list.indexOf(e) > first);
      rest.splice(insertAt < 0 ? rest.length : insertAt, 0, ...items);
      list = rest;
    });
    // 塩田店：ケーブル1台。連続ブロックが15分を超えたら、間に他の種目を挟む
    const eqp = STORE_EQUIPMENT[store];
    if (eqp && eqp.cableBlockMinutes) {
      let block = 0;
      for (let i = 0; i < list.length; i++) {
        if (equipOf(list[i].name) !== 'cable') { block = 0; continue; }
        block += estimateSeconds([list[i]]) / 60;
        if (block > eqp.cableBlockMinutes && i > 0 && equipOf(list[i - 1].name) === 'cable') {
          const j = list.findIndex((x, k) => k > i && equipOf(x.name) !== 'cable');
          if (j > 0) { const [m] = list.splice(j, 1); list.splice(i, 0, m); block = 0; }
        }
      }
    }
    return list;
  }

  // 履歴がある種目か（店舗・表記揺れを問わず、同じ種目名の実績が1回でもあるか）
  function hasHistory(analysis, name) { const n = canonicalName(name); return Object.values(analysis.byKey).some(s => s.name === n && s.exposures.some(x => x.sets.length)); }
  // 重量の基準にする「最新の実績」：同じ店舗（ダンベル・自重は共通）と店舗未記録の実績のうち最も新しいもの
  function latestFor(analysis, store, name) {
    const n = canonicalName(name), eq = equipOf(name), shared = EQUIP[eq] && EQUIP[eq].shared;
    const own = analysis.byKey[weightKey(store, name)], unknown = shared ? null : analysis.byKey[weightKey('', name)];
    // 本セットのある最新の実績（準備セットだけの日は基準にしない）
    const lastMain = st => st ? [...st.exposures].reverse().find(x => x.main.length) || null : null;
    const cands = [[own, lastMain(own)], [unknown, lastMain(unknown)]].filter(([, x]) => x).sort((a, b) => b[1].date.localeCompare(a[1].date));
    const [pick, exposure] = cands[0] || [own || null, null];
    let note = '';
    if (pick && pick === unknown && exposure) note = `${exposure.date.slice(5).replace('-', '/')}の記録は店舗が未記録のため、${storeLabel(store)}の実績として扱っています（履歴で店舗を指定できます）。`;
    const newerElsewhere = Object.values(analysis.byKey).filter(st => st.name === n && st !== own && st !== unknown && lastMain(st) && (!exposure || lastMain(st).date > exposure.date)).sort((a, b) => lastMain(b).date.localeCompare(lastMain(a).date))[0];
    if (newerElsewhere) note += ` より新しい${lastMain(newerElsewhere).date.slice(5).replace('-', '/')}の${storeLabel(newerElsewhere.store)}の実績は、機器が違うため重量に使っていません。`;
    return { stat: pick, exposure, note: note.trim() };
  }
  // 準備セットの設計（spec 6-4）：前回の準備セットを優先。なければ主力（複合種目・その部位の最初の2種目）にだけ、本セットの重さに応じて入れる
  function designWarmups(name, mains, lastEx, before) {
    const prev = lastEx ? (lastEx.sets || []).filter(s => s.type === 'warmup').map(s => ({ type: 'warmup', weight: s.weight, reps: s.reps })) : [];
    if (prev.length) return prev;
    const top = Math.max(0, ...mains.map(s => +s.weight || 0));
    const eq = equipOf(name), kind = kindOf(name), primary = kind === 'compound' || before.length < 2;
    if (!primary || eq === 'bodyweight') return [];
    const step = eq === 'dumbbell' ? 2 : 5, rd = v => Math.max(step, Math.round(v / step) * step);
    if (!top) return [{ type: 'warmup', weight: null, reps: 10 }];
    if (kind === 'compound' && top >= 60) return [{ type: 'warmup', weight: rd(top * 0.6), reps: 8 }, { type: 'warmup', weight: rd(top * 0.85), reps: 4 }];
    return [{ type: 'warmup', weight: rd(top * 0.6), reps: 10 }];
  }

  function planSession(opts) {
    const o = opts || {};
    const store = normalizeStore(o.store) || 'honten', part = PARTS[o.part] ? o.part : 'chest';
    const prefs = prefsNormalized(o.prefs), profile = profileNormalized(o.profile), ratings = ratingsNormalized(o.ratings);
    const minutes = Math.max(20, Math.min(150, num(o.minutes) || prefs.defaultMinutes || 60));
    const analysis = o.analysis || analyze(o.records || [], o.today, { ...(o.prefs || {}), imports: o.imports });
    const eqp = storeEquipment(store, o.prefs);
    const todayPain = parsePain(o.pain || '');
    const pain = { ...analysis.pain, ...todayPain };
    const fatigue = num(o.fatigue) || 0;
    const ctx = { excluded: new Set([...(profile.excluded || []), ...prefs.avoid].map(canonicalName)), missing: new Set(eqp.missing.map(canonicalName)), ratings };
    const warnings = [], notes = [];

    // 1) 土台：同部位の直近セッション（同店舗優先）
    const partSessions = analysis.sessions.filter(s => s.part === part && s.exercises.length);
    const sameStore = [...partSessions].reverse().find(s => s.store === store);
    const anyStore = partSessions[partSessions.length - 1];
    const base = sameStore || anyStore || null;
    let names = base ? base.exercises.map(e => e.name) : DEFAULT_TEMPLATES[part].slice();
    const basis = base ? `${base.date.slice(5).replace('-', '/')} ${storeLabel(base.store)}の${PARTS[part]}` : '標準構成（この部位の記録なし）';
    if (base && base.store !== store) notes.push(`${storeLabel(store)}の${PARTS[part]}の記録がないため、${storeLabel(base.store)}（${base.date.slice(5).replace('-', '/')}）の構成を土台にしています。マシン重量は店舗別のため空欄です。`);
    // 2) 除外・設備・代替・本人評価
    names = names.map(n => {
      if (ctx.missing.has(canonicalName(n))) { const sub = (STORE_EQUIPMENT[store] && STORE_EQUIPMENT[store].substitutes || {})[canonicalName(n)]; if (sub) { notes.push(`${storeLabel(store)}に${n}がないため${sub}で代替`); return sub; } }
      return n;
    }).filter((n, i, a) => a.indexOf(n) === i).filter(n => !exerciseExcluded(n, ctx));
    if (!base) {
      // 標準構成のみ：本人評価で優先度が低い種目は外し、優先・効きの良い種目を残す
      names = names.filter(n => { const r = ratingFor(n, ratings, 'priority'); return !(r && r.value === 'low') && (ratingFor(n, ratings, 'effect') || {}).value !== 'low'; });
    }

    const exercisesSoFar = [];
    const exercises = names.map(name => {
      const key = weightKey(store, name), ref = latestFor(analysis, store, name), stat = ref.stat;
      const lastEx = ref.exposure;
      const hurt = painHit(name, pain), caution = ratingFor(name, ratings, 'pain');
      const ex = { id: uid(), name, part: (exactEntry(name) || guessEntry(name) || {}).part || part, equip: equipOf(name), restSec: restFor(store, name), reason: '', isNew: !hasHistory(analysis, name), atStore: (analysis.storeExercises[store] || []).includes(name) || EQUIP[equipOf(name)].shared, sets: [], last: lastEx ? formatSets(lastEx.sets) : '', lastDate: lastEx ? lastEx.date : '', refNote: ref.note };
      if (hurt >= 6) return null;
      if (lastEx && lastEx.main.length) {
        const hold = hurt >= 3 || fatigue >= 4 || lastEx.rating === 'hard';
        const pr = progressMain(lastEx.main, name, stat, { hold, holdReason: hurt >= 3 ? '痛みの申告があるため重量・回数は維持' : fatigue >= 4 ? '疲労度が高いため維持' : '前回きつかったため維持' });
        let mains = pr.sets;
        if (fatigue >= 4 && mains.length >= 3) mains = mains.slice(0, -1);
        // 準備セット：本人が前回入れた準備セットを引き継ぐ。前回の記録に準備がなければ主力種目だけ設計する
        const warm = designWarmups(name, mains, lastEx, exercisesSoFar);
        ex.sets = [...warm, ...mains];
        ex.reason = `基準：${lastEx.date.slice(5).replace('-', '/')}${EQUIP[ex.equip].shared ? '' : '・' + (lastEx.store ? storeLabel(lastEx.store) : '店舗未記録')}の${formatSets(lastEx.main)}（最新の実績）。${pr.note}${ref.note ? ' ' + ref.note : ''}`;
      } else {
        // 同じ重量キーの実績なし：他店舗の同名種目は参考表示のみ（マシンは換算しない）
        const other = Object.values(analysis.byKey).filter(s => s.name === name && s.key !== key && s.last.top).sort((a, b) => a.daysSince - b.daysSince)[0];
        const entry = exactEntry(name) || guessEntry(name);
        const reps = entry ? entry.reps[0] : 10;
        const count = kindOf(name) === 'compound' ? 3 : 3;
        const mainsNew = Array.from({ length: count }, () => ({ type: 'main', weight: null, reps }));
        ex.sets = [...designWarmups(name, mainsNew, null, exercisesSoFar), ...mainsNew];
        ex.reason = other ? `${storeLabel(other.store)}では${other.last.top.weight}kg×${other.last.top.reps}回（${EQUIP[ex.equip].label}は店舗・機器別のため換算しません）。1セット目で重量を決めてください。` : `記録がない種目です。準備セットで重量を確認してから本セットへ。`;
      }
      if (hurt >= 3) ex.reason += ` ${Object.keys(pain).join('・')}の痛み申告あり。痛みが強くなる・鋭い痛み・しびれが出たら中止。`;
      else if (caution) ex.reason += ` 注意：${caution.note}`;
      exercisesSoFar.push(ex);
      return ex;
    }).filter(Boolean);
    if (fatigue >= 4) warnings.push(`疲労度${fatigue}/5：重量・回数は維持し、3セット以上の種目は1セット減らしています。`);
    Object.entries(todayPain).filter(([, v]) => v >= 6).forEach(([k, v]) => warnings.push(`${k}の痛み${v}/10：関係する種目を外しました。`));

    // 4) 時間配分：予定時間を超える場合は後半の単関節種目から本セットを減らす。大きく余れば主力に1セット足す
    let secs = estimateSeconds(exercises);
    const budget = minutes * 60;
    for (let guard = 0; guard < 40 && secs > budget; guard++) {
      const cand = [...exercises].reverse().find(e => e.sets.filter(s => s.type === 'main').length > 2 && kindOf(e.name) === 'isolation') || [...exercises].reverse().find(e => e.sets.filter(s => s.type === 'main').length > 2);
      if (!cand) { if (exercises.length > 3) { exercises.pop(); secs = estimateSeconds(exercises); continue; } break; }
      const idx = cand.sets.map(s => s.type).lastIndexOf('main'); cand.sets.splice(idx, 1); secs = estimateSeconds(exercises);
    }
    // 時間が大きく余る時は、その部位で本人が実施したことのある他の種目（新しい順）→標準構成の順に追加する（セットの水増しはしない）
    if (budget - secs > 15 * 60) {
      const inPlan = new Set(exercises.map(e => canonicalName(e.name)));
      const pastNames = [...analysis.sessions].reverse().filter(x => x.part === part).flatMap(x => x.exercises.filter(e => e.sets.length).map(e => e.name));
      const cands = [...new Set([...pastNames, ...DEFAULT_TEMPLATES[part]].map(canonicalName))].filter(n => !inPlan.has(n) && !exerciseExcluded(n, ctx) && painHit(n, pain) < 6 && (!ctx.missing.has(n)));
      for (const n of cands) {
        if (budget - secs <= 15 * 60) break;
        const ref = latestFor(analysis, store, n), lx = ref.exposure, entry = exactEntry(n) || guessEntry(n);
        const mains = lx ? progressMain(lx.main, n, ref.stat, { hold: fatigue >= 4 }).sets : Array.from({ length: 3 }, () => ({ type: 'main', weight: null, reps: entry ? entry.reps[0] : 12 }));
        const ex = { id: uid(), name: n, part: (entry || {}).part || part, equip: equipOf(n), restSec: restFor(store, n), isNew: !hasHistory(analysis, n), atStore: (analysis.storeExercises[store] || []).includes(n) || EQUIP[equipOf(n)].shared,
          sets: [...designWarmups(n, mains, lx, exercises), ...mains], last: lx ? formatSets(lx.sets) : '', lastDate: lx ? lx.date : '',
          reason: `予定時間に余裕があるため追加。${lx ? `基準：${lx.date.slice(5).replace('-', '/')}の${formatSets(lx.main)}（最新の実績）。` : '記録がない種目です。準備セットで重量を確認してください。'}` };
        if (budget - secs - estimateSeconds([ex]) < -5 * 60) continue;
        exercises.push(ex); secs = estimateSeconds(exercises);
      }
    }
    if (!base && exercises.length && budget - secs > 10 * 60) { // 記録がない標準構成の時だけ時間に合わせて足す（根拠なく増やさない）
      for (const e of exercises.filter(x => kindOf(x.name) === 'compound' && x.sets.some(s => s.type === 'main'))) {
        if (budget - secs < 4 * 60) break;
        const mains = e.sets.filter(s => s.type === 'main'); const lastMain = mains[mains.length - 1];
        e.sets.push({ type: 'main', weight: lastMain.weight, reps: lastMain.reps }); secs = estimateSeconds(exercises);
      }
    }
    const ordered = orderForFlow(exercises, store, o.prefs);
    const totalSets = ordered.reduce((a, e) => a + e.sets.length, 0), mainCount = ordered.reduce((a, e) => a + e.sets.filter(s => s.type === 'main').length, 0);
    const est = Math.round(estimateSeconds(ordered) / 60);
    return {
      id: uid(), version: 2, store, part, minutes, source: 'local', createdAt: new Date().toISOString(),
      basedOnSessions: analysis.totalSessions, basedOnLastDate: analysis.lastSession ? analysis.lastSession.date : null, basis,
      summary: `${storeLabel(store)}・${PARTS[part]}｜${ordered.length}種目・${totalSets}セット（本${mainCount}）｜約${est}分`,
      estMinutes: est, warnings, notes, exercises: ordered
    };
  }

  /* ---------- AI出力の検証（spec 14） ---------- */
  function validatePlan(ai, localPlan, analysis, prefs, profile, ratings, opts) {
    if (!ai || !Array.isArray(ai.exercises) || !ai.exercises.length) return null;
    const store = localPlan.store, eqp = storeEquipment(store, prefs), p = prefsNormalized(prefs), prof = profileNormalized(profile), rt = ratingsNormalized(ratings);
    const ctx = { excluded: new Set([...(prof.excluded || []), ...p.avoid].map(canonicalName)), missing: new Set(eqp.missing.map(canonicalName)), ratings: rt };
    const fixes = [];
    const exercises = ai.exercises.slice(0, 12).map(raw => {
      const name = String(raw.name || '').trim().slice(0, 40);
      if (!name) return null;
      if (exerciseExcluded(name, ctx)) { fixes.push(`${name}は除外・設備なしのため外しました`); return null; }
      const refL = latestFor(analysis, store, name), stat = refL.stat && refL.exposure ? { ...refL.stat, last: refL.exposure } : refL.stat;
      let sets = (Array.isArray(raw.sets) ? raw.sets : []).slice(0, 12).map(s => {
        let weight = num(s.weight); if (weight !== null && (weight < 0 || weight > 500)) weight = null;
        let reps = firstInt(s.reps); if (!reps || reps < 1 || reps > 60) reps = 10;
        return { type: s.type === 'warmup' ? 'warmup' : 'main', weight, reps };
      });
      if (!sets.some(s => s.type === 'main')) { fixes.push(`${name}：本セットがないため修正`); sets.push({ type: 'main', weight: null, reps: 10 }); }
      // 同じ重量キーの最高記録を大きく超える重量は、本人の実績の範囲に戻す（痛みを無視した更新を防ぐ）
      const local = (localPlan.exercises || []).find(e => canonicalName(e.name) === canonicalName(name));
      if (local && stat && stat.last && stat.last.main.length) {
        // 最新の実績に根拠がない増減は採用しない：本セットの重量は「最新実績から1段階以内の増量／痛み・疲労がない限り減量なし」
        const latestTop = Math.max(...stat.last.main.map(x => +x.weight || 0)), step = stepFor(name, stat, latestTop) || 2.5;
        const localMain = local.sets.filter(x => x.type === 'main'), aiMain = sets.filter(x => x.type === 'main');
        const unexplained = aiMain.some(x => x.weight !== null && (x.weight > latestTop + step + 0.01 || x.weight < Math.min(...localMain.map(y => +y.weight || Infinity)) * 0.9 - 0.01));
        if (unexplained && !opts?.allowChange) { fixes.push(`${name}：AIの重量は最新実績（${stat.last.date.slice(5).replace('-', '/')} ${formatSets(stat.last.main)}）から説明できないため、最新実績を基準にした重量にしました`); sets = local.sets.map(x => ({ ...x })); }
        else if (local.sets.filter(x => x.type === 'warmup').length > sets.filter(x => x.type === 'warmup').length) sets = [...local.sets.filter(x => x.type === 'warmup').map(x => ({ ...x })), ...sets.filter(x => x.type === 'main')];
      }
      const lastEx = stat ? stat.last : null;
      return { id: uid(), name, part: (exactEntry(name) || guessEntry(name) || {}).part || localPlan.part, equip: equipOf(name), restSec: Math.max(30, Math.min(300, firstInt(raw.restSec) || restFor(store, name))),
        reason: String(raw.reason || '').slice(0, 200), isNew: !hasHistory(analysis, name), newReason: String(raw.newReason || '').slice(0, 200),
        atStore: (analysis.storeExercises[store] || []).includes(canonicalName(name)) || EQUIP[equipOf(name)].shared, sets, last: lastEx ? formatSets(lastEx.sets) : '', lastDate: lastEx ? lastEx.date : '' };
    }).filter(Boolean);
    if (!exercises.length) return null;
    const totalSets = exercises.reduce((a, e) => a + e.sets.length, 0), mainCount = exercises.reduce((a, e) => a + e.sets.filter(s => s.type === 'main').length, 0);
    const est = Math.round(estimateSeconds(exercises) / 60);
    return { ...localPlan, id: uid(), source: 'ai', createdAt: new Date().toISOString(), exercises,
      summary: `${storeLabel(store)}・${PARTS[localPlan.part]}｜${exercises.length}種目・${totalSets}セット（本${mainCount}）｜約${est}分`, estMinutes: est,
      comment: String(ai.summary || '').slice(0, 300), warnings: (Array.isArray(ai.warnings) ? ai.warnings.map(String).slice(0, 2) : []), fixes };
  }

  /* ---------- AIへ渡す構造化データ（spec 6-1） ---------- */
  function aiContext(analysis, store, part, prefs, profile, ratings) {
    const relevant = Object.values(analysis.byKey).filter(s => s.part === part || s.exposures.some(x => x.sessionPart === part));
    const stats = relevant.sort((a, b) => a.daysSince - b.daysSince).slice(0, 30).map(s => ({
      exercise: s.name, weightMode: EQUIP[s.equip] ? EQUIP[s.equip].label : s.equip, store: s.key.startsWith('*|') ? '共通' : storeLabel(s.store), sessions: s.count, daysSince: s.daysSince,
      best: s.best ? `${s.best.weight}×${s.best.reps}（${s.best.date}）` : null, first: s.first && s.first.top ? `${s.first.date} ${s.first.top.weight}×${s.first.top.reps}` : null,
      growthPctPerWeek: s.growthPctPerWeek, latest: { date: s.last.date, store: s.last.store ? storeLabel(s.last.store) : '店舗未記録', sets: formatSets(s.last.sets) },
      older: s.recent.slice(0, -1).map(x => ({ date: x.date, sets: formatSets(x.sets) }))
    }));
    const partHistory = analysis.sessions.filter(s => s.part === part).slice(-5).map(s => ({ date: s.date, store: storeLabel(s.store), minutes: s.minutes, fatigue: s.fatigue, exercises: s.exercises.map(e => `${e.name}：${formatSets(e.sets)}`) }));
    const recentSessions = analysis.sessions.slice(-6).map(s => ({ date: s.date, store: storeLabel(s.store), part: PART_LABELS[s.part] || s.part }));
    return { totalSessions: analysis.totalSessions, store: storeLabel(store), part: PARTS[part], storeEquipment: STORE_EQUIPMENT[store], profile: profileNormalized(profile), ratings: ratingsNormalized(ratings),
      prefs: prefsNormalized(prefs), body: analysis.body, weeklySetsByPart: analysis.weekSets, recentSessions, partHistory, exerciseStats: stats };
  }

  /* ---------- 会話（AI不通時の端末内処理） ---------- */
  function localChat(message, plan, prefs) {
    const text = String(message || '').trim();
    const permanent = /今後|いつも|毎回|ずっと|恒久|これから|次から/.test(text);
    const changes = [], ratings = [], replies = [];
    let newPlan = plan ? JSON.parse(JSON.stringify(plan)) : null;
    const names = CATALOG.flatMap(e => [e.name, ...e.aliases].map(n => [n, e.name])).sort((a, b) => b[0].length - a[0].length);
    const findName = s => { const k = clean(s); const inPlan = newPlan && newPlan.exercises.find(e => k.includes(clean(e.name))); if (inPlan) return inPlan.name; const hit = names.find(([n]) => k.includes(clean(n))); return hit ? hit[1] : ''; };
    const storeId = normalizeStore(text) || (plan && plan.store) || '';
    let m;
    if (/ケーブル.*(空いて|使え|埋ま)/.test(text) && newPlan) {
      const isDone = e => e.doneSets > 0;
      const done = newPlan.exercises.filter(isDone), rest = newPlan.exercises.filter(e => !isDone(e));
      const cable = rest.filter(e => equipOf(e.name) === 'cable'), other = rest.filter(e => equipOf(e.name) !== 'cable');
      newPlan.exercises = [...done, ...other, ...cable];
      replies.push(cable.length ? `ケーブル種目（${cable.map(e => e.name).join('・')}）を最後に回しました。完了済みの種目はそのままです。` : 'この後の種目にケーブル種目はありません。');
    } else if ((m = text.match(/(.+?)(?:が|は)(?:ない|無い|なかった|置いてない|使えない|壊れて)/)) && /店|ジム|ここ/.test(text)) {
      const name = findName(m[1].replace(/^.*?(?:本店|塩田店|店)(?:に|で|には|では)/, ''));
      if (name && storeId) { changes.push({ action: 'add', type: 'missing_equipment', value: name, store: storeId }); replies.push(`${storeLabel(storeId)}には「${name}」がない設定にしました（次回以降も反映）。`); }
    } else if ((m = text.match(/(.+?)(?:の方が|のほうが)(?:効く|効いた|良い|いい)/))) {
      const name = findName(m[1]);
      if (name) { ratings.push({ exercise: name, aspect: 'effect', value: 'good', note: text.slice(0, 120) }); replies.push(`「${name}」の方が効くという評価を保存しました。次回以降の種目選択に使います。`); }
    } else if ((m = text.match(/(.+?)(?:を|は)?(?:外して|抜いて|なしで|無しで|やめ|やらない|削除|カット)/))) {
      const name = findName(m[1]);
      if (name) {
        if (newPlan) newPlan.exercises = newPlan.exercises.filter(e => e.name !== name || e.doneSets > 0);
        if (permanent) changes.push({ action: 'add', type: 'avoid', value: name, store: null });
        replies.push(`「${name}」を${permanent ? '今後のメニューからも' : '今日のメニューから'}外しました。`);
      }
    }
    if ((m = text.match(/(\d{2,3})\s*分しか|(\d{2,3})\s*分で/)) && newPlan) {
      const target = +(m[1] || m[2]) * 60;
      for (let g = 0; g < 40 && estimateSeconds(newPlan.exercises.filter(e => !(e.doneSets > 0))) > target; g++) {
        const cand = [...newPlan.exercises].reverse().find(e => !(e.doneSets > 0) && e.sets.filter(s => s.type === 'main').length > 2);
        if (!cand) { const idx = newPlan.exercises.map(e => !(e.doneSets > 0)).lastIndexOf(true); if (idx > 0) newPlan.exercises.splice(idx, 1); else break; continue; }
        cand.sets.splice(cand.sets.map(s => s.type).lastIndexOf('main'), 1);
      }
      replies.push(`${+(m[1] || m[2])}分に収まるよう、後半の種目のセットを減らしました。`);
    }
    if (permanent && !changes.length && !ratings.length && text.length >= 4) { changes.push({ action: 'add', type: 'note', value: text.slice(0, 120), store: null }); replies.push('今後のメニュー作成で考慮するメモとして保存しました。'); }
    return { reply: replies.join('\n') || 'AIに接続できないため、この内容は自動で反映できませんでした。種目の「変更」で直接調整できます。', plan: replies.length && newPlan ? newPlan : null, preferenceChanges: changes, ratings, offline: true };
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
      else if (c.type === 'default_minutes') p.defaultMinutes = remove ? null : Math.max(20, Math.min(150, firstInt(c.value) || 60));
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
  // 種目評価の追加・更新（最新の評価を優先。種目×観点で1件）
  function applyRatings(ratings, updates) {
    const list = ratingsNormalized(ratings).slice();
    (Array.isArray(updates) ? updates : []).forEach(u => {
      if (!u || !u.exercise || !u.aspect) return;
      const name = canonicalName(u.exercise), i = list.findIndex(r => canonicalName(r.exercise) === name && r.aspect === u.aspect);
      const item = { exercise: name, aspect: u.aspect, value: String(u.value || 'note'), note: String(u.note || '').slice(0, 160), date: u.date || new Date().toISOString().slice(0, 10) };
      if (i >= 0) list[i] = item; else list.push(item);
    });
    return list;
  }

  /* ---------- セッション（予定と実績をセットごとに分離 spec 5-3） ---------- */
  function newSession(plan, date, nowIso, extra = {}) {
    return {
      id: uid(), schema: 2, planId: plan.id, planSource: plan.source, store: plan.store, part: plan.part, date, status: 'active',
      startedAt: nowIso, updatedAt: nowIso, finishedAt: null, plannedMinutes: plan.minutes, fatigue: num(extra.fatigue), pain: String(extra.pain || ''),
      exercises: plan.exercises.map(e => sessionExercise(e)), feedback: { overall: '', pain: '', note: '' }
    };
  }
  function sessionExercise(e) {
    return { id: e.id || uid(), name: e.name, part: e.part, equip: e.equip || equipOf(e.name), restSec: e.restSec || 90, reason: e.reason || '', last: e.last || '', isNew: !!e.isNew, lr: false,
      sets: (e.sets || []).map(s => ({ id: uid(), type: s.type === 'warmup' ? 'warmup' : 'main', plannedWeight: num(s.weight), plannedReps: firstInt(s.reps), weight: num(s.weight), reps: firstInt(s.reps), done: false, doneAt: null, rir: null, memo: '', side: '' })) };
  }

  /* ---------- 集計（プログラムで正確に計算 spec 10・11・12） ---------- */
  function caloriesFor(minutes, bodyWeight, mainSets, restSecAvg) {
    if (!(minutes > 0) || !(bodyWeight > 0)) return null;
    // 平均4.5METを暫定基準に、運動密度（1分あたりの本セット数）と休憩時間で調整した推定値
    const density = mainSets / minutes;
    let met = 4.5;
    if (density >= 0.45 || (restSecAvg && restSecAvg <= 75)) met = 5.0;
    else if (density < 0.25 || (restSecAvg && restSecAvg >= 150)) met = 4.0;
    const total = met * 3.5 * bodyWeight / 200 * minutes, rest = 1.0 * 3.5 * bodyWeight / 200 * minutes;
    return { met, bodyWeight, minutes, total: Math.round(total), resting: Math.round(rest), extra: Math.round(total - rest), formula: `${met}MET×3.5×${bodyWeight}kg÷200×${minutes}分 − 安静時1.0MET` };
  }
  function summarizeSession(session, bodyWeight) {
    const done = session.exercises.map(e => ({ e, sets: e.sets.filter(s => s.done) })).filter(x => x.sets.length);
    const all = done.flatMap(x => x.sets), warm = all.filter(s => s.type === 'warmup'), main = all.filter(s => s.type !== 'warmup');
    const reps = s => firstInt(s.reps) || 0;
    const minutes = session.finishedAt && session.startedAt ? Math.max(1, Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 60000)) : null;
    const planned = session.exercises.reduce((a, e) => a + e.sets.length, 0);
    const restAvg = done.length ? Math.round(done.reduce((a, x) => a + (x.e.restSec || 90), 0) / done.length) : null;
    return {
      minutes, exercises: done.length, warmupSets: warm.length, mainSets: main.length, totalSets: all.length, plannedSets: planned, incompleteSets: planned - all.length,
      totalReps: all.reduce((a, s) => a + reps(s), 0), mainReps: main.reduce((a, s) => a + reps(s), 0),
      fatigue: num(session.fatigue), pain: session.pain || session.feedback && session.feedback.pain || '', rir: main.filter(s => s.rir !== null && s.rir !== undefined).map(s => s.rir),
      calories: caloriesFor(minutes, bodyWeight, main.length, restAvg)
    };
  }
  // 前回比較：同じ重量キー（マシンは同店舗、ダンベルは共通）で、共通する最大重量の回数を比べる
  function compareSession(session, analysisBefore) {
    return session.exercises.map(e => {
      const cur = e.sets.filter(s => s.done && s.type !== 'warmup' && firstInt(s.reps)).map(s => ({ weight: num(s.weight), reps: firstInt(s.reps) }));
      if (!cur.length) return null;
      const ref = latestFor(analysisBefore, session.store, e.name);
      const prev = ref.exposure ? ref.exposure.main : [];
      const fmt = s => `${s.weight ?? '自重'}×${s.reps}`;
      const best = (list, w) => list.filter(s => s.weight === w).reduce((b, s) => !b || s.reps > b.reps ? s : b, null);
      if (!prev.length) { const top = cur.reduce((b, s) => !b || (s.weight || 0) > (b.weight || 0) ? s : b, null); return { exercise: e.name, prev: '—', now: fmt(top), result: '初回' }; }
      const common = [...new Set(cur.map(s => s.weight))].filter(w => prev.some(p => p.weight === w)).sort((a, b) => (b || 0) - (a || 0));
      if (common.length) {
        const w = common[0], a = best(prev, w), b = best(cur, w);
        return { exercise: e.name, prev: fmt(a), now: fmt(b), result: b.reps > a.reps ? '更新' : b.reps === a.reps ? '維持' : '低下' };
      }
      const pt = prev.reduce((b, s) => !b || (s.weight || 0) > (b.weight || 0) ? s : b, null), ct = cur.reduce((b, s) => !b || (s.weight || 0) > (b.weight || 0) ? s : b, null);
      return { exercise: e.name, prev: fmt(pt), now: fmt(ct), result: (ct.weight || 0) > (pt.weight || 0) ? '更新' : (ct.weight || 0) < (pt.weight || 0) ? '低下' : ct.reps >= pt.reps ? '維持' : '低下' };
    }).filter(Boolean);
  }
  function localReview(summary, comparison) {
    const up = comparison.filter(r => r.result === '更新'), same = comparison.filter(r => r.result === '維持'), down = comparison.filter(r => r.result === '低下');
    const lines = [];
    if (up.length) lines.push(`更新：${up.map(r => `${r.exercise}（${r.prev}→${r.now}）`).join('、')}`);
    if (same.length) lines.push(`維持：${same.map(r => r.exercise).join('、')}。減量中に維持できているのも成果です。`);
    if (down.length) lines.push(`低下：${down.map(r => `${r.exercise}（${r.prev}→${r.now}）`).join('、')}。種目順や疲労の影響も考えられます。`);
    if (!summary.pain) lines.push('痛みは未申告のため、次回の重量更新は当日の体調を確認して判断します。');
    return lines.join('\n');
  }

  // 日別記録の既存項目（旧形式）にも要約を書く（旧画面・ホーム集計との互換）
  function sessionRecordFields(session) {
    const done = session.exercises.map(e => ({ e, sets: e.sets.filter(s => s.done) })).filter(x => x.sets.length);
    const minutes = session.finishedAt && session.startedAt ? Math.max(1, Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 60000)) : null; // 時間不明は不明のまま
    const planned = session.exercises.reduce((a, e) => a + e.sets.length, 0), completed = done.reduce((a, x) => a + x.sets.length, 0);
    const workoutExercises = done.map(({ e, sets }) => {
      const mains = sets.filter(s => s.type !== 'warmup'), pool = mains.length ? mains : sets;
      const top = pool.reduce((b, s) => (num(s.weight) || 0) >= (num(b.weight) || 0) ? s : b, pool[0]);
      return { name: e.name, equipment: EQUIP[e.equip] ? EQUIP[e.equip].label : '', loadType: e.equip === 'bodyweight' ? 'bodyweight' : e.equip === 'dumbbell' || e.equip === 'plate' ? 'per_side' : 'total', weight: num(top.weight), reps: firstInt(top.reps), sets: mains.length || sets.length, restSeconds: e.restSec || null, note: `実績 ${formatSets(sets)}` };
    });
    return {
      workoutPlace: storeLabel(session.store), workoutPart: session.part, workoutMinutes: minutes,
      workoutCompletion: completed === 0 ? 'stopped' : completed >= planned ? 'completed' : 'partial',
      workoutFeedback: [session.pain, session.feedback && session.feedback.note].filter(Boolean).join('。').slice(0, 500),
      workoutExercises, workoutExercisesJson: JSON.stringify(workoutExercises),
      strength: done.map(({ e, sets }) => `${e.name}：${formatSets(sets)}`).join('\n'),
      strengthIntensity: 'moderate', completedSets: completed, plannedSets: planned
    };
  }
  function planText(plan) {
    return `【${plan.summary}】\n` + plan.exercises.map((e, i) => `${i + 1}. ${e.name}：${formatSets(e.sets)}／休憩${e.restSec}秒`).join('\n');
  }
  function planFromImport(entries, store, part, minutes) {
    const list = entries.filter(e => e.store === store && e.part === part);
    if (!list.length) return null;
    const exercises = list.map(e => ({ id: uid(), name: e.name, part: e.part || part, equip: equipOf(e.name), restSec: e.restSec || restFor(store, e.name), reason: '貼り付けたメニューの指定どおり', isNew: false, atStore: true, last: '', lastDate: '',
      sets: Array.from({ length: e.sets || 3 }, () => ({ type: 'main', weight: e.weight, reps: e.reps || 10 })) }));
    const total = exercises.reduce((a, x) => a + x.sets.length, 0);
    return { id: uid(), version: 2, store, part, minutes, source: 'import', createdAt: new Date().toISOString(), summary: `${storeLabel(store)}・${PARTS[part]}｜${exercises.length}種目・${total}セット（貼り付け）`, warnings: [], notes: [], exercises };
  }

  const api = { normName, hasHistory, latestFor, designWarmups, STORES, PARTS, PART_LABELS, ROTATION, EQUIP, CATALOG, DEFAULT_PROFILE, DEFAULT_RATINGS, STORE_EQUIPMENT, REST, normalizeStore, storeLabel, catalogEntry, exactEntry, guessEntry, canonicalName, equipOf, kindOf, inferPart, weightKey,
    parsePain, parseFreeText, parseImport, planFromImport, extractSessions, analyze, recommendPart, prefsNormalized, profileNormalized, ratingsNormalized, storeEquipment, planSession, progressMain, orderForFlow, estimateSeconds,
    validatePlan, aiContext, localChat, applyPreferenceChanges, applyRatings, newSession, sessionExercise, summarizeSession, compareSession, localReview, caloriesFor, sessionRecordFields, planText, formatSets, e1rm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WorkoutEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
