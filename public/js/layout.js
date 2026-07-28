// Builds the sidebar / topbar / mobile nav shell around <main id="page-content">.
// Each dashboard HTML page just needs: a <div id="app-shell"></div> wrapper
// and its unique content inside <div id="page-content">...</div>; this script
// moves that content into the generated shell on load.

const NAV_ITEMS = [
  { href: '/dashboard.html', label: 'Dashboard', icon: 'grid' },
  { href: '/markets.html', label: 'Markets', icon: 'chart' },
  { href: '/auto-trading.html', label: 'Auto Trading', icon: 'bot' },
  { href: '/manual-trading.html', label: 'Manual Trading', icon: 'trade' },
  { href: '/signals.html', label: 'Signals', icon: 'signal' },
  { href: '/analytics.html', label: 'Analytics', icon: 'analytics' },
  { href: '/history.html', label: 'Trade History', icon: 'history' },
  { href: '/wallet.html', label: 'Wallet', icon: 'wallet' },
  { href: '/referral.html', label: 'Referral', icon: 'gift' },
  { href: '/notifications.html', label: 'Notifications', icon: 'bell' },
  { href: '/support.html', label: 'Support', icon: 'support' },
  { href: '/settings.html', label: 'Settings', icon: 'settings' },
  { href: '/profile.html', label: 'Profile', icon: 'user' },
];

const MOBILE_ITEMS = ['/dashboard.html', '/markets.html', '/auto-trading.html', '/signals.html', '/wallet.html'];

const ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 8V4M9 4h6"/></svg>',
  trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h11l-3-3M20 17H9l3 3"/></svg>',
  signal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6M12 7v5l4 2"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 9h18M12 9c-1.5-4-6-4-6-1s4.5 1 6 1c1.5 0 6.5.5 6-1s-4.5-3-6 1Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
};

function buildShell() {
  const current = window.location.pathname;
  const shell = document.getElementById('app-shell');
  const existingContent = document.getElementById('page-content');
  const innerHtml = existingContent ? existingContent.innerHTML : '';
  const pageTitle = document.title.split('|')[0].trim() || 'Dashboard';

  const sidebarLinks = NAV_ITEMS.map((item) => `
    <a class="nav-link ${current.endsWith(item.href) ? 'active' : ''}" href="${item.href}">
      ${ICONS[item.icon]}<span>${item.label}</span>
    </a>`).join('');

  const mobileLinks = MOBILE_ITEMS.map((href) => {
    const item = NAV_ITEMS.find((n) => n.href === href);
    return `<a class="${current.endsWith(href) ? 'active' : ''}" href="${href}">${ICONS[item.icon]}<span>${item.label}</span></a>`;
  }).join('');

  shell.innerHTML = `
    <div class="sidebar" id="sidebar">
      <div class="logo"><span class="dot-accent"></span> AI Trader</div>
      ${sidebarLinks}
      <div style="margin-top:auto;padding-top:16px;">
        <button class="btn btn-secondary btn-block btn-sm" onclick="logout()">Log out</button>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:center;gap:14px;">
          <div class="hamburger icon-btn" onclick="document.getElementById('sidebar').classList.toggle('open')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </div>
          <div class="search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
            <input placeholder="Search markets, trades, symbols..." />
          </div>
        </div>
        <div class="topbar-right">
          <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-1);">
            <span class="dot dot-green"></span> Server Online
          </div>
          <a href="/notifications.html" class="icon-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></a>
          <a href="/profile.html" class="avatar" id="user-avatar">U</a>
        </div>
      </div>
      <div class="page-content" id="page-content-inner">
        ${innerHtml}
      </div>
    </div>
    <div class="mobile-nav">${mobileLinks}</div>
  `;
}

document.addEventListener('DOMContentLoaded', buildShell);
document.addEventListener('user-ready', (e) => {
  const avatar = document.getElementById('user-avatar');
  if (avatar && e.detail?.name) avatar.textContent = e.detail.name.trim()[0].toUpperCase();
});
