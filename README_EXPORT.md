# Exporting a SHAD (Rubika) chat

## Method 1 - DOM-based (recommended for text/sender/time) (Always works!)

1. Open the chat in `https://web.shad.ir` and scroll up until **all ~5000 messages are loaded**.
2. Press `F12` -> `Console` tab. Type `allow pasting` and press Enter (Chrome self-XSS protection).
3. Open `shad_export.js` from this folder, copy its **entire contents**, paste into the console, press `Enter`.
   (Alternative: DevTools -> Sources -> Snippets -> New snippet -> paste -> Run, which bypasses the paste warning.)
4. Three files download automatically: `shad_chat.json`, `shad_chat.csv`, `shad_chat.html`.
5. Check the console for `[shad_export] parsed messages: N` and `with date: M`. `M` should be > 0 now.

Notes:
- `reply_to_message_id` is `null` in the DOM export: SHAD does not render the quoted original message or its id in the DOM (only an `is-reply` CSS flag). An `is_reply` boolean is included instead.
- For real reply links, use Method 2.

## Method 2 - API-based (for reply links + full metadata)

Use this when you need `reply_to_message_id`, exact timestamps, or sender names.

1. Get your AUTH token: DevTools -> Network tab -> find a request whose domain starts with `shadmessenger` -> Request tab -> copy the `auth` string.
2. Run: `python shad_export_api.py`
3. Paste the AUTH when prompted, pick the chat from the list.
4. Outputs: `shad_raw.json` (raw API responses), `shad_chat.json`, `shad_chat.csv` (HTML transcript included).

Notes:
- Runs locally via `requests` (no browser CORS). May still be affected by your network/VPN.
- Paginates with `getMessages` (FromMax) with a 0.6s delay to avoid `TOO_REQUESTS`.
- ~5000 messages -> ~50-100 requests -> a few minutes.

## Output schema (Telegram-like)

`shad_chat.json`:
```json
{
  "name": "contact name",
  "type": "personal_chat",
  "messages": [
    { "id": "...", "type": "message", "date": "...", "date_unixtime": "...",
      "from": "Me/Contact", "from_id": "user_me/user_contact",
      "text": "...", "reply_to_message_id": "...", "is_reply": true }
  ]
}
```
