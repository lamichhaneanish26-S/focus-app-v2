/*JS file for Focus 2.0: timer, Pomodoro cycle, stats, tasks, breathing, sounds, theme, settings, Snake game*/
/* --Last updated: 11/20/2026 00:33 --*/
/*example of a timer function */

/* ===== Focus 2.0: shared helpers ===== */
var FocusStore = {
	get: function (key, fallback) {
		try {
			var v = localStorage.getItem(key);
			return v == null ? fallback : JSON.parse(v);
		} catch (e) { return fallback; }
	},
	set: function (key, value) {
		try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
	}
};

var FocusSettings = (function () {
	var defaults = {
		focus: 25, short: 5, long: 15, every: 4,
		autoBreaks: true, autoFocus: false,
		sound: true, notify: false, reminders: true, keepAwake: true, askSound: true
	};
	var saved = FocusStore.get("focusSettings", {});
	var s = {};
	Object.keys(defaults).forEach(function (k) { s[k] = (saved && k in saved) ? saved[k] : defaults[k]; });
	return {
		get: function (k) { return s[k]; },
		set: function (k, v) { s[k] = v; FocusStore.set("focusSettings", s); },
		all: function () { return s; }
	};
})();

function focusDayKey(d) {
	d = d || new Date();
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ===== Pop-up alerts (notifications) ===== */
var FocusNotify = (function () {
	function supported() {
		try { return "Notification" in window; } catch (e) { return false; }
	}
	return {
		canAsk: function () { return supported() && Notification.permission === "default"; },
		ask: function (done) {
			if (!supported()) { done(false); return; }
			try {
				var p = Notification.requestPermission(function (r) { done(r === "granted"); });
				if (p && p.then) p.then(function (r) { done(r === "granted"); });
			} catch (e) { done(false); }
		},
		send: function (title, body) {
			if (!FocusSettings.get("notify") || !supported() || Notification.permission !== "granted") return;
			var opts = { body: body, icon: "icons/icon-192.png", badge: "icons/favicon-32.png", tag: "focus-timer", renotify: true };
			try {
				if (navigator.serviceWorker && navigator.serviceWorker.controller) {
					navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, opts); });
				} else {
					new Notification(title, opts);
				}
			} catch (e) {
				try { new Notification(title, opts); } catch (e2) { /* not allowed */ }
			}
		}
	};
})();

