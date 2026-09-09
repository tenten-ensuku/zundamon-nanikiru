# ずんだもん何切る — Discord取込ツール

## アプリを開く

```powershell
npm run app
```

ブラウザで `http://localhost:4173/` を開きます。構造化済みの牌姿から打牌を選び、確定後にDiscordスレッドから取得した解説を確認できます。回答と進捗はブラウザの `localStorage` に保存されます。

### 管理画面

問題ごとに正解打牌（複数可）と解説文を編集できます。「元に戻す」で同梱の問題データへ戻せます。

**現在は全体公開前の一時的な編集開放中です。ログインなしで編集できます。** URLを知っている人による書き換えも可能です。

- ローカル: 変更分をこのPCの `data/question-overrides.json` に保存します。公開サイトには自動反映されません。
- GitHub Pages: 変更分を専用Cloudflare D1 `zundamon-question-data` に保存し、利用者全員へ反映します。
- 共有APIが停止中なら入力を保持し、保存できたようには扱いません。公開用スナップショット・取得済み差分からの出題と端末内の採点・履歴は継続できます。

回答後は「解説を編集」から動画解説・補足解説をその場で編集できます（`open` の間のみ）。`PATCH /questions/:id/explanation` は変更した解説欄だけを保存し、更新日時が変わっていれば409で上書きを拒否します。入力は失敗時も保持し、画面移動時は未保存の変更を確認します。公開時にはWorkerを先に更新してから、クライアントを反映してください。

解説の下と管理一覧に、○ 完成 / △ 要確認 / × 要修正のチェックがあります。同時選択は1種類で、選択済みをもう一度押すと未確認に戻せます。本文とは別の更新日時で競合を検出し、以前の確認済みチェックは○として保持します。

#### 全体公開時に編集を停止する

`QUESTION_EDIT_MODE` をサーバー側で設定します。画面だけでなく、追加・修正・確認済みチェック・復元の全APIで適用します。

| 値 | 動作 |
| --- | --- |
| `open` | 誰でも編集可能（現在の初期値） |
| `password` | `ADMIN_PASSWORD` で認証した人だけ編集可能 |
| `closed` | パスワードが正しくても全編集を拒否 |

ローカルでは `.env` に `QUESTION_EDIT_MODE=closed` を追加して `npm run app` を再起動します。公開版は `cloudflare/wrangler.jsonc` の `QUESTION_EDIT_MODE` を同じ設定に変更し、`npm run worker:deploy` で配信します。

環境変数が優先され、不正な値は安全側の `closed` になります。完成後の全体公開時は `config.js` の `releaseStage` も `public` にし、古い編集画面からの書き込みも拒否されることを確認してください。

将来 `password` モードを使う場合のローカル用パスワードは `.env`、公開版はWorker Secret `ADMIN_PASSWORD` に保存します。現在は不要です。パスワードを公開ファイルやブラウザ保存領域へ置きません。通常のアプリ更新の公開と、利用者を広く募集する「全体公開」は区別してください。

### GitHub Pages + Cloudflare

公開画面と画像は既存GitHub Pages、共有編集差分と確認状態は専用D1を使用します。`config.js` に含まれるのは公開Worker URLだけです。DBをブラウザへ直接公開せず、Workerの入力検証・競合検出を通して更新します。

構成:

- Worker: `cloudflare/worker.mjs` / `cloudflare/wrangler.jsonc` (`zundamon-question-api`)
- D1: `zundamon-question-data` / `cloudflare/migrations/0001_questions.sql`
- 公開用スナップショット: `public/shared-overrides.json`（公開項目だけ。独立バックアップではありません）
- 同期: `shared-data.js`。最大50件ずつの差分取得、10秒の公開APIキャッシュ、定期ポーリングなし。
- 制限: IPあたり読取等240回/分・保存60回/分、アプリ全体のDB変更1,000回/UTC日。Cloudflareのアカウント共通枠は別に存在し、無料・無停止を保証しません。
- テスト: `npm test`、配信確認: `npm run worker:check`、Worker公開: `npm run worker:deploy`。
- GitHub Pagesはmainブランチのルート。バージョンを1つ上げ、テスト後にpushし、実配信バージョンと保存操作まで確認します。

