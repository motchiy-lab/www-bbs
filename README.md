# よりみち掲示板

CloudflareでホストするReact Routerフロントエンドと、MongoDBに接続する独立したHono APIで構成されています。投稿の取得・作成はすべてHono APIを通します。投稿者はニックネームを入力する方式で、アカウント認証はありません。

## ローカル開発

1. `npm install` を実行します。
2. `.env.api.example` を `.env.api` にコピーし、MongoDBの接続URIとデータベース名を設定します。MongoDBユーザーには対象DBの `readWrite` 権限が必要です。接続ユーザーの認証DBが利用DBと異なる場合は、URIに `authSource`（例: `?authSource=admin`）を指定します。
3. `.env.example` を `.env` にコピーします。ローカルAPIのベースURLは `http://localhost:8787/www-bbs` です。
4. `npm run dev:api` と `npm run dev` をそれぞれ起動します。

## 絵文字の追加

1. 画像を `public\emojis\` にアップロードします。PNG、GIF、WebP、JPG/JPEGを使用できます。
2. `server\emojis.json` に絵文字を登録します。`code` は投稿本文で使う英小文字・数字・`_`・`-`のみの短い名前、`label` は表示名、`file` はアップロードしたファイル名です。

```json
{
  "code": "hello",
  "label": "こんにちは",
  "file": "hello.png"
}
```

登録した絵文字は投稿フォームのボタンに表示され、投稿内では `:hello:` の形式で画像に置き換わります。絵文字画像はフロントエンドと一緒にCloudflareへデプロイされます。

## デプロイ

### フロントエンド（Cloudflare）

ビルド時に `VITE_API_BASE_URL` をHono APIの公開URL（例: `https://api.motchiy.com/www-bbs`）に設定してから `npm run deploy` を実行します。Cloudflare側にはフロントエンドと `public\emojis\` の画像がデプロイされます。

### Hono API（自分のサーバー）

Node.js 22以降を用意し、このリポジトリをサーバーへ配置して `npm ci` を実行します。`.env.api` に次の値を設定し、`npm run start:api` で起動してください。

- `MONGODB_URI`: MongoDB接続URI。ユーザー名・パスワードに `$ : / ? # [ ] @ %` などURIの予約文字が含まれる場合は、URLエンコードしてから設定します（例: `@` は `%40`、`:` は `%3A`、`/` は `%2F`、`%` は `%25`）。
- `MONGODB_DB`: 使用するデータベース名
- `PORT`: APIが待ち受けるポート（省略時 `8787`）
- `CORS_ORIGINS`: Cloudflareフロントエンドのオリジン。複数の場合はカンマ区切り

APIサーバーは `0.0.0.0` で待ち受けます。APIはMongoDBのインデックスを自動作成しません。インターネット公開時はリバースプロキシでHTTPSを有効にし、Cloudflareの実際のサイトオリジンだけを `CORS_ORIGINS` に設定してください。MongoDBの接続情報はフロントエンドに設定せず、APIサーバー上だけに保管します。

Hono APIのルートには `/www-bbs` が含まれます。リバースプロキシではこのプレフィックスを取り除かず、たとえばNginxでは `proxy_pass http://127.0.0.1:8787;` のように末尾に `/` を付けずに転送します。公開後の確認先は `https://api.motchiy.com/www-bbs/api/health` です。
