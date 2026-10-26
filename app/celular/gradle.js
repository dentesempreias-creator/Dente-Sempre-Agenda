#!/usr/bin/env node
// Roda o Gradle do projeto Android (android/gradlew no Mac/Linux, android\gradlew.bat no Windows).
// Uso: node gradle.js assembleDebug
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const pasta = path.join(__dirname, 'android');
const windows = process.platform === 'win32';
const r = spawnSync(windows ? 'gradlew.bat' : './gradlew', process.argv.slice(2), { cwd: pasta, stdio: 'inherit', shell: windows });
if (r.error) { console.error('Não consegui rodar o Gradle: ' + r.error.message + '\nInstale o JDK 21 e o Android Studio (veja LEIA-ME-APPS.md).'); process.exit(1); }
process.exit(r.status === null ? 1 : r.status);
