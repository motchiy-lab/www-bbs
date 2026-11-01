import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { replenishCredits } from "./credits.js";

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

const settings = JSON.parse(
  readFileSync(new URL("./settings.json", import.meta.url), "utf8"),
);
const positiveSettings = [
  "maxCredits",
  "initialCredits",
  "creditsPerRegen",
  "regenIntervalSeconds",
  "createLetterCost",
  "returnLetterCost",
  "writeCost",
  "recipientTimeoutSeconds",
  "onlineWindowSeconds",
];
if (
  positiveSettings.some(
    (key) => !Number.isInteger(settings[key]) || settings[key] < 1,
  ) ||
  settings.initialCredits > settings.maxCredits ||
  settings.creditsPerRegen > settings.maxCredits ||
  settings.createLetterCost > settings.maxCredits ||
  settings.returnLetterCost + settings.writeCost > settings.maxCredits
) {
  throw new Error("server/settings.json contains invalid credit or timing settings.");
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
  mongo = new MongoClient(mongoUri, { retryWrites: false });
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

const database = mongo.db(databaseName);
const posts = database.collection("posts");
const users = database.collection("anonymousUsers");
const app = new Hono().basePath("/www-bbs");

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

app.use(
  "/*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Anonymous-Id"],
  }),
);

function getUserId(context) {
  const userId = context.req.header("X-Anonymous-Id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new ApiError("匿名IDがありません。ページを再読み込みしてください。", 400);
  }
  return userId;
}

async function getOrCreateUser(userId, { touch = false } = {}) {
  const now = new Date();
  await users.updateOne(
    { _id: userId },
    {
      $setOnInsert: {
        credits: settings.initialCredits,
        creditUpdatedAt: now,
        createdAt: now,
      },
      ...(touch ? { $set: { lastSeenAt: now } } : {}),
    },
    { upsert: true },
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const user = await users.findOne({ _id: userId });
    if (!user) {
      throw new Error("Failed to load the anonymous participant.");
    }

    const replenished = replenishCredits(user, now.getTime(), settings);
    const result = await users.updateOne(
      {
        _id: userId,
        credits: user.credits,
        creditUpdatedAt: user.creditUpdatedAt,
      },
      {
        $set: {
          credits: replenished.credits,
          creditUpdatedAt: replenished.creditUpdatedAt,
        },
      },
    );
    if (result.matchedCount === 1) {
      return { ...user, ...replenished, ...(touch ? { lastSeenAt: now } : {}) };
    }
  }
  throw new ApiError("クレジットを更新できませんでした。再度お試しください。", 409);
}

async function chargeCredits(userId, amount) {
  const user = await getOrCreateUser(userId);
  if (user.credits < amount) {
    throw new ApiError(`クレジットが足りません（必要: ${amount}）。`, 409);
  }

  const result = await users.updateOne(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount } },
  );
  if (result.modifiedCount !== 1) {
    throw new ApiError("クレジットを更新できませんでした。再度お試しください。", 409);
  }
}

async function refundCredits(userId, amount) {
  await users.updateOne(
    { _id: userId },
    [
      {
        $set: {
          credits: {
            $min: [settings.maxCredits, { $add: ["$credits", amount] }],
          },
        },
      },
    ],
  );
}

function validateMessage(value, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) {
    throw new ApiError("便箋の内容を入力してください。");
  }
  if (text.length > 1000) {
    throw new ApiError("書き込みは1000文字以内で入力してください。");
  }

  const registeredCodes = new Set(emojiConfig.map((emoji) => emoji.code));
  for (const [, code] of text.matchAll(/:([a-z0-9_-]+):/gi)) {
    if (!registeredCodes.has(code.toLowerCase())) {
      throw new ApiError(`未登録の絵文字です: :${code}:`);
    }
  }
  return text;
}

function chooseRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function chooseNextRecipient(post, now = new Date()) {
  const alreadyReceived = new Set([
    ...(Array.isArray(post.receivedUserIds) ? post.receivedUserIds : []),
    post.creatorId,
  ]);
  const candidates = await users
    .find({ _id: { $nin: [...alreadyReceived] } })
    .toArray();
  if (candidates.length === 0) {
    return null;
  }

  const onlineAfter = new Date(
    now.getTime() - settings.onlineWindowSeconds * 1000,
  );
  const online = candidates.filter(
    (candidate) =>
      candidate.lastSeenAt instanceof Date && candidate.lastSeenAt >= onlineAfter,
  );
  return chooseRandom(online.length > 0 ? online : candidates);
}

