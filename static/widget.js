/* LoukaBuilds AI Lead-Qualifier — embeddable chat widget.
 * Drop onto any site with ONE line:
 *   <script src="https://lead-qualifier.onrender.com/widget.js"
 *           data-name="Northbeam Studio" data-accent="#1f4ed8"></script>
 * Self-contained: injects its own styles, talks to /api/chat on the host origin.
 * The greeting is display-only; the messages array sent to the API starts with the
 * visitor's first real reply (the backend/Claude expects a user-first transcript).
 */
(function () {
  "use strict";
  var script = document.currentScript ||
    (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var API = script.src.replace(/\/widget\.js(\?.*)?$/, "") + "/api/chat";
  var NAME = script.getAttribute("data-name") || "our team";
  var ACCENT = script.getAttribute("data-accent") || "#1f4ed8";
  var GREETING = script.getAttribute("data-greeting") ||
    ("Hi! 👋 I'm " + NAME + "'s assistant. What are you looking to build or get help with?");

  var msgs = [];          // transcript SENT to the API (user-first)
  var open = false, busy = false, done = false;

  // ---------- styles ----------
  var css = "" +
    ".lqb-btn{position:fixed;right:22px;bottom:22px;width:62px;height:62px;border-radius:50%;" +
    "background:" + ACCENT + ";color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.28);" +
    "font-size:28px;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
    ".lqb-btn:hover{transform:scale(1.06)}" +
    ".lqb-panel{position:fixed;right:22px;bottom:96px;width:370px;max-width:calc(100vw - 32px);height:560px;" +
    "max-height:calc(100vh - 130px);background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.32);" +
    "z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,sans-serif}" +
    ".lqb-panel.open{display:flex}" +
    ".lqb-hd{background:" + ACCENT + ";color:#fff;padding:16px 18px;font-weight:700;font-size:16px;display:flex;justify-content:space-between;align-items:center}" +
    ".lqb-hd small{display:block;font-weight:500;opacity:.85;font-size:12px;margin-top:2px}" +
    ".lqb-x{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.9}" +
    ".lqb-body{flex:1;overflow-y:auto;padding:16px;background:#f6f8fb}" +
    ".lqb-row{display:flex;margin:8px 0}" +
    ".lqb-row.u{justify-content:flex-end}" +
    ".lqb-b{max-width:80%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}" +
    ".lqb-row.a .lqb-b{background:#fff;color:#16202e;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08)}" +
    ".lqb-row.u .lqb-b{background:" + ACCENT + ";color:#fff;border-bottom-right-radius:4px}" +
    ".lqb-cta{display:block;text-align:center;margin:10px 0 4px;background:#37b87f;color:#fff;text-decoration:none;" +
    "padding:11px;border-radius:12px;font-weight:700;font-size:14.5px}" +
    ".lqb-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #eceff3;background:#fff}" +
    ".lqb-in{flex:1;border:1px solid #d6dce5;border-radius:22px;padding:10px 15px;font-size:14.5px;outline:none}" +
    ".lqb-in:focus{border-color:" + ACCENT + "}" +
    ".lqb-send{background:" + ACCENT + ";color:#fff;border:none;border-radius:22px;padding:0 16px;cursor:pointer;font-weight:700}" +
    ".lqb-send:disabled{opacity:.5;cursor:default}" +
    ".lqb-dots span{display:inline-block;width:6px;height:6px;margin:0 1px;background:#9aa3b0;border-radius:50%;animation:lqbb 1s infinite}" +
    ".lqb-dots span:nth-child(2){animation-delay:.2s}.lqb-dots span:nth-child(3){animation-delay:.4s}" +
    "@keyframes lqbb{0%,60%,100%{opacity:.3}30%{opacity:1}}" +
    ".lqb-credit{text-align:center;font-size:11px;color:#9aa3b0;padding:0 0 8px;background:#fff}" +
    ".lqb-credit a{color:#9aa3b0}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM ----------
  var btn = el("button", "lqb-btn", "💬");
  var panel = el("div", "lqb-panel");
  panel.innerHTML =
    '<div class="lqb-hd"><div>' + esc(NAME) + '<small>Typically replies instantly</small></div>' +
    '<button class="lqb-x" aria-label="Close">×</button></div>' +
    '<div class="lqb-body"></div>' +
    '<div class="lqb-credit">⚡ AI assistant by <a href="https://loukabuilds.com" target="_blank" rel="noopener">LoukaBuilds</a></div>' +
    '<form class="lqb-foot"><input class="lqb-in" placeholder="Type your message…" autocomplete="off" maxlength="1000"/>' +
    '<button class="lqb-send" type="submit">Send</button></form>';
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector(".lqb-body");
  var form = panel.querySelector(".lqb-foot");
  var input = panel.querySelector(".lqb-in");
  var sendBtn = panel.querySelector(".lqb-send");

  btn.addEventListener("click", toggle);
  panel.querySelector(".lqb-x").addEventListener("click", toggle);
  form.addEventListener("submit", function (e) { e.preventDefault(); send(); });

  function toggle() {
    open = !open;
    panel.classList.toggle("open", open);
    btn.textContent = open ? "×" : "💬";
    if (open && body.childElementCount === 0) {
      addBubble("a", GREETING);   // display-only greeting (not in msgs[])
      input.focus();
    }
  }

  function send() {
    var text = (input.value || "").trim();
    if (!text || busy || done) return;
    input.value = "";
    addBubble("u", text);
    msgs.push({ role: "user", content: text });
    busy = true; sendBtn.disabled = true;
    var typing = addTyping();
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs })
    }).then(function (r) { return r.json(); }).then(function (d) {
      typing.remove();
      var reply = d.reply || "Sorry — could you say that another way?";
      addBubble("a", reply);
      msgs.push({ role: "assistant", content: reply });
      if (d.lead_captured) {
        done = true;
        input.placeholder = "Chat ended — thanks!";
        if (d.booking_url) addCTA("📅 Book your call", d.booking_url);
      }
    }).catch(function () {
      typing.remove();
      addBubble("a", "Hmm, I lost my connection. Mind trying again in a moment?");
    }).then(function () {
      busy = false; sendBtn.disabled = false;
      if (!done) input.focus();
    });
  }

  // ---------- helpers ----------
  function addBubble(who, text) {
    var row = el("div", "lqb-row " + who);
    row.appendChild(el("div", "lqb-b", text));
    body.appendChild(row); scroll();
  }
  function addCTA(label, url) {
    var a = document.createElement("a");
    a.className = "lqb-cta"; a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = label; body.appendChild(a); scroll();
  }
  function addTyping() {
    var row = el("div", "lqb-row a");
    var b = el("div", "lqb-b");
    b.innerHTML = '<span class="lqb-dots"><span></span><span></span><span></span></span>';
    row.appendChild(b); body.appendChild(row); scroll();
    return row;
  }
  function scroll() { body.scrollTop = body.scrollHeight; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
})();
