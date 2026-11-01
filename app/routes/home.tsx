import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Route } from "./+types/home";

type Emoji = {
  code: string;
  label: string;
  file: string;
};

type Post = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const apiPrefix = apiBaseUrl.endsWith("/www-bbs") ? "" : "/www-bbs";
const appBaseUrl = import.meta.env.BASE_URL;

function emojiUrl(file: string) {
  return `${appBaseUrl}emojis/${encodeURIComponent(file)}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URLを設定してHono APIのURLを指定してください。");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${apiPrefix}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
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

export function meta({}: Route.MetaArgs) {
  return [
    { title: "よりみち掲示板 — ちいさな話を、気軽に。" },
    {
      name: "description",
      content: "好きなことや今日あったことを、気軽に書き込める小さな掲示板です。",
    },
  ];
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [postResult, emojiResult] = await Promise.all([
        fetchJson<{ posts: Post[] }>("/api/posts"),
        fetchJson<{ emojis: Emoji[] }>("/api/emojis"),
      ]);
      setPosts(postResult.posts);
      setEmojis(emojiResult.emojis);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "掲示板を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSending(true);

    try {
      const result = await fetchJson<{ post: Post }>("/api/posts", {
        method: "POST",
        body: JSON.stringify({ authorName, body }),
      });
      setPosts((current) => [result.post, ...current].slice(0, 100));
      setBody("");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "投稿できませんでした。",
      );
    } finally {
      setSending(false);
    }
  }

  function insertEmoji(emoji: Emoji) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const shortcode = `:${emoji.code}:`;
    const nextBody = `${body.slice(0, start)}${shortcode}${body.slice(end)}`;

    setBody(nextBody);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + shortcode.length, start + shortcode.length);
    });
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href={appBaseUrl} aria-label="よりみち掲示板 ホーム">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>よりみち<span className="brand-light">掲示板</span></span>
        </a>
        <div className="topbar-note">
          <span className="online-dot" />
          <span>今日ものんびり、ひとこと。</span>
        </div>
        <a className="topbar-link" href="#about">この掲示板について <span aria-hidden="true">↗</span></a>
      </header>

      <nav className="side-menu" aria-label="ページ内メニュー">
        <a href="#composer">ひとことを投稿</a>
        <a href="#posts">みんなの投稿</a>
        <a href="#emojis">掲示板の絵文字</a>
        <a href="#about">この掲示板について</a>
      </nav>
      <button
        className="menu-toggle"
        type="button"
        aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
      </button>
      <main className="main-layout">
        {menuOpen && (
          <nav id="mobile-menu" className="mobile-menu" aria-label="ページ内メニュー">
            <a href="#composer" onClick={() => setMenuOpen(false)}>ひとことを投稿</a>
            <a href="#posts" onClick={() => setMenuOpen(false)}>みんなの投稿</a>
            <a href="#emojis" onClick={() => setMenuOpen(false)}>掲示板の絵文字</a>
            <a href="#about" onClick={() => setMenuOpen(false)}>この掲示板について</a>
          </nav>
        )}
        <div className="container page-layout">
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> A LITTLE PLACE TO TALK</div>
            <h1 id="page-title">ちいさな話を、<br /><span>気軽に。</span></h1>
            <p className="intro-description">
              今日のこと、好きなもののこと。<br />
              ふと思いついたことを、ここに置いていきませんか。
            </p>
            <div className="intro-meta">
              <span className="meta-sparkle" aria-hidden="true">✳</span>
              <span>ひとことから、つながろう。</span>
            </div>
          </div>
          <div className="intro-art" aria-hidden="true">
            <div className="art-sun" />
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <span className="art-star star-one">✳</span>
            <span className="art-star star-two">✦</span>
            <span className="art-star star-three">✧</span>
            <div className="art-note note-one"><span className="note-face">☺</span><span>こんにちは！</span></div>
            <div className="art-note note-two"><span className="note-heart">♡</span><span>いい日だね</span></div>
          </div>
        </section>

        <div className="content-grid">
          <section className="board-column" aria-label="掲示板">
            <div className="section-heading">
              <div>
                <span className="section-kicker">COMMUNITY BOARD</span>
                <h2>みんなのひとこと <span className="heading-sparkle">✳</span></h2>
              </div>
              <span className="post-count">{posts.length}<span> 件</span></span>
            </div>

            <form id="composer" className="composer card" onSubmit={submitPost}>
              <div className="composer-heading">
                <div className="avatar avatar-compose">✎</div>
                <div>
                  <strong>ひとこと投稿する</strong>
                  <span>あなたの今日を聞かせてください</span>
                </div>
                <span className="composer-decoration" aria-hidden="true">✳</span>
              </div>
              <label className="sr-only" htmlFor="author-name">お名前（ニックネーム）</label>
              <input
                id="author-name"
                className="name-input"
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                placeholder="お名前（ニックネーム）"
                maxLength={30}
                required
              />
              <label className="sr-only" htmlFor="post-body">投稿内容</label>
              <textarea
                ref={textareaRef}
                id="post-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="たとえば、今日のおやつがおいしかったこと。"
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
                  <button className="submit-button" type="submit" disabled={sending || !authorName.trim() || !body.trim()}>
                    {sending ? "投稿中…" : "投稿する"} <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </div>
              {error && (
                <div className="error-message" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={() => void loadBoard()}>再読み込み</button>
                </div>
              )}
            </form>

            <div id="posts" className="feed-heading">
              <h3>新着の投稿</h3>
              <span><span className="feed-dot" />新しい順</span>
            </div>

            {loading ? (
              <div className="feed-state card"><span className="loading-spinner" /> 投稿を読み込んでいます…</div>
            ) : posts.length === 0 ? (
              <div className="feed-state empty-state card">
                <span className="empty-illustration" aria-hidden="true">☁</span>
                <strong>まだ投稿はありません</strong>
                <span>最初のひとことを、ここに残してみましょう。</span>
              </div>
            ) : (
              <div className="post-list">
                {posts.map((post, index) => (
                  <article className="post-card card" key={post.id}>
                    <div className={`avatar avatar-${index % 4}`}>{post.authorName.slice(0, 1)}</div>
                    <div className="post-main">
                      <div className="post-meta">
                        <strong>{post.authorName}</strong>
                        <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
                      </div>
                      <p className="post-body">{renderBody(post.body, emojis)}</p>
                      <div className="post-reaction"><span aria-hidden="true">✳</span> よりみち掲示板</div>
                    </div>
                    <span className="post-decoration" aria-hidden="true">{index % 2 === 0 ? "✦" : "✳"}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="sidebar">
            <section className="welcome-card card">
              <span className="welcome-kicker">WELCOME!</span>
              <h2>ここは、<br />ひと休みの場所。</h2>
              <p>ちゃんとした話じゃなくて大丈夫。小さな「好き」や「聞いてほしい」を、気軽に書いてね。</p>
              <div className="welcome-doodle" aria-hidden="true"><span>☀</span><i>✳</i><b>♡</b></div>
            </section>

            <section className="guide-card card">
              <div className="guide-heading"><span className="guide-icon">?</span><h3>気持ちよく使うために</h3></div>
              <ul>
                <li><span>01</span>やさしい言葉でお話ししよう</li>
                <li><span>02</span>個人情報は書かないでね</li>
                <li><span>03</span>好きな絵文字を添えてみよう</li>
              </ul>
              <a href="#about" className="guide-link">掲示板について <span aria-hidden="true">→</span></a>
            </section>

            <section id="emojis" className="emoji-card card">
              <div className="emoji-card-heading"><span>✿</span><h3>この掲示板の絵文字</h3></div>
              <p>投稿フォームからワンタップで使えます。</p>
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

        <footer id="about" className="site-footer">
          <span>よりみち掲示板 <span className="footer-sparkle">✳</span></span>
          <span>今日も、よいよりみちを。</span>
        </footer>
        </div>
      </main>
    </div>
  );
}
