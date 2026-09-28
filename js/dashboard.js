const DASHBOARD_TAB_KEY = 'oa_tab_session';
const dashboardUrl = new URL(window.location.href);

if (dashboardUrl.searchParams.has('tabSession')) {
  sessionStorage.setItem(DASHBOARD_TAB_KEY, '1');
} else if (dashboardUrl.searchParams.has('remembered')) {
  sessionStorage.removeItem(DASHBOARD_TAB_KEY);
}

if (dashboardUrl.searchParams.has('tabSession') || dashboardUrl.searchParams.has('remembered')) {
  window.history.replaceState(null, '', '/dashboard.html');
}

fetch('/api/me')
  .then(response => {
    if (!response.ok) {
      throw new Error('not authenticated');
    }
    return response.json();
  })
  .then(user => {
    if (!user.remembered && sessionStorage.getItem(DASHBOARD_TAB_KEY) !== '1') {
      window.location.replace('/index.html?msg=Сначала войдите в аккаунт&type=error');
      return;
    }
    document.getElementById('accountName').textContent = user.name;
  })
  .catch(() => {
    window.location.replace('/index.html?msg=Сначала войдите в аккаунт&type=error');
  });
