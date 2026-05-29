import {
  getSearchSuggestions as getPipedSuggestions,
  searchAlbums as searchPipedAlbums,
  searchArtists as searchPipedArtists,
  searchPlaylists as searchPipedPlaylists,
  searchTracks as searchPipedTracks,
  type PipedArtist,
  type PipedCollection,
  type PipedTrack,
} from "./piped";

type BackendTrack = {
  videoId?: string;
  title?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  artist?: string;
  thumbnails?: Array<{ url?: string }>;
  thumbnail?: { url?: string } | string;
  duration?: string | number;
  duration_seconds?: number;
  views?: number;
};

type BackendStream = {
  url?: string;
  title?: string;
  duration?: number;
};

export type PlayableSource = {
  src: string;
  duration?: number;
  mode: "stream" | "youtube";
};

const BACKEND_BASE = "https://satriamusic.vercel.app";

function parseDuration(value?: string | number) {
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  if (!value) return 0;

  const parts = value.split(":").map(Number).filter((part) => Number.isFinite(part));
  if (parts.length === 0) return 0;

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function extractVideoId(url: string): string {
  const viMatch = url.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]{11})\//);
  if (viMatch) return viMatch[1];
  const vMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (vMatch) return vMatch[1];
  const proxyMatch = url.match(/[?&](?:url|videoId|id)=([^&]+)/);
  if (proxyMatch) {
    try {
      const decoded = decodeURIComponent(proxyMatch[1]);
      return extractVideoId(decoded);
    } catch {
      return "";
    }
  }
  return "";
}

function upscaleArtwork(url: string) {
  if (!url) return "";

  const isYtThumb =
    url.includes("i.ytimg.com") ||
    url.includes("img.youtube.com") ||
    url.includes("/vi/") ||
    url.includes("/vi_webp/");

  if (isYtThumb) {
    const vid = extractVideoId(url);
    if (vid) return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  }

  return url
    .replace(/=w\d+-h\d+/g, "=w1200-h1200")
    .replace(/=s\d+/g, "=s1200");
}

function pickArtwork(item: BackendTrack) {
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    return upscaleArtwork(item.thumbnails[item.thumbnails.length - 1]?.url || "");
  }

  if (typeof item.thumbnail === "string") {
    return upscaleArtwork(item.thumbnail);
  }

  return upscaleArtwork(item.thumbnail?.url || "");
}

function isBlockedSearchTrack(title: string, artist: string) {
  const target = `${title} ${artist}`.toLowerCase();
  const blocked = [
    "bollywood dj non stop remix(remix by",
    "gym beats vol.4-nonstop-megamix",
    "the gym beats",
  ];

  return blocked.some((item) => target.includes(item));
}

function normalizeBackendTrack(item: BackendTrack, source: PipedTrack["source"]): PipedTrack | null {
  const videoId = item.videoId?.trim();
  if (!videoId) return null;

  const title = item.title?.trim() || item.name?.trim() || "Unknown Title";
  const artist =
    item.artists?.map((entry) => entry.name?.trim()).filter(Boolean).join(", ") || item.artist?.trim() || "Unknown Artist";
  const duration = item.duration_seconds || parseDuration(item.duration);

  return {
    id: videoId,
    title,
    artist,
    artwork: pickArtwork(item) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    plays: item.views,
    source,
  };
}

async function fetchJson<T>(url: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestBackend<T>(path: string) {
  return fetchJson<T>(`${BACKEND_BASE}${path}`);
}

export async function searchTracks(query: string) {
  try {
    const params = new URLSearchParams({ q: query.trim() });
    const results = await requestBackend<BackendTrack[]>(`/api/search?${params.toString()}`);
    const normalized = (Array.isArray(results) ? results : [])
      .map((item) => normalizeBackendTrack(item, "search"))
      .filter((item): item is PipedTrack => Boolean(item))
      .filter((item) => !isBlockedSearchTrack(item.title, item.artist));

    if (normalized.length > 0) return normalized;
  } catch {
    // fallback below
  }

  return (await searchPipedTracks(query)).filter((item) => !isBlockedSearchTrack(item.title, item.artist));
}

export async function getTrendingTracks(region = "ID") {
  try {
    const results = await requestBackend<BackendTrack[]>("/api/trending");
    const normalized = (Array.isArray(results) ? results : [])
      .map((item) => normalizeBackendTrack(item, "trending"))
      .filter((item): item is PipedTrack => Boolean(item));

    if (normalized.length > 0) return normalized;
  } catch {
    // fallback below
  }

  const safeFallback = await searchPipedTracks(region === "ID" ? "top hits indonesia official audio" : "top songs official audio");
  return safeFallback.slice(0, 20);
}

function wrapWithCroxyProxy(url: string): string {
  return `https://www.croxyproxy.com/requests/${encodeURIComponent(url)}`;
}

export async function getTrackPlaybackSource(videoId: string): Promise<PlayableSource> {
  try {
    const params = new URLSearchParams({ id: videoId });
    const result = await requestBackend<BackendStream>(`/api/stream?${params.toString()}`);
    if (result.url) {
      return {
        src: wrapWithCroxyProxy(result.url),
        duration: result.duration,
        mode: "stream",
      };
    }
  } catch {
    // fallback
  }

  return {
    src: `https://www.youtube.com/watch?v=${videoId}`,
    mode: "youtube",
  };
}

export async function getSearchSuggestions(query: string) {
  return getPipedSuggestions(query);
}

export async function searchAlbums(query: string): Promise<PipedCollection[]> {
  return searchPipedAlbums(query);
}

export async function searchPlaylists(query: string): Promise<PipedCollection[]> {
  return searchPipedPlaylists(query);
}

export async function searchArtists(query: string): Promise<PipedArtist[]> {
  return searchPipedArtists(query);
}