/* ===== Sounds: timer chime, music, and calm sounds made in the browser (work offline) ===== */
var FocusSounds = (function () {
	var ctx = null, master = null, current = null, currentName = "quiet";
	var NAMES = { music: "Music", rain: "Rain", waves: "Waves", forest: "Forest", brown: "Brown noise", quiet: "Nothing (quiet)" };
	var volume = Number(FocusStore.get("focusVolume", 60));
	var playerBox = document.getElementById("music-player");
	var iframe = document.getElementById("sc-player");
	var widget = null, widgetReady = false, apiLoading = false, wantMusic = false;

	function unlock() {
		try {
			if (!ctx) {
				ctx = new (window.AudioContext || window.webkitAudioContext)();
				master = ctx.createGain();
				master.gain.value = gainFor(volume);
				master.connect(ctx.destination);
			}
			if (ctx.state === "suspended") ctx.resume();
		} catch (e) { ctx = null; }
		return ctx;
	}

	// a little extra boost so the calm sounds are easy to hear
	function gainFor(v) { return Math.pow(v / 100, 1.3) * 1.8; }

	function chime() {
		if (!ctx) return;
		try {
			[659, 784, 988].forEach(function (freq, i) {
				var t = ctx.currentTime + i * 0.35;
				var osc = ctx.createOscillator();
				var g = ctx.createGain();
				osc.type = "sine";
				osc.frequency.value = freq;
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
				g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
				osc.connect(g).connect(ctx.destination);
				osc.start(t);
				osc.stop(t + 1);
			});
		} catch (e) { /* sound is optional */ }
	}

	/* ---- generated sounds ---- */
	function noiseBuffer(kind) {
		var len = ctx.sampleRate * 4;
		var buf = ctx.createBuffer(1, len, ctx.sampleRate);
		var d = buf.getChannelData(0);
		var last = 0, b0 = 0, b1 = 0, b2 = 0;
		for (var i = 0; i < len; i++) {
			var w = Math.random() * 2 - 1;
			if (kind === "brown") {
				last = (last + 0.02 * w) / 1.02;
				d[i] = last * 3.5;
			} else if (kind === "pink") {
				b0 = 0.99765 * b0 + w * 0.099046;
				b1 = 0.963 * b1 + w * 0.2965164;
				b2 = 0.57 * b2 + w * 1.0526913;
				d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
			} else {
				d[i] = w;
			}
		}
		return buf;
	}

	function source(kind) {
		var src = ctx.createBufferSource();
		src.buffer = noiseBuffer(kind);
		src.loop = true;
		return src;
	}

	function lfo(target, rate, depth, base) {
		var o = ctx.createOscillator();
		var g = ctx.createGain();
		o.frequency.value = rate;
		g.gain.value = depth;
		target.value = base;
		o.connect(g).connect(target);
		o.start();
		return o;
	}

	function build(name) {
		var nodes = [], out = ctx.createGain(), timers = [];
		out.connect(master);
		var src, f1, f2, g;
		if (name === "rain") {
			src = source("white");
			f1 = ctx.createBiquadFilter(); f1.type = "highpass"; f1.frequency.value = 800;
			f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = 7500;
			g = ctx.createGain(); g.gain.value = 0.35;
			src.connect(f1).connect(f2).connect(g).connect(out);
			nodes.push(src);
		} else if (name === "waves") {
			src = source("brown");
			f1 = ctx.createBiquadFilter(); f1.type = "lowpass"; f1.frequency.value = 900;
			g = ctx.createGain();
			src.connect(f1).connect(g).connect(out);
			nodes.push(src, lfo(g.gain, 0.09, 0.55, 0.65));
		} else if (name === "forest") {
			src = source("pink");
			f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 500; f1.Q.value = 0.4;
			g = ctx.createGain();
			src.connect(f1).connect(g).connect(out);
			nodes.push(src, lfo(g.gain, 0.05, 0.3, 0.6));
			var chirp = function () {
				if (currentName !== "forest") return;
				var t = ctx.currentTime, base = 2200 + Math.random() * 1500;
				for (var k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
					var o = ctx.createOscillator(), cg = ctx.createGain(), st = t + k * 0.16;
					o.type = "sine";
					o.frequency.setValueAtTime(base, st);
					o.frequency.exponentialRampToValueAtTime(base * 1.35, st + 0.09);
					cg.gain.setValueAtTime(0.0001, st);
					cg.gain.exponentialRampToValueAtTime(0.08, st + 0.02);
					cg.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
					o.connect(cg).connect(out);
					o.start(st); o.stop(st + 0.14);
				}
				timers.push(setTimeout(chirp, 3000 + Math.random() * 6000));
			};
			timers.push(setTimeout(chirp, 1500));
		} else {
			src = source("brown");
			f1 = ctx.createBiquadFilter(); f1.type = "lowpass"; f1.frequency.value = 500;
			g = ctx.createGain(); g.gain.value = 0.8;
			src.connect(f1).connect(g).connect(out);
			nodes.push(src);
		}
		nodes.forEach(function (n) { if (n instanceof AudioBufferSourceNode) n.start(); });
		out.gain.setValueAtTime(0.0001, ctx.currentTime);
		out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.2);
		return { out: out, nodes: nodes, timers: timers };
	}

	function stopGenerated() {
		if (!current) return;
		var c = current;
		current = null;
		c.timers.forEach(clearTimeout);
		try {
			c.out.gain.cancelScheduledValues(ctx.currentTime);
			c.out.gain.setValueAtTime(Math.max(c.out.gain.value, 0.001), ctx.currentTime);
			c.out.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
		} catch (e) {}
		setTimeout(function () {
			c.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
			try { c.out.disconnect(); } catch (e) {}
		}, 700);
	}

	/* ---- music (SoundCloud player, needs internet) ---- */
	function withWidget(cb) {
		if (widget && widgetReady) { cb(); return; }
		if (!iframe) return;
		var make = function () {
			try {
				if (!widget) {
					widget = window.SC.Widget(iframe);
					widget.bind(window.SC.Widget.Events.READY, function () {
						widgetReady = true;
						if (wantMusic) { widget.setVolume(volume); widget.play(); }
					});
				}
			} catch (e) { musicFailed(); }
		};
		if (window.SC && window.SC.Widget) { make(); return; }
		if (apiLoading) return;
		apiLoading = true;
		var sc = document.createElement("script");
		sc.src = "https://w.soundcloud.com/player/api.js";
		sc.onload = make;
		sc.onerror = function () { apiLoading = false; musicFailed(); };
		document.head.appendChild(sc);
	}

	function musicFailed() {
		if (currentName !== "music") return;
		setNowPlaying("Music isn't available offline. Try Rain or Waves 🌧️");
	}

	function startMusic() {
		wantMusic = true;
		if (playerBox) playerBox.hidden = false;
		if (!navigator.onLine) { musicFailed(); return; }
		withWidget(function () { widget.setVolume(volume); widget.play(); });
	}

	function stopMusic() {
		wantMusic = false;
		if (widget && widgetReady) { try { widget.pause(); } catch (e) {} }
		if (playerBox) playerBox.hidden = true;
	}

	/* ---- choosing a sound ---- */
	function setNowPlaying(text) {
		document.querySelectorAll(".now-playing-name").forEach(function (el) { el.textContent = text; });
	}

	function renderButtons() {
		document.querySelectorAll(".sound-btn").forEach(function (b) {
			var on = b.dataset.sound === currentName;
			b.classList.toggle("active", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		});
		setNowPlaying(NAMES[currentName] || NAMES.quiet);
	}

	function select(name) {
		if (!NAMES[name]) name = "quiet";
		if (name === currentName && name !== "quiet") name = "quiet"; // tap again to turn off
		stopGenerated();
		if (name !== "music") stopMusic();
		currentName = name;
		if (name === "music") startMusic();
		else if (name !== "quiet" && unlock()) current = build(name);
		renderButtons();
		if (name === "music" && !navigator.onLine) musicFailed();
	}

	function setVolume(v) {
		volume = Math.max(0, Math.min(100, Math.round(v)));
		FocusStore.set("focusVolume", volume);
		if (master) master.gain.value = gainFor(volume);
		if (widget && widgetReady) { try { widget.setVolume(volume); } catch (e) {} }
		document.querySelectorAll(".sound-volume").forEach(function (el) { if (Number(el.value) !== volume) el.value = volume; });
		document.querySelectorAll(".volume-num").forEach(function (el) { el.textContent = volume + "%"; });
	}

	document.querySelectorAll(".sound-btn").forEach(function (btn) {
		btn.addEventListener("click", function () { select(btn.dataset.sound); });
	});
	document.querySelectorAll(".sound-volume").forEach(function (el) {
		el.addEventListener("input", function () { setVolume(Number(el.value)); });
	});
	setVolume(volume);
	renderButtons();

	/* ---- ask which sound to use when the app opens ---- */
	var dialog = document.getElementById("sound-dialog");
	var dontAsk = document.getElementById("sound-dont-ask");
	function askOnOpen() {
		if (!dialog || !FocusSettings.get("askSound")) return;
		if (new URLSearchParams(location.search).get("start")) return; // opened from a shortcut
		try {
			if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
		} catch (e) { return; }
		// picking a sound in the window closes it
		dialog.querySelectorAll(".sound-btn").forEach(function (btn) {
			btn.addEventListener("click", function () { setTimeout(function () { if (dialog.open) dialog.close(); }, 250); });
		});
		dialog.addEventListener("close", function () {
			if (dontAsk && dontAsk.checked) {
				FocusSettings.set("askSound", false);
				if (typeof FocusSettingsUI !== "undefined") FocusSettingsUI.sync();
			}
		});
	}

	return { unlock: unlock, chime: chime, select: select, askOnOpen: askOnOpen, playing: function () { return currentName; } };
})();

