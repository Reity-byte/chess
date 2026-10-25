// ─── APP: OFFLINE + INSTALL ────────────────────────────────────────────────────
// Loaded on every page. Registers the service worker (sw.js), which keeps an
// offline copy of the whole site, and — when the browser offers to install the
// site as an app (Chrome, Edge, Android) — adds an "Install" button to the top
// bar. Both need the site served over https or from localhost, not a file.
(() => {
    const base = new URL('.', document.currentScript.src); // the main/ folder
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname }).catch(() => { /* online-only then */ });
        });
    }

    let offer = null; // the browser's deferred install prompt
    let button = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        offer = e;
        showButton();
    });

    window.addEventListener('appinstalled', () => {
        offer = null;
        if (button) button.remove();
        if (typeof showToast === 'function') showToast('Installed — Chess now opens like an app, even offline.', 3500);
    });

    function showButton() {
        if (button || !offer) return;
        const bar = document.querySelector('.topbar-right');
        if (!bar) { document.addEventListener('DOMContentLoaded', showButton, { once: true }); return; }
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-ghost install-button';
        button.title = 'Install Chess as an app (works offline)';
        button.innerHTML = '<span aria-hidden="true">⤓</span><span class="install-label">Install</span>';
        button.addEventListener('click', async () => {
            if (!offer) return;
            offer.prompt();
            await offer.userChoice;
            offer = null;
            button.remove();
            button = null;
        });
        bar.prepend(button);
    }
})();
