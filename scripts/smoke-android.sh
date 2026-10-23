#!/usr/bin/env bash
# Open the release APK on an emulator and fail if it crashes (CI only).
#
#   bash scripts/smoke-android.sh path/to/app.apk out-dir
#
# Release builds are shrunk and renamed by R8, and a missing keep rule shows
# only when the code runs: a crash at launch, or a native module that no
# longer answers. Nothing else in CI runs the app, so this opens it, then
# Settings (whose "Android API" row is filled in by the speech module) and
# Al-Fatiha, and presses the microphone. It fails if the app dies, or if the
# speech module visibly did not answer. Screenshots and the log go to out-dir.
set -u
APK=$1
OUT=${2:-smoke}
PKG=com.tasmeehifz.app
mkdir -p "$OUT"
failed=0

fail() {
  echo "::error::$1"
  failed=1
}

alive() { [ -n "$(adb shell pidof "$PKG" | tr -d '\r')" ]; }

shot() { adb exec-out screencap -p > "$OUT/$1.png"; }

# Reads the screen into $OUT/ui.xml. uiautomator gives up on a screen that
# never goes idle, so a failed read only skips the text checks.
read_screen() {
  rm -f "$OUT/ui.xml"
  adb shell rm -f /sdcard/ui.xml
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2> /dev/null
  grep -q "<hierarchy" "$OUT/ui.xml"
}

# ui QUERY ARG: "has TEXT" exits 0 when TEXT is on screen; "after TEXT" prints
# the next text after TEXT; "center LABEL" prints the middle of the element
# with that accessibility label, as "x y".
ui() {
  python3 -I - "$OUT/ui.xml" "$1" "$2" << 'EOF'
import re
import sys
import xml.etree.ElementTree as ET

path, query, arg = sys.argv[1:4]
nodes = list(ET.parse(path).iter('node'))
texts = [n.get('text', '') for n in nodes if n.get('text')]
if query == 'has':
    sys.exit(0 if any(arg in t for t in texts) else 1)
if query == 'after':
    for i, t in enumerate(texts[:-1]):
        if t == arg:
            print(texts[i + 1])
            sys.exit(0)
    sys.exit(1)
if query == 'center':
    for n in nodes:
        if n.get('content-desc') == arg:
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
            print((x1 + x2) // 2, (y1 + y2) // 2)
            sys.exit(0)
    sys.exit(1)
sys.exit(2)
EOF
}

adb wait-for-device
# -g grants the microphone, location and notifications up front
adb install -r -g "$APK" || {
  echo "::error::the APK did not install"
  exit 1
}
adb logcat -c
size=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1)
W=${size%x*}
H=${size#*x}
echo "screen ${W}x${H}"

echo "== launch"
adb shell am start -W -n "$PKG/.MainActivity" > /dev/null
sleep 15
shot 1-launch
alive || fail "the app is not running 15 s after launch"

echo "== settings"
adb shell am start -W -a android.intent.action.VIEW -d "tasmeehifz://settings" "$PKG" > /dev/null
sleep 8
found=no
for _ in 1 2 3 4 5 6 7 8; do
  if read_screen && ui has "Android API"; then
    found=yes
    break
  fi
  adb shell input swipe $((W / 2)) $((H * 3 / 4)) $((W / 2)) $((H / 4)) 300
  sleep 1
done
shot 2-settings
if [ "$found" = yes ]; then
  sdk=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
  shown=$(ui after "Android API")
  echo "Settings shows Android API: $shown (the emulator is $sdk)"
  [ "$shown" = "$sdk" ] || fail "the speech module did not answer: Settings shows '$shown' for Android API, expected $sdk"
else
  echo "::warning::could not read the Settings screen; the speech module check was skipped"
fi
alive || fail "the app is not running after opening Settings"

echo "== Al-Fatiha"
adb shell am start -W -a android.intent.action.VIEW -d "tasmeehifz://surah/1" "$PKG" > /dev/null
sleep 10
shot 3-surah
if read_screen; then
  ui has "Al-Fatihah" || fail "the Al-Fatiha screen did not show its title"
  if xy=$(ui center "Start reciting"); then
    echo "== microphone at $xy"
    # shellcheck disable=SC2086
    adb shell input tap $xy
    sleep 8
    shot 4-reciting
    alive || fail "the app is not running after pressing the microphone"
    if read_screen && xy=$(ui center "Stop reciting"); then
      # shellcheck disable=SC2086
      adb shell input tap $xy
      sleep 3
    fi
  else
    echo "::warning::could not find the microphone button"
  fi
else
  echo "::warning::could not read the Al-Fatiha screen; its checks were skipped"
fi
shot 5-end
alive || fail "the app is not running at the end"

adb logcat -d > "$OUT/logcat.txt"
adb logcat -d -b crash > "$OUT/crash.txt"
if grep -q "Process: $PKG" "$OUT/crash.txt"; then
  fail "the app crashed:"
  cat "$OUT/crash.txt"
fi
echo "== JavaScript errors in the log, if any:"
grep " E ReactNativeJS" "$OUT/logcat.txt" | head -40 || true

exit $failed
