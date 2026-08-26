import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from './ui.jsx';

/*
 * The sidebar, grouped the way the work actually divides.
 *
 * "Pages" and "Everywhere" is the distinction that matters once the header and
 * footer stopped living inside each page: some things you change for one page,
 * some you change once and they land on all of them. Getting that wrong is how
 * a footer ends up edited eighteen times.
 *
 * "Growth" is separated from both because it is a different job — the person
 * running a test or reading leads is usually not the person writing the copy.
 */
const GROUPS = [
  {
    label: 'Pages',
    items: [
      { to: '/', icon: 'dashboard', label: 'Overview', end: true },
      { to: '/pages', icon: 'pages', label: 'Pages' },
      { to: '/blog', icon: 'blog', label: 'Blog' },
      { to: '/media', icon: 'media', label: 'Images & video' },
    ],
  },
  {
    label: 'Everywhere',
    items: [
      { to: '/chrome', icon: 'layout', label: 'Header & footer' },
      { to: '/navigation', icon: 'nav', label: 'Menus' },
      { to: '/content', icon: 'text', label: 'Copy & languages' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { to: '/experiments', icon: 'flask', label: 'A/B tests' },
      { to: '/leads', icon: 'leads', label: 'Leads' },
      { to: '/redirects', icon: 'redirect', label: 'Redirects' },
      { to: '/partners', icon: 'partners', label: 'Partners' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/integrations', icon: 'plug', label: 'Integrations', role: 'admin' },
      { to: '/settings', icon: 'settings', label: 'Settings', role: 'admin' },
      { to: '/users', icon: 'users', label: 'Team', role: 'admin' },
      { to: '/audit', icon: 'audit', label: 'Activity', role: 'admin' },
    ],
  },
];

const TITLES = {
  '/': 'Overview',
  '/pages': 'Pages',
  '/content': 'Copy & languages',
  '/blog': 'Blog',
  '/media': 'Images & video',
  '/chrome': 'Header & footer',
  '/navigation': 'Menus',
  '/partners': 'Partner directory',
  '/experiments': 'A/B tests',
  '/redirects': 'Redirects',
  '/integrations': 'Integrations',
  '/leads': 'Leads',
  '/settings': 'Settings',
  '/users': 'Team',
  '/audit': 'Activity',
};

export default function Shell({ children }) {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const title = TITLES[pathname] || TITLES[`/${pathname.split('/')[1]}`] || 'Rainbow CMS';
  const wide = /^\/pages\/[^/]+/.test(pathname);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__mark" aria-hidden="true" />
          <span>Rainbow CMS</span>
        </div>

        <nav className="sidebar__nav">
          {GROUPS.map(group => {
            const items = group.items.filter(i => !i.role || can(i.role));
            if (!items.length) return null;
            return (
              <div className="sidebar__group" key={group.label}>
                <div className="sidebar__label">{group.label}</div>
                {items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div style={{ fontWeight: 600 }}>{user.name}</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{user.email} · {user.role}</div>
          <button className="btn btn--sm" style={{ width: '100%' }} onClick={logout}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">{title}</span>
          <span className="topbar__spacer" />
          <a className="btn btn--sm" href="/" target="_blank" rel="noreferrer">
            <Icon name="external" /> View site
          </a>
        </header>
        {/* The page editor's visual builder wants the whole window rather than
            the reading-width column every other screen is set in. */}
        <main className={`content ${wide ? 'content--wide' : ''}`}>{children}</main>
      </div>
    </div>
  );
}
