/*
 * env.mjs — read .env the way every tool in here needs it.
 *
 * Four tools had their own copy of this, all with the same bug: the line was
 * matched with `/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/`, and in JavaScript `.` does not
 * match a carriage return. On a checkout with CRLF line endings — which this
 * repository has, `.gitattributes` says so — *every* line failed to match, so
 * every tool silently fell back to the environment, found no ADMIN_PASSWORD,
 * and reported "Validation failed" from the login endpoint.
 *
 * That is a bug worth fixing in one place rather than four: a tool that cannot
 * sign in reports something that looks like a server problem, and the next
 * person spends an afternoon on the API before thinking to look here.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Parse dotenv text. Tolerates CRLF, `export ` prefixes, comments and quotes. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    // An unquoted value may carry a trailing comment; a quoted one may not, and
    // its quotes are not part of the value.
    if (/^"(.*)"$/s.test(value) || /^'(.*)'$/s.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    out[m[1]] = value;
  }
  return out;
}

/**
 * The environment a tool should use: `.env` at the repository root, with real
 * environment variables winning — so CI and `docker compose` override the file
 * rather than the other way round.
 */
export function loadEnv(root) {
  let fromFile = {};
  try {
    fromFile = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  } catch { /* no .env: the environment is the whole story */ }
  return { ...fromFile, ...process.env };
}

/**
 * Credentials, or a message saying exactly what to do about it.
 *
 * Tools that write to the database all sign in the same way, and all of them
 * used to fail with the API's "Validation failed" when the credentials were
 * missing — which names the wrong layer. This names this layer.
 */
export function credentials(env, { email, password } = {}) {
  const user = email || env.ADMIN_EMAIL;
  const pass = password || env.ADMIN_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'No administrator credentials. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env '
      + 'at the repository root, or pass --email and --password.',
    );
  }
  return { email: user, password: pass };
}
