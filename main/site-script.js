document.addEventListener('DOMContentLoaded', () => {
	const btn = document.getElementById('startGameButton');
	if (btn) btn.addEventListener('click', () => {
		location.href = 'game/game.html';
	});
});