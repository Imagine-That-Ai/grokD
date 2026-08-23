#!/bin/bash
# Kill only Grok Bot D, then start it again. Never touch B or C.
# Run from launchd (gui session), not from D's process tree.
set -u
trap '' HUP INT TERM
if [ -z "${GROK_D_APP:-}" ]; then
  for c in "$HOME/Applications/Grok Bot D.app" "/Applications/Grok Bot D.app" \
           "$HOME/Applications/grok\"D\".app" "/Applications/grok\"D\".app"; do
    if [ -e "$c" ]; then GROK_D_APP="$c"; break; fi
  done
fi
APP="${GROK_D_APP:-$HOME/Applications/Grok Bot D.app}"
if command -v python3 >/dev/null 2>&1; then
  APP=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$APP" 2>/dev/null || echo "$APP")
fi
LAUNCHER="$APP/Contents/MacOS/Grok Bot"
LOCK="${GROK_SEAT4:-$HOME/Library/Application Support/GrokBotSeat4}/SingletonLock"
LOG="${GROK_PROFILE_ROOT:-$HOME/.grok/grokbot-d}/runtime/relaunch.log"
mkdir -p "$(dirname "$LOG")"
echo "$(date +%s) helper start $$" >>"$LOG"

sleep "${1:-0.8}"

is_d_main() {
  local cmd="$1"
  case "$cmd" in
    *bash*|*zsh*|*relaunch-d*|*ELECTRON_RUN_AS_NODE*) return 1 ;;
  esac
  echo "$cmd" | grep -q "Grok Bot.real --user-data-dir" || return 1
  echo "$cmd" | grep -q "GrokBotSeat4" || return 1
  echo "$cmd" | grep -qE '^(/Users/|/Applications/)' || return 1
  return 0
}

kill_d() {
  local sig="${1:-TERM}"
  pgrep -f "Grok Bot.real" 2>/dev/null | while read -r pid; do
    [ -n "$pid" ] || continue
    [ "$pid" = "$$" ] && continue
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    is_d_main "$cmd" || continue
    echo "$(date +%s) kill -$sig $pid" >>"$LOG"
    kill -s "$sig" "$pid" 2>/dev/null || true
  done
}

kill_d TERM
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if [ ! -e "$LOCK" ]; then break; fi
  tgt=$(readlink "$LOCK" 2>/dev/null || true)
  pid="${tgt##*-}"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$LOCK"
    break
  fi
  sleep 0.25
done
kill_d KILL
sleep 0.25
if [ -L "$LOCK" ]; then
  tgt=$(readlink "$LOCK" 2>/dev/null || true)
  pid="${tgt##*-}"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$LOCK"
  fi
fi

# Must go through LaunchServices (`open`). Starting the binary from this
# helper has no Aqua session, so Electron exits at once — D stays dead.
d_up() {
  for pid in $(pgrep -f "Grok Bot.real --user-data-dir" 2>/dev/null); do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    is_d_main "$cmd" || continue
    case "$cmd" in
      "$APP/Contents/MacOS/Grok Bot.real --user-data-dir="*) ;;
      *) continue ;;
    esac
    if ps ax -o ppid=,command= | awk -v p="$pid" \
      '$1 == p && /--type=renderer/ { found=1 } END { exit(found ? 0 : 1) }'; then
      return 0
    fi
  done
  return 1
}

start_d() {
  echo "$(date +%s) open -na $APP" >>"$LOG"
  open -na "$APP" >>"$LOG" 2>&1 || open -a "$APP" >>"$LOG" 2>&1 || true
}

start_d
for ((i = 0; i < 30; i++)); do
  d_up && { echo "$(date +%s) d is up" >>"$LOG"; exit 0; }
  sleep 0.5
done

kill_d TERM
sleep 0.5
kill_d KILL
echo "$(date +%s) retry open" >>"$LOG"
start_d
for ((i = 0; i < 20; i++)); do
  d_up && { echo "$(date +%s) d is up" >>"$LOG"; exit 0; }
  sleep 0.5
done
if ! d_up; then
  echo "$(date +%s) osascript activate" >>"$LOG"
  osascript -e 'tell application id "com.imaginethat.grokbot.seatd" to activate' >>"$LOG" 2>&1 || true
fi
if d_up; then
  echo "$(date +%s) d is up" >>"$LOG"
else
  echo "$(date +%s) FAILED to restart D" >>"$LOG"
  osascript -e 'display alert "grok\"D\" could not open" message "The renderer did not start. Run the one-line installer again, then see ~/.grok/grokbot-d/runtime/relaunch.log." as critical' >>"$LOG" 2>&1 || true
fi
echo "$(date +%s) helper done" >>"$LOG"
