// ─── ACHIEVEMENTS PAGE ─────────────────────────────────────────────────────────
// achievements.html: every badge from achievements.js, earned ones with their
// date, locked ones with a progress bar where there's a count to show.
document.addEventListener('DOMContentLoaded', () => {
    checkAchievements(); // unlock anything earned before drawing
    renderAchievementsPage();
});

// Called by checkAchievements() whenever something new unlocks.
function onAchievementsChanged() {
    renderAchievementsPage();
}