/* ===== Study stats: minutes per day, week total, streak, 7-day chart ===== */
var FocusStats = (function () {
	var todayEl = document.getElementById("stat-today");
	var weekEl = document.getElementById("stat-week");
	var streakEl = document.getElementById("stat-streak");
	var sessEl = document.getElementById("stat-sessions");
	var chartEl = document.getElementById("week-chart");
	var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	function log() { return FocusStore.get("focusLog", {}) || {}; }

	function add(minutes) {
		var l = log(), k = focusDayKey();
		var day = l[k] || { min: 0, sessions: 0 };
		if (typeof day === "number") day = { min: day, sessions: 0 };
		day.min += Math.max(0, minutes);
		day.sessions += 1;
		l[k] = day;
		FocusStore.set("focusLog", l);
		render();
	}

	function minOf(l, d) { var v = l[focusDayKey(d)]; return v ? (v.min || 0) : 0; }
	function activeOn(l, d) { var v = l[focusDayKey(d)]; return !!v && ((v.min || 0) > 0 || (v.sessions || 0) > 0); }

	function render() {
		var l = log(), now = new Date(), week = 0, days = [];
		for (var i = 6; i >= 0; i--) {
			var d = new Date(now); d.setDate(now.getDate() - i);
			var v = minOf(l, d);
			week += v;
			days.push({ label: i === 0 ? "Today" : DAYS[d.getDay()], min: v });
		}
		// streak: consecutive days with focus time, counting back from today (or yesterday)
		var streak = 0, cur = new Date(now);
		if (!activeOn(l, cur)) cur.setDate(cur.getDate() - 1);
		while (activeOn(l, cur)) { streak++; cur.setDate(cur.getDate() - 1); }

		var today = l[focusDayKey()] || { min: 0, sessions: 0 };
		if (todayEl) todayEl.textContent = today.min || 0;
		if (weekEl) weekEl.textContent = week;
		if (streakEl) streakEl.textContent = streak;
		if (sessEl) sessEl.textContent = today.sessions || 0;

		if (chartEl) {
			var max = Math.max(25, Math.max.apply(null, days.map(function (x) { return x.min; })));
			chartEl.innerHTML = days.map(function (x) {
				var pct = Math.round((x.min / max) * 100);
				return '<div class="bar-col" title="' + x.label + ": " + x.min + ' min">' +
					'<span class="bar-val">' + (x.min ? x.min : "") + "</span>" +
					'<div class="bar-track"><div class="bar" style="height:' + pct + '%"></div></div>' +
					'<span class="bar-label">' + x.label + "</span></div>";
			}).join("");
		}
	}

	function reset() {
		FocusStore.set("focusLog", {});
		FocusStore.set("focusCycle", { day: focusDayKey(), count: 0 });
		render();
	}

	render();
	return { add: add, render: render, reset: reset };
})();

