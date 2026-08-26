/*
 * /cms/preview — turn draft rendering on or off for this browser.
 *
 * The CMS links an editor here with the shared secret; the cookie that comes
 * back makes every later request render drafts and annotate editable strings.
 * Nothing is cached while it is set.
 */
export const prerender = false;

import { config } from '../../lib/config.js';

export async function GET({ url, cookies, redirect }) {
  const secret = url.searchParams.get('secret');
  const target = url.searchParams.get('redirect') || `/${config.defaultLocale}/`;
  const off = url.searchParams.get('off');
  // Edit mode is preview plus the visual editor's annotations and bridge. It is
  // a separate flag so an editor can preview a draft as a visitor would see it,
  // without the overlay, from the same cookie exchange.
  const edit = url.searchParams.get('edit');

  if (off) {
    cookies.delete(config.previewCookie, { path: '/' });
    cookies.delete(config.editCookie, { path: '/' });
    return redirect(safeTarget(target), 302);
  }

  if (secret !== config.previewSecret) {
    return new Response(JSON.stringify({ error: 'Invalid preview secret' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  cookies.set(config.previewCookie, config.previewSecret, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600,
  });
  if (edit) {
    cookies.set(config.editCookie, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 3600 });
  } else {
    cookies.delete(config.editCookie, { path: '/' });
  }
  return redirect(safeTarget(target), 302);
}

/** Only ever redirect within this site. */
function safeTarget(target) {
  return target.startsWith('/') && !target.startsWith('//') ? target : '/';
}
