const STORE_KEY = "melomaniac:contests";
const LAST_CONTEST_KEY = "melomaniac:lastContest";

const DEFAULT_TOPICS = [
  "Ziemassvetki (Mix)",
  "Milas balades (Mix)",
  "Raimonds Pauls (LV)",
  "Roks (Mix)",
  "Slegers (LV)",
  "Deivdesmitie (ENG)",
  "Eirovizijas dziesmas (Mix)",
  "Deju muzika",
  "Laikapstakli (LV)",
  "Skumjais latvietis (LV)",
];

const view = document.body.dataset.view;
const spotify = window.MelomaniacSpotify;

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyConnecting = false;

function uid() {
  return `mc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function darkenHex(hex, amount = 18) {
  if (!hex) return hex;
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const num = parseInt(normalized, 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function loadContests() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function saveContests(contests) {
  localStorage.setItem(STORE_KEY, JSON.stringify(contests));
}

function getContest(id) {
  return loadContests().find((contest) => contest.id === id);
}

function updateContest(nextContest) {
  const contests = loadContests();
  const index = contests.findIndex((contest) => contest.id === nextContest.id);
  if (index === -1) {
    contests.push(nextContest);
  } else {
    contests[index] = nextContest;
  }
  saveContests(contests);
}

function createContest(name = "Melomaniac", id = uid()) {
  const topics = DEFAULT_TOPICS.map((label) => ({
    label,
    songs: Array.from({ length: 5 }, (_, idx) => ({
      level: idx + 1,
      title: "",
      artist: "",
      url: "",
      used: false,
    })),
  }));

  const contest = {
    id,
    name,
    topics,
    selection: null,
    currentPlay: null,
    updatedAt: Date.now(),
  };

  const contests = loadContests();
  contests.push(contest);
  saveContests(contests);
  localStorage.setItem(LAST_CONTEST_KEY, contest.id);
  return contest;
}

function ensureContestId() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("contest");
  if (fromQuery) {
    localStorage.setItem(LAST_CONTEST_KEY, fromQuery);
    return fromQuery;
  }
  const last = localStorage.getItem(LAST_CONTEST_KEY);
  if (last) return last;
  const contest = createContest();
  return contest.id;
}

function setContestId(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("contest", id);
  window.history.replaceState({}, "", url.toString());
  localStorage.setItem(LAST_CONTEST_KEY, id);
}

function syncNav(contestId) {
  const select = document.querySelector("#contest-select");
  const contests = loadContests();
  select.innerHTML = contests
    .map((contest) => `<option value="${contest.id}">${contest.name}</option>`)
    .join("");
  select.value = contestId;

  document.querySelectorAll("[data-nav]").forEach((link) => {
    const target = link.dataset.nav;
    link.href = `${target}.html?contest=${contestId}`;
  });

  document.querySelector("#new-contest").onclick = () => {
    const name = prompt("Contest name?", "Melomaniac") || "Melomaniac";
    const contest = createContest(name);
    setContestId(contest.id);
    window.location.href = `${view}.html?contest=${contest.id}`;
  };

  select.onchange = (event) => {
    const nextId = event.target.value;
    setContestId(nextId);
    window.location.href = `${view}.html?contest=${nextId}`;
  };
}

function renderBoard(container, contest, options = {}) {
  container.innerHTML = "";
  contest.topics.forEach((topic, tIndex) => {
    const card = document.createElement("div");
    card.className = "topic-card";

    const title = document.createElement("div");
    title.className = "topic-title";
    title.textContent = topic.label;

    const levels = document.createElement("div");
    levels.className = "levels";

    topic.songs.forEach((song, sIndex) => {
      const level = document.createElement("div");
      level.className = "level";
      level.textContent = song.level;

      if (song.used) level.classList.add("used");
      if (options.showFilled && song.url) level.classList.add("filled");
      if (
        contest.selection &&
        contest.selection.topicIndex === tIndex &&
        contest.selection.levelIndex === sIndex
      ) {
        level.classList.add("selected");
      }
      if (
        options.selectedSlot &&
        options.selectedSlot.topicIndex === tIndex &&
        options.selectedSlot.levelIndex === sIndex
      ) {
        level.classList.add("setup-selected");
      }

      if (!song.used || options.allowUsedClick) {
        level.onclick = () => {
          const result = options.onPick?.(tIndex, sIndex);
          if (result && typeof result.then === "function") {
            result.catch(() => {});
          }
        };
      }

      levels.appendChild(level);
    });

    card.appendChild(title);
    card.appendChild(levels);

    if (options.showDetails) {
      const detail = document.createElement("div");
      detail.className = "host-detail";
      detail.textContent = "";
      card.appendChild(detail);

      levels.querySelectorAll(".level").forEach((level, idx) => {
        level.onclick = () => {
          const result = options.onPick?.(tIndex, idx, detail);
          if (result && typeof result.then === "function") {
            result.catch(() => {});
          }
        };
      });
    }

    container.appendChild(card);
  });
}

async function updateSpotifyStatus() {
  if (!spotify) return;
  const status = document.querySelector("#spotify-status");
  const connect = document.querySelector("#spotify-connect");
  if (!status || !connect) return;

  const token = await spotify.getAccessToken();
  if (token) {
    status.textContent = "Spotify: connected";
    status.classList.remove("warn");
    status.classList.add("ok");
    connect.textContent = "Reconnect";
  } else {
    status.textContent = "Spotify: not connected";
    status.classList.remove("ok");
    status.classList.add("warn");
    connect.textContent = "Connect Spotify";
  }
}

function setupSpotifyUI() {
  if (!spotify) return;
  const connect = document.querySelector("#spotify-connect");
  if (!connect) return;
  connect.onclick = () => spotify.startAuth(window.location.href);
  updateSpotifyStatus();
  window.addEventListener("focus", updateSpotifyStatus);
  window.addEventListener("storage", (event) => {
    if (event.key === "melomaniac:spotify:token") updateSpotifyStatus();
  });
}

async function ensureSpotifyPlayer() {
  if (!spotify) throw new Error("Spotify not available.");
  if (spotifyDeviceId) return spotifyDeviceId;
  if (spotifyConnecting) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return spotifyDeviceId;
  }
  spotifyConnecting = true;

  spotifyPlayer = await spotify.createPlayer({ name: "Melomaniac Host" });
  spotifyPlayer.addListener("ready", ({ device_id }) => {
    spotifyDeviceId = device_id;
  });
  spotifyPlayer.addListener("not_ready", ({ device_id }) => {
    if (spotifyDeviceId === device_id) spotifyDeviceId = null;
  });

  const connected = await spotifyPlayer.connect();
  if (!connected) {
    spotifyConnecting = false;
    throw new Error("Spotify player failed to connect.");
  }

  const startedAt = Date.now();
  while (!spotifyDeviceId && Date.now() - startedAt < 4000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!spotifyDeviceId) {
    spotifyConnecting = false;
    throw new Error("Spotify device not ready.");
  }

  await spotify.transferPlayback(spotifyDeviceId);
  spotifyConnecting = false;
  return spotifyDeviceId;
}

function renderParticipant(contest) {
  const board = document.querySelector("#board");
  const status = document.querySelector("#now-playing");
  const audio = document.querySelector("#participant-audio");
  const unlockButton = document.querySelector("#unlock-audio");
  const topicColorInput = document.querySelector("#topic-color");
  const levelColorInput = document.querySelector("#level-color");

  const colorKey = `melomaniac:colors:${contest.id}`;
  const applyColors = (topicColor, levelColor) => {
    document.documentElement.style.setProperty("--topic-color", topicColor);
    document.documentElement.style.setProperty("--topic-color-dark", darkenHex(topicColor, 22));
    document.documentElement.style.setProperty("--level-color", levelColor);
    document.documentElement.style.setProperty("--level-color-dark", darkenHex(levelColor, 22));
  };

  if (topicColorInput && levelColorInput) {
    const stored = localStorage.getItem(colorKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.topic) topicColorInput.value = parsed.topic;
        if (parsed?.level) levelColorInput.value = parsed.level;
      } catch (err) {}
    }
    applyColors(topicColorInput.value, levelColorInput.value);

    const handleChange = () => {
      const next = { topic: topicColorInput.value, level: levelColorInput.value };
      localStorage.setItem(colorKey, JSON.stringify(next));
      applyColors(next.topic, next.level);
    };
    topicColorInput.addEventListener("input", handleChange);
    levelColorInput.addEventListener("input", handleChange);
  }

  const audioStateKey = `melomaniac:audio:${contest.id}`;
  let audioUnlocked = sessionStorage.getItem(audioStateKey) === "1";

  unlockButton.onclick = () => {
    audioUnlocked = true;
    sessionStorage.setItem(audioStateKey, "1");
    unlockButton.textContent = "Audio unlocked";
    unlockButton.classList.add("ghost");
  };

  if (audioUnlocked) {
    unlockButton.textContent = "Audio unlocked";
    unlockButton.classList.add("ghost");
  }

  renderBoard(board, contest, {
    onPick: (topicIndex, levelIndex) => {
      contest.selection = {
        topicIndex,
        levelIndex,
        pickedAt: Date.now(),
      };
      contest.updatedAt = Date.now();
      updateContest(contest);
    },
  });

  if (contest.currentPlay) {
    const topic = contest.topics[contest.currentPlay.topicIndex];
    const song = topic.songs[contest.currentPlay.levelIndex];
    status.textContent = `Now playing: ${topic.label} - Level ${song.level}`;
    const isSpotify = spotify?.isSpotifyTrack?.(song.url);
    if (isSpotify) {
      audio.pause();
    } else if (audioUnlocked && song.url && audio.src !== song.url) {
      audio.src = song.url;
      audio.play().catch(() => {
        status.textContent = "Audio is blocked. Click Enable audio.";
      });
    }
  } else {
    status.textContent = "Waiting for host...";
    audio.pause();
  }
}

function renderHost(contest) {
  const board = document.querySelector("#board");
  const status = document.querySelector("#host-status");
  const stopButton = document.querySelector("#stop-play");
  const preview = document.querySelector("#host-audio");

  const selectionText = contest.selection
    ? (() => {
        const topic = contest.topics[contest.selection.topicIndex];
        const song = topic.songs[contest.selection.levelIndex];
        const meta = song.title || song.artist ? ` • ${song.artist} | ${song.title}` : "";
        return `Participants selected: ${topic.label} - Level ${song.level}${meta}`;
      })()
    : "No selection yet";
  status.textContent = selectionText;

  renderBoard(board, contest, {
    showDetails: true,
    allowUsedClick: true,
    onPick: async (topicIndex, levelIndex, detail) => {
      const song = contest.topics[topicIndex].songs[levelIndex];
      if (song.used) {
        const reopen = confirm("This song was already played. Re-enable it?");
        if (reopen) {
          song.used = false;
          contest.updatedAt = Date.now();
          updateContest(contest);
          renderHost(contest);
        }
        return;
      }
      detail.textContent = song.title || song.artist ? `${song.artist} | ${song.title}` : "No song info";
      const trackId = spotify?.parseTrackId?.(song.url);

      if (!song.url) {
        alert("Add a song URL or Spotify track in Setup before playing.");
        return;
      }

      if (trackId) {
        try {
          const deviceId = await ensureSpotifyPlayer();
          await spotify.playTrack(deviceId, trackId);
        } catch (err) {
          alert("Spotify playback failed. Make sure you are logged in with Premium.");
          return;
        }
      } else {
        preview.src = song.url;
        preview.play().catch(() => {});
      }

      song.used = true;
      contest.currentPlay = {
        topicIndex,
        levelIndex,
        startedAt: Date.now(),
      };
      contest.selection = null;
      contest.updatedAt = Date.now();
      updateContest(contest);
      const meta = song.title || song.artist ? ` • ${song.artist} | ${song.title}` : "";
      status.textContent = `Now playing: ${contest.topics[topicIndex].label} - Level ${song.level}${meta}`;
    },
  });

  stopButton.onclick = () => {
    contest.currentPlay = null;
    contest.updatedAt = Date.now();
    updateContest(contest);
    preview.pause();
    if (spotifyDeviceId) {
      spotify.pausePlayback(spotifyDeviceId).catch(() => {});
    }
  };
}

function renderSetup(contest) {
  const nameInput = document.querySelector("#contest-name");
  const saveButton = document.querySelector("#save-setup");
  const board = document.querySelector("#setup-board");
  const topicInput = document.querySelector("#topic-label");
  const levelInput = document.querySelector("#level-number");
  const artistInput = document.querySelector("#song-artist");
  const titleInput = document.querySelector("#song-title");
  const urlInput = document.querySelector("#song-url");
  const clearButton = document.querySelector("#clear-slot");
  const resetUsedButton = document.querySelector("#reset-used");
  const applyButton = document.querySelector("#apply-slot");
  const slotPreview = document.querySelector("#slot-preview");
  const searchInput = document.querySelector("#spotify-query");
  const searchButton = document.querySelector("#spotify-search");
  const results = document.querySelector("#spotify-results");
  const hint = document.querySelector("#spotify-hint");

  let selectedTopic = 0;
  let selectedLevel = 0;

  nameInput.value = contest.name;

  function loadSlot() {
    const topic = contest.topics[selectedTopic];
    const song = topic.songs[selectedLevel];
    topicInput.value = topic.label;
    levelInput.value = `Level ${song.level}`;
    artistInput.value = song.artist || "";
    titleInput.value = song.title || "";
    urlInput.value = song.url || "";
    if (slotPreview) {
      const meta = song.title || song.artist ? `${song.artist} | ${song.title}` : "Empty slot";
      slotPreview.textContent = `Selected: ${topic.label} - Level ${song.level} • ${meta}`;
    }
  }

  function saveSlot() {
    const topic = contest.topics[selectedTopic];
    const song = topic.songs[selectedLevel];
    topic.label = topicInput.value.trim() || topic.label;
    song.artist = artistInput.value.trim();
    song.title = titleInput.value.trim();
    song.url = urlInput.value.trim();
    contest.updatedAt = Date.now();
    updateContest(contest);
  }

  function resetUsed() {
    const song = contest.topics[selectedTopic].songs[selectedLevel];
    if (!song.used) return;
    song.used = false;
    contest.updatedAt = Date.now();
    updateContest(contest);
  }

  function renderSetupBoard() {
    renderBoard(board, contest, {
      showFilled: true,
      selectedSlot: { topicIndex: selectedTopic, levelIndex: selectedLevel },
      onPick: (topicIndex, levelIndex) => {
        selectedTopic = topicIndex;
        selectedLevel = levelIndex;
        loadSlot();
        renderSetupBoard();
      },
    });
  }

  renderSetupBoard();

  loadSlot();

  applyButton.onclick = () => {
    saveSlot();
    renderSetupBoard();
    if (slotPreview) slotPreview.textContent += " • Saved";
  };

  clearButton.onclick = () => {
    artistInput.value = "";
    titleInput.value = "";
    urlInput.value = "";
    saveSlot();
    renderSetupBoard();
    loadSlot();
  };

  if (resetUsedButton) {
    resetUsedButton.onclick = () => {
      resetUsed();
      renderSetupBoard();
      loadSlot();
    };
  }

  saveButton.onclick = () => {
    contest.name = nameInput.value.trim() || "Melomaniac";
    saveSlot();
    contest.updatedAt = Date.now();
    updateContest(contest);
    alert("Saved! Host and participants will update automatically.");
  };

  const liveInputs = [topicInput, artistInput, titleInput, urlInput];
  liveInputs.forEach((input) => {
    input.addEventListener("input", () => {
      saveSlot();
      renderSetupBoard();
      loadSlot();
    });
  });

  if (hint) {
    spotify?.getAccessToken?.().then((token) => {
      hint.textContent = token ? "Search Spotify and click Assign." : "Connect Spotify to search.";
    });
  }

  async function runSearch() {
    if (!spotify) return;
    const query = searchInput.value.trim();
    if (!query) return;
    const token = await spotify.getAccessToken();
    if (!token) {
      spotify.startAuth(window.location.href);
      return;
    }
    results.innerHTML = "";
    hint.textContent = "Searching...";
    try {
      const items = await spotify.searchTracks(query, 12);
      if (!items.length) {
        hint.textContent = "No results. Try a different search.";
        return;
      }
      hint.textContent = "";
      items.forEach((track) => {
        const row = document.createElement("div");
        row.className = "track-row";

        const img = document.createElement("img");
        img.src = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || "";
        img.alt = track.name;

        const meta = document.createElement("div");
        meta.className = "track-meta";
        const title = document.createElement("strong");
        title.textContent = track.name;
        const artist = document.createElement("span");
        artist.textContent = track.artists?.map((a) => a.name).join(", ") || "";
        meta.appendChild(title);
        meta.appendChild(artist);

        const button = document.createElement("button");
        button.className = "ghost";
        button.textContent = "Assign";
        button.onclick = () => {
          artistInput.value = track.artists?.map((a) => a.name).join(", ") || "";
          titleInput.value = track.name || "";
          urlInput.value = track.uri;
          saveSlot();
          renderSetupBoard();
          loadSlot();
        };

        row.appendChild(img);
        row.appendChild(meta);
        row.appendChild(button);
        results.appendChild(row);
      });
    } catch (err) {
      hint.textContent = "Search failed. Check your Spotify login.";
    }
  }

  searchButton.onclick = runSearch;
  searchInput.onkeydown = (event) => {
    if (event.key === "Enter") runSearch();
  };
}

function renderPoints(contest) {
  const list = document.querySelector("#score-list");
  const addButton = document.querySelector("#add-team");
  const resetButton = document.querySelector("#reset-scores");
  const count = document.querySelector("#team-count");
  if (!list || !addButton || !count) return;

  const key = `melomaniac:scores:${contest.id}`;
  const loadScores = () => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (err) {
      return [];
    }
  };

  const saveScores = (scores) => {
    localStorage.setItem(key, JSON.stringify(scores));
  };

  let scores = loadScores();

  function render() {
    list.innerHTML = "";
    count.textContent = String(scores.length);
    scores.forEach((team) => {
      const card = document.createElement("div");
      card.className = "score-card";

      const row = document.createElement("div");
      row.className = "score-row";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = team.name;
      nameInput.placeholder = "Team name";
      nameInput.oninput = () => {
        team.name = nameInput.value;
        saveScores(scores);
      };

      const value = document.createElement("div");
      value.className = "score-value";
      value.textContent = team.points;

      row.appendChild(nameInput);
      row.appendChild(value);

      const actions = document.createElement("div");
      actions.className = "score-actions";

      const add1 = document.createElement("button");
      add1.textContent = "+1";
      add1.onclick = () => {
        team.points += 1;
        value.textContent = team.points;
        saveScores(scores);
      };

      const add3 = document.createElement("button");
      add3.textContent = "+3";
      add3.onclick = () => {
        team.points += 3;
        value.textContent = team.points;
        saveScores(scores);
      };

      const add5 = document.createElement("button");
      add5.textContent = "+5";
      add5.onclick = () => {
        team.points += 5;
        value.textContent = team.points;
        saveScores(scores);
      };

      const sub1 = document.createElement("button");
      sub1.className = "ghost";
      sub1.textContent = "-1";
      sub1.onclick = () => {
        team.points = Math.max(0, team.points - 1);
        value.textContent = team.points;
        saveScores(scores);
      };

      const remove = document.createElement("button");
      remove.className = "ghost";
      remove.textContent = "Remove";
      remove.onclick = () => {
        scores = scores.filter((item) => item.id !== team.id);
        saveScores(scores);
        render();
      };

      actions.appendChild(add1);
      actions.appendChild(add3);
      actions.appendChild(add5);
      actions.appendChild(sub1);
      actions.appendChild(remove);

      card.appendChild(row);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  addButton.onclick = () => {
    scores.push({
      id: uid(),
      name: `Team ${scores.length + 1}`,
      points: 0,
    });
    saveScores(scores);
    render();
  };

  if (resetButton) {
    resetButton.onclick = () => {
      const ok = confirm("Reset all scores to 0?");
      if (!ok) return;
      scores = scores.map((team) => ({ ...team, points: 0 }));
      saveScores(scores);
      render();
    };
  }

  render();
}

function start() {
  const contestId = ensureContestId();
  const contest = getContest(contestId) || createContest("Melomaniac", contestId);
  setContestId(contest.id);
  syncNav(contest.id);
  setupSpotifyUI();

  if (view === "participant") {
    renderParticipant(contest);
  }

  if (view === "host") {
    renderHost(contest);
  }

  if (view === "setup") {
    renderSetup(contest);
  }

  if (view === "points") {
    renderPoints(contest);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== STORE_KEY) return;
    const updated = getContest(contest.id);
    if (!updated) return;
    if (view === "participant") renderParticipant(updated);
    if (view === "host") renderHost(updated);
  });
}

start();