/* ===== Session to-do list ===== */
(function () {
	var form = document.getElementById("task-form");
	var input = document.getElementById("task-input");
	var list = document.getElementById("task-list");
	var empty = document.getElementById("task-empty");
	var clearBtn = document.getElementById("task-clear");
	if (!form || !list) return;

	var tasks = FocusStore.get("focusTasks", []) || [];

	function save() { FocusStore.set("focusTasks", tasks); }

	function render() {
		list.innerHTML = "";
		tasks.forEach(function (t) {
			var li = document.createElement("li");
			li.className = "task" + (t.done ? " done" : "");

			var label = document.createElement("label");
			var box = document.createElement("input");
			box.type = "checkbox";
			box.checked = t.done;
			box.addEventListener("change", function () { t.done = box.checked; save(); render(); });
			var span = document.createElement("span");
			span.textContent = t.text;
			label.appendChild(box);
			label.appendChild(span);

			var del = document.createElement("button");
			del.type = "button";
			del.className = "task-del";
			del.setAttribute("aria-label", "Delete task: " + t.text);
			del.textContent = "✕";
			del.addEventListener("click", function () {
				tasks = tasks.filter(function (x) { return x !== t; });
				save(); render();
			});

			li.appendChild(label);
			li.appendChild(del);
			list.appendChild(li);
		});
		if (empty) empty.hidden = tasks.length > 0;
		if (clearBtn) clearBtn.hidden = !tasks.some(function (t) { return t.done; });
	}

	form.addEventListener("submit", function (e) {
		e.preventDefault();
		var text = input.value.trim();
		if (!text) return;
		tasks.push({ text: text, done: false });
		input.value = "";
		save(); render();
		input.focus();
	});

	if (clearBtn) clearBtn.addEventListener("click", function () {
		tasks = tasks.filter(function (t) { return !t.done; });
		save(); render();
	});

	render();
})();

/* ===== Breathing guide (works offline) ===== */
(function () {
	var circle = document.getElementById("breath-circle");
	var phaseEl = document.getElementById("breath-phase");
	var countEl = document.getElementById("breath-count");
	var startBtn = document.getElementById("breath-start");
	var patternEl = document.getElementById("breath-pattern");
	var roundsEl = document.getElementById("breath-rounds");
	if (!circle || !startBtn) return;

	var PATTERNS = {
		box: [["Breathe in", 4, "grow"], ["Hold", 4, "hold"], ["Breathe out", 4, "shrink"], ["Hold", 4, "rest"]],
		"478": [["Breathe in", 4, "grow"], ["Hold", 7, "hold"], ["Breathe out", 8, "shrink"]],
		calm: [["Breathe in", 4, "grow"], ["Breathe out", 6, "shrink"]]
	};
	var running = false, step = 0, rounds = 0, timer = null, countTimer = null;

	function setPhase(p) {
		var name = p[0], secs = p[1], kind = p[2];
		phaseEl.textContent = name;
		circle.style.transitionDuration = (kind === "grow" || kind === "shrink") ? secs + "s" : "0.3s";
		circle.classList.toggle("big", kind === "grow" || kind === "hold");
		var left = secs;
		countEl.textContent = left;
		clearInterval(countTimer);
		countTimer = setInterval(function () {
			left -= 1;
			if (left > 0) countEl.textContent = left;
		}, 1000);
		timer = setTimeout(next, secs * 1000);
	}

	function next() {
		var pat = PATTERNS[patternEl.value] || PATTERNS.box;
		step += 1;
		if (step >= pat.length) {
			step = 0;
			rounds += 1;
			roundsEl.textContent = rounds + (rounds === 1 ? " round" : " rounds") + " done";
		}
		setPhase(pat[step]);
	}

	function stop() {
		running = false;
		clearTimeout(timer);
		clearInterval(countTimer);
		circle.style.transitionDuration = "1s";
		circle.classList.remove("big");
		phaseEl.textContent = rounds ? "Nice work 🌿" : "Ready";
		countEl.textContent = "";
		startBtn.textContent = "▶ Start";
	}

	startBtn.addEventListener("click", function () {
		if (running) { stop(); return; }
		running = true;
		step = 0;
		rounds = 0;
		roundsEl.textContent = "Follow the circle";
		startBtn.textContent = "■ Stop";
		setPhase((PATTERNS[patternEl.value] || PATTERNS.box)[0]);
	});

	patternEl.addEventListener("change", function () { if (running) { stop(); startBtn.click(); } });
})();

/* ===== Dark / light mode ===== */
(function () {
	var btn = document.getElementById("theme-btn");
	var meta = document.querySelector('meta[name="theme-color"]');
	function apply(t) {
		document.documentElement.dataset.theme = t;
		if (btn) {
			btn.textContent = t === "dark" ? "☀️" : "🌙";
			btn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
		}
		if (meta) meta.setAttribute("content", t === "dark" ? "#14241c" : "#285d43");
	}
	apply(document.documentElement.dataset.theme || "light");
	if (btn) btn.addEventListener("click", function () {
		var t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
		FocusStore.set("focusTheme", t);
		apply(t);
	});
	try {
		matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
			if (!FocusStore.get("focusTheme", null)) apply(e.matches ? "dark" : "light");
		});
	} catch (e) { /* older browsers */ }
})();

