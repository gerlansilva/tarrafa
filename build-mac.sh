#!/bin/bash
# Gera o Tarrafa.app e o .dmg com assinatura ad hoc (gratuita) no macOS.
set -e
cd "$(dirname "$0")"
command -v cargo >/dev/null || { echo "Instale o Rust: https://rustup.rs"; exit 1; }
npm install
npm run tauri build
APP="src-tauri/target/release/bundle/macos/Tarrafa.app"
codesign --force --deep -s - "$APP"
codesign --verify --verbose "$APP" && echo "Assinado (ad hoc): $APP"
ls src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null
