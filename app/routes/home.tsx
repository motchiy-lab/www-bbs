import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Route } from "./+types/home";

type Emoji = {
  code: string;
  label: string;
  file: string;
};

type BoardSettings = {
  createLetterCost: number;
  returnLetterCost: number;
  writeCost: number;
  recipientTimeoutSeconds: number;
};

type Session = {
  credits: number;
  maxCredits: number;
  nextCreditAt: string | null;
  now: string;
  settings: BoardSettings;
};

type Letter = {
  id: string;
  body: string;
  notes: { text: string; createdAt: string }[];
  createdAt: string;
  expiresAt: string | null;
  returned: boolean;
};

type SentLetter = {
  id: string;
  replyCount: number;
  status: "active" | "waiting" | "completed";
  createdAt: string;
};

type Board = {
  letters: Letter[];
  sent: SentLetter[];
};

const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || "https://api.motchiy.com/www-bbs"
).replace(/\/+$/, "");
const apiPrefix = apiBaseUrl.endsWith("/www-bbs") ? "" : "/www-bbs";
const appBaseUrl = import.meta.env.BASE_URL;

function getAnonymousId() {
  const key = "yorimichi-anonymous-id";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    throw new Error("匿名IDを保存できません。ブラウザーのサイトデータ設定を確認してください。");
  }
}

function emojiUrl(file: string) {
  return `${appBaseUrl}emojis/${encodeURIComponent(file)}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URLを設定してHono APIのURLを指定してください。");
  }
  const anonymousId = getAnonymousId();

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${apiPrefix}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        "X-Anonymous-Id": anonymousId,
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Hono APIに接続できません。APIのURLとサーバーの状態を確認してください。");
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Hono APIからJSON応答がありません。APIのURL設定を確認してください。");
  }

  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? `リクエストに失敗しました (${response.status})`);
  }
  return result;
}

function renderBody(body: string, emojis: Emoji[]) {
  const emojiByCode = new Map(emojis.map((emoji) => [emoji.code, emoji]));

  return body.split(/(:[a-z0-9_-]+:)/gi).map((part, index) => {
    const match = /^:([a-z0-9_-]+):$/i.exec(part);
    const emoji = match ? emojiByCode.get(match[1].toLowerCase()) : undefined;

    return emoji ? (
      <img
        className="inline-emoji"
        src={emojiUrl(emoji.file)}
        alt={`:${emoji.code}:`}
        title={emoji.label}
        key={`${emoji.code}-${index}`}
      />
    ) : (
      <span key={index}>{part}</span>
    );
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRemaining(value: string | null, now: number) {
  if (!value) return "返却済み";
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1000));
  return `あと${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ことのは便箋 — ことばを、そっとつないで。" },
    {
      name: "description",
      content: "匿名で便箋をつくり、ひとことを添えて次の人へ回す掲示板です。",
    },
  ];
}