/* ===== Study Timer with Pomodoro cycle ===== */
var FocusTimer = (function () {
	var startBtn = document.getElementById("start");
	var pauseBtn = document.getElementById("pause");
	var resetBtn = document.getElementById("reset");
	var h = document.getElementById("hour");
	var m = document.getElementById("min");
	var s = document.getElementById("sec");
	var panel = document.getElementById("studying");
	var statusEl = document.getElementById("timer-status");
	var dotsEl = document.getElementById("session-dots");
	var countEl = document.getElementById("session-count");
	var notifyBtn = document.getElementById("notify-btn");
	var tipBox = document.getElementById("break-tip");
	var tipText = document.getElementById("break-tip-text");
	var tipNext = document.getElementById("break-tip-next");
	if (!startBtn || !h || !m || !s) return null;

	var MODE_NAMES = { focus: "Focus", short: "Short break", long: "Long break" };
	var TIPS = [
		"🧍 Stand up and stretch your arms and back.",
		"💧 Drink a glass of water.",
		"👀 Look at something 20 feet away for 20 seconds.",
		"🚶 Take a short walk around the room.",
		"🌬️ Try the breathing guide below for one round.",
		"🍎 Grab a healthy snack.",
		"🪟 Open a window and get some fresh air.",
		"🙆 Roll your shoulders and neck slowly.",
		"📵 Put your phone down and rest your eyes.",
		"🎮 Play one quick round of Snake."
	];

	var mode = "focus";
	var ticker = null;
	var endTime = 0;
	var remaining = 0;      // seconds left while paused
	var setSeconds = 0;     // length of the current session
	var paused = false;
	var baseTitle = document.title;
	var wakeLock = null;
	var cycle = FocusStore.get("focusCycle", { day: focusDayKey(), count: 0 });
	if (cycle.day !== focusDayKey()) cycle = { day: focusDayKey(), count: 0 };

	function pad(n) { return String(n).padStart(2, "0"); }
	function setStatus(t) { if (statusEl) statusEl.textContent = t; }

	function readSeconds() {
		var hh = Math.max(0, Math.min(99, parseInt(h.value, 10) || 0));
		var mm = Math.max(0, parseInt(m.value, 10) || 0);
		var ss = Math.max(0, parseInt(s.value, 10) || 0);
		return hh * 3600 + mm * 60 + ss;
	}

	function show(total) {
		h.value = pad(Math.floor(total / 3600));
		m.value = pad(Math.floor((total % 3600) / 60));
		s.value = pad(total % 60);
	}

	function lengthOf(md) { return Math.round(Number(FocusSettings.get(md)) * 60) || 60; }

	function renderMode() {
		panel.dataset.mode = mode;
		document.querySelectorAll(".mode-tab").forEach(function (b) {
			var on = b.dataset.mode === mode;
			b.classList.toggle("active", on);
			b.setAttribute("aria-selected", on ? "true" : "false");
		});
		var isBreak = mode !== "focus";
		if (tipBox) tipBox.hidden = !(isBreak && FocusSettings.get("reminders"));
		if (isBreak) newTip();
	}

	function renderDots() {
		if (!dotsEl) return;
		var every = Math.max(2, Number(FocusSettings.get("every")) || 4);
		var inSet = cycle.count % every;
		if (cycle.count > 0 && inSet === 0 && mode === "long") inSet = every;
		var html = "";
		for (var i = 0; i < every; i++) html += '<span class="dot' + (i < inSet ? " done" : "") + '">🍅</span>';
		dotsEl.innerHTML = html;
		if (countEl) countEl.textContent = cycle.count + " today";
	}

	function newTip() {
		if (!tipText) return;
		tipText.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
	}

	function setRunning(running) {
		[h, m, s].forEach(function (el) { el.readOnly = running; });
		startBtn.textContent = running ? "▶ Running" : (paused ? "▶ Resume" : "▶ Start");
		startBtn.disabled = running;
		panel.classList.toggle("running", running);
		if (running) keepAwake(); else releaseAwake();
	}

	function saveState() {
		FocusStore.set("focusTimerState", {
			mode: mode, running: !!ticker, endTime: endTime, remaining: remaining,
			setSeconds: setSeconds, paused: paused
		});
	}

	function setMode(md, seconds, quiet) {
		stopTicker();
		mode = md;
		paused = false;
		setSeconds = seconds || lengthOf(md);
		remaining = setSeconds;
		show(setSeconds);
		setRunning(false);
		renderMode();
		renderDots();
		document.title = baseTitle;
		if (!quiet) setStatus(MODE_NAMES[md] + " · " + Math.round(setSeconds / 60) + " min ready. Press Start.");
		saveState();
	}

	function stopTicker() { clearInterval(ticker); ticker = null; }

	function tick() {
		var left = Math.max(0, Math.round((endTime - Date.now()) / 1000));
		show(left);
		document.title = pad(Math.floor(left / 60)) + ":" + pad(left % 60) + " · " + MODE_NAMES[mode];
		if (left === 0) finish();
	}

	function start() {
		FocusSounds.unlock();
		var total = paused ? remaining : readSeconds();
		if (total === 0) {
			setStatus("Set a time first: type it in or pick a quick timer below.");
			m.focus();
			return;
		}
		if (!paused) setSeconds = total;
		paused = false;
		endTime = Date.now() + total * 1000;
		stopTicker();
		ticker = setInterval(tick, 250);
		setRunning(true);
		setStatus(mode === "focus" ? "Focusing… you can switch tabs, the timer keeps going." : MODE_NAMES[mode] + " — relax, you earned it 🌿");
		tick();
		saveState();
	}

	function pause() {
		if (!ticker) return;
		stopTicker();
		remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
		show(remaining);
		paused = true;
		setRunning(false);
		document.title = baseTitle;
		setStatus("Paused. Press Resume to keep going.");
		saveState();
	}

	function reset() {
		setMode(mode, setSeconds || lengthOf(mode), true);
		setStatus("Reset. Press Start when you are ready.");
	}

	function finish(fromRestore) {
		stopTicker();
		paused = false;
		setRunning(false);
		document.title = baseTitle;
		if (FocusSettings.get("sound") && !fromRestore) FocusSounds.chime();

		var every = Math.max(2, Number(FocusSettings.get("every")) || 4);
		if (mode === "focus") {
			cycle.count += 1;
			FocusStore.set("focusCycle", cycle);
			FocusStats.add(Math.round(setSeconds / 60));
			var next = cycle.count % every === 0 ? "long" : "short";
			var mins = Math.round(lengthOf(next) / 60);
			FocusNotify.send("Focus session done! 🎉", "Time for a " + mins + "-minute " + (next === "long" ? "long " : "") + "break.");
			setMode(next, null, true);
			if (FocusSettings.get("autoBreaks") && !fromRestore) {
				start();
				setStatus("🎉 Session " + cycle.count + " done! Your " + mins + "-min break has started.");
			} else {
				setStatus("🎉 Session " + cycle.count + " done! Press Start for your " + mins + "-min break.");
			}
		} else {
			FocusNotify.send("Break's over ⏰", "Ready for your next focus session?");
			setMode("focus", null, true);
			if (FocusSettings.get("autoFocus") && !fromRestore) {
				start();
				setStatus("Break's over. Next focus session has started 🌱");
			} else {
				setStatus("Break's over. Press Start when you're ready to focus 🌱");
			}
		}
		saveState();
	}

	/* Keep the screen on while the timer runs (where supported) */
	function keepAwake() {
		if (!FocusSettings.get("keepAwake") || wakeLock) return;
		try {
			if ("wakeLock" in navigator) {
				navigator.wakeLock.request("screen").then(function (lock) {
					wakeLock = lock;
					lock.addEventListener("release", function () { wakeLock = null; });
				}).catch(function () { /* not allowed right now */ });
			}
		} catch (e) { /* unsupported */ }
	}
	function releaseAwake() {
		if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
	}
	document.addEventListener("visibilitychange", function () {
		if (document.visibilityState === "visible") {
			if (ticker) { keepAwake(); tick(); }
		}
	});

	/* Buttons */
	startBtn.addEventListener("click", start);
	pauseBtn.addEventListener("click", pause);
	resetBtn.addEventListener("click", reset);

	document.querySelectorAll(".mode-tab").forEach(function (b) {
		b.addEventListener("click", function () { setMode(b.dataset.mode); });
	});

	document.querySelectorAll(".preset").forEach(function (btn) {
		btn.addEventListener("click", function () {
			setMode(btn.dataset.mode || "focus", Number(btn.dataset.min) * 60, true);
			setStatus(btn.textContent + " ready. Press Start.");
		});
	});

	[h, m, s].forEach(function (el) {
		el.addEventListener("change", function () {
			if (ticker) return;
			paused = false;
			setSeconds = readSeconds();
			remaining = setSeconds;
			show(setSeconds);
			saveState();
		});
	});

	if (tipNext) tipNext.addEventListener("click", newTip);

	if (notifyBtn) {
		notifyBtn.addEventListener("click", function () {
			FocusNotify.ask(function (ok) {
				FocusSettings.set("notify", ok);
				notifyBtn.hidden = true;
				setStatus(ok ? "🔔 Alerts are on. We'll let you know when time is up." : "Alerts are blocked. You can allow them in your browser settings.");
				FocusSettingsUI.sync();
			});
		});
		notifyBtn.hidden = !FocusNotify.canAsk();
	}

	/* Restore a timer that was running before the page closed */
	function restore() {
		var st = FocusStore.get("focusTimerState", null);
		var params = new URLSearchParams(location.search);
		var shortcut = params.get("start");
		if (shortcut) {
			try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
			setMode(shortcut === "break" ? "short" : "focus");
			start();
			return;
		}
		if (st && MODE_NAMES[st.mode]) {
			mode = st.mode;
			setSeconds = st.setSeconds || lengthOf(mode);
			if (st.running && st.endTime) {
				renderMode(); renderDots();
				if (st.endTime > Date.now()) {
					endTime = st.endTime;
					ticker = setInterval(tick, 250);
					setRunning(true);
					setStatus("Welcome back — your timer kept running.");
					tick();
				} else {
					finish(true);
				}
				return;
			}
			if (st.paused) {
				setMode(mode, setSeconds, true);
				paused = true;
				remaining = st.remaining;
				show(remaining);
				setRunning(false);
				setStatus("Paused. Press Resume to keep going.");
				return;
			}
		}
		setMode(mode, setSeconds || lengthOf(mode), true);
	}

	return {
		restore: restore,
		refresh: function () { if (!ticker && !paused) setMode(mode, null, true); renderDots(); renderMode(); },
		isRunning: function () { return !!ticker; }
	};
})();

