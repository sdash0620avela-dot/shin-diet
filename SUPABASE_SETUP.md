# AI Diet クラウド接続

## 必要なもの

- SupabaseプロジェクトのURL
- Publishable key（ブラウザ公開用）

`service_role`キーは絶対にアプリへ入れない。

## 接続手順

1. SupabaseのSQL Editorで `supabase-schema.sql` 全文を実行する。
2. AuthenticationのURL Configurationで公開アプリURLをSite URLとRedirect URLへ登録する。
3. `supabase-config.js` のURLとPublishable keyを置き換える。
4. 慎の端末でログインし、既存記録が残ったままクラウドへ同期されることを確認する。
5. ログアウト・再ログイン後に同じ記録が復元されることを確認する。
6. 確認後、弟の端末で新規ログインし、空の個人データから始まることを確認する。

データはRLSにより、ログイン中の本人の `user_id` と一致する行だけ読書きできる。
