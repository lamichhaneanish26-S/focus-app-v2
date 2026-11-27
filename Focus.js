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
	// Inside the Android app, use Android's own notifications (they arrive on time even when locked)
	function nativeNotes() {
		try {
			var C = window.Capacitor;
			if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.LocalNotifications) return C.Plugins.LocalNotifications;
		} catch (e) {}
		return null;
	}
	function supported() {
		try { return "Notification" in window; } catch (e) { return false; }
	}
	var END_ID = 1001, scheduledAt = 0;

	return {
		isNative: function () { return !!nativeNotes(); },
		canAsk: function () {
			if (nativeNotes()) return !FocusSettings.get("notify");
			return supported() && Notification.permission === "default";
		},
		ask: function (done) {
			var N = nativeNotes();
			if (N) {
				N.requestPermissions().then(function (r) { done(r && r.display === "granted"); }).catch(function () { done(false); });
				return;
			}
			if (!supported()) { done(false); return; }
			try {
				var p = Notification.requestPermission(function (r) { done(r === "granted"); });
				if (p && p.then) p.then(function (r) { done(r === "granted"); });
			} catch (e) { done(false); }
		},
		// Android app: book the alert ahead of time for when the timer ends
		scheduleEnd: function (atMs, title, body) {
			var N = nativeNotes();
			if (!N || !FocusSettings.get("notify")) return;
			scheduledAt = atMs;
			N.cancel({ notifications: [{ id: END_ID }] }).catch(function () {}).then(function () {
				return N.schedule({ notifications: [{ id: END_ID, title: title, body: body, schedule: { at: new Date(atMs), allowWhileIdle: true } }] });
			}).catch(function () {});
		},
		cancelEnd: function () {
			var N = nativeNotes();
			scheduledAt = 0;
			if (N) N.cancel({ notifications: [{ id: END_ID }] }).catch(function () {});
		},
		send: function (title, body) {
			if (!FocusSettings.get("notify")) return;
			var N = nativeNotes();
			if (N) {
				// already booked with scheduleEnd? then Android shows it; don't double up
				if (scheduledAt && Date.now() >= scheduledAt - 3000) { scheduledAt = 0; return; }
				N.schedule({ notifications: [{ id: END_ID + 1, title: title, body: body }] }).catch(function () {});
				return;
			}
			if (!supported() || Notification.permission !== "granted") return;
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
	var NAMES = { music: "Music", piano: "Soft piano", ambient: "Ambient", bowls: "Singing bowls", chimes: "Wind chimes", quiet: "Nothing (quiet)" };
	var volume = Number(FocusStore.get("focusVolume", 60));
	var playerBox = document.getElementById("music-player");
	var iframe = null;
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
	function gainFor(v) { return Math.pow(v / 100, 1.5) * 1.6; }

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

	/* ---- calm sounds, made in the browser (work offline) ---- */
	function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

	// a soft "room" echo so the sounds feel spacious
	var reverb = null;
	function getReverb() {
		if (reverb) return reverb;
		var len = Math.floor(ctx.sampleRate * 3.5);
		var ir = ctx.createBuffer(2, len, ctx.sampleRate);
		for (var c = 0; c < 2; c++) {
			var d = ir.getChannelData(c);
			for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
		}
		reverb = ctx.createConvolver();
		reverb.buffer = ir;
		var wet = ctx.createGain();
		wet.gain.value = 0.55;
		reverb.connect(wet).connect(master);
		return reverb;
	}

	// one gentle note: soft start, slow fade
	function note(out, freq, when, opts) {
		opts = opts || {};
		var dur = opts.dur || 3, peak = opts.gain || 0.12, attack = opts.attack || 0.015;
		var g = ctx.createGain();
		var lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = opts.cutoff || 2200;
		g.gain.setValueAtTime(0.0001, when);
		g.gain.exponentialRampToValueAtTime(peak, when + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
		lp.connect(g).connect(out);
		(opts.partials || [[1, 1, "sine"]]).forEach(function (p) {
			var o = ctx.createOscillator();
			var pg = ctx.createGain();
			o.type = p[2] || "sine";
			o.frequency.value = freq * p[0];
			if (p[3]) o.detune.value = p[3];
			pg.gain.value = p[1];
			o.connect(pg).connect(lp);
			o.start(when);
			o.stop(when + dur + 0.1);
		});
	}

	function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
	function rand(a, b) { return a + Math.random() * (b - a); }

	var PENTA = [60, 62, 64, 67, 69, 72, 74, 76];           // C major pentatonic: every note fits together
	var CHORDS = [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 62]]; // Cmaj7, Am7, Fmaj7, G

	function build(name) {
		var out = ctx.createGain(), timers = [];
		out.connect(master);
		out.connect(getReverb());
		var alive = function () { return currentName === name && current && current.out === out; };
		var loop = function (fn, minS, maxS, firstS) {
			var run = function () {
				if (!alive()) return;
				fn();
				timers.push(setTimeout(run, rand(minS, maxS) * 1000));
			};
			timers.push(setTimeout(run, (firstS || 0.2) * 1000));
		};

		if (name === "piano") {
			// slow, soft piano-like notes
			loop(function () {
				var t = ctx.currentTime + 0.05;
				var n = pick(PENTA);
				note(out, midi(n), t, { dur: 4.5, gain: 0.11, cutoff: 1800,
					partials: [[1, 1, "sine"], [2, 0.18, "sine"], [3, 0.05, "sine"]] });
				if (Math.random() < 0.3) {
					note(out, midi(n - 12), t + 0.02, { dur: 5, gain: 0.07, cutoff: 1200,
						partials: [[1, 1, "sine"], [2, 0.12, "sine"]] });
				}
			}, 1.4, 3.2, 0.3);
		} else if (name === "ambient") {
			// warm chords that slowly fade into each other
			var ci = 0;
			loop(function () {
				var t = ctx.currentTime + 0.05;
				CHORDS[ci % CHORDS.length].forEach(function (n, k) {
					note(out, midi(n), t + k * 0.15, { dur: 11, attack: 3.5, gain: 0.045, cutoff: 900,
						partials: [[1, 1, "sine", -5], [1, 1, "sine", 5], [2, 0.15, "triangle"]] });
				});
				ci++;
			}, 8, 8, 0.2);
		} else if (name === "bowls") {
			// singing bowl rings out slowly
			loop(function () {
				var t = ctx.currentTime + 0.05;
				var f = pick([196, 220, 261.63, 293.66]);
				note(out, f, t, { dur: 10, attack: 0.03, gain: 0.12, cutoff: 3000,
					partials: [[1, 1, "sine"], [1.003, 0.8, "sine"], [2.71, 0.25, "sine"], [5.15, 0.06, "sine"]] });
			}, 6, 10, 0.3);
		} else if (name === "chimes") {
			// light, sparse wind chimes
			var CH = [84, 86, 88, 91, 93];
			loop(function () {
				var t = ctx.currentTime + 0.05;
				var count = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 2) : 1;
				for (var k = 0; k < count; k++) {
					note(out, midi(pick(CH)), t + k * rand(0.15, 0.4), { dur: 3.2, attack: 0.005, gain: 0.09, cutoff: 6000,
						partials: [[1, 1, "sine"], [2.76, 0.2, "sine"]] });
				}
			}, 1.2, 3.8, 0.2);
		}
		out.gain.setValueAtTime(0.0001, ctx.currentTime);
		out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
		return { out: out, nodes: [], timers: timers };
	}

	function stopGenerated() {
		if (!current) return;
		var c = current;
		current = null;
		c.timers.forEach(clearTimeout);
		try {
			c.out.gain.cancelScheduledValues(ctx.currentTime);
			c.out.gain.setValueAtTime(Math.max(c.out.gain.value, 0.001), ctx.currentTime);
			c.out.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
		} catch (e) {}
		setTimeout(function () { try { c.out.disconnect(); } catch (e) {} }, 1400);
	}

	/* ---- music: the default track, a playlist link, or the person's own songs ---- */
	var DEFAULT_SC = "https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/soundcloud%253Atracks%253A1476190729&color=%23285d43&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true";
	var music = FocusStore.get("focusMusic", { type: "default" }) || { type: "default" };
	var frame = null, frameKind = null, fileAudio = null, fileIndex = 0, fileList = [];

	// Work out what a pasted link is
	function parseMusicLink(raw) {
		var url;
		try { url = new URL(raw.trim()); } catch (e) { return null; }
		var host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
		if (host === "youtube.com" || host === "youtu.be") {
			var list = url.searchParams.get("list");
			var id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
			if (!id) { var sm = url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/); if (sm) id = sm[1]; }
			if (!id && !list) return null;
			return { type: "youtube", id: id || "", list: list || "", url: raw.trim(), label: list ? "YouTube playlist" : "YouTube video" };
		}
		if (host === "soundcloud.com" || host === "on.soundcloud.com") {
			return { type: "soundcloud", url: raw.trim(), label: /\/sets\//.test(url.pathname) ? "SoundCloud playlist" : "SoundCloud" };
		}
		if (host === "open.spotify.com") {
			var m = url.pathname.match(/(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/);
			if (!m) return null;
			return { type: "spotify", kind: m[1], id: m[2], url: raw.trim(), label: "Spotify " + m[1] };
		}
		return null;
	}

	function embedSrc(src) {
		if (src.type === "youtube") {
			var base = src.id ? "https://www.youtube.com/embed/" + encodeURIComponent(src.id) : "https://www.youtube.com/embed/videoseries";
			var q = "?enablejsapi=1&playsinline=1&rel=0&origin=" + encodeURIComponent(location.origin);
			if (src.list) q += "&list=" + encodeURIComponent(src.list);
			else q += "&loop=1&playlist=" + encodeURIComponent(src.id);
			return base + q;
		}
		if (src.type === "soundcloud") {
			return "https://w.soundcloud.com/player/?url=" + encodeURIComponent(src.url) + "&color=%23285d43&auto_play=false&hide_related=true&show_comments=false&visual=true";
		}
		if (src.type === "spotify") {
			return "https://open.spotify.com/embed/" + src.kind + "/" + src.id + "?utm_source=generator&theme=0";
		}
		return DEFAULT_SC;
	}

	function sourceName() {
		if (music.type === "files") return "Your songs (" + fileList.length + ")";
		if (music.type === "default") return "Focus default track";
		return music.label || "Your link";
	}

	function ytCommand(func, args) {
		if (frame && frame.contentWindow) {
			try { frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*"); } catch (e) {}
		}
	}

	function clearPlayer() {
		if (fileAudio) { fileAudio.pause(); }
		if (frame) { try { frame.src = "about:blank"; } catch (e) {} frame.remove(); }
		frame = null; frameKind = null; widget = null; widgetReady = false;
		if (playerBox) { playerBox.innerHTML = ""; playerBox.className = "music-player"; }
	}

	function showFrame(kind) {
		clearPlayer();
		frameKind = kind;
		frame = document.createElement("iframe");
		frame.id = "sc-player";
		frame.title = "Your music";
		frame.allow = "autoplay; encrypted-media; clipboard-write; picture-in-picture; fullscreen";
		frame.src = kind === "default" ? DEFAULT_SC : embedSrc(music);
		playerBox.className = "music-player kind-" + (kind === "default" ? "soundcloud" : kind);
		playerBox.appendChild(frame);
		iframe = frame;
	}

	/* SoundCloud (default track and SoundCloud links) */
	function withWidget(cb) {
		if (widget && widgetReady) { cb(); return; }
		var make = function () {
			try {
				if (!widget && iframe) {
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
		sc.onload = function () { apiLoading = false; make(); };
		sc.onerror = function () { apiLoading = false; musicFailed(); };
		document.head.appendChild(sc);
	}

	function musicFailed() {
		if (currentName !== "music") return;
		setNowPlaying(music.type === "files" ? "Add some songs first, in Your music below" : "Music needs internet. Try Soft piano 🎹, it works offline");
	}

	/* Songs from the device, saved in the browser's storage (IndexedDB) so they work offline */
	var DB = {
		open: function () {
			return new Promise(function (res, rej) {
				try {
					var r = indexedDB.open("focusMusic", 1);
					r.onupgradeneeded = function () { r.result.createObjectStore("songs", { keyPath: "id", autoIncrement: true }); };
					r.onsuccess = function () { res(r.result); };
					r.onerror = function () { rej(r.error); };
				} catch (e) { rej(e); }
			});
		},
		run: function (mode, fn) {
			return DB.open().then(function (db) {
				return new Promise(function (res, rej) {
					var tx = db.transaction("songs", mode), st = tx.objectStore("songs"), out = fn(st);
					tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
					tx.onerror = function () { rej(tx.error); };
				});
			});
		},
		all: function () { return DB.run("readonly", function (st) { return st.getAll(); }); },
		add: function (song) { return DB.run("readwrite", function (st) { return st.add(song); }); },
		remove: function (id) { return DB.run("readwrite", function (st) { return st.delete(id); }); },
		clear: function () { return DB.run("readwrite", function (st) { return st.clear(); }); }
	};

	function loadFiles() {
		return DB.all().then(function (list) { fileList = list || []; renderMusicUI(); }).catch(function () { fileList = []; renderMusicUI(); });
	}

	function filePlay(index) {
		if (!fileList.length) { musicFailed(); return; }
		fileIndex = (index + fileList.length) % fileList.length;
		var song = fileList[fileIndex];
		if (!fileAudio) {
			fileAudio = new Audio();
			fileAudio.addEventListener("ended", function () { if (wantMusic) filePlay(fileIndex + 1); });
		}
		if (fileAudio.dataset.url) URL.revokeObjectURL(fileAudio.dataset.url);
		var objUrl = URL.createObjectURL(song.blob);
		fileAudio.dataset.url = objUrl;
		fileAudio.src = objUrl;
		fileAudio.volume = volume / 100;
		fileAudio.play().catch(function () {});
		renderFileCard();
	}

	function renderFileCard() {
		if (!playerBox || music.type !== "files") return;
		playerBox.className = "music-player kind-files";
		var song = fileList[fileIndex];
		playerBox.innerHTML =
			'<div class="mini-player"><span class="mini-title"></span>' +
			'<div class="mini-controls"><button type="button" data-act="prev" aria-label="Previous song">⏮</button>' +
			'<button type="button" data-act="toggle" aria-label="Play or pause">' + (fileAudio && !fileAudio.paused ? "⏸" : "▶") + "</button>" +
			'<button type="button" data-act="next" aria-label="Next song">⏭</button></div></div>';
		playerBox.querySelector(".mini-title").textContent = song ? "🎵 " + song.name : "🎵 No songs yet";
		playerBox.querySelectorAll("button").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var act = btn.dataset.act;
				if (act === "prev") filePlay(fileIndex - 1);
				else if (act === "next") filePlay(fileIndex + 1);
				else if (fileAudio) { if (fileAudio.paused) fileAudio.play().catch(function () {}); else fileAudio.pause(); setTimeout(renderFileCard, 50); }
			});
		});
	}

	function startMusic() {
		wantMusic = true;
		if (!playerBox) return;
		playerBox.hidden = false;
		if (music.type === "files") {
			clearPlayer();
			if (!fileList.length) { playerBox.hidden = true; musicFailed(); return; }
			filePlay(fileIndex);
			return;
		}
		if (!navigator.onLine) { musicFailed(); return; }
		var kind = music.type === "default" ? "default" : music.type;
		if (frameKind !== kind || !frame) showFrame(kind);
		if (kind === "default" || kind === "soundcloud") {
			withWidget(function () { widget.setVolume(volume); widget.play(); });
		} else if (kind === "youtube") {
			var go = function () { ytCommand("setVolume", [volume]); ytCommand("playVideo"); };
			frame.addEventListener("load", function () { setTimeout(go, 600); setTimeout(go, 1800); }, { once: true });
			go();
		} else if (kind === "spotify") {
			setNowPlaying("Spotify — press ▶ in the player (bottom right)");
		}
	}

	function stopMusic() {
		wantMusic = false;
		if (fileAudio) fileAudio.pause();
		if (frameKind === "default" || frameKind === "soundcloud") {
			if (widget && widgetReady) { try { widget.pause(); } catch (e) {} }
		} else if (frameKind === "youtube") {
			ytCommand("pauseVideo");
		} else if (frameKind === "spotify") {
			clearPlayer(); // Spotify can only be stopped by closing its player
		}
		if (playerBox) playerBox.hidden = true;
	}

	function musicSetVolume(v) {
		if (fileAudio) fileAudio.volume = v / 100;
		if (widget && widgetReady) { try { widget.setVolume(v); } catch (e) {} }
		if (frameKind === "youtube") ytCommand("setVolume", [v]);
	}

	/* ---- "Your music" controls in the Calm sounds section ---- */
	var linkForm = document.getElementById("music-link-form");
	var linkInput = document.getElementById("music-link");
	var filesInput = document.getElementById("music-files");
	var listEl = document.getElementById("music-file-list");
	var resetBtn = document.getElementById("music-reset");
	var msgEl = document.getElementById("music-msg");
	var srcNameEl = document.getElementById("music-source-name");

	function say(t) { if (msgEl) msgEl.textContent = t; }

	function setMusic(m, note) {
		var wasPlaying = currentName === "music";
		if (wasPlaying) stopMusic();
		clearPlayer();
		music = m;
		FocusStore.set("focusMusic", m);
		renderMusicUI();
		if (note) say(note);
		if (wasPlaying) startMusic();
	}

	function renderMusicUI() {
		if (srcNameEl) srcNameEl.textContent = sourceName();
		if (resetBtn) resetBtn.hidden = music.type === "default";
		if (linkInput && music.url && document.activeElement !== linkInput) linkInput.value = music.url;
		if (listEl) {
			listEl.innerHTML = "";
			fileList.forEach(function (song) {
				var li = document.createElement("li");
				li.className = "music-file";
				var name = document.createElement("span");
				name.textContent = "🎵 " + song.name;
				var del = document.createElement("button");
				del.type = "button";
				del.className = "task-del";
				del.textContent = "✕";
				del.setAttribute("aria-label", "Remove " + song.name);
				del.addEventListener("click", function () {
					var gone = typeof song.id === "string" ? Promise.resolve(fileList = fileList.filter(function (x) { return x !== song; })).then(renderMusicUI) : DB.remove(song.id).then(loadFiles);
					gone.then(function () {
						if (!fileList.length && music.type === "files") setMusic({ type: "default" }, "No songs left — back to the default music.");
					});
				});
				li.appendChild(name);
				li.appendChild(del);
				listEl.appendChild(li);
			});
		}
	}

	if (linkForm) linkForm.addEventListener("submit", function (e) {
		e.preventDefault();
		var parsed = parseMusicLink(linkInput.value || "");
		if (!parsed) { say("That link didn't work. Paste a link from YouTube, SoundCloud or Spotify."); return; }
		setMusic(parsed, "✓ The Music button now plays your " + parsed.label + ".");
		if (currentName !== "music") select("music");
	});

	function addSongs(fileArray) {
		var files = Array.prototype.slice.call(fileArray || []).filter(function (f) {
			return /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(f.name);
		});
		if (!files.length) { say("Those weren't music files. Pick files like MP3, M4A or WAV."); return; }
		say("Saving " + files.length + (files.length === 1 ? " song…" : " songs…"));
		var chain = Promise.resolve();
		files.forEach(function (f) {
			chain = chain.then(function () { return DB.add({ name: f.name.replace(/\.[^.]+$/, ""), blob: f, added: Date.now() }); });
		});
		chain.then(loadFiles).then(function () {
			if (filesInput) filesInput.value = "";
			setMusic({ type: "files" }, "✓ Added " + files.length + (files.length === 1 ? " song" : " songs") + ". They play offline too.");
			if (currentName !== "music") select("music");
		}).catch(function () {
			// storage blocked (e.g. private browsing): still play them for this visit
			fileList = fileList.concat(files.map(function (f, i) { return { id: "tmp" + Date.now() + i, name: f.name.replace(/\.[^.]+$/, ""), blob: f }; }));
			renderMusicUI();
			setMusic({ type: "files" }, "Added " + files.length + " for now. Your browser won't let Focus save them, so add them again next time.");
			if (currentName !== "music") select("music");
		});
	}

	var addBtn = document.getElementById("music-add-btn");
	if (addBtn && filesInput) addBtn.addEventListener("click", function () {
		say("Choose one or more music files…");
		try { filesInput.click(); } catch (e) { say("Your browser can't open files here. Drag songs onto this box instead."); }
	});
	if (filesInput) filesInput.addEventListener("change", function () { addSongs(filesInput.files); });

	// drag and drop songs onto the Your music box
	var dropBox = document.getElementById("my-music");
	if (dropBox) {
		["dragenter", "dragover"].forEach(function (ev) {
			dropBox.addEventListener(ev, function (e) {
				if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) {
					e.preventDefault();
					dropBox.classList.add("dragging");
				}
			});
		});
		["dragleave", "drop"].forEach(function (ev) {
			dropBox.addEventListener(ev, function () { dropBox.classList.remove("dragging"); });
		});
		dropBox.addEventListener("drop", function (e) {
			e.preventDefault();
			if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addSongs(e.dataTransfer.files);
		});
	}
	// a file dropped anywhere else shouldn't open in the tab and replace the app
	window.addEventListener("dragover", function (e) { e.preventDefault(); });
	window.addEventListener("drop", function (e) { if (!dropBox || !dropBox.contains(e.target)) e.preventDefault(); });

	if (resetBtn) resetBtn.addEventListener("click", function () {
		if (linkInput) linkInput.value = "";
		var removeSongs = fileList.length ? DB.clear().then(loadFiles) : Promise.resolve();
		removeSongs.then(function () { setMusic({ type: "default" }, "✓ Back to the default Focus music."); });
	});

	loadFiles();

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
		musicSetVolume(volume);
		document.querySelectorAll(".sound-volume").forEach(function (el) { if (Number(el.value) !== volume) el.value = volume; });
		document.querySelectorAll(".volume-num").forEach(function (el) { el.textContent = volume + "%"; });
	}

	document.querySelectorAll(".sound-btn").forEach(function (btn) {
		btn.addEventListener("click", function () {
			select(btn.dataset.sound);
			FocusStore.set("focusSoundOff", currentName === "quiet");
		});
	});
	document.querySelectorAll(".sound-volume").forEach(function (el) {
		el.addEventListener("input", function () { setVolume(Number(el.value)); });
	});
	setVolume(volume);
	renderButtons();

	/* ---- when the app opens: Music is the default sound ---- */
	var DEFAULT_SOUND = "music";
	var dialog = document.getElementById("sound-dialog");
	var dontAsk = document.getElementById("sound-dont-ask");

	function playDefaultOnFirstTap() {
		// browsers only allow sound after a tap or click, so the default starts on the first one
		var go = function () {
			window.removeEventListener("pointerdown", go, true);
			window.removeEventListener("keydown", go, true);
			if (currentName === "quiet" && FocusStore.get("focusSoundOff", false) !== true) select(DEFAULT_SOUND);
		};
		window.addEventListener("pointerdown", go, true);
		window.addEventListener("keydown", go, true);
	}

	function askOnOpen() {
		if (new URLSearchParams(location.search).get("start")) return; // opened from a shortcut
		if (!dialog || !FocusSettings.get("askSound")) { playDefaultOnFirstTap(); return; }
		var picked = false;
		// show Music as the selected default
		dialog.querySelectorAll(".sound-btn").forEach(function (b) {
			var on = b.dataset.sound === DEFAULT_SOUND;
			b.classList.toggle("active", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		});
		try {
			if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
		} catch (e) { return; }
		// picking a sound plays it and closes the window
		dialog.querySelectorAll(".sound-btn").forEach(function (btn) {
			btn.addEventListener("click", function () {
				picked = true;
				FocusStore.set("focusSoundOff", btn.dataset.sound === "quiet");
				setTimeout(function () { if (dialog.open) dialog.close("picked"); }, 250);
			});
		});
		dialog.addEventListener("close", function () {
			// "Start studying" without picking = play the default (Music)
			if (!picked && dialog.returnValue === "start") {
				FocusStore.set("focusSoundOff", false);
				select(DEFAULT_SOUND);
			}
			if (dontAsk && dontAsk.checked) {
				FocusSettings.set("askSound", false);
				if (typeof FocusSettingsUI !== "undefined") FocusSettingsUI.sync();
			}
		});
	}

	return { unlock: unlock, chime: chime, select: select, askOnOpen: askOnOpen, playing: function () { return currentName; }, _master: function () { return master; } };
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
	// Starts light (the original cherry blossom look); dark only when chosen with the 🌙 button
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
		if (ticker) FocusNotify.cancelEnd();
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
		if (mode === "focus") FocusNotify.scheduleEnd(endTime, "Focus session done! 🎉", "Time for a break.");
		else FocusNotify.scheduleEnd(endTime, "Break's over ⏰", "Ready for your next focus session?");
		setStatus(mode === "focus" ? "Focusing… you can switch tabs, the timer keeps going." : MODE_NAMES[mode] + " — relax, you earned it 🌿");
		tick();
		saveState();
	}

	function pause() {
		if (!ticker) return;
		stopTicker();
		FocusNotify.cancelEnd();
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
    isPaused = false;
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

  // Pause Snake when another game tab is opened
  let isPaused = false;
  function pauseGame() {
    if (!isGameRunning) return;
    clearInterval(gameLoop);
    isGameRunning = false;
    isPaused = true;
    startBtn.textContent = "Resume";
    actionBar.style.display = "flex";
  }
  document.addEventListener("focus:game-hidden", function (e) { if (e.detail === "snake") pauseGame(); });

  startBtn.addEventListener("click", function () {
    if (isPaused) {
      isPaused = false;
      isGameRunning = true;
      actionBar.style.display = "none";
      gameLoop = setInterval(update, Number(speedSelect.value));
      return;
    }
    startGame();
  });

  // Display start screen on load
  drawStartScreen();
});



