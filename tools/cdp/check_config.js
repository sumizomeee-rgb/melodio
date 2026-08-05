const fs = require('fs');
const src = fs.readFileSync('C:/Users/sumizome/AppData/Local/Temp/melodio-build/Melodio_Handoff_Source/app/src/main/assets/www/config.js', 'utf8');
const cleaned = src.replace(/\/\*[\s\S]*?\*\//g, '');
const window = {};
eval(cleaned);
const albums = window.MELODIO_ALBUMS;
console.log('albums:', albums.length);
for (const a of albums) {
  console.log('-', a.albumTitle, '/', a.artist, '/', a.tracks.length, 'tracks');
  a.tracks.forEach((t, i) => console.log('   ', i + 1, t.audio.split('/').pop(), '->', t.image.split('/').pop()));
}
