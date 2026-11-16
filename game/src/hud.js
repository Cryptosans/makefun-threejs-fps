// HUD: every DOM readout, updated only when its value changes (cached).
// Panels: crosshair (spread gap), hitmarker, health bar, ammo, timer, score,
// money, team counts, kill feed, round banner, buy menu, plant/defuse bar,
// bomb timer, start/pause/end overlays. The buy menu is a real shop: click a
// row or press 1-5 during the buy phase.
import { WEAPONS, GRENADE_DEFS } from './weapons.js';

function $(id) {
  return document.getElementById(id);
}

export function createHud() {
  const el = {
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammo: $('ammo'),
    weaponName: $('weapon-name'),
    timer: $('timer'),
    scoreEmber: $('score-ember'),
    scoreWarden: $('score-warden'),
    money: $('money'),
    aliveEmber: $('alive-ember'),
    aliveWarden: $('alive-warden'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buyMenu: $('buy-menu'),
    buyMoney: $('buy-money'),
    plantBar: $('plant-bar'),
    plantFill: $('plant-fill'),
    plantLabel: $('plant-label'),
    bombTimer: $('bomb-timer'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    grenades: $('grenades'),
    roundLabel: $('round-label'),
  };
  const cache = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  const feed = [];

  function set(id, value) {
    if (cache[id] !== value) {
      cache[id] = value;
      const node = el[id];
      if (node) node.textContent = value;
    }
  }

  function show(node, on) {
    if (!node) return;
    const key = node.id + ':show';
    if (cache[key] !== on) {
      cache[key] = on;
      node.hidden = !on;
    }
  }

  return {
    onPlay(cb) { el.play.addEventListener('click', cb); },
    onBuy(cb) {
      el.buyMenu.querySelectorAll('[data-buy]').forEach((row) => {
        row.addEventListener('click', () => cb(row.dataset.buy));
      });
    },
    setHealth(hp) {
      set('healthNum', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (cache.healthPct !== pct) {
        cache.healthPct = pct;
        el.healthFill.style.width = pct + '%';
        el.healthFill.style.background = pct > 50 ? 'var(--good)' : (pct > 25 ? 'var(--accent)' : 'var(--danger)');
      }
    },
    setAmmo(mag, reserve, name) {
      set('ammoMag', String(mag));
      set('ammoReserve', '/ ' + reserve);
      set('weaponName', name);
      const empty = mag === 0;
      if (cache.empty !== empty) {
        cache.empty = empty;
        el.ammo.classList.toggle('empty', empty);
      }
    },
    setTimer(text, danger) {
      set('timer', text);
      if (cache.timerDanger !== danger) {
        cache.timerDanger = danger;
        el.timer.classList.toggle('danger', !!danger);
      }
    },
    setScore(ember, warden, round) {
      set('scoreEmber', String(ember));
      set('scoreWarden', String(warden));
      set('roundLabel', 'ROUND ' + round + ' / 9');
    },
    setMoney(m) { set('money', '$' + m); },
    setAlive(ember, warden) {
      set('aliveEmber', 'EMBER ' + ember);
      set('aliveWarden', 'WARDEN ' + warden);
    },
    setGrenades(frag, smoke, selected) {
      set('grenades', 'G frag x' + frag + ' · F smoke x' + smoke + (selected ? ' · [' + selected + ']' : ''));
    },
    setSpread(spreadPx) {
      const px = Math.round(4 + spreadPx * 900);
      if (cache.spread !== px) {
        cache.spread = px;
        el.crosshair.style.setProperty('--gap', px + 'px');
      }
    },
    hitMarker(killed, holdMs) {
      el.hitmarker.classList.add('on');
      if (killed) el.hitmarker.classList.add('kill');
      else el.hitmarker.classList.remove('kill');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), holdMs || 90);
    },
    feed(text) {
      feed.push(text);
      if (feed.length > 4) feed.shift();
      el.killfeed.innerHTML = feed.map((t) => '<div>' + t + '</div>').join('');
    },
    banner(title, sub, holdMs) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub || '';
      show(el.banner, true);
      clearTimeout(bannerTimer);
      if (holdMs) bannerTimer = setTimeout(() => show(el.banner, false), holdMs);
    },
    hideBanner() { show(el.banner, false); },
    setBuy(open, money, owned, grenades) {
      show(el.buyMenu, open);
      if (!open) return;
      set('buyMoney', '$' + money);
      el.buyMenu.querySelectorAll('[data-buy]').forEach((row) => {
        const id = row.dataset.buy;
        const price = id === 'heron' ? WEAPONS.heron.price : id === 'wasp' ? WEAPONS.wasp.price
          : id === 'frag' ? GRENADE_DEFS.frag.price : GRENADE_DEFS.smoke.price;
        const have = owned[id] || (grenades && grenades[id] > 0);
        const afford = money >= price;
        row.classList.toggle('owned', !!have);
        row.classList.toggle('cant', !have && !afford);
        row.querySelector('.price').textContent = have ? 'OWNED' : '$' + price;
      });
    },
    setPlant(showBar, frac, label) {
      show(el.plantBar, showBar);
      if (!showBar) return;
      el.plantFill.style.width = Math.round(frac * 100) + '%';
      if (cache.plantLabel !== label) {
        cache.plantLabel = label;
        el.plantLabel.textContent = label;
      }
    },
    setBombTimer(showIt, text) {
      show(el.bombTimer, showIt);
      if (showIt) set('bombTimer', text);
    },
    showOverlay(kind, score) {
      el.overlayTitle.textContent = kind === 'start' ? 'Emberline'
        : kind === 'paused' ? 'Paused'
        : kind === 'dead' ? 'You are down'
        : kind === 'match' ? 'Match over'
        : 'Round over';
      el.overlayCopy.textContent = kind === 'start'
        ? 'Foundry Yard. Ember plants the charge at A or B; Wardens stop them. First to 5 rounds. Click to play.'
        : kind === 'paused' ? 'Click to resume. Your team keeps fighting without you.'
        : kind === 'dead' ? 'Spectating your team. The round plays on.'
        : kind === 'match' ? ('Final score Ember ' + score.ember + ' — ' + score.warden + ' Warden. Click to play again.')
        : 'Click to continue.';
      show(el.overlay, true);
    },
    hideOverlay() { show(el.overlay, false); },
  };
}
