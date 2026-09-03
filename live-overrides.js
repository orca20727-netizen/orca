(() => {
  const origin = window.location.origin;
  const text = (el, value) => { if (el) el.textContent = value; };
  const byExactText = (value) => Array.from(document.querySelectorAll('span,div,p,h2,h4,strong')).filter((el) => el.children.length === 0 && el.textContent.trim() === value);
  const replaceExact = (from, to) => byExactText(from).forEach((el) => text(el, to));

  function pending() {
    replaceExact('SAFE (88/100)', 'LIVE METRICS PENDING');
    replaceExact('88', '—');
    replaceExact('SAFE FOR SEA VENTURE', 'LIVE SAFETY METRICS PENDING');
    replaceExact('Simulated AIS fleet', 'Awaiting live AIS feed');
    replaceExact('3 Active', 'Provider required');
    ['1.25 m', '14.2 kn', 'State 3', '35 Tracked', '35 Active Vessels'].forEach((v) => replaceExact(v, '—'));
    Array.from(document.querySelectorAll('p')).filter((el) => el.textContent.includes('IND-TN-001')).forEach((el) => text(el, 'Live GPS/IMBL alert requires a connected vessel position.'));
  }

  function renderSafety(wave, windKts) {
    const score = Math.max(0, Math.min(100, Math.round(100 - wave * 18 - windKts * 1.2)));
    const clearance = score >= 75 ? 'LOW RISK' : score >= 50 ? 'CAUTION' : 'HIGH RISK';
    replaceExact('LIVE METRICS PENDING', clearance + ' (' + score + '/100)');
    replaceExact('LIVE SAFETY METRICS PENDING', clearance + ' — LIVE WEATHER');
    byExactText('—').slice(0, 1).forEach((el) => text(el, String(score)));
    text(document.getElementById('marineWaveVal'), wave.toFixed(2) + ' m');
    text(document.getElementById('marineWindVal'), windKts.toFixed(1) + ' kn');
    Array.from(document.querySelectorAll('span')).filter((el) => el.textContent.trim() === '—').slice(0, 2).forEach((el, i) => text(el, i === 0 ? wave.toFixed(2) + ' m' : windKts.toFixed(1) + ' kn'));
  }

  async function refresh() {
    pending();
    try {
      const marineUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=9.93&longitude=76.26&current=wave_height&timezone=Asia%2FKolkata';
      const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=9.93&longitude=76.26&current=wind_speed_10m&wind_speed_unit=ms&timezone=Asia%2FKolkata';
      const [marine, weather] = await Promise.all([fetch(marineUrl).then((r) => r.json()), fetch(weatherUrl).then((r) => r.json())]);
      const wave = Number(marine && marine.current && marine.current.wave_height);
      const windKts = Number(weather && weather.current && weather.current.wind_speed_10m) * 1.94384;
      if (!Number.isFinite(wave) || !Number.isFinite(windKts)) throw new Error('Current weather unavailable');
      renderSafety(wave, windKts);
    } catch (_) {
      replaceExact('LIVE METRICS PENDING', 'LIVE WEATHER UNAVAILABLE');
      replaceExact('LIVE SAFETY METRICS PENDING', 'LIVE WEATHER UNAVAILABLE');
    }
    try {
      const snapshot = await fetch(origin + '/api/live/vessels').then((r) => r.json());
      const count = snapshot && snapshot.status === 'LIVE' && Array.isArray(snapshot.payload) ? snapshot.payload.length : 0;
      text(document.getElementById('homeActiveVessels'), String(count));
      text(document.getElementById('dagPanelVesselCount'), count ? count + ' Tracked' : 'No live vessels');
      text(document.getElementById('mapActiveVessels'), count ? count + ' Active Vessels' : 'No live vessels');
    } catch (_) {}
  }
  document.addEventListener('DOMContentLoaded', () => { setTimeout(refresh, 800); setInterval(refresh, 120000); });
})();
