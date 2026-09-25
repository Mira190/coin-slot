// Coin Slot game catalog: the one place to list games (lobby order).
// Every game lives at games/<id>/ and is playable on its own at that URL.
//   cabinet: true -> games/<id>/game.js registers a canvas game run by arcade/cabinet.js
//   otherwise     -> games/<id>/index.html is a full page; games/<id>/card.js registers its lobby card
window.Arcade = window.Arcade || {};
Object.assign(window.Arcade, {
  catalog: [
    { id: 'windrift' },
    { id: 'cargo-deck' },
    { id: 'twin-gate' },
    { id: 'folded-steps' },
    { id: 'pelican-pedal' },
    { id: 'cloudspire' },
    { id: 'neon-circuit', cabinet: true },
    { id: 'coil', cabinet: true },
    { id: 'stackfall', cabinet: true },
    { id: 'brickstorm', cabinet: true },
    { id: 'lantern', cabinet: true }
  ],
  games: [],
  register(def) { this.games.push(def); }
});
