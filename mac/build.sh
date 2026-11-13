#!/bin/sh
# Builds Life Console Now, the Mac menu-bar app: build/Life Console Now.app, build/LifeConsoleNow.zip (what in-app
# updates and the Terminal install use) and build/LifeConsoleNow.dmg (drag to Applications).
# Needs only Apple's Command Line Tools (xcode-select --install). Usage: mac/build.sh [version]   (default: mac/VERSION)
# BUNDLE_ID=… overrides the app ID (end-to-end update tests run a copy without touching your real install).
# Releases: push a tag mac-vX.Y.Z and .github/workflows/mac-release.yml builds and publishes these on GitHub.
set -e
cd "$(dirname "$0")"
VERSION="${1:-$(cat VERSION)}"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "version must be X.Y.Z, got '$VERSION'" >&2; exit 1; }
BUILD_NO=$(echo "$VERSION" | awk -F. '{ print $1 * 10000 + $2 * 100 + $3 }')
APP="build/Life Console Now.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# one universal binary (Apple silicon + Intel), macOS 13+
swiftc -O -target arm64-apple-macos13 main.swift -o build/arm64
swiftc -O -target x86_64-apple-macos13 main.swift -o build/x86_64
lipo -create build/arm64 build/x86_64 -output "$APP/Contents/MacOS/LifeConsoleNow" && rm build/arm64 build/x86_64

# icon: icon.jpg → AppIcon.icns with macOS proportions
swiftc mkicon.swift -o build/mkicon && build/mkicon icon.jpg build/AppIcon.iconset
iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns" && rm -rf build/mkicon build/AppIcon.iconset

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Life Console Now</string>
<key>CFBundleDisplayName</key><string>Life Console Now</string>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID:-dev.life-console.now}</string>
<key>CFBundleExecutable</key><string>LifeConsoleNow</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$BUILD_NO</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHumanReadableCopyright</key><string>Life Console · MIT licence</string>
<key>CFBundleURLTypes</key><array><dict>
  <key>CFBundleURLName</key><string>dev.life-console.now.connect</string>
  <key>CFBundleURLSchemes</key><array><string>lifeconsole-now</string></array>
</dict></array>
</dict></plist>
PLIST
# ad-hoc signature: not notarised (that needs a paid Apple Developer ID), see the README for what that means
codesign --force --sign - "$APP"

ditto -c -k --keepParent "$APP" build/LifeConsoleNow.zip
mkdir -p build/dmg && cp -R "$APP" build/dmg/ && ln -s /Applications build/dmg/Applications
hdiutil create -quiet -volname "Life Console Now" -srcfolder build/dmg -ov -format UDZO build/LifeConsoleNow.dmg
rm -rf build/dmg
echo "Built Life Console Now $VERSION: mac/build/LifeConsoleNow.zip, mac/build/LifeConsoleNow.dmg"
