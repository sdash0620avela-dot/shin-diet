/* E2E専用：Supabase JSの代替。本番Supabaseへは一切接続しない。
 * データはテストランナーが保持する仮想クラウド（https://fake-supabase.test）に保存する。 */
(function () {
  const API = 'https://fake-supabase.test/';
  const authUser = () => { try { return JSON.parse(localStorage.getItem('e2eAuthUser') || 'null'); } catch (e) { return null; } };
  const call = async (body) => { const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('fake db ' + r.status); return r.json(); };
  function builder(table) {
    const q = { table, filters: {} };
    const run = async (single) => { try { const res = await call({ op: 'select', table, filters: q.filters, user: authUser() && authUser().id }); return { data: single ? (res.data[0] || null) : res.data, error: null }; } catch (e) { return { data: null, error: { message: 'Failed to fetch' } }; } };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters[k] = v; return api; },
      maybeSingle() { return run(true); },
      then(res, rej) { return run(false).then(res, rej); },
      async upsert(rows) { try { await call({ op: 'upsert', table, rows: Array.isArray(rows) ? rows : [rows], user: authUser() && authUser().id }); return { error: null }; } catch (e) { return { error: { message: 'Failed to fetch' } }; } }
    };
    return api;
  }
  window.supabase = {
    createClient() {
      const listeners = [];
      const session = () => { const u = authUser(); return u ? { user: u, access_token: 'e2e-token-' + u.id } : null; };
      return {
        auth: {
          async getSession() { return { data: { session: session() }, error: null }; },
          onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session()), 0); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() { localStorage.removeItem('e2eAuthUser'); listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
          async signInWithOtp() { return { error: null }; },
          async verifyOtp() { return { data: { user: authUser() }, error: null }; }
        },
        from: builder
      };
    }
  };
})();
