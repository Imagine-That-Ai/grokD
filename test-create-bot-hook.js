#!/usr/bin/env node
"use strict";
const assert = (c, m) => { if (!c) throw new Error(m); };
const { isCreateTarget, quotedCreateName, typedName } = require("./create-bot-hook");

function el(tag, label, opts) {
  opts = opts || {};
  const node = {
    tagName: String(tag || "DIV").toUpperCase(),
    textContent: label || "",
    parentElement: opts.parent || null,
    value: opts.value,
    placeholder: opts.placeholder || "",
    getAttribute(k) {
      if (k === "aria-label") return opts.aria || "";
      if (k === "role") return opts.role || "";
      return null;
    },
  };
  return node;
}

assert(quotedCreateName('Create "James"') === "James", "quoted james");
assert(quotedCreateName("Create “James”") === "James", "smart quotes");
assert(quotedCreateName("Create new") === "", "not quoted");

const chip = el("button", 'Create "James"');
const hit = isCreateTarget(chip);
assert(hit && hit.name === "James", "chip name");

const child = el("span", '"James"', { parent: chip });
assert(isCreateTarget(child).name === "James", "walk to chip");

const draft = el("button", "Create new");
assert(isCreateTarget(draft) == null, "empty create new stays official");

const named = el("button", "Create new");
const search = el("input", "", { value: "James", placeholder: "Search or create Bots" });
const doc = { querySelector: () => search, querySelectorAll: () => [search] };
assert(isCreateTarget(named, doc).name === "James", "create new uses typed");

const bot = el("button", "Create new Bot");
assert(isCreateTarget(bot, { querySelector: () => null, querySelectorAll: () => [] }).name === "New Bot", "explicit new bot");

assert(typedName({
  querySelector: () => search,
  querySelectorAll: () => [search],
}) === "James", "typed from search");

console.log("PASS  create-bot-hook");
