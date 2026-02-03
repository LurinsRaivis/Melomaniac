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
      if (
        contest.selection &&
        contest.selection.topicIndex === tIndex &&
        contest.selection.levelIndex === sIndex
      ) {
        level.classList.add("selected");
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

  status.textContent = contest.selection
    ? `Participants selected: ${contest.topics[contest.selection.topicIndex].label} - Level ${contest.selection.levelIndex + 1}`
    : "No selection yet";

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
      detail.textContent = song.title || song.artist ? `${song.artist} - ${song.title}` : "No song info";
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
  const applyButton = document.querySelector("#apply-slot");
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

  renderBoard(board, contest, {
    onPick: (topicIndex, levelIndex) => {
      selectedTopic = topicIndex;
      selectedLevel = levelIndex;
      loadSlot();
    },
  });

  loadSlot();

  applyButton.onclick = () => {
    saveSlot();
    renderBoard(board, contest, {
      onPick: (topicIndex, levelIndex) => {
        selectedTopic = topicIndex;
        selectedLevel = levelIndex;
        loadSlot();
      },
    });
  };

  clearButton.onclick = () => {
    artistInput.value = "";
    titleInput.value = "";
    urlInput.value = "";
  };

  saveButton.onclick = () => {
    contest.name = nameInput.value.trim() || "Melomaniac";
    saveSlot();
    contest.updatedAt = Date.now();
    updateContest(contest);
    alert("Saved! Host and participants will update automatically.");
  };

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

  window.addEventListener("storage", (event) => {
    if (event.key !== STORE_KEY) return;
    const updated = getContest(contest.id);
    if (!updated) return;
    if (view === "participant") renderParticipant(updated);
    if (view === "host") renderHost(updated);
  });
}

start();
