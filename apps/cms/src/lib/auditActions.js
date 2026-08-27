/*
 * What an audit entry means, in words.
 *
 * The log stores machine keys — `page.section.reorder` — because that is what a
 * filter and an alert want. A human reading the activity feed wants a sentence.
 * The two lists used to be maintained separately on the dashboard and the
 * activity screen, which is why one of them said "restored the original header"
 * and the other said `chrome.restore`.
 */
const ACTIONS = {
  'auth.login': 'signed in',
  'auth.logout': 'signed out',

  'page.create': 'created a page',
  'page.update': 'edited a page',
  'page.publish': 'published a page',
  'page.unpublish': 'unpublished a page',
  'page.delete': 'deleted a page',
  'page.recover': 'recovered a deleted page',
  'page.section.create': 'added a block',
  'page.section.update': 'edited a block',
  'page.section.delete': 'deleted a block',
  'page.section.duplicate': 'duplicated a block',
  'page.section.reorder': 'reordered blocks',
  'page.section.link': 'changed a link',
  'page.section.convert': 'converted a block',
  'page.variant.create': 'created a page variant',

  'post.create': 'created an article',
  'post.update': 'edited an article',
  'post.publish': 'published an article',
  'post.delete': 'deleted an article',

  'string.update': 'edited copy',
  'string.bulk_update': 'edited copy in bulk',

  'chrome.update': 'changed the header or footer',
  'chrome.restore': 'restored the original header or footer',
  'chrome.addin.create': 'added an add-in',
  'chrome.addin.update': 'changed an add-in',
  'chrome.addin.delete': 'removed an add-in',

  'navigation.update': 'changed a menu',

  'media.upload': 'uploaded a file',
  'media.update': 'renamed or described a file',
  'media.replace': 'replaced a file',
  'media.restore': 'put back a replaced file',
  'media.delete': 'deleted a file',
  'media.adopt': 'gave a file a reference',

  'integration.create': 'added an integration',
  'integration.update': 'changed an integration',
  'integration.delete': 'removed an integration',
  'integration.test': 'tested an integration',

  'experiment.create': 'created a test',
  'experiment.update': 'changed a test',
  'experiment.delete': 'deleted a test',

  'redirect.create': 'added a redirect',
  'redirect.update': 'changed a redirect',
  'redirect.delete': 'removed a redirect',

  'settings.update': 'changed the settings',
  'user.create': 'added a team member',
  'user.update': 'changed a team member',
  'user.delete': 'removed a team member',

  'version.create': 'saved a restore point',
  'version.restore': 'restored an earlier version',
  'cache.purge': 'cleared the cache',
};

/** The sentence for an action key, or the key itself when it is a new one. */
export const describeAction = (action) => ACTIONS[action] || action;

/** Whether we have a sentence at all — the caller styles unknown keys as code. */
export const isKnownAction = (action) => action in ACTIONS;
