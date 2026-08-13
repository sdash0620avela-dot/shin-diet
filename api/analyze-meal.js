const ALLOWED_ORIGINS = new Set([
  'https://sdash0620avela-dot.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

const schema = {
  type: 'object', additionalProperties: false,
  required: ['items', 'total', 'confidence', 'uncertainties'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'estimated_amount', 'base_amount', 'unit', 'kcal', 'protein_g', 'fat_g', 'carbs_g'], properties: {
        name: { type: 'string' }, estimated_amount: { type: 'string' }, base_amount: { type: 'number', exclusiveMinimum: 0 }, unit: { type: 'string' },
        kcal: { type: 'number', minimum: 0 }, protein_g: { type: 'number', minimum: 0 }, fat_g: { type: 'number', minimum: 0 }, carbs_g: { type: 'number', minimum: 0 }
      } } },
    total: { type: 'object', additionalProperties: false,
      required: ['kcal', 'protein_g', 'fat_g', 'carbs_g'], properties: {
        kcal: { type: 'number', minimum: 0 }, protein_g: { type: 'number', minimum: 0 },
        fat_g: { type: 'number', minimum: 0 }, carbs_g: { type: 'number', minimum: 0 }
      } },
    confidence: { type: 'string', enum: ['高', '中', '低'] },
    uncertainties: { type: 'array', items: { type: 'string' } }
  }
};

function cors(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Vary': 'Origin', 'Content-Type': 'application/json; charset=utf-8' };
}
function json(body, status, origin) { return new Response(JSON.stringify(body), { status, headers: cors(origin) }); }

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: '許可されていない接続元です。' }, 403, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POSTのみ利用できます。' }, 405, origin);
    if (!env.OPENAI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return json({ error: '解析サーバーの設定が未完了です。' }, 503, origin);
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return json({ error: '写真解析にはログインが必要です。' }, 401, origin);
    const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': authorization, 'apikey': env.SUPABASE_PUBLISHABLE_KEY }
    });
    if (!authResponse.ok) return json({ error: 'ログインの有効期限が切れています。再ログインしてください。' }, 401, origin);
    const authUser = await authResponse.json().catch(() => null);
    if (!authUser?.id) return json({ error: 'ログイン情報を確認できませんでした。' }, 401, origin);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > 10_000_000) return json({ error: '写真データが大きすぎます。' }, 413, origin);
    let stage = 'request_body';
    try {
      const body = await request.json();
      if (!body.image || !/^data:image\/(jpeg|png|webp);base64,/.test(body.image)) return json({ error: '対応する写真データがありません。' }, 400, origin);
      stage = 'openai_fetch';
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini', store: false,
          reasoning: { effort: 'low' },
          instructions: 'あなたは日本の食事記録用栄養推定器です。写真に見える食品を一品ずつ分け、各品の一般的な中央値の量と栄養値を推定してください。過大評価を避け、推定範囲の最大値ではなく最も妥当な中央寄りの値を使います。ユーザーの補足に個数・g数・食べた割合・食べていない品が書かれている場合は、写真より補足を優先してください。base_amountは補正計算の基準となる数値、unitは個・g・杯・切れ等の短い単位にします。totalはitemsの合計と一致させてください。見えない油・調味料・重量を断定せずuncertaintiesに日本語で記載してください。食事でない画像ならitemsを空、全数値を0、confidenceを低にしてください。',
          input: [{ role: 'user', content: [
            { type: 'input_text', text: `${String(body.meal_type || '食事')}の写真です。料理名、推定量、各料理のkcal・P・F・Cと合計を推定してください。実際に食べた量の補足：${String(body.portion_note || '補足なし').slice(0,500)}` },
            { type: 'input_image', image_url: body.image, detail: 'low' }
          ] }],
          text: { format: { type: 'json_schema', name: 'meal_nutrition', strict: true, schema } },
          max_output_tokens: 3000
        })
      });
      stage = 'openai_response_read';
      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        return json({
          error: `診断: OpenAI応答をJSONとして読めません（HTTP ${response.status}）。`,
          reason: 'invalid_openai_response',
          request_id: response.headers.get('x-request-id') || ''
        }, 502, origin);
      }
      if (!response.ok) return json({
        error: `診断: OpenAI APIエラー（HTTP ${response.status}）: ${data.error?.message || '詳細なし'}`,
        reason: data.error?.code || data.error?.type || 'openai_error',
        request_id: response.headers.get('x-request-id') || ''
      }, 502, origin);

      if (data.status === 'incomplete') {
        const reason = data.incomplete_details?.reason || 'unknown';
        return json({
          error: reason === 'max_output_tokens'
            ? 'AI解析が出力上限に達しました。もう一度お試しください。'
            : 'AI解析が完了しませんでした。もう一度お試しください。',
          reason
        }, 502, origin);
      }

      const refusal = data.output
        ?.flatMap(x => x.content || [])
        .find(x => x.type === 'refusal')?.refusal;
      if (refusal) {
        return json({ error: 'この写真はAIで解析できませんでした。', reason: 'refusal' }, 422, origin);
      }

      stage = 'openai_output_extract';
      const output = data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
      if (!output) {
        return json({
          error: 'AIから解析結果が返りませんでした。もう一度お試しください。',
          reason: data.status || 'no_output'
        }, 502, origin);
      }

      try {
        return json(JSON.parse(output), 200, origin);
      } catch {
        return json({
          error: 'AIの解析結果が途中で途切れました。もう一度お試しください。',
          reason: 'invalid_json'
        }, 502, origin);
      }
    } catch (error) {
      return json({
        error: `診断: ${stage}で例外: ${error instanceof Error ? error.message : String(error)}`,
        reason: 'worker_exception'
      }, 500, origin);
    }
  }
};
