/* LoukaBuilds AI Lead-Qualifier — embeddable chat widget.
 * Drop onto any site with ONE line:
 *   <script src="https://lead-qualifier-zxl9.onrender.com/widget.js"
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
  var ACCENT = script.getAttribute("data-accent") || "#FF4D1C";
  var INK = "#141210", PAPER = "#FBF4E9", LIME = "#C6FF4D";
  var DISP = "'Bricolage Grotesque',-apple-system,Segoe UI,Roboto,sans-serif";
  var BODY = "'Hanken Grotesk',-apple-system,Segoe UI,Roboto,sans-serif";
  var GREETING = script.getAttribute("data-greeting") ||
    ("Hi! 👋 I'm " + NAME + "'s assistant. What are you looking to build or get help with?");

  var msgs = [];          // transcript SENT to the API (user-first)
  var open = false, busy = false, done = false;

  // ---------- styles (bold-vibrant: ink borders, hard shadows, cream paper) ----------
  var css = "" +
    ".lqb-btn{position:fixed;right:22px;bottom:22px;width:64px;height:64px;border-radius:18px;" +
    "background:" + ACCENT + ";color:#fff;border:3px solid " + INK + ";cursor:pointer;box-shadow:5px 5px 0 " + INK + ";" +
    "font-size:28px;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .12s,box-shadow .12s}" +
    ".lqb-btn:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 " + INK + "}" +
    ".lqb-btn:active{transform:translate(2px,2px);box-shadow:2px 2px 0 " + INK + "}" +
    ".lqb-panel{position:fixed;right:22px;bottom:100px;width:374px;max-width:calc(100vw - 32px);height:564px;" +
    "max-height:calc(100vh - 134px);background:" + PAPER + ";border:3px solid " + INK + ";border-radius:20px;box-shadow:8px 8px 0 " + INK + ";" +
    "z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:" + BODY + "}" +
    ".lqb-panel.open{display:flex}" +
    ".lqb-hd{background:" + INK + ";color:" + PAPER + ";padding:15px 18px;font-weight:800;font-size:17px;" +
    "font-family:" + DISP + ";letter-spacing:-.3px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid " + INK + "}" +
    ".lqb-hd small{display:block;font-weight:700;opacity:.9;font-size:11px;margin-top:3px;letter-spacing:.5px;" +
    "text-transform:uppercase;font-family:'Space Mono',monospace;color:" + LIME + "}" +
    ".lqb-x{background:none;border:none;color:" + PAPER + ";font-size:24px;cursor:pointer;line-height:1;opacity:.85}" +
    ".lqb-x:hover{opacity:1}" +
    ".lqb-body{flex:1;overflow-y:auto;padding:16px;background:" + PAPER + ";" +
    "background-image:radial-gradient(rgba(20,18,16,.07) 1px,transparent 1px);background-size:18px 18px}" +
    ".lqb-row{display:flex;margin:9px 0}" +
    ".lqb-row.u{justify-content:flex-end}" +
    ".lqb-b{max-width:80%;padding:10px 13px;border:2.5px solid " + INK + ";border-radius:14px;font-size:14.5px;" +
    "line-height:1.42;white-space:pre-wrap;word-wrap:break-word;font-weight:500}" +
    ".lqb-row.a .lqb-b{background:#fff;color:" + INK + ";border-bottom-left-radius:4px;box-shadow:3px 3px 0 " + INK + "}" +
    ".lqb-row.u .lqb-b{background:" + ACCENT + ";color:#fff;border-bottom-right-radius:4px;box-shadow:3px 3px 0 " + INK + "}" +
    ".lqb-cta{display:block;text-align:center;margin:12px 0 4px;background:" + LIME + ";color:" + INK + ";text-decoration:none;" +
    "padding:12px;border:3px solid " + INK + ";border-radius:13px;font-weight:800;font-size:15px;font-family:" + DISP + ";" +
    "box-shadow:4px 4px 0 " + INK + ";transition:transform .12s,box-shadow .12s}" +
    ".lqb-cta:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 " + INK + "}" +
    ".lqb-foot{display:flex;gap:8px;padding:12px;border-top:3px solid " + INK + ";background:" + PAPER + "}" +
    ".lqb-in{flex:1;border:2.5px solid " + INK + ";border-radius:12px;padding:10px 14px;font-size:14.5px;outline:none;" +
    "font-family:" + BODY + ";background:#fff;font-weight:500}" +
    ".lqb-in:focus{box-shadow:3px 3px 0 " + ACCENT + "}" +
    ".lqb-send{background:" + ACCENT + ";color:#fff;border:2.5px solid " + INK + ";border-radius:12px;padding:0 16px;cursor:pointer;" +
    "font-weight:800;font-family:" + DISP + "}" +
    ".lqb-send:disabled{opacity:.45;cursor:default}" +
    ".lqb-dots span{display:inline-block;width:6px;height:6px;margin:0 1px;background:" + INK + ";border-radius:50%;animation:lqbb 1s infinite}" +
    ".lqb-dots span:nth-child(2){animation-delay:.2s}.lqb-dots span:nth-child(3){animation-delay:.4s}" +
    "@keyframes lqbb{0%,60%,100%{opacity:.25}30%{opacity:1}}" +
    ".lqb-credit{text-align:center;font-size:10.5px;color:#8a8378;padding:0 0 8px;background:" + PAPER + ";" +
    "font-family:'Space Mono',monospace;letter-spacing:.3px}" +
    ".lqb-credit a{color:#8a8378}";
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
