#!/usr/bin/env node
/**
 * Renames the Electron app bundle to Meshflow so the dock and menu bar
 * show "Meshflow" in dev mode. Runs automatically after npm install.
 */
import { existsSync, renameSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'node_modules/electron/dist')
const pathTxt = join(root, 'node_modules/electron/path.txt')

// 1. Rename Electron.app → Meshflow.app
const electronApp = join(dist, 'Electron.app')
const meshflowApp = join(dist, 'Meshflow.app')
if (existsSync(electronApp)) {
  renameSync(electronApp, meshflowApp)
  console.log('Renamed Electron.app → Meshflow.app')
} else if (existsSync(meshflowApp)) {
  console.log('Meshflow.app already in place')
} else {
  console.warn('No Electron.app found — skipping rename')
}

// 2. Patch Info.plist
const plist = join(meshflowApp, 'Contents/Info.plist')
if (existsSync(plist)) {
  const patched = readFileSync(plist, 'utf8').replace(/<string>Electron<\/string>/g, '<string>Meshflow</string>')
  writeFileSync(plist, patched)
  console.log('Patched Info.plist')
}

// 3. Update path.txt
if (existsSync(pathTxt)) {
  const updated = readFileSync(pathTxt, 'utf8').replace('Electron.app', 'Meshflow.app')
  writeFileSync(pathTxt, updated)
  console.log('Updated path.txt')
}