export default function Home() {
  const [board, setBoard] = useState<Board>({ letters: [], sent: [] });
  const [session, setSession] = useState<Session | null>(null);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [body, setBody] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyLetter, setBusyLetter] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const didLoadRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replyTextareaRefs = useRef(new Map<string, HTMLTextAreaElement>());

  const loadBoard = useCallback(async (showLoading = false) => {
    if (showLoading && !didLoadRef.current) setLoading(true);
    try {
      const [sessionResult, boardResult, emojiResult] = await Promise.all([
        fetchJson<Session>("/session"),
        fetchJson<Board>("/board"),
        fetchJson<{ emojis: Emoji[] }>("/emojis"),
      ]);
      setSession(sessionResult);
      setBoard(boardResult);
      setEmojis(emojiResult.emojis);
      setError("");
      didLoadRef.current = true;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "便箋を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard(true);
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      void loadBoard();
    }, 15_000);
    return () => window.clearInterval(refresh);
  }, [loadBoard]);

  async function submitLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSending(true);
    try {
      await fetchJson("/posts", {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setBody("");
      await loadBoard();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "便箋を作成できませんでした。",
      );
    } finally {
      setSending(false);
    }
  }

  async function advanceLetter(letter: Letter, target: "next" | "creator") {
    setError("");
    setBusyLetter(letter.id);
    try {
      await fetchJson(`/posts/${encodeURIComponent(letter.id)}/advance`, {
        method: "POST",
        body: JSON.stringify({
          target,
          text: drafts[letter.id] ?? "",
        }),
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[letter.id];
        return next;
      });
      await loadBoard();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "便箋を回せませんでした。",
      );
      await loadBoard();
    } finally {
      setBusyLetter("");
    }
  }

  function insertEmoji(emoji: Emoji, letterId?: string) {
    const textarea = letterId
      ? replyTextareaRefs.current.get(letterId)
      : textareaRef.current;
    const value = letterId ? drafts[letterId] ?? "" : body;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const shortcode = `:${emoji.code}:`;
    const nextValue = `${value.slice(0, start)}${shortcode}${value.slice(end)}`;

    if (letterId) {
      setDrafts((current) => ({ ...current, [letterId]: nextValue }));
    } else {
      setBody(nextValue);
    }
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + shortcode.length, start + shortcode.length);
    });
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href={appBaseUrl} aria-label="ことのは便箋 ホーム">
          <span className="brand-icon-frame" aria-hidden="true">
            <img className="brand-icon" src="/favicon.png" alt="" />
          </span>
          <span>ことのは<span className="brand-light">便箋</span></span>
        </a>
        <div className="topbar-note">
          <span className="online-dot" />
          <span>ことばを、そっとつないで。</span>
        </div>
      </header>

      <main className="main-layout">
        <div className="container page-layout">
          <section className="intro" aria-labelledby="page-title">
            <div className="intro-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> A LETTER PASSES BY</div>
              <h1 id="page-title">ことばを、<br /><span>そっとつないで。</span></h1>
              <p className="intro-description">
                匿名で便箋をつくり、ひとことを添えて次の人へ。<br />
                返ってくるまで、どんな言葉が届くかはお楽しみ。
              </p>
              <div className="intro-meta">
                <span className="meta-sparkle" aria-hidden="true">✳</span>
                <span>手元にある便箋だけが読めます。</span>
              </div>
            </div>
            <div className="intro-art" aria-hidden="true">
              <div className="art-sun" />
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <span className="art-star star-one">✳</span>
              <span className="art-star star-two">✦</span>
              <span className="art-star star-three">✧</span>
              <div className="art-note note-one"><span className="note-face">✉</span><span>お元気ですか？</span></div>
              <div className="art-note note-two"><span className="note-heart">♡</span><span>ひとこと添えて</span></div>
            </div>
          </section>

          <div className="content-grid">
            <section className="board-column" aria-label="匿名の便箋">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">YOUR LETTER DESK</span>
                  <h2>便箋のある暮らし <span className="heading-sparkle">✳</span></h2>
                </div>
                <span className="post-count">{board.letters.length}<span> 通</span></span>
              </div>

              <section className="credit-panel card" aria-label="クレジット残高">
                <div>
                  <span className="credit-label">あなたのクレジット</span>
                  <strong className="credit-balance">
                    {session ? session.credits : "—"}
                    <span> / {session?.maxCredits ?? "—"}</span>
                  </strong>
                </div>
                <div className="credit-meter" aria-hidden="true">
                  <span
                    style={{
                      width: `${session ? (session.credits / session.maxCredits) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="credit-hint">
                  {session?.nextCreditAt
                    ? `次の回復 ${formatDate(session.nextCreditAt)}`
                    : "クレジットは上限です"}
                </span>
              </section>

              <form id="composer" className="composer card" onSubmit={submitLetter}>
                <div className="composer-heading">
                  <div className="avatar avatar-compose">✎</div>
                  <div>
                    <strong>新しい便箋をつくる</strong>
                    <span>
                      {session
                        ? `${session.settings.createLetterCost} クレジットを消費します`
                        : "ことばを便箋にしたためましょう"}
                    </span>
                  </div>
                  <span className="composer-decoration" aria-hidden="true">✳</span>
                </div>
                <label className="sr-only" htmlFor="post-body">便箋の内容</label>
                <textarea
                  ref={textareaRef}
                  id="post-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="たとえば、誰かに伝えたい小さな出来事。"
                  maxLength={1000}
                  rows={4}
                  required
                />
                <div className="composer-footer">
                  <div className="emoji-tools">
                    <span className="emoji-label">絵文字</span>
                    {emojis.map((emoji) => (
                      <button
                        className="emoji-button"
                        type="button"
                        key={emoji.code}
                        title={`${emoji.label} (:${emoji.code}:)`}
                        aria-label={`${emoji.label}を挿入`}
                        onClick={() => insertEmoji(emoji)}
                      >
                        <img src={emojiUrl(emoji.file)} alt="" />
                      </button>
                    ))}
                    {emojis.length === 0 && <span className="emoji-empty">登録待ち</span>}
                  </div>
                  <div className="submit-tools">
                    <span className="character-count">{body.length}/1000</span>
                    <button
                      className="submit-button"
                      type="submit"
                      disabled={
                        sending ||
                        !body.trim() ||
                        !session ||
                        session.credits < session.settings.createLetterCost
                      }
                    >
                      {sending ? "作成中…" : "便箋をつくる"} <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </div>
              </form>

              <div id="inbox" className="feed-heading">
                <h3>手元にある便箋</h3>
                <span><span className="feed-dot" />受け取った便箋だけ表示</span>
              </div>
              {loading ? (
                <div className="feed-state card"><span className="loading-spinner" /> 便箋を確認しています…</div>
              ) : board.letters.length === 0 ? (
                <div className="feed-state empty-state card">
                  <span className="empty-illustration" aria-hidden="true">✉</span>
                  <strong>いま手元に便箋はありません</strong>
                  <span>誰かから届くまで、気長にお待ちください。</span>
                </div>
              ) : (
                <div className="post-list">
                  {board.letters.map((letter) => {
                    const writingCost = session?.settings.writeCost ?? 0;
                    const returnCost = session?.settings.returnLetterCost ?? 0;
                    const busy = busyLetter === letter.id;
                    return (
                      <article className="letter-card card" key={letter.id}>
                        <div className="letter-card-heading">
                          <span className="letter-stamp" aria-hidden="true">✉</span>
                          <div>
                            <strong>{letter.returned ? "便箋が返ってきました" : "便箋が届きました"}</strong>
                            <time dateTime={letter.createdAt}>{formatDate(letter.createdAt)} に作成</time>
                          </div>
                          {!letter.returned && (
                            <span className="letter-timer">{formatRemaining(letter.expiresAt, now)}</span>
                          )}
                        </div>
                        <p className="letter-body">{renderBody(letter.body, emojis)}</p>
                        {letter.notes.length > 0 && (
                          <div className="letter-notes">
                            <h4>これまでの書き込み（{letter.notes.length}）</h4>
                            {letter.notes.map((note, index) => (
                              <div className="letter-note" key={`${note.createdAt}-${index}`}>
                                <p>{renderBody(note.text, emojis)}</p>
                                <time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
                              </div>
                            ))}
                          </div>
                        )}
                        {!letter.returned && (
                          <div className="letter-controls">
                            <label className="sr-only" htmlFor={`note-${letter.id}`}>便箋への書き込み</label>
                            <textarea
                              id={`note-${letter.id}`}
                              className="letter-reply"
                              ref={(element) => {
                                if (element) {
                                  replyTextareaRefs.current.set(letter.id, element);
                                } else {
                                  replyTextareaRefs.current.delete(letter.id);
                                }
                              }}
                              value={drafts[letter.id] ?? ""}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [letter.id]: event.target.value,
                                }))
                              }
                              maxLength={1000}
                              rows={3}
                              placeholder={`書き込みは任意です。書くと ${writingCost} クレジット消費します。`}
                              disabled={busy}
                            />
                            <div className="reply-emoji-tools" aria-label="書き込みに絵文字を挿入">
                              {emojis.map((emoji) => (
                                <button
                                  className="emoji-button"
                                  type="button"
                                  key={`${letter.id}-${emoji.code}`}
                                  title={`${emoji.label} (:${emoji.code}:)`}
                                  aria-label={`${emoji.label}を挿入`}
                                  onClick={() => insertEmoji(emoji, letter.id)}
                                >
                                  <img src={emojiUrl(emoji.file)} alt="" />
                                </button>
                              ))}
                            </div>
                            <div className="letter-actions">
                              <span className="letter-cost-note">
                                {`返却 ${returnCost} ／ 書き込み +${writingCost} クレジット`}
                              </span>
                              <button
                                className="submit-button secondary-button"
                                type="button"
                                disabled={busy || (Boolean(drafts[letter.id]?.trim()) && (session?.credits ?? 0) < writingCost)}
                                onClick={() => void advanceLetter(letter, "next")}
                              >
                                {busy ? "回送中…" : "次の人へ流す"}
                              </button>
                              <button
                                className="submit-button"
                                type="button"
                                disabled={
                                  busy ||
                                  (session?.credits ?? 0) <
                                    returnCost + (drafts[letter.id]?.trim() ? writingCost : 0)
                                }
                                onClick={() => void advanceLetter(letter, "creator")}
                              >
                                作成者へ返す
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              <div id="sent" className="feed-heading">
                <h3>送った便箋</h3>
                <span>書き込み数だけ確認できます</span>
              </div>
              {board.sent.length === 0 ? (
                <div className="sent-empty card">まだ送った便箋はありません。</div>
              ) : (
                <div className="sent-list">
                  {board.sent.map((letter) => (
                    <div className="sent-item card" key={letter.id}>
                      <span className="sent-mark" aria-hidden="true">✉</span>
                      <span className="sent-count">書き込み {letter.replyCount} 件</span>
                      <span className="sent-status">
                        {letter.status === "waiting"
                          ? "受取人待ち"
                          : letter.status === "completed"
                            ? "返却済み"
                            : "回覧中"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {error && (
                <div className="error-message" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={() => void loadBoard(true)}>再読み込み</button>
                </div>
              )}
            </section>

            <aside className="sidebar">
              <section className="welcome-card card">
                <span className="welcome-kicker">WELCOME!</span>
                <h2>手紙のように、<br />人から人へ。</h2>
                <p>名前は出ません。便箋が手元にある間だけ、それまでの書き込みを読めます。</p>
                <div className="welcome-doodle" aria-hidden="true"><span>✉</span><i>✳</i><b>♡</b></div>
              </section>

              <section id="about" className="guide-card card">
                <div className="guide-heading"><span className="guide-icon">?</span><h3>便箋の回しかた</h3></div>
                <ul>
                  <li><span>01</span>作成にはクレジットを使います</li>
                  <li><span>02</span>書き込みは受取人ごとに一度だけ</li>
                  <li><span>03</span>5分たつと自動で次の人へ</li>
                  <li><span>04</span>作成者に返すと便箋は完了</li>
                </ul>
                <a href="#composer" className="guide-link">便箋をつくる <span aria-hidden="true">→</span></a>
              </section>

              <section id="emojis" className="emoji-card card">
                <div className="emoji-card-heading"><span>✿</span><h3>この掲示板の絵文字</h3></div>
                <p>便箋や書き込みに添えられます。</p>
                <div className="emoji-gallery">
                  {emojis.slice(0, 8).map((emoji) => (
                    <span className="emoji-gallery-item" key={emoji.code} title={emoji.label}>
                      <img src={emojiUrl(emoji.file)} alt={emoji.label} />
                    </span>
                  ))}
                  {emojis.length === 0 && <span className="emoji-empty">絵文字を準備中です</span>}
                </div>
              </section>
            </aside>
          </div>

          <footer className="site-footer">
            <span>ことのは便箋 <span className="footer-sparkle">✳</span></span>
            <span>ことばが、よいことのはになりますように。</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
