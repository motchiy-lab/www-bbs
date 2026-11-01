import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { MongoClient, ObjectId } from "mongodb";
import { readFileSync } from "node:fs";

const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB;
const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!mongoUri || !databaseName) {
  throw new Error("MONGODB_URI and MONGODB_DB must be set before starting the API.");
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const emojiConfig = JSON.parse(
  readFileSync(new URL("./emojis.json", import.meta.url), "utf8"),
);

if (
  !Array.isArray(emojiConfig) ||
  emojiConfig.some(
    (emoji) =>
      typeof emoji.code !== "string" ||
      !/^[a-z0-9_-]{1,32}$/.test(emoji.code) ||
      typeof emoji.label !== "string" ||
      typeof emoji.file !== "string" ||
      !/^[a-zA-Z0-9_-]+\.(png|gif|webp|jpe?g)$/i.test(emoji.file),
  ) ||
  new Set(emojiConfig.map((emoji) => emoji.code)).size !== emojiConfig.length
) {
  throw new Error("server/emojis.json contains an invalid or duplicate emoji entry.");
}

let mongo;
try {
  mongo = new MongoClient(mongoUri);
} catch (error) {
  if (error instanceof Error && error.name === "MongoParseError") {
    throw new Error(
      "Invalid MONGODB_URI. URL-encode special characters in the username and password (for example, @ as %40, : as %3A, / as %2F, and % as %25).",
      { cause: error },
    );
  }
  throw error;
}

await mongo.connect();

const posts = mongo.db(databaseName).collection("posts");

const app = new Hono().basePath("/www-bbs");

app.use(
  "/api/*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/emojis", (context) =>
  context.json({
    emojis: emojiConfig.map(({ code, label, file }) => ({ code, label, file })),
  }),
);

app.get("/api/posts", async (context) => {
  const documents = await posts.find().sort({ createdAt: -1 }).limit(100).toArray();
  return context.json({
    posts: documents.map(({ _id, authorName, body, createdAt }) => ({
      id: _id.toString(),
      authorName,
      body,
      createdAt: createdAt.toISOString(),
    })),
  });
});

app.post("/api/posts", async (context) => {
  let payload;
  try {
    payload = await context.req.json();
  } catch {
    return context.json({ error: "JSON形式の投稿を送信してください。" }, 400);
  }

  const authorName =
    typeof payload?.authorName === "string" ? payload.authorName.trim() : "";
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";

  if (!authorName || authorName.length > 30) {
    return context.json({ error: "お名前は1〜30文字で入力してください。" }, 400);
  }

  if (!body || body.length > 1000) {
    return context.json({ error: "投稿内容は1〜1000文字で入力してください。" }, 400);
  }

  const registeredCodes = new Set(emojiConfig.map((emoji) => emoji.code));
  for (const [, code] of body.matchAll(/:([a-z0-9_-]+):/gi)) {
    if (!registeredCodes.has(code.toLowerCase())) {
      return context.json({ error: `未登録の絵文字です: :${code}:` }, 400);
    }
  }

  const document = {
    _id: new ObjectId(),
    authorName,
    body,
    createdAt: new Date(),
  };
  await posts.insertOne(document);

  return context.json(
    {
      post: {
        id: document._id.toString(),
        authorName: document.authorName,
        body: document.body,
        createdAt: document.createdAt.toISOString(),
      },
    },
    201,
  );
});

app.onError((error, context) => {
  console.error(error);
  return context.json({ error: "サーバーでエラーが発生しました。" }, 500);
});

const server = serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`Hono API listening on http://0.0.0.0:${port}/www-bbs`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    void mongo.close().finally(() => process.exit(0));
  });
}
