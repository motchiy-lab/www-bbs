# よりみち掲示板

CloudflareでホストするReact Routerフロントエンドと、MongoDBに接続する独立したHono APIで構成されています。フロントエンドは `/`、Hono APIのルートは `/www-bbs/` で配信します。便箋の取得・作成はすべてHono APIを通し、投稿者名やアカウント認証はありません。

## 便箋のしくみ

閲覧・投稿は匿名です。ブラウザーの `localStorage` に匿名IDを保存してクレジットと受取履歴を管理します。ブラウザーデータを消去したり別のブラウザーを使ったりすると、新しい参加者として扱われます。匿名IDはアカウント認証ではありません。

便箋を作成すると作成者の手元に届き、その後はまだ受け取っていない参加者へランダムに回ります。直近90秒以内にアクセスした参加者を優先し、該当者がいない場合は過去に訪問した参加者も候補にします。受取人は書き込み（任意）を一度だけ行って次へ流すか、作成者へ返却できます。作成者へ返ると回覧は終了します。受取人は便箋が手元にある間だけ内容を読めます。作成者も手元にない間は内容を読めませんが、書き込み件数は確認できます。一定時間操作がなければ、書き込みなしで自動的に次へ流れます。受取候補がいない便箋は待機し、候補ができたときに回覧を再開します。

クレジットの初期値は `server/settings.json` で編集できます。値を変更したらHono APIを再起動してください。

| 設定 | 初期値 | 意味 |
| --- | ---: | --- |
| `maxCredits` | 100 | 所持上限 |
| `initialCredits` | 50 | 初回付与 |
| `creditsPerRegen` | 1 | 回復ごとの付与量 |
| `regenIntervalSeconds` | 300 | 回復間隔（秒） |
| `createLetterCost` | 30 | 便箋の作成 |
| `returnLetterCost` | 10 | 作成者への返却 |
| `writeCost` | 5 | 書き込み（返却時は返却費用に加算） |
| `recipientTimeoutSeconds` | 300 | 受取後の自動回送までの時間（秒） |
| `onlineWindowSeconds` | 90 | オンラインとみなす最終アクセス時間（秒） |

次の受取人へ流す操作と、時間切れによる自動回送にはクレジットを消費しません。既存のニックネーム付き投稿は新しい便箋として移行されず、掲示板にも表示されません。既存データはMongoDB内に残るため、不要になった場合はバックアップ後にデータベース管理者が削除してください。

## ローカル開発

1. `npm install` を実行します。
2. `.env.api.example` を `.env.api` にコピーし、MongoDBの接続URIとデータベース名を設定します。MongoDBユーザーには対象DBの `readWrite` 権限が必要です。接続ユーザーの認証DBが利用DBと異なる場合は、URIに `authSource`（例: `?authSource=admin`）を指定します。
3. `.env.example` を `.env` にコピーします。ローカルAPIのベースURLは `http://localhost:8787/www-bbs` です。
4. `npm run dev` を実行すると、Hono APIとフロントエンドが同時に起動します。ターミナルを終了すると両方停止します。APIだけを起動する場合は `npm run dev:api` を使います。

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

公開後の掲示板URLはCloudflareのホストURL直下（例: `https://www-bbs.motchiy-tuti.workers.dev/`）です。本番ビルドは `.env.production` に記載した `https://api.motchiy.com/www-bbs` をAPI URLとして使用します。APIのホスト名を変更する場合は `.env.production` を更新するか、Cloudflare Workers Buildsの **Settings > Build > Build variables and secrets** に `VITE_API_BASE_URL` をBuild variableとして設定して再ビルドしてください。このURLはビルド時にブラウザーへ含まれる公開設定です。MongoDBの接続情報は登録しないでください。ローカルの `.env` は引き続き `http://localhost:8787/www-bbs` を指定します。Cloudflare側にはフロントエンドと `public\emojis\` の画像がデプロイされます。

Cloudflare Workersの静的アセットと絵文字画像は `/assets/` と `/emojis/` で配信します。Viteの `base: "/"` はこのアセットパスのための設定です。

### Hono API（自分のサーバー）

Node.js 22以降を用意し、このリポジトリをサーバーへ配置して `npm ci` を実行します。`.env.api` に次の値を設定し、`npm run start:api` で起動してください。
接続先MongoDBは、レプリカセット構成でない単体サーバーでも利用できます。

- `MONGODB_URI`: MongoDB接続URI。ユーザー名・パスワードに `$ : / ? # [ ] @ %` などURIの予約文字が含まれる場合は、URLエンコードしてから設定します（例: `@` は `%40`、`:` は `%3A`、`/` は `%2F`、`%` は `%25`）。
- `MONGODB_DB`: 使用するデータベース名
- `PORT`: APIが待ち受けるポート（省略時 `8787`）
- `CORS_ORIGINS`: Cloudflareフロントエンドのオリジン。たとえば `https://www-bbs.motchiy-tuti.workers.dev`。`/www-bbs` などのパスは付けず、複数の場合はカンマ区切り

APIサーバーは `0.0.0.0` で待ち受けます。APIはMongoDBのインデックスを自動作成しません。インターネット公開時はリバースプロキシでHTTPSを有効にし、Cloudflareの実際のサイトオリジンだけを `CORS_ORIGINS` に設定してください。MongoDBの接続情報はフロントエンドに設定せず、APIサーバー上だけに保管します。

Hono APIのルートには `/www-bbs` が含まれます。リバースプロキシではこのプレフィックスを取り除かず、たとえばNginxでは `proxy_pass http://127.0.0.1:8787;` のように末尾に `/` を付けずに転送します。公開後の確認先は `https://api.motchiy.com/www-bbs/api/health` です。