/* ===== Settings panel ===== */
var FocusSettingsUI = (function () {
	var dialog = document.getElementById("settings-dialog");
	var openBtn = document.getElementById("settings-btn");
	var resetStats = document.getElementById("stats-reset");
	var NUMBERS = { focus: "set-focus", short: "set-short", long: "set-long", every: "set-every" };
	var CHECKS = {
		autoBreaks: "set-autobreak", autoFocus: "set-autofocus", sound: "set-sound",
		notify: "set-notify", reminders: "set-reminders", keepAwake: "set-awake", askSound: "set-asksound"
	};

	function el(id) { return document.getElementById(id); }

	function sync() {
		Object.keys(NUMBERS).forEach(function (k) { if (el(NUMBERS[k])) el(NUMBERS[k]).value = FocusSettings.get(k); });
		Object.keys(CHECKS).forEach(function (k) { if (el(CHECKS[k])) el(CHECKS[k]).checked = !!FocusSettings.get(k); });
	}

	Object.keys(NUMBERS).forEach(function (k) {
		var input = el(NUMBERS[k]);
		if (!input) return;
		input.addEventListener("change", function () {
			var min = Number(input.min) || 1, max = Number(input.max) || 180;
			var v = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
			input.value = v;
			FocusSettings.set(k, v);
			if (FocusTimer) FocusTimer.refresh();
		});
	});

	Object.keys(CHECKS).forEach(function (k) {
		var box = el(CHECKS[k]);
		if (!box) return;
		box.addEventListener("change", function () {
			if (k === "notify" && box.checked) {
				FocusNotify.ask(function (ok) {
					FocusSettings.set("notify", ok);
					box.checked = ok;
					var nb = el("notify-btn");
					if (nb) nb.hidden = true;
				});
				return;
			}
			FocusSettings.set(k, box.checked);
			if (k === "reminders" && FocusTimer) FocusTimer.refresh();
		});
	});

	if (openBtn && dialog) {
		openBtn.addEventListener("click", function () {
			sync();
			if (typeof dialog.showModal === "function") dialog.showModal();
			else dialog.setAttribute("open", "");
		});
		// click outside the box closes it
		dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
	}

	if (resetStats) {
		var armed = false;
		resetStats.addEventListener("click", function () {
			if (!armed) {
				armed = true;
				resetStats.textContent = "Tap again to erase all stats";
				setTimeout(function () { armed = false; resetStats.textContent = "Reset my stats"; }, 4000);
				return;
			}
			armed = false;
			FocusStats.reset();
			resetStats.textContent = "Stats cleared ✓";
			if (FocusTimer) FocusTimer.refresh();
		});
	}

	sync();
	return { sync: sync };
})();

