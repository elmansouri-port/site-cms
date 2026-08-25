import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from './ui.jsx';

const GROUPS = [
  {
    label: 'Content',
    items: [
      { to: '/', icon: 'dashboard', label: 'Dashboard', end: true },
      { to: '/pages', icon: 'pages', label: 'Pages' },
      { to: '/content', icon: 'text', label: 'Copy & translations' },
      { to: '/blog', icon: 'blog', label: 'Blog' },
      { to: '/media', icon: 'media', label: 'Media' },
    ],
  },
  {
    label: 'Site',
    items: [
      { to: '/navigation', icon: 'nav', label: 'Navigation' },
      { to: '/partners', icon: 'partners', label: 'Partners' },
      { to: '/experiments', icon: 'flask', label: 'A/B tests' },
      { to: '/redirects', icon: 'redirect', label: 'Redirects' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/leads', icon: 'leads', label: 'Leads' },
      { to: '/settings', icon: 'settings', label: 'Settings', role: 'admin' },
      { to: '/users', icon: 'users', label: 'Team', role: 'admin' },
      { to: '/audit', icon: 'audit', label: 'Activity', role: 'admin' },
    ],
  },
];

const TITLES = {
  '/': 'Dashboard',
  '/pages': 'Pages',
  '/content': 'Copy & translations',
  '/blog': 'Blog',
  '/media': 'Media library',
  '/navigation': 'Navigation',
  '/partners': 'Partner directory',
  '/experiments': 'A/B tests',
  '/redirects': 'Redirects',
  '/leads': 'Leads',
  '/settings': 'Settings',
  '/users': 'Team',
  '/audit': 'Activity',
};

export default function Shell({ children }) {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const title = TITLES[pathname] || TITLES[`/${pathname.split('/')[1]}`] || 'Rainbow CMS';

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
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
