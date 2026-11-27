/* Focus mini games: game tabs, Memory Match, 2048 and Bubble Pop.
   (Snake lives in Focus.js.) Everything works offline. */

(function () {
  "use strict";

  var store = window.FocusStore || {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function $(id) { return document.getElementById(id); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ===== Soft game sounds (made in the browser) ===== */
  var audio = null;
  function tone(freq, dur, vol, type) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      var t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.3));
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + (dur || 0.3) + 0.05);
    } catch (e) { /* sound is optional */ }
  }
  var PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

  /* ===== Game tabs ===== */
  var current = "snake";
  var games = {};
  function showGame(name) {
    if (name === current) return;
    if (games[current] && games[current].hide) games[current].hide();
    document.dispatchEvent(new CustomEvent("focus:game-hidden", { detail: current }));
    current = name;
    document.querySelectorAll(".game-tab").forEach(function (t) {
      var on = t.dataset.game === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".game-panel").forEach(function (p) { p.hidden = p.dataset.game !== name; });
    if (games[name] && games[name].show) games[name].show();
  }
  document.querySelectorAll(".game-tab").forEach(function (t) {
    t.addEventListener("click", function () { showGame(t.dataset.game); });
  });

  /* ===== Memory Match ===== */
  games.memory = (function () {
    var grid = $("mem-grid"), movesEl = $("mem-moves"), timeEl = $("mem-time"), bestEl = $("mem-best");
    var msg = $("mem-msg"), sizeSel = $("mem-size"), newBtn = $("mem-new");
    if (!grid) return {};
    var ICONS = ["🌸", "🌲", "🍃", "🌻", "🍄", "🦋", "🐝", "🌙", "🍀", "🐢"];
    var first = null, lock = false, moves = 0, found = 0, pairs = 8, started = 0, timer = null;

    function fmt(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
    function best() { return store.get("focusMemBest", {})[pairs]; }
    function showBest() { var b = best(); bestEl.textContent = b ? b + " moves" : "–"; }
    function stopTimer() { clearInterval(timer); timer = null; }

    function newGame() {
      stopTimer();
      pairs = Number(sizeSel.value) || 8;
      first = null; lock = false; moves = 0; found = 0; started = 0;
      movesEl.textContent = "0"; timeEl.textContent = "0:00";
      msg.textContent = "Flip two cards at a time and find all the matching pairs.";
      showBest();
      var deck = shuffle(ICONS.slice(0, pairs).concat(ICONS.slice(0, pairs)));
      grid.dataset.size = String(pairs * 2);
      grid.innerHTML = "";
      deck.forEach(function (icon, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mem-card";
        b.dataset.icon = icon;
        b.setAttribute("aria-label", "Hidden card " + (i + 1));
        b.innerHTML = '<span class="mem-inner"><span class="mem-front" aria-hidden="true">🌿</span><span class="mem-back" aria-hidden="true">' + icon + "</span></span>";
        b.addEventListener("click", function () { flip(b); });
        grid.appendChild(b);
      });
    }

    function flip(card) {
      if (lock || card.classList.contains("flipped") || card.classList.contains("matched")) return;
      if (!started) {
        started = Date.now();
        timer = setInterval(function () { timeEl.textContent = fmt(Math.floor((Date.now() - started) / 1000)); }, 500);
      }
      card.classList.add("flipped");
      card.setAttribute("aria-label", card.dataset.icon);
      tone(PENTA[Math.floor(Math.random() * 4)], 0.18, 0.06);
      if (!first) { first = card; return; }
      moves++;
      movesEl.textContent = moves;
      var a = first;
      first = null;
      if (a.dataset.icon === card.dataset.icon) {
        a.classList.add("matched"); card.classList.add("matched");
        found++;
        tone(PENTA[4], 0.25, 0.08); setTimeout(function () { tone(PENTA[6], 0.35, 0.08); }, 120);
        if (found === pairs) win();
      } else {
        lock = true;
        setTimeout(function () {
          a.classList.remove("flipped"); card.classList.remove("flipped");
          a.setAttribute("aria-label", "Hidden card"); card.setAttribute("aria-label", "Hidden card");
          lock = false;
        }, 800);
      }
    }

    function win() {
      stopTimer();
      var secs = Math.floor((Date.now() - started) / 1000);
      var all = store.get("focusMemBest", {}) || {};
      var isBest = !all[pairs] || moves < all[pairs];
      if (isBest) { all[pairs] = moves; store.set("focusMemBest", all); }
      showBest();
      msg.textContent = "🎉 All pairs found in " + moves + " moves and " + fmt(secs) + "!" + (isBest ? " New best!" : "");
      [0, 1, 2, 3].forEach(function (k) { setTimeout(function () { tone(PENTA[k * 2], 0.4, 0.08); }, k * 130); });
    }

    newBtn.addEventListener("click", newGame);
    sizeSel.addEventListener("change", newGame);
    newGame();
    return { hide: stopTimer, show: function () { if (started && found < pairs && !timer) { timer = setInterval(function () { timeEl.textContent = fmt(Math.floor((Date.now() - started) / 1000)); }, 500); } } };
  })();

  /* ===== 2048 ===== */
  games.g2048 = (function () {
    var board = $("g2048-board"), scoreEl = $("g2048-score"), bestEl = $("g2048-best"), msg = $("g2048-msg"), newBtn = $("g2048-new");
    if (!board) return {};
    var N = 4, grid, score, won, over, fresh = -1, merged = [];

    function empty() { var out = []; for (var i = 0; i < N * N; i++) if (!grid[i]) out.push(i); return out; }
    function addTile() {
      var e = empty();
      if (!e.length) return;
      fresh = e[Math.floor(Math.random() * e.length)];
      grid[fresh] = Math.random() < 0.9 ? 2 : 4;
    }

    function render() {
      board.innerHTML = "";
      for (var i = 0; i < N * N; i++) {
        var cell = document.createElement("div");
        var v = grid[i];
        cell.className = "g-cell" + (v ? " t t" + Math.min(v, 4096) : "") + (i === fresh ? " new" : "") + (merged.indexOf(i) !== -1 ? " merged" : "");
        cell.textContent = v || "";
        board.appendChild(cell);
      }
      scoreEl.textContent = score;
      var best = Math.max(score, store.get("focus2048Best", 0));
      store.set("focus2048Best", best);
      bestEl.textContent = best;
    }

    function newGame() {
      grid = new Array(N * N).fill(0);
      score = 0; won = false; over = false; merged = [];
      addTile(); addTile();
      msg.textContent = "Use the arrow keys or swipe. Matching tiles join together — can you reach 2048?";
      render();
    }

    // dir: 0 left, 1 right, 2 up, 3 down
    function move(dir) {
      if (over) return;
      var moved = false;
      merged = [];
      for (var line = 0; line < N; line++) {
        var idx = [];
        for (var k = 0; k < N; k++) {
          var r, c;
          if (dir < 2) { r = line; c = dir === 0 ? k : N - 1 - k; }
          else { c = line; r = dir === 2 ? k : N - 1 - k; }
          idx.push(r * N + c);
        }
        var vals = idx.map(function (i) { return grid[i]; }).filter(Boolean);
        var out = [], mergedAt = [];
        for (var j = 0; j < vals.length; j++) {
          if (j + 1 < vals.length && vals[j] === vals[j + 1]) {
            out.push(vals[j] * 2);
            score += vals[j] * 2;
            mergedAt.push(out.length - 1);
            if (vals[j] * 2 === 2048 && !won) { won = true; setTimeout(function () { msg.textContent = "🎉 You reached 2048! Keep going for a higher score."; }, 50); }
            j++;
          } else out.push(vals[j]);
        }
        while (out.length < N) out.push(0);
        idx.forEach(function (i, p) {
          if (grid[i] !== out[p]) moved = true;
          grid[i] = out[p];
          if (mergedAt.indexOf(p) !== -1) merged.push(i);
        });
      }
      if (!moved) return;
      tone(merged.length ? PENTA[Math.min(7, merged.length + 2)] : 330, merged.length ? 0.2 : 0.08, merged.length ? 0.07 : 0.03);
      addTile();
      if (!canMove()) {
        over = true;
        msg.textContent = "No more moves! Final score: " + score + ". Press New game to try again.";
      }
      render();
    }

    function canMove() {
      if (empty().length) return true;
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        var v = grid[r * N + c];
        if ((c < N - 1 && v === grid[r * N + c + 1]) || (r < N - 1 && v === grid[(r + 1) * N + c])) return true;
      }
      return false;
    }

    var KEYS = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, a: 0, d: 1, w: 2, s: 3 };
    document.addEventListener("keydown", function (e) {
      if (current !== "g2048") return;
      var card = board.closest(".game-card");
      if (!card || !card.contains(document.activeElement)) return; // only when the game is being played
      if (!(e.key in KEYS)) return;
      e.preventDefault();
      move(KEYS[e.key]);
    });

    var sx = 0, sy = 0;
    board.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    board.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : 0); else move(dy > 0 ? 3 : 2);
    });
    board.addEventListener("pointerdown", function () { board.focus({ preventScroll: true }); });

    newBtn.addEventListener("click", function () { newGame(); board.focus({ preventScroll: true }); });
    newGame();
    return { show: function () { board.focus({ preventScroll: true }); }, move: move };
  })();

  /* ===== Bubble Pop ===== */
  games.bubbles = (function () {
    var area = $("bub-area"), countEl = $("bub-count"), timeWrap = $("bub-time-wrap"), timeEl = $("bub-time");
    var bestEl = $("bub-best"), msg = $("bub-msg"), relaxBtn = $("bub-relax"), challengeBtn = $("bub-challenge"), stopBtn = $("bub-stop");
    if (!area) return {};
    var COLORS = ["#5fb883", "#ee8fab", "#6fbde0", "#f2c14e", "#a98be0", "#4fc7a6"];
    var mode = null, spawnTimer = null, clock = null, count = 0, endAt = 0;

    bestEl.textContent = store.get("focusBubbleBest", 0);

    function spawn() {
      var size = 44 + Math.random() * 46;
      var rise = (mode === "challenge" ? 4.5 : 7) + Math.random() * 3;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bubble";
      b.setAttribute("aria-label", "Pop bubble");
      b.style.width = b.style.height = size + "px";
      b.style.left = Math.random() * (area.clientWidth - size) + "px";
      b.style.setProperty("--c", COLORS[Math.floor(Math.random() * COLORS.length)]);
      b.style.setProperty("--rise", (area.clientHeight + size + 20) + "px");
      b.style.setProperty("--drift", (Math.random() * 40 - 20) + "px");
      b.style.animationDuration = rise + "s";
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); pop(b); });
      b.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pop(b); } });
      b.addEventListener("animationend", function (e) { if (e.animationName === "bubble-rise") b.remove(); });
      area.appendChild(b);
    }

    function pop(b) {
      if (b.classList.contains("popped") || !mode) return;
      b.classList.add("popped");
      count++;
      countEl.textContent = count;
      tone(PENTA[Math.floor(Math.random() * PENTA.length)], 0.35, 0.1);
      setTimeout(function () { b.remove(); }, 260);
    }

    function start(m) {
      stop(true);
      mode = m;
      count = 0;
      countEl.textContent = "0";
      area.innerHTML = "";
      relaxBtn.hidden = challengeBtn.hidden = true;
      stopBtn.hidden = false;
      timeWrap.hidden = m !== "challenge";
      spawn();
      spawnTimer = setInterval(spawn, m === "challenge" ? 420 : 750);
      if (m === "challenge") {
        endAt = Date.now() + 60000;
        timeEl.textContent = "60";
        msg.textContent = "Pop as many bubbles as you can in 60 seconds!";
        clock = setInterval(function () {
          var left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
          timeEl.textContent = left;
          if (left === 0) finish();
        }, 200);
      } else {
        msg.textContent = "Relax mode: pop bubbles for as long as you like. 🫧";
      }
    }

    function finish() {
      var popped = count;
      var best = store.get("focusBubbleBest", 0);
      var isBest = popped > best;
      if (isBest) { store.set("focusBubbleBest", popped); bestEl.textContent = popped; }
      stop(true);
      msg.textContent = "⏱ Time's up! You popped " + popped + (popped === 1 ? " bubble." : " bubbles.") + (isBest ? " New best! 🎉" : "");
      [0, 2, 4, 7].forEach(function (k, i) { setTimeout(function () { tone(PENTA[k], 0.4, 0.08); }, i * 140); });
    }

    function stop(silent) {
      clearInterval(spawnTimer); clearInterval(clock);
      spawnTimer = clock = null;
      var wasRelax = mode === "relax";
      mode = null;
      area.querySelectorAll(".bubble").forEach(function (b) { b.classList.add("fade"); setTimeout(function () { b.remove(); }, 400); });
      relaxBtn.hidden = challengeBtn.hidden = false;
      stopBtn.hidden = true;
      timeWrap.hidden = true;
      if (!silent && wasRelax) msg.textContent = "Nice and calm. You popped " + count + (count === 1 ? " bubble" : " bubbles") + ". 🫧";
    }

    relaxBtn.addEventListener("click", function () { start("relax"); });
    challengeBtn.addEventListener("click", function () { start("challenge"); });
    stopBtn.addEventListener("click", function () { stop(false); });
    document.addEventListener("visibilitychange", function () { if (document.hidden && mode) stop(false); });

    return { hide: function () { if (mode) stop(false); } };
  })();
})();
