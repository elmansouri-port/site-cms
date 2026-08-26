/*
 * Settings — site-wide configuration: identity, default metadata, languages,
 * the three global snippet zones and analytics.
 */
import { useEffect, useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Spinner, ErrorBox, Field, Tabs, Icon, Checkbox } from '../components/ui.jsx';
import MediaPicker from '../components/MediaPicker.jsx';

export default function SettingsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/settings');
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState('general');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null);

  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!form) return null;

  const set = (field) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm(f => ({ ...f, [field]: value }));
  };
  const setAnalytics = (field) => (e) =>
    setForm(f => ({ ...f, analytics: { ...(f.analytics || {}), [field]: e.target.value } }));

  async function save() {
    setBusy(true);
    try {
      await api.put('/settings', {
        siteName: form.siteName,
        baseUrl: form.baseUrl,
        defaultLocale: form.defaultLocale,
        sourceLocale: form.sourceLocale,
        locales: (form.locales || []).map(({ code, label, nativeLabel, active, order }) => ({ code, label, nativeLabel, active, order })),
        blogSegment: form.blogSegment || {},
        defaultTitle: form.defaultTitle,
        defaultDescription: form.defaultDescription,
        defaultOgTitle: form.defaultOgTitle,
        defaultOgDescription: form.defaultOgDescription,
        defaultOgImage: form.defaultOgImage,
        organizationName: form.organizationName,
        organizationLogo: form.organizationLogo,
        socialProfiles: form.socialProfiles || [],
        globalHeadSnippet: form.globalHeadSnippet,
        globalBodySnippet: form.globalBodySnippet,
        globalFooterSnippet: form.globalFooterSnippet,
        analytics: form.analytics || {},
        robotsExtra: form.robotsExtra,
        maintenanceMode: !!form.maintenanceMode,
      });
      toast.success('Settings saved');
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Settings</h1>
          <p>Applies to every page on the site.</p>
        </div>
        <div className="page-head__actions">
          {can('admin') && (
            <button className="btn btn--primary" onClick={save} disabled={busy}>
              <Icon name="save" /> {busy ? 'Saving…' : 'Save settings'}
            </button>
          )}
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'locales', label: 'Languages' },
          { value: 'seo', label: 'Default metadata' },
          { value: 'snippets', label: 'Code snippets' },
          { value: 'analytics', label: 'Analytics' },
        ]}
      />

      {tab === 'general' && (
        <Panel title="Identity">
          <div className="grid grid--2">
            <Field label="Site name"><input value={form.siteName || ''} onChange={set('siteName')} /></Field>
            <Field label="Public base URL" hint="Used for canonical URLs, OG tags and the sitemap.">
              <input className="code" value={form.baseUrl || ''} onChange={set('baseUrl')} />
            </Field>
            <Field label="Organisation name"><input value={form.organizationName || ''} onChange={set('organizationName')} /></Field>
            <Field label="Organisation logo">
              <div className="inline">
                <input className="code" value={form.organizationLogo || ''} onChange={set('organizationLogo')} style={{ flex: 1 }} />
                <button className="btn btn--sm" onClick={() => setPicking('organizationLogo')}>Browse</button>
              </div>
            </Field>
          </div>
          <Field label="Social profile URLs" hint="One per line. Emitted as sameAs in the Organization structured data.">
            <textarea
              rows={3}
              className="code"
              value={(form.socialProfiles || []).join('\n')}
              onChange={e => setForm(f => ({ ...f, socialProfiles: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
            />
          </Field>
          <Checkbox
            label="Maintenance mode — robots.txt disallows everything"
            checked={!!form.maintenanceMode}
            onChange={set('maintenanceMode')}
          />
          <Field label="Extra robots.txt rules">
            <textarea rows={4} className="code" value={form.robotsExtra || ''} onChange={set('robotsExtra')} />
          </Field>
        </Panel>
      )}

      {tab === 'locales' && (
        <Panel title="Languages">
          <p className="field__hint" style={{ marginBottom: 14 }}>
            Only active languages are routed, listed in the sitemap and given an hreflang entry.
            A language with an incomplete translation is better left inactive than advertised.
          </p>
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Native name</th><th>Active</th></tr>
            </thead>
            <tbody>
              {(form.locales || []).map((l, i) => (
                <tr key={l.code}>
                  <td className="mono">{l.code}</td>
                  <td>
                    <input
                      value={l.label || ''}
                      onChange={e => setForm(f => {
                        const locales = f.locales.slice();
                        locales[i] = { ...locales[i], label: e.target.value };
                        return { ...f, locales };
                      })}
                    />
                  </td>
                  <td>
                    <input
                      value={l.nativeLabel || ''}
                      onChange={e => setForm(f => {
                        const locales = f.locales.slice();
                        locales[i] = { ...locales[i], nativeLabel: e.target.value };
                        return { ...f, locales };
                      })}
                    />
                  </td>
                  <td className="shrink">
                    <input
                      type="checkbox"
                      checked={!!l.active}
                      onChange={e => setForm(f => {
                        const locales = f.locales.slice();
                        locales[i] = { ...locales[i], active: e.target.checked };
                        return { ...f, locales };
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid--2" style={{ marginTop: 16 }}>
            <Field label="Default language" hint="Where a visitor with no preference lands.">
              <select value={form.defaultLocale} onChange={set('defaultLocale')}>
                {(form.locales || []).map(l => <option key={l.code} value={l.code}>{l.code}</option>)}
              </select>
            </Field>
            <Field label="Source language" hint="The language the page templates are authored in.">
              <select value={form.sourceLocale} onChange={set('sourceLocale')}>
                {(form.locales || []).map(l => <option key={l.code} value={l.code}>{l.code}</option>)}
              </select>
            </Field>
          </div>

          <h3 style={{ margin: '22px 0 8px' }}>Blog address</h3>
          <p className="field__hint" style={{ marginBottom: 12 }}>
            The path segment articles sit under, per language. Leave a language empty to use{' '}
            <span className="mono">blog</span>. Changing it changes the public URL of every article
            in that language, so set it before you have inbound links rather than after.
          </p>
          <div className="grid grid--3">
            {(form.locales || []).filter(l => l.active).map(l => (
              <Field
                key={l.code}
                label={l.code.toUpperCase()}
                hint={`/${l.code}/${form.blogSegment?.[l.code] || 'blog'}/an-article`}
              >
                <input
                  className="code"
                  placeholder="blog"
                  value={form.blogSegment?.[l.code] || ''}
                  onChange={e => setForm(f => ({
                    ...f,
                    blogSegment: { ...(f.blogSegment || {}), [l.code]: e.target.value },
                  }))}
                />
              </Field>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'seo' && (
        <Panel title="Default metadata">
          <p className="field__hint" style={{ marginBottom: 14 }}>
            Used when a page leaves the matching field empty. Nothing is ever emitted as an empty tag.
          </p>
          <Field label="Default title"><input value={form.defaultTitle || ''} onChange={set('defaultTitle')} /></Field>
          <Field label="Default description"><textarea rows={3} value={form.defaultDescription || ''} onChange={set('defaultDescription')} /></Field>
          <Field label="Default OG title"><input value={form.defaultOgTitle || ''} onChange={set('defaultOgTitle')} /></Field>
          <Field label="Default OG description"><textarea rows={3} value={form.defaultOgDescription || ''} onChange={set('defaultOgDescription')} /></Field>
          <Field label="Default OG image">
            <div className="inline">
              <input className="code" value={form.defaultOgImage || ''} onChange={set('defaultOgImage')} style={{ flex: 1 }} />
              <button className="btn btn--sm" onClick={() => setPicking('defaultOgImage')}>Browse</button>
            </div>
          </Field>
        </Panel>
      )}

      {tab === 'snippets' && (
        <Panel title="Site-wide code snippets">
          <p className="field__hint" style={{ marginBottom: 14 }}>
            Raw HTML injected into every page as markup. This is the place for tracking tags,
            verification meta tags and site-wide structured data.
          </p>
          <Field label="Head" hint="Inside <head>, before the page's own head snippet.">
            <textarea rows={7} className="code" value={form.globalHeadSnippet || ''} onChange={set('globalHeadSnippet')} />
          </Field>
          <Field label="Body" hint="Before </body>.">
            <textarea rows={6} className="code" value={form.globalBodySnippet || ''} onChange={set('globalBodySnippet')} />
          </Field>
          <Field label="Footer" hint="At the very end of the body.">
            <textarea rows={6} className="code" value={form.globalFooterSnippet || ''} onChange={set('globalFooterSnippet')} />
          </Field>
        </Panel>
      )}

      {tab === 'analytics' && (
        <Panel title="Analytics & session recording">
          <div className="grid grid--2">
            <Field label="Matomo URL"><input className="code" value={form.analytics?.matomoUrl || ''} onChange={setAnalytics('matomoUrl')} /></Field>
            <Field label="Matomo site id"><input value={form.analytics?.matomoSiteId || ''} onChange={setAnalytics('matomoSiteId')} /></Field>
            <Field label="Hotjar id"><input value={form.analytics?.hotjarId || ''} onChange={setAnalytics('hotjarId')} /></Field>
            <Field label="Variant custom dimension" hint="Which Matomo dimension receives the A/B variant.">
              <input value={form.analytics?.variantDimensionId || ''} onChange={setAnalytics('variantDimensionId')} />
            </Field>
          </div>
          <p className="field__hint">
            The assigned A/B variant is exposed to the page as <code>window.__CMS__.variants</code>, so
            recordings and funnels can be filtered by variant without extra tooling.
          </p>
        </Panel>
      )}

      {picking && (
        <MediaPicker
          onClose={() => setPicking(null)}
          onSelect={(item) => { setForm(f => ({ ...f, [picking]: item.url })); setPicking(null); }}
        />
      )}
    </>
  );
}