Supabaseの対象2テーブルは削除せず保存し、`service_role` の書き込み権限だけを停止しています。通常画面・管理画面・Discord取込にSupabaseへのネットワーク依存はありません。旧コードは記録として保持します。ロールバックはD1の新しい編集を先に退避・照合してから行い、単にAPI URLだけを旧版へ戻さないでください。非公開の移行記録・独立バックアップ・復元手順は作業日のローカル移行フォルダにあります。

## Discord取込

指定Discord親チャンネルの画像付き投稿を問題として取り込みます。通常の画像添付に加え、Discordの転送メッセージ（message snapshots）にも対応し、転送元の画像・投稿日時・メッセージURL・スレッドを取得します。各投稿のスレッドを最後まで読み、\`DISCORD_EXPLAINER_USER_ID\` と一致する投稿だけを、投稿日時順で改行連結した解説にします。

出力先:

- 問題データ: \`public/questions.json\`
- 画像: \`public/questions/question-001.png\`（複数画像は \`question-001-02.png\` のように連番）
- 中断再開用の状態: \`data/import-state.json\`
- 失敗ログ: \`data/import-errors.jsonl\`

\`questions.json\` の各項目は指定形式に加え、複数画像を扱うための \`images\` 配列を持ちます。既存アプリは先頭画像の \`image\` だけを使えます。

## 初回設定

1. Node.js 20以降を用意します。
2. \`.env.example\` を \`.env\` にコピーし、次の4項目を入力します。
   - \`DISCORD_BOT_TOKEN\`
   - \`DISCORD_GUILD_ID\`
   - \`DISCORD_CHANNEL_ID\`
   - \`DISCORD_EXPLAINER_USER_ID\`
3. Discord Developer PortalでBotの **Message Content Intent** を有効にします。
4. Botを対象サーバーへ追加し、対象チャンネルと各スレッドに「チャンネルを見る」「メッセージ履歴を読む」権限を与えます。

\`.env\` は \`.gitignore\` 済みです。Tokenはソース、JSON、ログへ書き出しません。

## 実行

最初は10件で確認します。

\`\`\`powershell
# 最新10件
npm run import:questions

# 最古10件
npm run import:questions:oldest
\`\`\`

出力された \`public/questions.json\` と \`public/questions/\` を確認できたら、全件を実行します。

\`\`\`powershell
npm run import:questions:all
\`\`\`

途中で止まっても同じコマンドを再実行すれば、保存済みの \`discordMessageId\` は重複取得せず未完了分だけを続行します。投稿中の画像はすべて記録します。画像パスを固定するため保存名は \`.png\` ですが、添付データは変換せず保存します。

## 追加オプション

\`\`\`powershell
node scripts/import-discord-questions.mjs --test newest
node scripts/import-discord-questions.mjs --test oldest
node scripts/import-discord-questions.mjs --test oldest --limit 3
\`\`\`

Discordの429（レート制限）は応答の待機時間に従って自動再試行します。個別投稿の失敗は処理全体を止めず、親メッセージIDとエラー内容を \`data/import-errors.jsonl\` に残します。

## 牌姿・局面の構造化

画像取込後、Windows標準の日本語OCRとプロジェクト内の承認済み牌画像を使って構造化します。

\`\`\`powershell
npm run structure:questions
\`\`\`

- \`hand\`: 打牌選択可能な手牌。分離表示されたツモ牌も含め、萬子・筒子・索子・字牌の順に理牌します。
- \`draw\`: 常に \`null\` です。
- \`meldCount\`: 鳴き数。鳴き牌は \`hand\` へ入れません。
- \`round\`, \`seat\`, \`turn\`, \`honba\`, \`points\`: 画像上部から認識した局面です。
- \`dora\`: 画像内のドラ牌です。

牌コードは \`1m～9m\`, \`1p～9p\`, \`1s～9s\`, \`1z～7z\` を使います。赤5萬・赤5筒・赤5索は通常5と区別し、それぞれ \`0m\`, \`0p\`, \`0s\` で保存します。牌画像は赤牌を含む37種です。詳細な認識レポートは \`data/structure-report.json\` へ保存されます。