/* ===== Inside an installed app? (Android app, desktop app, or home-screen app) ===== */
(function () {
	var inApp = false;
	try {
		inApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
			/Electron/i.test(navigator.userAgent) ||
			matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
	} catch (e) {}
	if (inApp) document.documentElement.classList.add("in-app");
})();

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

// One "Install App" button: downloads the right app for this device automatically.
// iPhone and iPad can't download app files outside the App Store, so they get the Add to Home Screen steps.
(function () {
  var installBtn = document.getElementById("install-btn");
  var toast = document.getElementById("install-toast");
  var body = document.getElementById("install-toast-body");
  var closeBtn = document.getElementById("install-toast-close");
  if (!installBtn) return;

  var BASE = "https://github.com/lamichhaneanish26-S/focus-app-v2/releases/latest/download/";
  var FILES = {
    windows: { file: "Focus-Setup.exe", name: "Windows", help: "If Windows says it protected your PC, click <b>More info → Run anyway</b>." },
    mac: { file: "Focus.dmg", name: "Mac", help: "Drag <b>Focus</b> into <b>Applications</b>. If your Mac blocks it, go to <b>System Settings → Privacy &amp; Security → Open Anyway</b>." },
    android: { file: "Focus.apk", name: "Android", help: "If asked, allow your browser to <b>install unknown apps</b>, then tap <b>Install</b>." },
    linux: { file: "Focus.AppImage", name: "Linux", help: "Allow the file to run as a program (right-click → Properties), then open it." }
  };

  function detect() {
    var ua = navigator.userAgent || "";
    var isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/.test(ua) || isIpad) return "ios";
    if (/Android/.test(ua)) return "android";
    if (/CrOS/.test(ua)) return "chromebook";
    if (/Windows/.test(ua)) return "windows";
    if (/Macintosh|Mac OS X/.test(ua)) return "mac";
    if (/Linux/.test(ua)) return "linux";
    return null;
  }

  function showToast(html) {
    if (!toast) return;
    body.innerHTML = html;
    toast.hidden = false;
  }
  if (closeBtn) closeBtn.addEventListener("click", function () { toast.hidden = true; });

  // Chromebooks install the web app itself, using the browser's own install prompt
  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredPrompt = e; });

  installBtn.addEventListener("click", function () {
    var os = detect();
    if (FILES[os] && !navigator.onLine) {
      showToast("<strong>You're offline</strong><p>Connect to the internet to download the Focus app.</p>");
      return;
    }
    if (FILES[os]) {
      var f = FILES[os];
      window.location.href = BASE + f.file;   // starts the download right away
      showToast("<strong>⬇ Downloading Focus for " + f.name + "…</strong>" +
        "<p>When it finishes, open <b>" + f.file + "</b> from your downloads.</p>" +
        "<p class=\"toast-help\">" + f.help + "</p>" +
        "<a href=\"download.html\">Need help or a different device?</a>");
      return;
    }
    if (os === "ios") {
      showToast("<strong>📱 Add Focus to your Home Screen</strong>" +
        "<ol><li>Tap the <b>Share</b> button <span aria-hidden=\"true\">(□↑)</span> in Safari.</li>" +
        "<li>Tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>" +
        "<p class=\"toast-help\">Apple only allows app downloads through the App Store, so iPhone and iPad install Focus this way.</p>");
      return;
    }
    if (os === "chromebook" && deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
      return;
    }
    window.location.href = "download.html";
  });
})();
