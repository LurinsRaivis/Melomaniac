const SPOTIFY_CLIENT_ID = "0009ae3fd90c49f891dbba84385a9eca";
const SPOTIFY_REDIRECT_URI = "https://lurinsraivis.github.io/Melomaniac/auth.html";

const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
];

const TOKEN_KEY = "melomaniac:spotify:token";
const AUTH_STATE_KEY = "melomaniac:spotify:state";
const AUTH_VERIFIER_KEY = "melomaniac:spotify:verifier";
const AUTH_REDIRECT_KEY = "melomaniac:spotify:redirect";

let sdkPromise = null;

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ("0" + (b % 36).toString(36)).slice(-1)).join("");
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function loadToken() {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function tokenExpiresAt(token) {
  if (!token?.expires_in || !token?.created_at) return 0;
  return token.created_at + token.expires_in * 1000 - 60000;
}

function isTokenValid(token) {
  return Boolean(token?.access_token && tokenExpiresAt(token) > Date.now());
}

async function refreshToken(token) {
  if (!token?.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: SPOTIFY_CLIENT_ID,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    clearToken();
    return null;
  }

  const next = await res.json();
  const updated = {
    ...token,
    ...next,
    refresh_token: next.refresh_token || token.refresh_token,
    created_at: Date.now(),
  };
  saveToken(updated);
  return updated;
}

async function getAccessToken() {
  const token = loadToken();
  if (isTokenValid(token)) return token.access_token;
  const refreshed = await refreshToken(token);
  return refreshed?.access_token || null;
}

async function startAuth(redirectTo = window.location.href) {
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(16);

  sessionStorage.setItem(AUTH_VERIFIER_KEY, verifier);
  sessionStorage.setItem(AUTH_STATE_KEY, state);
  sessionStorage.setItem(AUTH_REDIRECT_KEY, redirectTo);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES.join(" "),
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error("Spotify token exchange failed.");
  }

  const token = await res.json();
  const stored = {
    ...token,
    created_at: Date.now(),
  };
  saveToken(stored);
  return stored;
}

async function finishAuth() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) throw new Error(error);

  const expectedState = sessionStorage.getItem(AUTH_STATE_KEY);
  if (!state || !expectedState || state !== expectedState) {
    throw new Error("Spotify auth state mismatch.");
  }

  const verifier = sessionStorage.getItem(AUTH_VERIFIER_KEY);
  if (!code || !verifier) {
    throw new Error("Missing Spotify auth data.");
  }

  await exchangeCode(code, verifier);
  const redirectTo = sessionStorage.getItem(AUTH_REDIRECT_KEY);

  sessionStorage.removeItem(AUTH_STATE_KEY);
  sessionStorage.removeItem(AUTH_VERIFIER_KEY);
  sessionStorage.removeItem(AUTH_REDIRECT_KEY);

  return { redirectTo };
}

async function loadSDK() {
  if (window.Spotify) return;
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => reject(new Error("Spotify SDK failed to load."));
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    document.head.appendChild(script);
  });

  return sdkPromise;
}

async function createPlayer({ name = "Melomaniac Host", volume = 0.8 } = {}) {
  await loadSDK();
  const token = await getAccessToken();
  if (!token) throw new Error("Spotify not connected.");

  const player = new window.Spotify.Player({
    name,
    volume,
    getOAuthToken: async (cb) => {
      const fresh = await getAccessToken();
      if (fresh) cb(fresh);
    },
  });

  return player;
}

function isSpotifyTrack(input) {
  if (!input) return false;
  return (
    input.startsWith("spotify:track:") ||
    input.includes("open.spotify.com/track/") ||
    /^[A-Za-z0-9]{22}$/.test(input)
  );
}

function parseTrackId(input) {
  if (!input) return null;
  if (input.startsWith("spotify:track:")) {
    return input.split(":")[2] || null;
  }
  if (input.includes("open.spotify.com/track/")) {
    const match = input.match(/track\/([A-Za-z0-9]{22})/);
    return match ? match[1] : null;
  }
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input;
  return null;
}

async function spotifyFetch(url, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Spotify not connected.");
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error("Spotify request failed.");
  }
  return res.status === 204 ? null : res.json();
}

async function transferPlayback(deviceId) {
  return spotifyFetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
}

async function playTrack(deviceId, trackId) {
  return spotifyFetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    }
  );
}

async function pausePlayback(deviceId) {
  return spotifyFetch(
    `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`,
    { method: "PUT" }
  );
}

window.MelomaniacSpotify = {
  startAuth,
  finishAuth,
  getAccessToken,
  isSpotifyTrack,
  parseTrackId,
  createPlayer,
  transferPlayback,
  playTrack,
  pausePlayback,
  clearToken,
};