async function deliverOrWait(post, now = new Date()) {
  const nextRecipient = await chooseNextRecipient(post, now);
  if (!nextRecipient) {
    await posts.updateOne(
      {
        _id: post._id,
        status: "active",
        currentRecipientId: post.currentRecipientId,
      },
      {
        $set: {
          status: "waiting",
          currentRecipientId: null,
          expiresAt: null,
        },
      },
    );
    return;
  }

  await posts.updateOne(
    { _id: post._id, status: "active", currentRecipientId: post.currentRecipientId },
    {
      $set: {
        currentRecipientId: nextRecipient._id,
        expiresAt: new Date(
          now.getTime() + settings.recipientTimeoutSeconds * 1000,
        ),
      },
      $addToSet: { receivedUserIds: nextRecipient._id },
    },
  );
}

async function dispatchWaitingLetters() {
  const waiting = await posts
    .find({ version: 2, status: "waiting" })
    .toArray();
  for (const post of waiting) {
    const current = await posts.findOne({
      _id: post._id,
      version: 2,
      status: "waiting",
    });
    if (!current) continue;

    const nextRecipient = await chooseNextRecipient(current);
    if (!nextRecipient) continue;

    const now = new Date();
    await posts.updateOne(
      { _id: current._id, version: 2, status: "waiting" },
      {
        $set: {
          status: "active",
          currentRecipientId: nextRecipient._id,
          expiresAt: new Date(
            now.getTime() + settings.recipientTimeoutSeconds * 1000,
          ),
        },
        $addToSet: { receivedUserIds: nextRecipient._id },
      },
    );
  }
}

async function expireLetter(postId, recipientId, expiresAt) {
  const now = new Date();
  const post = await posts.findOne({
    _id: postId,
    version: 2,
    status: "active",
    currentRecipientId: recipientId,
    expiresAt: { $eq: expiresAt, $lte: now },
  });
  if (post) {
    await deliverOrWait(post, now);
  }
}

let sweepRunning = false;
async function sweepLetters() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const now = new Date();
    const expired = await posts
      .find({
        version: 2,
        status: "active",
        expiresAt: { $lte: now },
      })
      .project({ _id: 1, currentRecipientId: 1, expiresAt: 1 })
      .toArray();
    for (const post of expired) {
      await expireLetter(post._id, post.currentRecipientId, post.expiresAt);
    }
    await dispatchWaitingLetters();
  } catch (error) {
    console.error("Failed to advance expired letters.", error);
  } finally {
    sweepRunning = false;
  }
}

app.get("/health", (context) => context.json({ status: "ok" }));

app.get("/emojis", (context) =>
  context.json({
    emojis: emojiConfig.map(({ code, label, file }) => ({ code, label, file })),
  }),
);

app.get("/session", async (context) => {
  const userId = getUserId(context);
  const user = await getOrCreateUser(userId, { touch: true });
  await dispatchWaitingLetters();
  const now = Date.now();
  const nextCreditAt =
    user.credits >= settings.maxCredits
      ? null
      : new Date(
          new Date(user.creditUpdatedAt).getTime() +
            settings.regenIntervalSeconds * 1000,
        ).toISOString();
  return context.json({
    credits: user.credits,
    maxCredits: settings.maxCredits,
    nextCreditAt,
    now: new Date(now).toISOString(),
    settings: {
      createLetterCost: settings.createLetterCost,
      returnLetterCost: settings.returnLetterCost,
      writeCost: settings.writeCost,
      recipientTimeoutSeconds: settings.recipientTimeoutSeconds,
    },
  });
});

app.get("/board", async (context) => {
  const userId = getUserId(context);
  await getOrCreateUser(userId, { touch: true });
  await dispatchWaitingLetters();

  const [heldLetters, createdLetters] = await Promise.all([
    posts
      .find({ version: 2, currentRecipientId: userId })
      .sort({ createdAt: -1 })
      .toArray(),
    posts
      .find({
        version: 2,
        creatorId: userId,
        currentRecipientId: { $ne: userId },
      })
      .sort({ createdAt: -1 })
      .toArray(),
  ]);

  return context.json({
    letters: heldLetters.map((post) => ({
      id: post._id,
      body: post.body,
      notes: post.notes.map(({ text, createdAt }) => ({
        text,
        createdAt: createdAt.toISOString(),
      })),
      createdAt: post.createdAt.toISOString(),
      expiresAt: post.expiresAt?.toISOString() ?? null,
      returned: post.status === "completed",
      isCreator: post.creatorId === userId,
    })),
    sent: createdLetters.map((post) => ({
      id: post._id,
      replyCount: post.notes.length,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
    })),
  });
});

