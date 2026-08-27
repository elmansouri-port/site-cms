/*
 * robots.txt — the rules from reco.md 5.5, plus anything an admin adds in the
 * CMS. A site put into maintenance mode disallows everything.
 */
export const prerender = false;

import { bootstrap, baseUrlFrom } from '../lib/site.js';

export async function GET({ url }) {
  const boot = await bootstrap();
  const settings = boot?.settings || {};
  const baseUrl = baseUrlFrom(settings, url);

  const lines = settings.maintenanceMode
    ? ['User-agent: *', 'Disallow: /']
    : [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin/',
      'Disallow: /cms/',
      'Disallow: /*?version=*',
      '',
      `Sitemap: ${baseUrl}/sitemap.xml`,
      '',
      // Not part of the robots.txt standard, and no crawler is obliged to read
      // it. It costs one line and it is where an assistant that does look for a
      // site summary expects to be told the file exists.
      `# llms.txt: ${baseUrl}/llms.txt`,
    ];

  if (settings.robotsExtra) lines.push('', settings.robotsExtra.trim());

  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
