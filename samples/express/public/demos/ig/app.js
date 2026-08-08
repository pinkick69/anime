// Instagram profile-link page: one avatar, a handful of canned lines, nothing
// else. Deliberately narrower than the other demos — no catalog picker and no
// free-text input, because this page is meant to be pointed at from a public
// bio where every visitor shares one Connect identity.

// ── 書き換えるのはここだけ ──────────────────────────────────────────────────
const CONFIG = {
  // カタログに実在することを確認済みのID。null にするとカタログの先頭が使われる。
  // 差し戻し用の候補（いずれも実在確認済み）:
  //   01K9DZPWQQ6HFX3WCGPR85APNK  cc046_vroid_female
  //   01K9E0T4F65SFPGZ0BERP917JJ  cc049_female_aya
  avatarId: "01KZFYT83RCZN4TGNTVFCTWVVH", // pinkick_model（VRoidから書き出した自作モデル）
  // 背景はカタログの48種から選ぶだけで、アップロードはできない（APIがない）。
  // 全48枚のサムネイルを確認した上での候補:
  //   01K4NYDJED35R2T928Q95630KP  sova_Interior_3（白基調のオシャレな部屋）
  //   01K4NYCSVMHPP5WWE21GMAGYA1  sova_Interior_1（ピンクの壁面がある内装）
  //   01K4NYB6627539QRJR2HXESJJK  sova_anime_1（神社。差し戻し用）
  sceneId: "01K4NY826V9D6JQYTX6V3SEAWD", // sova_Abstract_2（ピンクのグラデーション）

  // 日本語のセリフなので日本語ボイスを明示。他の選択肢:
  //   01KY4JJ8VS5Z1TFB5NBRYTB1A6  Female - lively and expressive (Japanese only)
  //   01KT9NE031K3MWGCXMYZ078TKD  Female - cheerful and clear (Japanese only)
  //   01KXFXE2QJYNH7895KYT1QTAP6  Female - cute and kind（Google製）
  voiceId: "01KTBJEV9G9GHFFF35F9QPKJ5D", // Female - cute and fast (For Japanese)

  // Perxona 側のチャットボット。性格は custom_instructions に入っているので、
  // 口調やキャラを変えるときは PATCH /api/chatbots/:id で更新する（このページの
  // コードは触らなくてよい）。別途の LLM API キーは不要。
  chatbotId: "01KZG130BRA1AC67BS7QXVFTG2",

  // 会話に渡す履歴の往復数。多いほど文脈が続くが、長い誘導を積み上げる余地も増える。
  historyTurns: 5,

  // ボタン1つに複数のセリフを持たせ、押すたびランダムに1本選ぶ。同じボタンでも
  // 毎回違うことを言うので、訪問者が繰り返し押してくれる。
  // motion: true の枠は、アバターが実際に持っている挨拶モーションを頭に差し込む。
  //
  // セリフを増やすときの目安: 1本25〜45文字（5〜8秒）。モーション付きの枠は
  // 挨拶モーションが4.57秒あるので、それより短いと振り終わる前に止まる。
  // 読み上げなので、英数字や読みにくい漢字はひらがなにする。
  lines: [
    {
      label: "あいさつ",
      motion: true,
      texts: [
        "やっと来た。ずっと待ってたんだけど。まあ、待ってないけどね。",
        "はじめまして、でいいのかな。ここまで来てくれて、ありがとう。",
        "おかえり。……って言うと、なんか照れるね。",
        "来てくれると思ってた。……ううん、思ってなかった。うれしい。",
        "こんばんは。今日はどんな一日だった？",
      ],
    },
    {
      label: "続きを見る",
      texts: [
        "私の話、もっと聞きたい？　だったら動画を見て。全部そこにあるから。",
        "続きが気になるなら、動画。……べつに、見なくてもいいけど。",
        "ここで話せるのは、ほんの一部だけ。本編は動画にあるよ。",
        "私がどんな話をしてきたか、動画に全部残してある。見てほしいな。",
      ],
    },
    {
      label: "またね",
      motion: true,
      texts: [
        "もう行っちゃうの？　……べつに、寂しくないけど。",
        "またね。次に来るとき、ちゃんと覚えてるから。",
        "行く前に、ひとつだけ。……今日、がんばったね。",
        "じゃあ、また。帰り道、気をつけて。",
      ],
    },
  ],
};
// ───────────────────────────────────────────────────────────────────────────