app.post("/posts", async (context) => {
  const userId = getUserId(context);
  let payload;
  try {
    payload = await context.req.json();
  } catch {
    return context.json({ error: "JSON形式の便箋を送信してください。" }, 400);
  }
  const body = validateMessage(payload?.body, true);
  const now = new Date();
  const post = {
    _id: randomUUID(),
    version: 2,
    creatorId: userId,
    body,
    notes: [],
    receivedUserIds: [userId],
    currentRecipientId: userId,
    status: "active",
    createdAt: now,
    expiresAt: new Date(
      now.getTime() + settings.recipientTimeoutSeconds * 1000,
    ),
  };

  await getOrCreateUser(userId, { touch: true });
  await chargeCredits(userId, settings.createLetterCost);
  await posts.insertOne(post);

  return context.json({ id: post._id }, 201);
});

app.post("/posts/:postId/advance", async (context) => {
  const userId = getUserId(context);
  let payload;
  try {
    payload = await context.req.json();
  } catch {
    return context.json({ error: "JSON形式の操作を送信してください。" }, 400);
  }
  const target = payload?.target;
  if (target !== "next" && target !== "creator") {
    return context.json({ error: "便箋の行き先が正しくありません。" }, 400);
  }
  const text = validateMessage(payload?.text);
  const postId = context.req.param("postId");
  const now = new Date();
  const post = await posts.findOne({
    _id: postId,
    version: 2,
    status: "active",
    currentRecipientId: userId,
  });
  if (!post) {
    throw new ApiError("この便箋は手元にないか、すでに流されています。", 404);
  }

  if (post.expiresAt && post.expiresAt <= now) {
    await expireLetter(post._id, userId, post.expiresAt);
    return context.json(
      { error: "時間切れのため、便箋は自動で次へ流れました。" },
      409,
    );
  }

  if (text && post.notes.some((note) => note.userId === userId)) {
    throw new ApiError("この便箋にはすでに書き込み済みです。");
  }

  const cost =
    (target === "creator" ? settings.returnLetterCost : 0) +
    (text ? settings.writeCost : 0);
  if (cost > 0) {
    await chargeCredits(userId, cost);
  }

  const change = {
    $set:
      target === "creator"
        ? {
            status: "completed",
            currentRecipientId: post.creatorId,
            expiresAt: null,
            returnedAt: now,
          }
        : {
            status: "waiting",
            currentRecipientId: null,
            expiresAt: null,
          },
  };
  if (text) {
    change.$push = {
      notes: { userId, text, createdAt: now },
    };
  }

  const updateResult = await posts.updateOne(
    {
      _id: post._id,
      version: 2,
      status: "active",
      currentRecipientId: userId,
      expiresAt: { $gt: now },
    },
    change,
  );

  if (updateResult.modifiedCount !== 1) {
    if (cost > 0) {
      await refundCredits(userId, cost);
    }
    const current = await posts.findOne({ _id: post._id });
    if (
      current?.status === "active" &&
      current.currentRecipientId === userId &&
      current.expiresAt instanceof Date &&
      current.expiresAt <= new Date()
    ) {
      await expireLetter(current._id, userId, current.expiresAt);
      return context.json(
        { error: "時間切れのため、便箋は自動で次へ流れました。" },
        409,
      );
    }
    throw new ApiError("便箋の状態が変わりました。再読み込みしてください。", 409);
  }

  if (target === "next") {
    await dispatchWaitingLetters();
  }
  return context.json({ ok: true });
});

app.onError((error, context) => {
  if (error instanceof ApiError) {
    return context.json({ error: error.message }, error.status);
  }
  console.error(error);
  return context.json({ error: "サーバーでエラーが発生しました。" }, 500);
});

const server = serve({
  fetch: app.fetch,
  port,
  hostname: "0.0.0.0",
});
const sweepTimer = setInterval(() => void sweepLetters(), 5000);
sweepTimer.unref();

console.log(`Hono API listening on http://0.0.0.0:${port}/www-bbs`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(sweepTimer);
    server.close();
    void mongo.close().finally(() => process.exit(0));
  });
}
