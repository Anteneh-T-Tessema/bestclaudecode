import path from 'path'
import { app } from 'electron'

// Packaged builds run from inside Lakoora.app's Resources/app.asar, where
// __dirname-relative math no longer lands on a real checkout. Lakoora is a
// personal launcher for this specific repo (not a redistributable product),
// so the packaged case resolves to a fixed checkout path instead of trying
// to bundle .venv/src — overridable via LAKOORA_REPO_ROOT if the checkout moves.
const PACKAGED_REPO_ROOT = '/Users/antenehtessema/study/skillsagentsandmcp'

/**
 * Resolves the skillsagentsandmcp repo root. In dev (electron-vite
 * dev/preview), derives it from the compiled main-process location
 * (desktop/out/main/index.js → up three levels). In a packaged app, uses
 * LAKOORA_REPO_ROOT or PACKAGED_REPO_ROOT, since __dirname then points inside
 * the app bundle, not a real checkout.
 */
export function repoRoot(): string {
  if (app.isPackaged) {
    return process.env.LAKOORA_REPO_ROOT ?? PACKAGED_REPO_ROOT
  }
  return path.resolve(__dirname, '..', '..', '..')
}

export function venvPython(): string {
  return path.join(repoRoot(), '.venv', 'bin', 'python3')
}

export function venvPytest(): string {
  return path.join(repoRoot(), '.venv', 'bin', 'pytest')
}

export function venvRuff(): string {
  return path.join(repoRoot(), '.venv', 'bin', 'ruff')
}
