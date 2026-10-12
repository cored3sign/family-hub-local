// Picks the hub's default data directory:
//   darwin  ~/Library/Application Support/Family Hub
//   win32   %APPDATA%\Family Hub (falls back to ~/AppData/Roaming/Family Hub)
//   linux   ${XDG_DATA_HOME:-~/.local/share}/family-hub
// macOS and Windows use the capitalized, space-containing "Family Hub" to
// match the display name a desktop app bundle would use on those
// platforms; Linux keeps the lowercase, hyphenated "family-hub" package-
// name convention. All three inputs are passed in rather than read from
// `process`/`os` directly, so tests can exercise every platform branch
// from a single process.
export function defaultDataDir({ platform, env, homedir }) {
  if (platform === 'darwin') {
    return join(homedir, 'Library', 'Application Support', 'Family Hub')
  }
  if (platform === 'win32') {
    const base = env.APPDATA || join(homedir, 'AppData', 'Roaming')
    return join(base, 'Family Hub')
  }
  const base = env.XDG_DATA_HOME || join(homedir, '.local', 'share')
  return join(base, 'family-hub')
}

// A tiny platform-agnostic join: inputs can be POSIX or Windows-style
// paths depending on the platform under test, and Node's `path.join`
// (POSIX-flavored on a POSIX host) would mangle a Windows path like
// `C:\Users\example`. Joining with the separator already present in the
// base (backslash for anything that looks like a Windows path, '/'
// otherwise) keeps each platform's own convention intact.
function join(base, ...parts) {
  const sep = base.includes('\\') ? '\\' : '/'
  const trimmedBase = base.endsWith(sep) ? base.slice(0, -1) : base
  return [trimmedBase, ...parts].join(sep)
}
