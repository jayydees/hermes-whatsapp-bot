# Patch: log group messages to daily JSONL files

`/logjobs`, `/chat-summary` and `/groups` read daily message logs from
`/opt/data/whatsapp/group_logs/YYYY-MM-DD.jsonl`. Stock Hermes does not write
these files. This deployment adds a small function to the WhatsApp bridge that
ships with Hermes (`scripts/whatsapp-bridge/bridge.js` in the
[Hermes Agent repo](https://github.com/NousResearch/hermes-agent)).

The full bridge is not copied here because it is upstream code. Only the added
lines are shown. Line positions differ between Hermes versions, so apply this
by hand and re-check it after every Hermes upgrade.

In this deployment the bridge copy on the volume
(`/opt/data/scripts/whatsapp-bridge/bridge.js`) is the one that runs. A copy
also exists in the image at `/opt/hermes/scripts/whatsapp-bridge/`. That the
volume copy runs was seen in operation. How Hermes picks it was never traced
in Hermes's code.

## Privacy warning: read before applying

The call below sits **before** any allowlist check. It records every message
from every group the bot's WhatsApp number belongs to, including groups that
are not on `group_allow_from` and messages from people who can never trigger
the bot. This was confirmed in the running deployment: its logs held messages
from 4 groups that were not on the allowlist.

If you only want to log allowlisted groups, add a check against your group
allowlist inside `appendGroupLog` before writing. That change has not been
written or tested here.

Each row stores the sender's WhatsApp ID (phone number or LID), their display
name and the message text. Treat the log folder as personal data.

## 1. Add near the top of bridge.js (after the other constants)

`appendFileSync` and `mkdirSync` must be in the existing `fs` import.

```js
const GROUP_LOG_DIR = "/opt/data/whatsapp/group_logs";

function peekBridgeBody(msg) {
  const m = msg && msg.message ? msg.message : {};
  return m.conversation
    || (m.extendedTextMessage && m.extendedTextMessage.text)
    || (m.imageMessage && m.imageMessage.caption)
    || (m.videoMessage && m.videoMessage.caption)
    || (m.documentMessage && m.documentMessage.caption)
    || "";
}
function appendGroupLog(event, extra) {
  try {
    extra = extra || {};
    if (!event || !event.isGroup) return;
    mkdirSync(GROUP_LOG_DIR, { recursive: true });
    const ts = event.timestamp || Math.floor(Date.now() / 1000);
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    const row = {
      ts: ts,
      day: day,
      chatId: event.chatId || "",
      chatName: event.chatName || "",
      messageId: event.messageId || "",
      senderId: event.senderId || "",
      pushName: event.senderName || "",
      fromMe: !!(extra.fromMe || event.fromMe),
      fromOwner: !!event.fromOwner,
      body: typeof event.body === "string" ? event.body : "",
      hasMedia: !!event.hasMedia,
      mediaType: event.mediaType || "",
      quotedText: event.quotedText || ""
    };
    appendFileSync(path.join(GROUP_LOG_DIR, day + ".jsonl"), JSON.stringify(row) + "\n");
  } catch (err) {
    console.warn("[bridge] appendGroupLog failed:", err && err.message);
  }
}
```

## 2. Call it inside the `messages.upsert` loop

Place it right after `chatId`, `senderId` and `isGroup` are computed, and
before the sender allowlist check.

```js
      if (isGroup) {
        appendGroupLog({
          isGroup: true,
          timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
          chatId,
          chatName: String(chatId).replace(/@.*/, ''),
          messageId: msg.key && msg.key.id,
          senderId,
          senderName: msg.pushName || '',
          fromMe: !!msg.key.fromMe,
          fromOwner: false,
          body: peekBridgeBody(msg),
          hasMedia: false,
          mediaType: '',
          quotedText: ''
        }, { fromMe: !!msg.key.fromMe });
      }
```

Files are named by UTC date. Nothing rotates or deletes them.
