# ずんだもん何切る — Discord取込ツール

## アプリを開く

```powershell
npm run app
```

ブラウザで `http://localhost:4173/` を開きます。構造化済みの牌姿から打牌を選び、確定後にDiscordスレッドから取得した解説を確認できます。回答と進捗はブラウザの `localStorage` に保存されます。

### 管理画面

問題ごとに正解打牌（複数可）と解説文を編集できます。「元に戻す」でDiscordから取得した原本へ戻せます。管理パスワードはHTML・JavaScript・JSON・ブラウザ保存領域には保存されません。

- ローカル: `.env` の `ADMIN_PASSWORD` で認証し、変更分を `data/question-overrides.json` に保存します。
- GitHub Pages: Supabase Edge FunctionのSecret `ADMIN_PASSWORD` で認証し、変更分を `public.zundamon_question_overrides` に保存します。

### GitHub Pages + Supabase

公開画面はGitHub Pages、共有編集データはSupabaseを使用します。`config.js` に含まれるのは公開Edge Function URLだけです。Supabaseのsecret key、service role key、管理パスワードは公開ファイルへ置きません。

Supabase側の構成:

- Migration: `supabase/migrations/20260716000000_create_zundamon_question_overrides.sql`
- Edge Function: `supabase/functions/zundamon-question-admin/index.ts`
- Production Secret: `ADMIN_PASSWORD`

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
