# Echo — Import Your Chat (Mobile Guide)

Echo rebuilds a person from your real conversations. As of V9 there is **one simple way** that works for **any messenger** — no per-app exports, no computer: you give Echo a **screen recording** of you scrolling the chat, or **screenshots**, and Echo reads the messages from the images.

_Written for your phone. Verified current as of June 2026._

> **Privacy:** the images are processed only to read the messages and build the persona, then the raw files are deleted. They contain private messages — only upload chats you have the right to use.

---

## The one step: upload a screen recording or screenshots

In the create flow, on the **Chats** step:

1. **Open your chat** with the person.
2. **Record your screen** while you **slowly scroll up** through the messages — or **take screenshots** as you go.
3. **Upload** the video or screenshots in Echo.

That's it. Echo extracts the messages, then lists the two people and asks **which one is you** — pick yourself, and we model the other person.

> Tip: scroll **slowly, oldest → newest**, so nothing is missed. A minute or two of scrolling is plenty for a long chat.

---

## How to screen-record

### iPhone
1. (One-time) Settings → Control Center → add **Screen Recording**.
2. Open the chat, swipe down from the top-right to open **Control Center**.
3. Tap the **Screen Recording** button (a dot inside a circle), then go to your chat.
4. **Scroll slowly** through the messages, then tap the red bar / Control Center button to **stop**.
5. The video saves to **Photos** → upload it to Echo.

### Android
1. Swipe down twice to open **Quick Settings**.
2. Tap **Screen record** → choose **without audio** → start.
3. Open the chat and **scroll slowly** through the messages.
4. **Stop** from the notification shade.
5. The video saves to your gallery → upload it to Echo.

---

## Or just screenshots
- Take screenshots as you scroll. **Overlap is fine** — it's better to over-capture than to miss messages; Echo de-duplicates automatically.
- Upload them all at once (the same upload button accepts images or a video).

---

## What Echo reads, and what it can't
- **Who said what** — inferred from bubble side/colour (right = you, left = them). You confirm it on the next step, so a wrong guess is one tap to fix.
- **Message text & emoji** — read directly, including Ukrainian/Russian.
- **Timestamps are approximate.** Most messengers hide per-message times, so Echo keeps the **order** and rough days, not exact clocks. (A real file export, if you have one, is more precise — but this path needs no export at all.)

---

## Tips for the best result
- More two-sided history = a truer persona. Capture as far back as you reasonably can.
- Good lighting / normal font size helps the reader; avoid tiny zoomed-out text.
- 1-on-1 chats work best. Group chats are read too, but speaker attribution is harder.

---

## Notes
- This visual import replaces the old per-messenger file-export guides (Telegram/WhatsApp/Instagram/Facebook/LINE/VK). Those parsers still exist in the codebase and can be re-enabled later as an "advanced: upload an export file" option, but the screen-recording / screenshots path is the default because it's universal, the easiest thing for users, and it covers messengers with no usable export (Viber, iMessage, Signal, Discord).
- Production note: the server needs `ffmpeg` installed for the video path; screenshots need only the image pipeline.