const stage = document.querySelector("#stage");
const overlay = document.querySelector("#overlay");
const idleView = document.querySelector("#idle-view");
const loadingView = document.querySelector("#loading-view");
const errorView = document.querySelector("#error-view");
const loadingLabel = document.querySelector("#loading-label");
const errorLabel = document.querySelector("#error-label");
const startBtn = document.querySelector("#start-btn");
const retryBtn = document.querySelector("#retry-btn");
const controls = document.querySelector("#controls");
const linesEl = document.querySelector("#lines");
const stopBtn = document.querySelector("#stop-btn");
const transcriptEl = document.querySelector("#transcript");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");
/** @type {HTMLElement & import('@perxona/presenter-types').IPresentationWidget} */
const presenter = document.querySelector("sv-presenter");

let serverConfig = null;
let motionId = null;
let isSpeaking = false;
let elapsedTimer = null;
/** Last text index played per line, so a repeat is never picked back-to-back. */
const lastPicked = new Map();
/** Rolling chat history in the Connect chatbot's wire format. */
const history = [];

// ── Visitor identity & on-device history ────────────────────────────────
// visitorId is a random value generated on this device — never a name, email,
// or anything else that identifies a person. It exists so the operator's
// anonymous log (server-side, see /admin/logs) can tell "same visitor,
// multiple turns" from "many different visitors", nothing more. It is sent
// only on chat requests, stored only in this browser's localStorage, and nothing
// about it leaves the device except that opaque value.
const VISITOR_ID_KEY = "pinkick_visitor_id";
const TRANSCRIPT_KEY = "pinkick_transcript_v1";
// Bound how much of the past this page keeps re-showing on return visits —
// unbounded growth would slow the page and make old, half-remembered turns
// resurface awkwardly.
const TRANSCRIPT_MAX_TURNS = 20;

function getVisitorId() {
  let id = localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}
const visitorId = getVisitorId();

/** Reads the visitor's own on-device transcript. Corrupt/missing → empty. */
function loadTranscript() {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persists one turn to the visitor's own device. Never touches the server. */
function saveTurn(role, text) {
  const turns = loadTranscript();
  turns.push({ role, text });
  const trimmed = turns.slice(-TRANSCRIPT_MAX_TURNS * 2);
  try {
    localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full or disabled (private browsing) — the visit still works,
    // it just won't be remembered next time.
  }
}

async function requestJson(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

function loadPresenterEngine(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error("エンジンの読み込みに失敗しました"));
    document.head.append(script);
  });
}

function showView(name) {
  idleView.hidden = name !== "idle";
  loadingView.hidden = name !== "loading";
  errorView.hidden = name !== "error";
  overlay.dataset.state = name;
}

function fail(message) {
  stopElapsedTimer();
  errorLabel.textContent = message;
  showView("error");
}