if (FocusTimer) FocusTimer.restore();
FocusSounds.askOnOpen();


/* ===== Snake Game ===== */

document.addEventListener("DOMContentLoaded", function () {
  const canvas = document.getElementById("snake-canvas");
  // Safely exit if this JS file is loaded on a page without the Snake game
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("snake-score");
  const highScoreEl = document.getElementById("snake-high-score");
  const actionBar = document.getElementById("snake-action-bar");
  const speedSelect = document.getElementById("snake-speed-select");
  const startBtn = document.getElementById("snake-start-btn");

  const gridSize = 20;
  const tileCount = canvas.width / gridSize;

  let snake = [];
  let food = { x: 15, y: 15 };
  let dx = 0;
  let dy = 0;
  let score = 0;
  let highScore = 0;
  try { highScore = Number(localStorage.getItem("snakeHighScore")) || 0; } catch (e) { /* storage blocked */ }
  let gameLoop;
  let isGameOver = false;
  let isGameRunning = false;
  let changingDirection = false;

  highScoreEl.textContent = highScore;


  // Render initial start screen
  function drawStartScreen() {
    ctx.fillStyle = "#11111b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Snake", canvas.width / 2, canvas.height / 2 - 12);

    ctx.font = "15px system-ui, sans-serif";
    ctx.fillStyle = "#a6adc8";
    ctx.fillText("Click 'Start Game' below to play", canvas.width / 2, canvas.height / 2 + 18);
  }

  function startGame() {
    snake = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 }
    ];
    dx = 1;
    dy = 0;
    score = 0;
    isGameOver = false;
    isGameRunning = true;
    scoreEl.textContent = score;
	actionBar.style.display = "none";
    spawnFood();

	const selectSpeed = Number(speedSelect.value);

    if (gameLoop) clearInterval(gameLoop);
    gameLoop = setInterval(update, selectSpeed);
  }


  function update() {
    if (isGameOver || !isGameRunning) return;
    changingDirection = false;

    const head = { x: snake[0].x + dx, y: snake[0].y + dy };

    // Check wall or self collision
    if (
      head.x < 0 || head.x >= tileCount ||
      head.y < 0 || head.y >= tileCount ||
      snake.some(segment => segment.x === head.x && segment.y === head.y)
    ) {
      endGame();
      return;
    }

    snake.unshift(head);

    // Check if food eaten
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = score;
      if (score > highScore) {
        highScore = score;
        highScoreEl.textContent = highScore;
        try { localStorage.setItem("snakeHighScore", highScore); } catch (e) { /* storage blocked */ }
      }
      spawnFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function draw() {
    // Clear board
    ctx.fillStyle = "#11111b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw food
    ctx.fillStyle = "#f38ba8";
    ctx.beginPath();
    ctx.arc(
      food.x * gridSize + gridSize / 2,
      food.y * gridSize + gridSize / 2,
      gridSize / 2 - 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Draw snake
    snake.forEach((segment, index) => {
      ctx.fillStyle = index === 0 ? "#a6e3a1" : "#40a02b";
      ctx.fillRect(
        segment.x * gridSize + 1,
        segment.y * gridSize + 1,
        gridSize - 2,
        gridSize - 2
      );
    });
  }

  function spawnFood() {
    food = {
      x: Math.floor(Math.random() * tileCount),
      y: Math.floor(Math.random() * tileCount)
    };
    // Ensure food doesn't spawn on the snake
    if (snake.some(segment => segment.x === food.x && segment.y === food.y)) {
      spawnFood();
    }
  }

  function endGame() {
    isGameOver = true;
    isGameRunning = false;
    clearInterval(gameLoop);

    ctx.fillStyle = "rgba(17, 17, 27, 0.75)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 32px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Game Over!", canvas.width / 2, canvas.height / 2 - 10);

    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#a6adc8";
    ctx.fillText("Final Score: " + score, canvas.width / 2, canvas.height / 2 + 20);

    startBtn.textContent = "Play Again";
    actionBar.style.display = "flex";
  }

  // Turn the snake (used by arrow keys, swipes and the on-screen buttons)
  function changeDirection(key) {
    if (!isGameRunning || changingDirection) return;

    const goingUp = dy === -1;
    const goingDown = dy === 1;
    const goingRight = dx === 1;
    const goingLeft = dx === -1;

    if (key === "ArrowLeft" && !goingRight) {
      dx = -1; dy = 0;
    } else if (key === "ArrowUp" && !goingDown) {
      dx = 0; dy = -1;
    } else if (key === "ArrowRight" && !goingLeft) {
      dx = 1; dy = 0;
    } else if (key === "ArrowDown" && !goingUp) {
      dx = 0; dy = 1;
    } else {
      return;
    }
    changingDirection = true;
  }

  // Arrow keys
  document.addEventListener("keydown", function (e) {
    if (!isGameRunning) return;

    const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (arrowKeys.includes(e.key)) {
      e.preventDefault();
      changeDirection(e.key);
    }
  });

  // Swipes on the game board
  let touchStartX = 0;
  let touchStartY = 0;

  canvas.addEventListener("touchstart", function (e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  canvas.addEventListener("touchend", function (e) {
    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;
    if (Math.max(Math.abs(diffX), Math.abs(diffY)) < 20) return; // a tap, not a swipe

    if (Math.abs(diffX) > Math.abs(diffY)) {
      changeDirection(diffX > 0 ? "ArrowRight" : "ArrowLeft");
    } else {
      changeDirection(diffY > 0 ? "ArrowDown" : "ArrowUp");
    }
  });

  // On-screen direction buttons
  document.querySelectorAll("#snake-dpad button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      changeDirection(btn.dataset.dir);
    });
  });

  startBtn.addEventListener("click", startGame);

  // Display start screen on load
  drawStartScreen();
});



/* ===== App install support ===== */

// Register the service worker so the app can be installed and open offline.
// (Service workers only run on https:// or http://localhost, not when opening the file directly.)
var swSupported = false;
try { swSupported = "serviceWorker" in navigator && !!navigator.serviceWorker; } catch (e) { /* blocked in sandboxed previews */ }
if (swSupported) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (err) {
      console.log("Service worker not registered:", err);
    });
  });
}

// Show an "Install App" button when the browser says the app can be installed
// (Chrome, Edge and Android). On iPhone/iPad, use Share > Add to Home Screen instead.
let deferredInstallPrompt = null;
const installBtn = document.getElementById("install-btn");

window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn) installBtn.hidden = false;
});

if (installBtn) {
  installBtn.addEventListener("click", async function () {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}

window.addEventListener("appinstalled", function () {
  if (installBtn) installBtn.hidden = true;
});
