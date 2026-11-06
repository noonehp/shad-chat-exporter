// shad_export.js
// Extracts a SHAD (Rubika-based) web chat from the already-loaded DOM
// and downloads Telegram-style exports: JSON, CSV, and a readable HTML transcript.
// Usage: open the chat in web.shad.ir, scroll so all messages are loaded,
// type `allow pasting` in the console, paste this file, press Enter.
(function () {
  "use strict";

  function xpathAll(expr, ctx) {
    ctx = ctx || document;
    const r = document.evaluate(expr, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
    return out;
  }
  function xpathOne(expr, ctx) {
    ctx = ctx || document;
    const r = document.evaluate(expr, ctx, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue;
  }
  function attr(el, name) { return el && el.getAttribute ? el.getAttribute(name) : null; }
  function text(el) { return el ? (el.innerText || el.textContent || "").trim() : ""; }
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function escCsv(v) {
    v = (v == null ? "" : String(v));
    if (/[",\n\r]/.test(v)) return "\"" + v.replace(/"/g, "\"\"") + "\"";
    return v;
  }
  function escHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // contact name (best effort)
  let contactName = "Contact";
  try {
    const t = document.title || "";
    if (t && t.toLowerCase().indexOf("shad") !== -1) {
      const parts = t.split(/[-–|]/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) contactName = parts[parts.length - 1];
    }
    const candSelectors = [
      "//div[contains(@class,'chat') and contains(@class,'title')]",
      "//span[contains(@class,'chat') and contains(@class,'name')]",
      "//div[contains(@class,'peer') and contains(@class,'title')]",
      "//h1", "//h2", "//h3"
    ];
    for (const s of candSelectors) {
      const el = xpathOne(s);
      const v = text(el);
      if (v && v.length < 60 && v.toLowerCase().indexOf("shad") === -1) { contactName = v; break; }
    }
  } catch (e) { /* ignore */ }

  const inner = xpathOne("//div[contains(@class,'bubbles-inner')]");
  console.log("[shad_export] bubbles-inner found:", !!inner);

  let currentDate = null;
  const messages = [];

  function processBubble(b, g) {
    const isOut = (b.className || "").indexOf("is-out") !== -1;
    const isReply = (b.className || "").indexOf("is-reply") !== -1;
    let sender = isOut ? "Me" : contactName;
    const nameEl = xpathOne(".//a[contains(@class,'name')]", b);
    const nameTxt = text(nameEl);
    if (nameTxt && !isOut) sender = nameTxt;

    const timeEl = xpathOne(".//span[@rb-message-time]", b) ||
                   xpathOne(".//span[contains(@class,'time')]", b);
    const time = text(timeEl);
    const timeAttr = attr(timeEl, "rb-message-time");

    let textVal = "";
    const msgWrap = xpathOne(".//div[contains(@class,'bubble-content')]/div[contains(@class,'message')]", b);
    if (msgWrap) {
      const textEl = xpathOne(".//descendant::div[@dir or contains(@class,'document-message')]", msgWrap) ||
                     xpathOne(".//descendant::div[not(@*) and position()=1]", msgWrap);
      textVal = text(textEl || msgWrap);
    } else {
      textVal = text(b);
    }
    if (time && textVal.endsWith(time)) textVal = textVal.slice(0, -time.length).trim();

    const id = attr(g, "data-msg-id") || attr(b, "data-msg-id") || attr(b, "data-id") || null;

    // reply preview (SHAD renders a small quoted preview of the original message)
    let replyPreview = null;
    let replySender = null;
    const replyDiv = xpathOne(".//div[contains(@class,'reply') and contains(@class,'reply-content')]/..", b) ||
                     xpathOne(".//div[contains(@class,'reply')][.//div[contains(@class,'reply-subtitle')]]", b);
    if (replyDiv) {
      const sub = xpathOne(".//div[contains(@class,'reply-subtitle')]", replyDiv);
      const title = xpathOne(".//span[contains(@class,'peer-title')]", replyDiv) ||
                    xpathOne(".//div[contains(@class,'reply-title')]", replyDiv);
      replyPreview = text(sub);
      replySender = text(title);
    }

    messages.push({
      id: id,
      type: "message",
      date: currentDate,
      time: time,
      date_unixtime: (timeAttr && timeAttr.trim()) ? timeAttr.trim() : null,
      from: sender,
      from_id: isOut ? "user_me" : "user_contact",
      text: textVal,
      reply_to_message_id: null,
      is_reply: isReply || !!replyDiv,
      is_outgoing: isOut,
      _reply_preview: replyPreview,
      _reply_sender: replySender
    });
  }

  function processGroup(g) {
    const bubbles = xpathAll(".//div[contains(@class,'is-in') or contains(@class,'is-out')]", g);
    if (!bubbles.length) return;
    for (const b of bubbles) processBubble(b, g);
  }

  if (inner) {
    for (const child of [...inner.children]) {
      if (child.classList && child.classList.contains("bubbles-date-group")) {
        const dateSpan = xpathOne(".//div[contains(@class,'is-date')]//span", child);
        if (dateSpan) currentDate = text(dateSpan);
        xpathAll(".//div[@class='bubbles-group']", child).forEach(processGroup);
      } else if (child.classList && child.classList.contains("bubbles-group")) {
        processGroup(child);
      } else {
        const ds = xpathOne(".//div[contains(@class,'is-date')]//span", child);
        if (ds) currentDate = text(ds);
      }
    }
  } else {
    xpathAll("//div[@class='bubbles-group']").forEach(processGroup);
  }

  // second pass: resolve reply_to_message_id by matching the quoted preview text
  function stripEllipsis(s) {
    return String(s || "").replace(/[\u2026.]+$/g, "").trim();
  }
  for (const m of messages) {
    if (!m.is_reply) continue;
    const preview = stripEllipsis(m._reply_preview);
    if (!preview) { m.reply_to_message_id = null; continue; }
    let best = null, bestScore = 0;
    for (const cand of messages) {
      if (cand === m) continue;
      const t = (cand.text || "").trim();
      if (!t) continue;
      let score = 0;
      if (t === preview) score = preview.length + 10000;
      else if (t.startsWith(preview)) score = preview.length + 1000;
      else if (preview.startsWith(t)) score = t.length;
      else if (t.indexOf(preview) !== -1) score = preview.length;
      else if (preview.indexOf(t) !== -1) score = t.length;
      if (m._reply_sender && cand.from && cand.from === m._reply_sender) score += 50;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    m.reply_to_message_id = (best && bestScore >= 3) ? best.id : null;
  }

  // cleanup internal fields
  for (const m of messages) { delete m._reply_preview; delete m._reply_sender; }
  messages.forEach((m, i) => { m.order = i; });

  console.log("[shad_export] parsed messages:", messages.length);
  console.log("[shad_export] with date:", messages.filter(m => m.date).length);
  console.log("[shad_export] replies flagged:", messages.filter(m => m.is_reply).length);
  console.log("[shad_export] reply_to resolved:", messages.filter(m => m.reply_to_message_id).length);

  // JSON
  const json = {
    name: contactName,
    type: "personal_chat",
    id: null,
    messages: messages.map(m => ({
      id: m.id,
      type: "message",
      date: m.date,
      date_unixtime: m.date_unixtime,
      from: m.from,
      from_id: m.from_id,
      text: m.text,
      reply_to_message_id: m.reply_to_message_id,
      is_reply: m.is_reply
    }))
  };
  download("shad_chat.json", JSON.stringify(json, null, 2), "application/json");

  // CSV
  const header = ["id", "date", "time", "from", "text", "is_reply", "reply_to_message_id"];
  const csvLines = [header.join(",")];
  for (const m of messages) {
    csvLines.push([m.id, m.date, m.time, m.from, m.text, m.is_reply, m.reply_to_message_id].map(escCsv).join(","));
  }
  download("shad_chat.csv", csvLines.join("\r\n"), "text/csv;charset=utf-8;");

  // HTML
  let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>SHAD export</title>";
  html += "<style>body{font-family:Tahoma,Arial,sans-serif;max-width:720px;margin:20px auto;padding:0 16px;background:#f5f5f5;}";
  html += ".day{ text-align:center;color:#888;margin:16px 0;font-size:12px;}";
  html += ".msg{margin:6px 0;padding:8px 12px;border-radius:12px;max-width:80%;white-space:pre-wrap;word-wrap:break-word;}";
  html += ".out{background:#dcf8c6;margin-left:auto;} .in{background:#fff;}";
  html += ".meta{font-size:11px;color:#666;margin-bottom:4px;} .reply{font-size:12px;color:#555;border-left:3px solid #aaa;padding-left:6px;margin-bottom:4px;opacity:.8;}</style></head><body>";
  html += "<h2>" + escHtml(contactName) + "</h2>";
  let lastDate = null;
  for (const m of messages) {
    if (m.date && m.date !== lastDate) {
      html += "<div class=\"day\">" + escHtml(m.date) + "</div>";
      lastDate = m.date;
    }
    const cls = m.is_outgoing ? "out" : "in";
    html += "<div class=\"msg " + cls + "\">";
    html += "<div class=\"meta\">" + escHtml(m.from) + " · " + escHtml(m.time) + (m.is_reply ? " · reply" : "") + "</div>";
    if (m.reply_to_message_id) {
      const orig = messages.find(x => x.id === m.reply_to_message_id);
      if (orig) html += "<div class=\"reply\">" + escHtml(orig.text.slice(0, 120)) + "</div>";
    }
    html += escHtml(m.text) + "</div>";
  }
  html += "</body></html>";
  download("shad_chat.html", html, "text/html;charset=utf-8;");

  console.log("[shad_export] Done. Downloaded shad_chat.json, shad_chat.csv, shad_chat.html");
  window.shadExport = { messages: messages, json: json };
})();
