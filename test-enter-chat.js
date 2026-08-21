#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const { chatSurface, enterChat } = require("./enter-chat");

let n = 0;
const ok = (name) => { n++; console.log("PASS ", name); };

function node(attrs) {
  const el = {
    style: { display: "" },
    textContent: "",
    clicked: 0,
    click() { this.clicked += 1; },
    getAttribute(k) { return (this.attrs && this.attrs[k]) || null; },
    removeAttribute(k) { if (this.attrs) delete this.attrs[k]; },
  };
  return Object.assign(el, attrs || {});
}

function docFrom(map) {
  return {
    querySelector(sel) {
      const v = map[sel];
      if (Array.isArray(v)) return v[0] || null;
      return v || null;
    },
    querySelectorAll(sel) {
      const v = map[sel];
      if (Array.isArray(v)) return v;
      if (v) return [v];
      return [];
    },
  };
}

{
  const blank = docFrom({});
  const s = chatSurface(blank);
  assert(s.ok === false && s.composer === false && s.agent === false, JSON.stringify(s));
  const composer = node();
  const withBox = docFrom({ '[contenteditable="true"]': composer });
  assert(chatSurface(withBox).ok === true, "composer is chat");
  const agent = node();
  const withAgent = docFrom({ ".sand-agent-item": agent });
  assert(chatSurface(withAgent).ok === true, "agent list is chat");
  ok("chatSurface");
}

{
  const item = node();
  let opened = 0;
  const d = docFrom({ ".sand-agent-item": item });
  const r = enterChat(d, { onOpen() { opened += 1; } });
  assert(r.action === "already" && r.ok === true, r.action);
  assert(opened === 1, "visible agent list is already chat");
  ok("visible-agent-list-is-chat");
}

{
  const cover = node({ style: { display: "none" } });
  const item = node();
  item.parentElement = cover;
  const d = docFrom({
    ".sand-access-cover, .sand-onboarding__landing": [cover],
    ".sand-agent-item": item,
  });
  const r = enterChat(d);
  assert(r.action === "clicked-agent", r.action);
  assert(cover.style.display === "", "revealed");
  assert(item.clicked === 1, "clicked the hidden row");
  ok("opens-existing-agent");
}

{
  const btn = node({ textContent: "Create new Bot" });
  const d = docFrom({
    "button, [role='button'], a": [btn],
  });
  const r = enterChat(d);
  assert(r.action === "clicked-create", r.action);
  assert(btn.clicked === 1, "clicked Create new Bot");
  ok("opens-create-when-empty");
}

{
  const box = node();
  const d = docFrom({ '[role="textbox"]': box });
  let opened = 0;
  const r = enterChat(d, { onOpen() { opened += 1; } });
  assert(r.action === "already" && r.ok === true, r.action);
  assert(opened === 1, "onOpen");
  ok("already-open-does-not-recreate");
}

{
  let created = 0;
  const d = docFrom({});
  const r = enterChat(d, { createNamed() { created += 1; } });
  assert(r.action === "box-create", r.action);
  assert(created === 1, "box create");
  ok("box-create-fallback");
}

console.log("\n" + n + "/" + n + " enter-chat checks passed");