// A 3D scene can take a minute or more on a phone. Without a visible counter
// the page reads as frozen and visitors leave, so surface the elapsed seconds.
function startElapsedTimer() {
  const startedAt = performance.now();
  loadingLabel.textContent = "読み込み中…";
  elapsedTimer = setInterval(() => {
    const seconds = Math.round((performance.now() - startedAt) / 1000);
    loadingLabel.textContent = `読み込み中… ${seconds}秒`;
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function setSpeaking(value) {
  isSpeaking = value;
  for (const button of linesEl.children) button.disabled = value;
  chatSend.disabled = value;
  chatInput.disabled = value;
}

/**
 * Appends a bubble and returns it, so a pending reply can be filled in later.
 * Scrolls to the newest turn — the transcript grows downward.
 */
function addBubble(role, text, pending = false) {
  const p = document.createElement("p");
  p.dataset.role = role;
  if (pending) p.dataset.pending = "true";
  p.textContent = text;
  transcriptEl.append(p);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return p;
}

/**
 * Sends one turn to the Connect chatbot and has the avatar speak the reply.
 *
 * The avatar's own states carry the wait: setThinking() while the reply is being
 * generated, so a several-second round trip looks like the character thinking
 * rather than the page hanging.
 */
async function sendChat(message) {
  if (isSpeaking) return;
  setSpeaking(true);
  presenter.setListening?.(false);
  addBubble("user", message);
  const pendingBubble = addBubble("bot", "…", true);

  history.push({ role: "user", parts: [{ type: "text", text: message }] });
  // Trim to the configured window. Each turn is a user + assistant pair.
  const window = CONFIG.historyTurns * 2;
  if (history.length > window) history.splice(0, history.length - window);

  saveTurn("user", message);

  try {
    presenter.setThinking?.(true);
    const { reply_text: reply } = await requestJson(
      `/api/chatbots/${encodeURIComponent(CONFIG.chatbotId)}/chat`,
      {
        method: "POST",
        // X-Visitor-Id lets the operator's anonymous log group turns by
        // device without identifying anyone — see the comment above visitorId.
        headers: { "X-Visitor-Id": visitorId },
        body: JSON.stringify({ messages: history }),
      },
    );
    presenter.setThinking?.(false);

    if (!reply) throw new Error("返答が空でした");
    // The model still emits the occasional line break despite being told not to;
    // collapsing whitespace keeps both the speech and the bubble tidy.
    const spoken = reply.replace(/\s*\n+\s*/g, " ").trim();
    history.push({ role: "assistant", parts: [{ type: "text", text: spoken }] });
    pendingBubble.textContent = spoken;
    delete pendingBubble.dataset.pending;
    saveTurn("bot", spoken);

    await presenter.resumeAudioPlayback?.();
    await presenter.present(spoken);
  } catch {
    presenter.setThinking?.(false);
    // Drop the failed turn so the next message is not sent with a dangling
    // user entry that has no reply.
    if (history.at(-1)?.role === "user") history.pop();
    pendingBubble.textContent = "うまく聞こえなかった。もう一回言ってくれる？";
    delete pendingBubble.dataset.pending;
  } finally {
    setSpeaking(false);
  }
}

function renderLines() {
  linesEl.replaceChildren(
    ...CONFIG.lines.map((line) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = line.label;
      button.addEventListener("click", () => void speak(line));
      return button;
    }),
  );
}

/**
 * Confirms `wanted` is really in the account's catalog, falling back to the
 * first entry when it is not (or when no id was configured). Returning a live
 * id rather than a stale one is what keeps initialize() from failing blind.
 */
async function resolveAssetId(path, wanted, label) {
  const { items } = await requestJson(path);
  if (!items?.length) throw new Error(`${label}のカタログが空です`);
  if (wanted && items.some((item) => item.id === wanted)) return wanted;
  if (wanted) {
    console.warn(`${label} ${wanted} はカタログにないため先頭を使います`);
  }
  return items[0].id;
}

/**
 * Picks a gesture the avatar actually owns. Motions are skeleton-scoped, so the
 * catalog differs per avatar and the field is `motion_id`, not `id`.
 * Prefers a greeting-style motion because it reads well on a first line.
 */
async function pickMotionId(avatarId) {
  try {
    const { items } = await requestJson(
      `/api/avatars/${encodeURIComponent(avatarId)}/motions`,
    );
    if (!items?.length) return null;
    const greeting = items.find((item) => /wave|greet/i.test(item.name ?? ""));
    return (greeting ?? items[0]).motion_id ?? null;
  } catch {
    return null; // Lines still speak, just without a gesture.
  }
}

/**
 * Picks a line from the button's pool, never repeating the one it just used.
 * Plain Math.random() would repeat often enough to read as a broken button.
 */
function pickText(line) {
  const { texts } = line;
  if (texts.length === 1) return texts[0];
  let index;
  do {
    index = Math.floor(Math.random() * texts.length);
  } while (index === lastPicked.get(line));
  lastPicked.set(line, index);
  return texts[index];
}

async function speak(line) {
  if (isSpeaking) return;
  setSpeaking(true);
  try {
    // Re-unlock on every utterance: iOS can suspend the audio context again
    // when the page loses focus, and the other demos do the same.
    await presenter.resumeAudioPlayback?.();
    // Motion goes at the FRONT of the line: playback stops when the speech it
    // accompanies ends, so a cue near the end of a short line never plays.
    const picked = pickText(line);
    const text =
      line.motion && motionId ? `[MOTION ${motionId}:1] ${picked}` : picked;
    await presenter.present(text);
  } catch {
    // A failed line is not worth breaking the page over — the visitor can just
    // tap another button.
  } finally {
    setSpeaking(false);
  }
}

// The SDK fires this whenever a Connect call returns 401. The call that
// triggered it still failed; refreshing only fixes subsequent taps.
let isRefreshingToken = false;
presenter.addEventListener("CONNECT_TOKEN_EXPIRED", async () => {
  if (isRefreshingToken) return;
  isRefreshingToken = true;
  try {
    const { connect_token: token } = await requestJson("/api/connect-token");
    presenter.refreshConnectToken(token);
  } catch {
    // Leave the page usable; the next tap will surface the failure itself.
  } finally {
    isRefreshingToken = false;
  }
});

/**
 * Redraws past turns from this device's own storage as plain bubbles — text
 * only, never re-spoken. Also seeds `history` so the chatbot has the prior
 * context on the visitor's very first message of this visit.
 */
function restoreTranscript() {
  const turns = loadTranscript();
  for (const turn of turns) {
    addBubble(turn.role, turn.text);
    if (turn.role === "user") {
      history.push({ role: "user", parts: [{ type: "text", text: turn.text }] });
    } else {
      history.push({
        role: "assistant",
        parts: [{ type: "text", text: turn.text }],
      });
    }
  }
  const window = CONFIG.historyTurns * 2;
  if (history.length > window) history.splice(0, history.length - window);
}

presenter.addEventListener("PRESENTER_STATUS", (event) => {
  if (event.detail?.status !== "Ready") return;
  stopElapsedTimer();
  presenter.hidden = false;
  showView("done");
  controls.hidden = false;
  restoreTranscript();
});

async function start() {
  startBtn.disabled = true;
  showView("loading");
  startElapsedTimer();
  // Reveal the stage now, not at Ready: the SDK draws its own 0–100% ring while
  // it downloads, and that is the only real progress signal this page has.
  presenter.hidden = false;

  try {
    // Must run inside the tap that started us, before any await on the network,
    // or iOS keeps the audio context suspended.
    await presenter.resumeAudioPlayback?.();

    // Resolve against the live catalog, never against /api/config defaults:
    // the DEMO_DEFAULT_* ids in .env can point at assets this account does not
    // have, and initialize() fails opaquely when handed an unknown avatar.
    const [avatarId, sceneId] = await Promise.all([
      resolveAssetId("/api/avatars", CONFIG.avatarId, "アバター"),
      resolveAssetId("/api/scenes", CONFIG.sceneId, "シーン"),
    ]);

    if (CONFIG.lines.some((line) => line.motion)) {
      motionId = await pickMotionId(avatarId);
    }

    const { connect_token: token } = await requestJson("/api/connect-token");
    await presenter.initialize(token, {
      avatarId,
      sceneId,
      voiceId: CONFIG.voiceId || serverConfig.defaults?.voiceId || undefined,
    });
    // The Ready listener above takes it from here.
  } catch (error) {
    fail(`起動できませんでした。\n${error.message}`);
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", () => void start());
retryBtn.addEventListener("click", () => {
  startBtn.disabled = false;
  showView("idle");
});
stopBtn.addEventListener("click", () => {
  presenter.interruptPresentation();
  setSpeaking(false);
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  // Keep focus so a conversation can continue without re-tapping the field, but
  // let iOS close the keyboard once the avatar starts speaking.
  chatInput.blur();
  void sendChat(message);
});

// The avatar visibly listens while the visitor is composing — one of the few
// cues that makes a typed exchange feel like a conversation.
chatInput.addEventListener("focus", () => presenter.setListening?.(true));
chatInput.addEventListener("blur", () => presenter.setListening?.(false));

// iOS reports the on-screen keyboard only through visualViewport. Without this
// the input sits underneath the keyboard the moment it opens.
if (window.visualViewport) {
  const viewport = window.visualViewport;
  const applyKeyboardInset = () => {
    const inset = Math.max(
      0,
      window.innerHeight - viewport.height - viewport.offsetTop,
    );
    document.documentElement.style.setProperty("--kb", `${inset}px`);
    document.body.dataset.keyboard = inset > 60 ? "open" : "closed";
  };
  viewport.addEventListener("resize", applyKeyboardInset);
  viewport.addEventListener("scroll", applyKeyboardInset);
  applyKeyboardInset();
}

renderLines();

// Engine first: without it there is no <sv-presenter> behaviour to drive, and
// failing here is worth telling the visitor about before they tap.
try {
  serverConfig = await requestJson("/api/config");
  if (serverConfig.mock) {
    fail("サーバーがモックモードです。live モードで起動してください。");
  } else {
    await loadPresenterEngine(serverConfig.presenterUrl);
    stage.dataset.ready = "true";
  }
} catch (error) {
  fail(`準備に失敗しました。\n${error.message}`);
}
