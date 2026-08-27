/*
 * Settings — site-wide configuration: identity, languages, default metadata and
 * analytics.
 *
 * Code that runs on every page is deliberately *not* here. It used to be, as
 * three anonymous textareas nobody dared touch; it now lives under Header &
 * footer as named add-ins, each with a note, a switch and its own history. The
 * capability is the same — what changed is that in two years somebody can tell
 * what a given snippet was for.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plug, Save } from 'lucide-react';
import { useDirtyGuard, useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import MediaPicker from '../components/MediaPicker.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import {
  Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, Code, ErrorBox,
  Field, FieldGroupLabel, FieldRow, Input, PageHeader, Select, Spinner, TBody, THead, TRow,
  Table, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from '../components/ui/index.js';

export default function SettingsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/settings');
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState('general');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null);

  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data]);

  const dirty = !!form && !!data && JSON.stringify(form) !== JSON.stringify(data.settings);
  useDirtyGuard(dirty);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!form) return null;

  const set = (field) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm(f => ({ ...f, [field]: value }));
  };
  const setAnalytics = (field) => (e) =>
    setForm(f => ({ ...f, analytics: { ...(f.analytics || {}), [field]: e.target.value } }));
  const setLocale = (i, patch) => setForm((f) => {
    const locales = f.locales.slice();
    locales[i] = { ...locales[i], ...patch };
    return { ...f, locales };
  });

  async function save() {
    setBusy(true);
    try {
      await api.put('/settings', {
        siteName: form.siteName,
        baseUrl: form.baseUrl,
        defaultLocale: form.defaultLocale,
        sourceLocale: form.sourceLocale,
        locales: (form.locales || []).map(({ code, label, nativeLabel, active, order }) => ({
          code, label, nativeLabel, active, order,
        })),
        blogSegment: form.blogSegment || {},
        defaultTitle: form.defaultTitle,
        defaultDescription: form.defaultDescription,
        defaultOgTitle: form.defaultOgTitle,
        defaultOgDescription: form.defaultOgDescription,
        defaultOgImage: form.defaultOgImage,
        organizationName: form.organizationName,
        organizationLogo: form.organizationLogo,
        socialProfiles: form.socialProfiles || [],
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
      <PageHeader title="Settings" description="Applies to every page on the site.">
        {can('admin') && (
          <Button onClick={save} disabled={busy || !dirty}>
            <Save /> {busy ? 'Saving…' : 'Save settings'}
          </Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="locales">Languages</TabsTrigger>
          <TabsTrigger value="seo">Default metadata</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
              <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
              <CardContent className="grid gap-4">
                <FieldRow>
                  <Field label="Site name">
                    {id => <Input id={id} value={form.siteName || ''} onChange={set('siteName')} />}
                  </Field>
                  <Field label="Public base URL" hint="Canonical URLs, OG tags and the sitemap are built from this.">
                    {id => <Input id={id} mono value={form.baseUrl || ''} onChange={set('baseUrl')} />}
                  </Field>
                  <Field label="Organisation name">
                    {id => <Input id={id} value={form.organizationName || ''} onChange={set('organizationName')} />}
                  </Field>
                  <Field label="Organisation logo">
                    {id => (
                      <div className="flex items-center gap-2">
                        <Input
                          id={id}
                          mono
                          value={form.organizationLogo || ''}
                          onChange={set('organizationLogo')}
                        />
                        <Button variant="outline" size="sm" onClick={() => setPicking('organizationLogo')}>
                          Browse…
                        </Button>
                      </div>
                    )}
                  </Field>
                </FieldRow>

                <Field
                  label="Social profile URLs"
                  hint="One per line. Emitted as sameAs in the Organization structured data."
                >
                  {id => (
                    <Textarea
                      id={id}
                      mono
                      rows={3}
                      value={(form.socialProfiles || []).join('\n')}
                      onChange={e => setForm(f => ({
                        ...f,
                        socialProfiles: e.target.value.split('\n').map(s => s.trim()).filter(Boolean),
                      }))}
                    />
                  )}
                </Field>

                <FieldGroupLabel>Crawlers</FieldGroupLabel>
                <CheckboxField
                  label="Maintenance mode"
                  hint="robots.txt disallows everything. For a site that is up but should not be indexed yet."
                  checked={!!form.maintenanceMode}
                  onChange={v => setForm(f => ({ ...f, maintenanceMode: v }))}
                />
                <Field label="Extra robots.txt rules">
                  {id => (
                    <Textarea id={id} mono rows={4} value={form.robotsExtra || ''} onChange={set('robotsExtra')} />
                  )}
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Code on every page</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                  Tracking tags, consent banners, chat widgets and verification meta tags are{' '}
                  <strong>add-ins</strong>, under Header &amp; footer.
                </p>
                <Callout>
                  This screen used to hold three anonymous snippet boxes. An add-in has a name, a
                  note, an on/off switch, an optional page filter and its own A/B key — which is what
                  makes it survivable to have a dozen of them after a few years of campaigns.
                </Callout>
                <Button variant="outline" size="sm" asChild className="justify-self-start">
                  <Link to="/chrome"><Plug /> Open add-ins</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="locales">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle>Languages</CardTitle></CardHeader>
              <CardContent>
                <Callout className="mb-4">
                  Only active languages are routed, listed in the sitemap and given an hreflang entry.
                  A language with an incomplete translation is better left inactive than advertised.
                </Callout>
              </CardContent>
              <Table>
                <THead>
                  <tr><th>Code</th><th>Name</th><th>Native name</th><th>Active</th></tr>
                </THead>
                <TBody>
                  {(form.locales || []).map((l, i) => (
                    <TRow key={l.code}>
                      <td className="font-mono uppercase">{l.code}</td>
                      <td>
                        <Input
                          value={l.label || ''}
                          aria-label={`Name for ${l.code}`}
                          onChange={e => setLocale(i, { label: e.target.value })}
                        />
                      </td>
                      <td>
                        <Input
                          value={l.nativeLabel || ''}
                          aria-label={`Native name for ${l.code}`}
                          onChange={e => setLocale(i, { nativeLabel: e.target.value })}
                        />
                      </td>
                      <td className="w-20">
                        <CheckboxField
                          label=""
                          checked={!!l.active}
                          onChange={v => setLocale(i, { active: v })}
                        />
                      </td>
                    </TRow>
                  ))}
                </TBody>
              </Table>
              <CardContent className="grid gap-4">
                <FieldRow>
                  <Field label="Default language" hint="Where a visitor with no preference lands.">
                    {id => (
                      <Select
                        id={id}
                        value={form.defaultLocale}
                        options={(form.locales || []).map(l => l.code)}
                        onChange={set('defaultLocale')}
                      />
                    )}
                  </Field>
                  <Field label="Source language" hint="The language the page templates are authored in.">
                    {id => (
                      <Select
                        id={id}
                        value={form.sourceLocale}
                        options={(form.locales || []).map(l => l.code)}
                        onChange={set('sourceLocale')}
                      />
                    )}
                  </Field>
                </FieldRow>

                <FieldGroupLabel
                  hint={(
                    <>
                      The path segment articles sit under, per language. Leave one empty to use{' '}
                      <Code>blog</Code>. Changing it changes the public URL of every article in that
                      language, so set it before you have inbound links rather than after.
                    </>
                  )}
                >
                  Blog address
                </FieldGroupLabel>
                <FieldRow cols={3}>
                  {(form.locales || []).filter(l => l.active).map(l => (
                    <Field
                      key={l.code}
                      label={l.code.toUpperCase()}
                      hint={`/${l.code}/${form.blogSegment?.[l.code] || 'blog'}/an-article`}
                    >
                      {id => (
                        <Input
                          id={id}
                          mono
                          placeholder="blog"
                          value={form.blogSegment?.[l.code] || ''}
                          onChange={e => setForm(f => ({
                            ...f,
                            blogSegment: { ...(f.blogSegment || {}), [l.code]: e.target.value },
                          }))}
                        />
                      )}
                    </Field>
                  ))}
                </FieldRow>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="seo">
          <Card className="max-w-3xl">
            <CardHeader><CardTitle>Default metadata</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <Callout>
                Used when a page leaves the matching field empty. Nothing is ever emitted as an empty
                tag.
              </Callout>
              <Field label="Default title">
                {id => <Input id={id} value={form.defaultTitle || ''} onChange={set('defaultTitle')} />}
              </Field>
              <Field label="Default description">
                {id => (
                  <Textarea id={id} rows={3} value={form.defaultDescription || ''} onChange={set('defaultDescription')} />
                )}
              </Field>
              <Field label="Default OG title">
                {id => <Input id={id} value={form.defaultOgTitle || ''} onChange={set('defaultOgTitle')} />}
              </Field>
              <Field label="Default OG description">
                {id => (
                  <Textarea id={id} rows={3} value={form.defaultOgDescription || ''} onChange={set('defaultOgDescription')} />
                )}
              </Field>
              <Field label="Default OG image" hint="Shown when a page has no image of its own.">
                {id => (
                  <div className="flex items-center gap-2">
                    <Input id={id} mono value={form.defaultOgImage || ''} onChange={set('defaultOgImage')} />
                    <Button variant="outline" size="sm" onClick={() => setPicking('defaultOgImage')}>
                      Browse…
                    </Button>
                  </div>
                )}
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <Card className="max-w-3xl">
            <CardHeader><CardTitle>Analytics &amp; session recording</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <FieldRow>
                <Field label="Matomo URL">
                  {id => (
                    <Input id={id} mono value={form.analytics?.matomoUrl || ''} onChange={setAnalytics('matomoUrl')} />
                  )}
                </Field>
                <Field label="Matomo site id">
                  {id => (
                    <Input id={id} value={form.analytics?.matomoSiteId || ''} onChange={setAnalytics('matomoSiteId')} />
                  )}
                </Field>
                <Field label="Hotjar id">
                  {id => <Input id={id} value={form.analytics?.hotjarId || ''} onChange={setAnalytics('hotjarId')} />}
                </Field>
                <Field label="Variant custom dimension" hint="Which Matomo dimension receives the A/B variant.">
                  {id => (
                    <Input
                      id={id}
                      value={form.analytics?.variantDimensionId || ''}
                      onChange={setAnalytics('variantDimensionId')}
                    />
                  )}
                </Field>
              </FieldRow>
              <Callout>
                The assigned A/B variant is exposed to the page as <Code>window.__CMS__.variants</Code>,
                so recordings and funnels can be filtered by variant without extra tooling.
              </Callout>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <HistoryPanel entity="settings" entityId="global" name="the site settings" onRestored={reload} />
            <Card>
              <CardHeader><CardTitle>What restoring covers</CardTitle></CardHeader>
              <CardContent className="prose-sm">
                <p>
                  Everything on this screen: the identity, the language list, the default metadata,
                  the analytics ids and the robots rules.
                </p>
                <p>
                  It is worth having because a wrong <strong>base URL</strong> or an accidentally
                  deactivated language changes every canonical tag on the site at once — a mistake
                  that is invisible in the CMS and expensive in search.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {picking && (
        <MediaPicker
          onClose={() => setPicking(null)}
          onSelect={(item) => { setForm(f => ({ ...f, [picking]: item.url })); setPicking(null); }}
        />
      )}
    </>
  );
}
