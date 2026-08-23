#!/usr/bin/env node
// Fast, no-network unit tests for bridge parsers. This is the door check.
const os = require("os");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error(m); };
const {
  allowedHackPath, safeRunCmd, resolveTeammate, parseHandoffs, parseFileOps,
} = require("./bridge-lib");

const DEV = path.join(os.homedir(), "Documents", "Developer");
const DEV_JOB = path.join(DEV, ".grokbot-exec", "job.js");

const roster = [
  { id: "aaa-111", name: "lol" },
  { id: "bbb-222", name: 'grok"D"' },
  { id: "ccc-333", name: "sally the seashell slinging slut" },
];

let n = 0;
const ok = (name) => { n++; console.log(`PASS  ${name}`); };

// resolveTeammate
assert(resolveTeammate(roster, "lol").id === "aaa-111", "lol");
assert(resolveTeammate(roster, "LOL").id === "aaa-111", "LOL");
assert(resolveTeammate(roster, "aaa-111").id === "aaa-111", "uuid");
assert(resolveTeammate(roster, "grok d").id === "bbb-222", "fuzzy grok d");
assert(resolveTeammate(roster, 'grok"D"').id === "bbb-222", "exact grok\"D\"");
assert(resolveTeammate(roster, "Grok Bot D").id === "bbb-222", "legacy name alias");
assert(resolveTeammate(roster, "sally").id === "ccc-333", "sally");
assert(resolveTeammate(roster, "") == null, "empty");
assert(resolveTeammate(roster, "   ") == null, "ws");
assert(resolveTeammate(roster, "nope-xyz") == null, "unknown");
assert(resolveTeammate(null, "lol") == null, "null roster");
ok("resolveTeammate");

// parseHandoffs
{
  const h = parseHandoffs("tell lol to repeat the token TELL-abc12 in her chat");
  assert(h.length === 1, `tell-lol count ${h.length}`);
  assert(h[0].target.toLowerCase() === "lol", h[0].target);
  assert(/TELL-abc12/.test(h[0].message), h[0].message);
  assert(parseHandoffs("tell me to do it").length === 0, "tell me");
  assert(parseHandoffs("tell them to buy milk").length === 0, "tell them");
  assert(parseHandoffs("tell you to stop").length === 0, "tell you");
  assert(parseHandoffs("").length === 0, "empty handoff");
  const live = parseHandoffs('Use the SendToAgent tool. target_id must be "aaa-111". message must contain the exact token LIVE-zz9.');
  assert(live.some((x) => x.target === "aaa-111" && /LIVE-zz9/.test(x.message)), JSON.stringify(live));
  ok("parseHandoffs");
}

// work roots: real project folders, not just /tmp/grokbot-hack
{
  assert(allowedHackPath("/tmp/grokbot-hack/foo.js"), "hack file");
  assert(allowedHackPath("/tmp/grokbot-hack"), "hack root");
  assert(allowedHackPath(path.join(DEV, "foo.js")), "developer file");
  assert(allowedHackPath(DEV), "developer root");
  assert(!allowedHackPath("/tmp/grokbot-hack-evil/x"), "prefix sibling");
  assert(!allowedHackPath("/etc/passwd"), "etc");
  assert(!allowedHackPath(path.join(os.homedir(), ".ssh", "id_rsa")), "ssh");
  assert(!allowedHackPath(path.join(os.homedir(), ".aws", "credentials")), "aws");
  assert(!allowedHackPath(path.join(os.homedir(), "Library", "Keychains", "login.keychain-db")), "keychain");
  assert(!allowedHackPath("/tmp/grokbot-hack/.git/hooks/pre-commit"), ".git hooks");
  assert(!allowedHackPath(path.join(DEV, ".git", "config")), ".git config");
  assert(!allowedHackPath("/tmp/other.js"), "other tmp");
  assert(safeRunCmd("cat /tmp/grokbot-hack/suite-exec/hello.js"), "cat hello");
  assert(safeRunCmd(`cat ${DEV_JOB}`), "cat developer");
  assert(safeRunCmd("echo hi"), "no path shell");
  assert(safeRunCmd("git --version"), "git version");
  assert(safeRunCmd("git status"), "git status");
  assert(!safeRunCmd("git commit -m 'evil hook'"), "git commit blocked");
  assert(!safeRunCmd("git push origin main"), "git push blocked");
  assert(!safeRunCmd("node /tmp/grokbot-hack/suite-exec/hello.js"), "node interpreter blocked");
  assert(!safeRunCmd("rm -rf " + os.homedir()), "rm users");
  assert(!safeRunCmd("node /etc/passwd"), "node etc");
  assert(!safeRunCmd("cat ~/.ssh/id_rsa"), "cat ssh");
  ok("work-paths");
}

// parseFileOps
{
  const src = [
    "Do this now:",
    "1. Write a file at /tmp/grokbot-hack/suite-exec/hello.js containing exactly: console.log('EXEC-1');",
    "2. Run: node /tmp/grokbot-hack/suite-exec/hello.js",
    "3. Also write the stdout to /tmp/grokbot-hack/suite-exec/out.txt",
  ].join("\n");
  const ops = parseFileOps(src);
  assert(ops.writes.length === 1, `writes ${ops.writes.length}`);
  assert(ops.writes[0].path.endsWith("/suite-exec/hello.js"), ops.writes[0].path);
  assert(ops.writes[0].content.includes("EXEC-1"), ops.writes[0].content);
  // Prompt-marker Run execution is strictly disabled for security
  assert(ops.runs.length === 0, "prompt runs must be disabled");

  const jail = parseFileOps("Write a file at /etc/passwd containing exactly: root::0:0");
  assert(jail.writes.length === 0, "jail write");
  const jailOut = parseFileOps("write the stdout to /etc/passwd");
  assert(jailOut.stdoutPath == null, "jail stdout");
  const alt = parseFileOps("create a file at /tmp/grokbot-hack/x.js with: console.log(1);\nExecute: node /tmp/grokbot-hack/x.js");
  assert(alt.writes.length === 1 && alt.writes[0].path.endsWith("/x.js"), alt.writes);
  assert(alt.runs.length === 0, "prompt runs disabled in alt");
  const dev = parseFileOps(`Write a file at ${DEV_JOB} containing exactly: console.log(1);\nRun: node ${DEV_JOB}`);
  assert(dev.writes.length === 1 && dev.writes[0].path === path.resolve(DEV_JOB), JSON.stringify(dev.writes));
  assert(dev.runs.length === 0, "prompt runs disabled in dev");
  ok("parseFileOps");
}

console.log(`\n${n}/4 unit groups passed`);
