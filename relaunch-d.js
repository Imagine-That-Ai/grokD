#!/usr/bin/env node
// Prefer launchd (same path as switch-profile). Fallback: detached bash.
"use strict";
require("./switch-profile").relaunchD();
