import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import ReactPlayer from "react-player";
import { getActiveLyricIndex, getLyrics, parseLrc, type LyricLine } from "./utils/lyrics";
import {
  getSearchSuggestions,
  getTrackPlaybackSource,
  getTrendingTracks,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  searchTracks,
  type PlayableSource,
} from "./utils/musicApi";
import { getPlaylistTracks, type PipedArtist, type PipedCollection, type PipedTrack } from "./utils/piped";

type MainView = "home" | "search" | "library";
type ActiveView = MainView | "artist";

type FeedSection = {
  id: string;
  title: string;
  tracks: PipedTrack[];
};

type SearchBundle = {
  tracks: PipedTrack[];
  albums: PipedCollection[];
  playlists: PipedCollection[];
  artists: PipedArtist[];
};

type ArtistDetail = {
  artist: PipedArtist;
  tracks: PipedTrack[];
  albums: PipedCollection[];
  playlists: PipedCollection[];
};

const QUICK_SEARCHES = ["Hindia", "Membasuh", "Kunto Aji", "Feast", "Pamungkas", "Nadin Amizah"];
const STORAGE_LIKES = "codersmusic-liked";
const STORAGE_RECENT = "codersmusic-recent";
const STORAGE_FAVORITES = "codersmusic-favorites";

const searchCategories = [
  { title: "Pop Indonesia", color: "#c0392b", emoji: "🎤", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=400&q=80" },
  { title: "Galau", color: "#6c3483", emoji: "🌧", image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=400&q=80" },
  { title: "Viral TikTok", color: "#148f77", emoji: "🔥", image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=400&q=80" },
  { title: "Focus Mode", color: "#1a5276", emoji: "🧠", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=400&q=80" },
  { title: "Acoustic", color: "#935116", emoji: "🎸", image: "https://images.unsplash.com/photo-1485579149621-3123dd979885?auto=format&fit=crop&w=400&q=80" },
  { title: "Late Night", color: "#0b4c5f", emoji: "🌙", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=400&q=80" },
  { title: "Santai", color: "#1e6b3c", emoji: "☀️", image: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=400&q=80" },
  { title: "Hip-Hop", color: "#212121", emoji: "🎧", image: "https://images.unsplash.com/photo-1571609860571-a9a3e79ed7e9?auto=format&fit=crop&w=400&q=80" },
];

function formatTime(seconds: number) {
  const safeValue = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeValue / 60);
  const remainingSeconds = String(safeValue % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function dedupeTracks(tracks: PipedTrack[]) {
  const map = new Map<string, PipedTrack>();
  tracks.forEach((track) => {
    if (!map.has(track.id)) map.set(track.id, track);
  });
  return Array.from(map.values());
}

function tryParse<T>(value: string | null, fallback: T) {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanForLyrics(value: string) {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/official/gi, "")
    .replace(/audio/gi, "")
    .replace(/video/gi, "")
    .replace(/lyric/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function primaryArtistName(value: string) {
  return value.split(",")[0]?.trim() || value.trim();
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function artistFromTrack(track: PipedTrack): PipedArtist {
  return {
    id: primaryArtistName(track.artist).toLowerCase().replace(/\s+/g, "-"),
    name: primaryArtistName(track.artist),
    artwork: track.artwork,
    subscribersText: "Artis",
  };
}

function chooseBestArtistMatch(targetName: string, artists: PipedArtist[]) {
  const normalizedTarget = normalizeName(targetName);

  return (
    artists.find((item) => normalizeName(item.name) === normalizedTarget) ||
    artists.find((item) => normalizeName(item.name).startsWith(normalizedTarget)) ||
    artists.find((item) => normalizedTarget.startsWith(normalizeName(item.name))) ||
    artists[0] ||
    null
  );
}

function isTrackFromArtist(track: PipedTrack, artistName: string) {
  const normalizedArtist = normalizeName(artistName);
  const trackArtist = normalizeName(primaryArtistName(track.artist));
  return trackArtist === normalizedArtist || trackArtist.includes(normalizedArtist) || normalizedArtist.includes(trackArtist);
}

function isCollectionFromArtist(item: PipedCollection, artistName: string) {
  const normalizedArtist = normalizeName(artistName);
  const creator = normalizeName(item.creator);
  const title = normalizeName(item.title);
  return creator.includes(normalizedArtist) || title.includes(normalizedArtist);
}

function filterHomeTracks(tracks: PipedTrack[]) {
  const blocked = /\b(yoga|meditation|mantra|bhajan|chant|nursery|kids|children|rhymes|podcast|live|dj set|mix nonstop|remix nonstop|hindi|bollywood|megamix|nonstop|psynth|gym beats)\b/i;
  const blockedTitles = [
    "gym beats vol.4-nonstop-megamix",
    "bollywood dj non stop remix(remix by dj jitesh,psynth)",
    "the gym beats",
  ];

  return tracks.filter((track) => {
    const target = `${track.title} ${track.artist}`.toLowerCase();
    if (blocked.test(target)) return false;
    return !blockedTitles.some((title) => target.includes(title));
  });
}

function HomeIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M4.5 10.4 12 4.7l7.5 5.7V20h-5.2v-5.2h-4.6V20H4.5v-9.6Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="1.9" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
}

function LibraryIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M5.2 4.8h2.5v14.4H5.2zm5.5-1.1h2.5v16.6h-2.5zm5.5 2.2h2.6v12.2h-2.6z" fill="currentColor" /></svg>;
}

function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`heart-icon ${filled ? "is-liked" : ""}`} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20.8 4.9 14c-1.5-1.4-2.4-3.1-2.4-5.3C2.5 5.5 5 3 8.1 3c1.7 0 3.3.8 4.4 2.1C13.6 3.8 15.2 3 16.9 3 20 3 22.5 5.5 22.5 8.7c0 2.2-.9 3.9-2.4 5.3L12 20.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function MusicIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M9 17.5V6.7L19 4v10.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="7" cy="18" r="2.8" stroke="currentColor" strokeWidth="1.8" /><circle cx="17" cy="18" r="2.8" stroke="currentColor" strokeWidth="1.8" /><path d="M9 10.4 19 7.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function BroadcastIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M3.5 9.2a13.8 13.8 0 0 1 17 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M6.8 12.7a8.9 8.9 0 0 1 10.4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M10 16a4.6 4.6 0 0 1 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></svg>;
}

function SpeakerLowIcon() {
  return <svg viewBox="0 0 24 24" className="volume-icon" fill="none"><path d="M11 5 6.6 8.3H4v7.4h2.6L11 19V5Z"></path></svg>;
}

function SpeakerHighIcon() {
  return <svg viewBox="0 0 24 24" className="volume-icon" fill="none"><path d="M10.8 5 6.5 8.3H4v7.4h2.5l4.3 3.3V5Z"></path><path d="M15.2 9.1a4.2 4.2 0 0 1 0 5.8"></path><path d="M18 7a8 8 0 0 1 0 10"></path></svg>;
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="2.4" height="14" rx="1.2" />
      <path d="M18.6 5.4a1 1 0 0 1 .4.8v11.6a1 1 0 0 1-1.55.84L7.6 12.84a1 1 0 0 1 0-1.68l9.85-5.76A1 1 0 0 1 18.6 5.4Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="18.6" y="5" width="2.4" height="14" rx="1.2" />
      <path d="M5.4 5.4a1 1 0 0 0-.4.8v11.6a1 1 0 0 0 1.55.84l9.85-5.76a1 1 0 0 0 0-1.68L6.55 5.4A1 1 0 0 0 5.4 5.4Z" />
    </svg>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24"><path d="M7.2 4.8 19.8 12 7.2 19.2V4.8Z"></path></svg>;
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24"><path d="M6.5 4.8h4.2v14.4H6.5zm6.8 0h4.2v14.4h-4.2z"></path></svg>;
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M6 9.5 12 15l6-5.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>;
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <div className="eq-wrap compact">
      {[0, 140, 280, 420].map((delay, index) => (
        <span key={delay} className={`eq-bar ${active ? "animate" : ""}`} style={{ height: `${10 + index * 4}px`, animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}

function BrandNoteIcon() {
  return <svg viewBox="0 0 24 24" fill="none"><path d="M10 16.8V7.2l8-1.8v9.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="17.4" r="2.6" fill="currentColor" stroke="none" /><circle cx="18" cy="16.6" r="2.6" fill="currentColor" stroke="none" /><path d="M10 10.1 18 8.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function SkeletonRecentList() {
  return (
    <div className="vertical-list">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="skeleton-row">
          <div className="skeleton skeleton-cover" />
          <div className="skeleton-copy">
            <div className="skeleton skeleton-line long" />
            <div className="skeleton skeleton-line short" />
          </div>
          <div className="skeleton skeleton-dot" />
        </div>
      ))}
    </div>
  );
}

function SkeletonHorizontalRow() {
  return (
    <div className="horizontal-scroll">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-card skeleton-card">
          <div className="skeleton skeleton-art" />
          <div className="skeleton skeleton-line long" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

function SkeletonArtistProfile() {
  return (
    <>
      <div className="artist-hero">
        <div className="back-btn skeleton-circle" />
        <div className="artist-hero-meta">
          <div className="artist-hero-img skeleton-circle big" />
          <div className="artist-hero-copy">
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line medium" />
            <div className="skeleton skeleton-line short" />
          </div>
        </div>
      </div>
      <div className="section-container">
        <h2 className="section-title">Populer</h2>
        <SkeletonRecentList />
      </div>
    </>
  );
}

function TrackRow({
  track,
  active,
  onClick,
  onArtistClick,
  right,
}: {
  track: PipedTrack;
  active?: boolean;
  onClick: () => void;
  onArtistClick?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className={`v-item ${active ? "active" : ""}`}>
      <button type="button" className="track-cover-btn" onClick={onClick}>
        <img className="v-img" src={track.artwork} alt={track.title} />
      </button>
      <div className="v-info text-left">
        <button type="button" className="track-title-btn" onClick={onClick}>
          <div className="v-title">{track.title}</div>
        </button>
        <button type="button" className="artist-link-btn" onClick={onArtistClick}>
          <div className="v-sub">{track.artist}</div>
        </button>
      </div>
      <button type="button" className="dots-icon track-right-btn" onClick={onClick}>
        {right}
      </button>
    </div>
  );
}

function HorizontalTrackCard({ track, onClick, onArtistClick }: { track: PipedTrack; onClick: () => void; onArtistClick?: () => void }) {
  return (
    <div className="h-card text-left">
      <button type="button" className="h-card-main" onClick={onClick}>
        <img className="h-img" src={track.artwork} alt={track.title} />
        <div className="h-title">{track.title}</div>
      </button>
      <button type="button" className="artist-link-btn horizontal" onClick={onArtistClick}>
        <div className="h-sub">{track.artist}</div>
      </button>
    </div>
  );
}

function HorizontalCollectionCard({ item, onClick }: { item: PipedCollection; onClick: () => void }) {
  return (
    <button type="button" className="h-card text-left" onClick={onClick}>
      <img className="h-img" src={item.artwork} alt={item.title} />
      <div className="h-title">{item.title}</div>
      <div className="h-sub">{item.creator}</div>
    </button>
  );
}

function HorizontalArtistCard({ artist, onClick }: { artist: PipedArtist; onClick: () => void }) {
  return (
    <button type="button" className="h-card text-left" onClick={onClick}>
      <img className="h-img artist-img" src={artist.artwork} alt={artist.name} />
      <div className="h-title">{artist.name}</div>
      <div className="h-sub">{artist.subscribersText} subscriber</div>
    </button>
  );
}

function PlayerCard({
  track,
  playing,
  liked,
  progress,
  currentTime,
  duration,
  volume,
  loadingStream,
  onClose,
  onTogglePlay,
  onPrev,
  onNext,
  onLike,
  onMenu,
  onArtistClick,
  onSeek,
  onVolume,
}: {
  track: PipedTrack | null;
  playing: boolean;
  liked?: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  loadingStream: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLike: () => void;
  onMenu: () => void;
  onArtistClick?: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
}) {
  return (
    <div className="player-phone-shell">
      <div className="player-grab-bar" />
      <div className="player-modal-header">
        <button type="button" className="player-top-btn" onClick={onClose}><ChevronDownIcon /></button>
        <div className="player-header-text leftish">
          <span>Memainkan Lagu</span>
          <strong>{track?.title || "CodersMusic"}</strong>
        </div>
        <button type="button" className="player-top-btn" onClick={onMenu}><MenuIcon /></button>
      </div>

      <div className="player-card-box">
        <div className="player-card-surface">
          <div className="player-rail desktop-only">
            <button type="button" className="rail-btn" onClick={onLike}><HeartIcon filled={liked} /></button>
            <button type="button" className="rail-btn"><MusicIcon /></button>
            <button type="button" className="rail-btn"><BroadcastIcon /></button>
          </div>

          <div className="player-art-container-ref">
            <img src={track?.artwork || "/images/satriamusic-cover.jpg"} alt={track?.title || "Album Art"} />
          </div>

          <div className="player-track-info-ref left-align">
            <div className="player-track-copy left-align">
              <div className="player-title-ref">{track?.title || "Judul Lagu"}</div>
              <button type="button" className="player-artist-button" onClick={onArtistClick}>
                <div className="player-artist-ref">{track?.artist || "Artis"}</div>
              </button>
            </div>
          </div>

          <div className="progress-container-ref">
            <input
              type="range"
              className="progress-bar-ref music-range"
              value={Math.min(currentTime, duration || track?.duration || 0)}
              min={0}
              max={duration || track?.duration || 0}
              step={0.1}
              onChange={(event) => onSeek(Number(event.target.value))}
              style={{ ["--range-progress" as string]: `${progress}%` }}
            />
            <div className="time-info-ref">
              <span>{formatTime(currentTime)}</span>
              <span>{loadingStream ? "Memuat..." : `-${formatTime(Math.max((duration || track?.duration || 0) - currentTime, 0))}`}</span>
            </div>
          </div>

          <div className="playback-controls-ref">
            <button type="button" className="ghost-player-btn" onClick={onPrev}><PrevIcon /></button>
            <button type="button" className="play-pause-btn-ref" onClick={onTogglePlay}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
            <button type="button" className="ghost-player-btn" onClick={onNext}><NextIcon /></button>
          </div>

          <div className="volume-row-ref">
            <SpeakerLowIcon />
            <input
              type="range"
              className="music-range"
              value={volume}
              min={0}
              max={100}
              onChange={(event) => onVolume(Number(event.target.value))}
              style={{ ["--range-progress" as string]: `${volume}%` }}
            />
            <SpeakerHighIcon />
          </div>

          <div className="airplay-pill-wrap">
            <div className="airplay-pill">
              <BrandNoteIcon />
              <span>CodersMusic</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export default function App() {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const lyricRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  const [activeView, setActiveView] = useState<ActiveView>("home");
  const [returnView, setReturnView] = useState<MainView>("home");
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerMenuOpen, setPlayerMenuOpen] = useState(false);

  const [homeSections, setHomeSections] = useState<FeedSection[]>([]);
  const [albumRows, setAlbumRows] = useState<PipedCollection[]>([]);
  const [playlistRows, setPlaylistRows] = useState<PipedCollection[]>([]);
  const [artistRows, setArtistRows] = useState<PipedArtist[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<SearchBundle>({ tracks: [], albums: [], playlists: [], artists: [] });
  const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [isHomeLoading, setIsHomeLoading] = useState(true);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [homeError, setHomeError] = useState("");
  const [searchMessage, setSearchMessage] = useState("");

  const [currentTrack, setCurrentTrack] = useState<PipedTrack | null>(null);
  const [activeQueue, setActiveQueue] = useState<PipedTrack[]>([]);
  const [queueTitle, setQueueTitle] = useState("CodersMusic");
  const [likedTracks, setLikedTracks] = useState<Record<string, boolean>>({});
  const [favoriteTracks, setFavoriteTracks] = useState<PipedTrack[]>([]);
  const [recentPlayed, setRecentPlayed] = useState<PipedTrack[]>([]);
  const [playbackSource, setPlaybackSource] = useState<PlayableSource | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(78);

  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [plainLyrics, setPlainLyrics] = useState("");
  const [syncedLyrics, setSyncedLyrics] = useState("");

  const playerBackground = currentTrack?.artwork || recentPlayed[0]?.artwork || "/images/satriamusic-cover.jpg";
  const visibleLyrics = useMemo<LyricLine[]>(() => {
    const synced = parseLrc(syncedLyrics);
    if (synced.length > 0) return synced;
    return plainLyrics
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text, index) => ({ time: index * 4, text }));
  }, [plainLyrics, syncedLyrics]);
  const activeLyricIndex = useMemo(() => getActiveLyricIndex(visibleLyrics, currentTime), [visibleLyrics, currentTime]);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const masterQueue = useMemo(
    () => dedupeTracks([...recentPlayed, ...homeSections.flatMap((section) => section.tracks), ...searchResults.tracks]),
    [homeSections, recentPlayed, searchResults.tracks],
  );

  const likedList = useMemo(() => masterQueue.filter((track) => likedTracks[track.id]), [likedTracks, masterQueue]);
  const recentList = recentPlayed.length > 0 ? recentPlayed.slice(0, 6) : homeSections[0]?.tracks.slice(0, 6) || [];

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") return;
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    setLikedTracks(tryParse<Record<string, boolean>>(localStorage.getItem(STORAGE_LIKES), {}));
    setFavoriteTracks(tryParse<PipedTrack[]>(localStorage.getItem(STORAGE_FAVORITES), []));
    setRecentPlayed(tryParse<PipedTrack[]>(localStorage.getItem(STORAGE_RECENT), []));

  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_LIKES, JSON.stringify(likedTracks));
  }, [likedTracks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_FAVORITES, JSON.stringify(favoriteTracks));
  }, [favoriteTracks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_RECENT, JSON.stringify(recentPlayed.slice(0, 12)));
  }, [recentPlayed]);

  useEffect(() => {
    let cancelled = false;

    const loadHome = async () => {
      setIsHomeLoading(true);
      setHomeError("");

      try {
        const [anyar, gembira, charts, galau, tiktok, hits, globalPop, albums, playlists, artistsMain, artistsIndo, artistsGlobal] = await Promise.all([
          searchTracks("baru rilis indonesia official audio"),
          searchTracks("lagu semangat indonesia official audio"),
          getTrendingTracks("ID"),
          searchTracks("lagu galau indonesia official audio"),
          searchTracks("viral tiktok indonesia official audio"),
          searchTracks("top hits indonesia official audio"),
          searchTracks("Justin Bieber Billie Eilish Bruno Mars Taylor Swift Multo official songs"),
          searchAlbums("Hindia"),
          searchPlaylists("This is Hindia"),
          searchArtists("Hindia Justin Bieber Billie Eilish Multo"),
          searchArtists("Hindia Tulus Sheila On 7 Pamungkas Nadin Amizah Kunto Aji"),
          searchArtists("Justin Bieber Billie Eilish Bruno Mars Taylor Swift Olivia Rodrigo The Weeknd"),
        ]);

        if (cancelled) return;

        const safeAnyar = filterHomeTracks(anyar).slice(0, 12);
        const safeGembira = filterHomeTracks(gembira).slice(0, 12);
        const safeCharts = filterHomeTracks(charts).slice(0, 12);
        const safeGalau = filterHomeTracks(galau).slice(0, 12);
        const safeTiktok = filterHomeTracks(tiktok).slice(0, 12);
        const safeHits = filterHomeTracks(hits).slice(0, 12);
        const safeGlobal = filterHomeTracks(globalPop).slice(0, 12);

        setHomeSections([
          { id: "anyar", title: "Rilis Anyar (Baru Rilis)", tracks: safeAnyar },
          { id: "gembira", title: "Gembira & Semangat", tracks: safeGembira },
          { id: "charts", title: "Tangga Lagu Populer", tracks: safeCharts },
          { id: "global", title: "Global Pop Pilihan", tracks: safeGlobal },
          { id: "galau", title: "Galau Terpopuler", tracks: safeGalau },
          { id: "tiktok", title: "Viral TikTok", tracks: safeTiktok },
          { id: "hits", title: "Hit terpopuler hari ini", tracks: safeHits },
        ].filter((section) => section.tracks.length > 0));

        const mergedArtists = new Map<string, PipedArtist>();
        [...artistsIndo, ...artistsGlobal, ...artistsMain].forEach((artist) => {
          if (!mergedArtists.has(artist.name.toLowerCase())) {
            mergedArtists.set(artist.name.toLowerCase(), artist);
          }
        });

        setAlbumRows(albums.slice(0, 10));
        setPlaylistRows(playlists.slice(0, 10));
        setArtistRows(Array.from(mergedArtists.values()).slice(0, 14));

        const fallbackTrack = safeCharts[0] || safeAnyar[0] || safeGembira[0] || safeGlobal[0] || null;
        if (fallbackTrack) {
          setCurrentTrack((previous) => previous ?? fallbackTrack);
          setActiveQueue((previous) => (previous.length > 0 ? previous : safeCharts));
          setQueueTitle((previous) => (previous !== "CodersMusic" ? previous : "Tangga Lagu Populer"));
          setDuration((previous) => previous || fallbackTrack.duration || 0);
        }
      } catch (error) {
        if (cancelled) return;
        setHomeError(error instanceof Error ? error.message : "Gagal memuat home.");
      } finally {
        if (!cancelled) setIsHomeLoading(false);
      }
    };

    void loadHome();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchSuggestions([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void getSearchSuggestions(searchInput)
        .then((items) => setSearchSuggestions(items))
        .catch(() => setSearchSuggestions([]));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    if (!currentTrack) {
      setPlaybackSource(null);
      return;
    }

    let cancelled = false;
    setLoadingStream(true);
    setPlaybackSource({ src: currentTrack.youtubeUrl, mode: "youtube" });
    setDuration(currentTrack.duration || 0);

    void getTrackPlaybackSource(currentTrack.videoId)
      .then((source) => {
        if (cancelled) return;
        setPlaybackSource(source);
        if (source.duration) setDuration(source.duration);
      })
      .catch(() => {
        if (cancelled) return;
        setPlaybackSource({ src: currentTrack.youtubeUrl, mode: "youtube" });
      })
      .finally(() => {
        if (!cancelled) setLoadingStream(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadLyrics = async () => {
      if (!currentTrack) return;
      setLyricsLoading(true);
      try {
        const result = await getLyrics(cleanForLyrics(currentTrack.title), cleanForLyrics(currentTrack.artist));
        if (cancelled) return;
        setPlainLyrics(result.plain);
        setSyncedLyrics(result.synced);
      } catch {
        if (cancelled) return;
        setPlainLyrics("");
        setSyncedLyrics("");
      } finally {
        if (!cancelled) setLyricsLoading(false);
      }
    };
    void loadLyrics();
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    const container = lyricsListRef.current;
    const activeLine = lyricRefs.current[activeLyricIndex];
    if (!container || !activeLine || activeLyricIndex < 0) return;

    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    const lineTop = activeLine.offsetTop;
    const lineBottom = lineTop + activeLine.clientHeight;

    if (lineTop < containerTop + 24 || lineBottom > containerBottom - 24) {
      container.scrollTo({
        top: Math.max(lineTop - container.clientHeight / 2 + activeLine.clientHeight, 0),
        behavior: "smooth",
      });
    }
  }, [activeLyricIndex]);

  useEffect(() => {
    if (!playerOpen) setPlayerMenuOpen(false);
  }, [playerOpen, currentTrack?.id]);

  const openTrack = (track: PipedTrack, queue: PipedTrack[], title: string) => {
    setCurrentTrack(track);
    setActiveQueue(queue);
    setQueueTitle(title);
    setCurrentTime(0);
    setDuration(track.duration || 0);
    setIsPlaying(true);
    setPlayerOpen(true);
    setRecentPlayed((previous) => dedupeTracks([track, ...previous]).slice(0, 12));
  };

  const handleToggleLike = (track: PipedTrack) => {
    setLikedTracks((previous) => ({ ...previous, [track.id]: !previous[track.id] }));
  };

  const handleToggleFavorite = (track: PipedTrack) => {
    setFavoriteTracks((previous) => {
      const exists = previous.some((item) => item.id === track.id);
      return exists ? previous.filter((item) => item.id !== track.id) : [track, ...previous];
    });
  };

  const handleSearch = async (query = searchInput) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setActiveView("search");
    setIsSearchLoading(true);
    setSearchMessage("Mencari lagu, album, playlist, dan artist...");

    try {
      const [tracks, albums, playlists, artists] = await Promise.all([
        searchTracks(trimmed),
        searchAlbums(trimmed),
        searchPlaylists(trimmed),
        searchArtists(trimmed),
      ]);

      setSearchResults({ tracks, albums, playlists, artists });
      setSearchMessage(`Hasil untuk “${trimmed}”. Klik lagu untuk memutar.`);
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : "Pencarian gagal.");
    } finally {
      setIsSearchLoading(false);
      setSearchSuggestions([]);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSearch();
  };

  const openCollection = async (item: PipedCollection) => {
    try {
      const detail = await getPlaylistTracks(item.id);
      setActiveView("search");
      setSearchResults((previous) => ({ ...previous, tracks: detail.tracks }));
      setSearchMessage(`Membuka ${item.type} “${detail.title}”. Klik lagu untuk memutar.`);
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : "Gagal membuka collection.");
    }
  };

  const openArtist = async (artist: PipedArtist) => {
    setReturnView(activeView === "artist" ? "home" : (activeView as MainView));
    setActiveView("artist");
    setArtistLoading(true);
    setArtistDetail({ artist, tracks: [], albums: [], playlists: [] });

    try {
      const [artistMatches, tracks, albums, playlists] = await Promise.all([
        searchArtists(artist.name),
        searchTracks(`${artist.name} official songs`),
        searchAlbums(artist.name),
        searchPlaylists(artist.name),
      ]);

      const resolvedArtist = chooseBestArtistMatch(artist.name, artistMatches) ?? artist;
      const filteredTracks = tracks.filter((item) => isTrackFromArtist(item, resolvedArtist.name));
      const filteredAlbums = albums.filter((item) => isCollectionFromArtist(item, resolvedArtist.name));
      const filteredPlaylists = playlists.filter((item) => isCollectionFromArtist(item, resolvedArtist.name));

      setArtistDetail({
        artist: resolvedArtist,
        tracks: (filteredTracks.length > 0 ? filteredTracks : tracks).slice(0, 12),
        albums: (filteredAlbums.length > 0 ? filteredAlbums : albums).slice(0, 10),
        playlists: (filteredPlaylists.length > 0 ? filteredPlaylists : playlists).slice(0, 10),
      });
    } finally {
      setArtistLoading(false);
    }
  };

  const handleNext = () => {
    const sourceQueue = activeQueue.length > 1 ? activeQueue : masterQueue;
    if (sourceQueue.length === 0) return;
    const currentIndex = sourceQueue.findIndex((item) => item.id === currentTrack?.id);
    const nextIndex = currentIndex === -1 || currentIndex === sourceQueue.length - 1 ? 0 : currentIndex + 1;
    openTrack(sourceQueue[nextIndex], sourceQueue, sourceQueue === activeQueue ? queueTitle : "CodersMusic Mix");
  };

  const handlePrevious = () => {
    const sourceQueue = activeQueue.length > 1 ? activeQueue : masterQueue;
    if (sourceQueue.length === 0) return;
    const currentIndex = sourceQueue.findIndex((item) => item.id === currentTrack?.id);
    const previousIndex = currentIndex <= 0 ? sourceQueue.length - 1 : currentIndex - 1;
    openTrack(sourceQueue[previousIndex], sourceQueue, sourceQueue === activeQueue ? queueTitle : "CodersMusic Mix");
  };

  const handleTogglePlay = () => {
    if (!currentTrack) {
      const fallback = recentList[0] || homeSections[0]?.tracks[0];
      if (fallback) {
        openTrack(fallback, recentList.length > 0 ? recentList : homeSections[0].tracks, "Sering kamu dengarkan");
      }
      return;
    }
    setIsPlaying((previous) => !previous);
  };

  const handleSeek = (value: number) => {
    if (playerRef.current) playerRef.current.currentTime = value;
    setCurrentTime(value);
  };

  return (
    <>

      <div className="app-bg" style={{ backgroundImage: `url(${playerBackground})` }}></div>

      <main className="app-shell">
        <section id="view-home" className={`view-section ${activeView === "home" ? "active" : ""}`}>
          <div className="home-header no-avatar-header">
            <div className="pill active">Semua</div>
            <div className="pill">Musik</div>
            <div className="pill">Podcast</div>
          </div>

          <div className="section-container">
            <h2 className="section-title">Sering kamu dengarkan</h2>
            {recentList.length > 0 ? (
              <div className="vertical-list" id="recentList">
                {recentList.map((track) => (
                  <TrackRow key={track.id} track={track} active={currentTrack?.id === track.id} onClick={() => openTrack(track, recentList, track.title)} onArtistClick={() => void openArtist(artistFromTrack(track))} right={<span className="play-badge">▶</span>} />
                ))}
              </div>
            ) : isHomeLoading ? (
              <SkeletonRecentList />
            ) : (
              <div className="vertical-list"><div className="empty-copy">Belum ada lagu di daftar ini.</div></div>
            )}
          </div>

          {homeError ? <div className="section-container"><div className="empty-copy">{homeError}</div></div> : null}

          {isHomeLoading && homeSections.length === 0 ? (
            <>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="section-container">
                  <h2 className="section-title">Memuat katalog...</h2>
                  <SkeletonHorizontalRow />
                </div>
              ))}
            </>
          ) : (
            <>
              {homeSections.map((section) => (
                <div key={section.id} className="section-container">
                  <h2 className="section-title">{section.title}</h2>
                  <div className="horizontal-scroll">
                    {section.tracks.map((track) => (
                      <HorizontalTrackCard key={track.id} track={track} onClick={() => openTrack(track, section.tracks, track.title)} onArtistClick={() => void openArtist(artistFromTrack(track))} />
                    ))}
                  </div>
                </div>
              ))}

              <div className="section-container">
                <h2 className="section-title">Album dan single populer</h2>
                <div className="horizontal-scroll">
                  {albumRows.map((item) => (
                    <HorizontalCollectionCard key={item.id} item={item} onClick={() => void openCollection(item)} />
                  ))}
                </div>
              </div>

              <div className="section-container">
                <h2 className="section-title">Artis Terpopuler Saat Ini</h2>
                <div className="horizontal-scroll">
                  {artistRows.map((artist) => (
                    <HorizontalArtistCard key={artist.id} artist={artist} onClick={() => void openArtist(artist)} />
                  ))}
                </div>
              </div>

              <div className="section-container">
                <h2 className="section-title">Playlist populer</h2>
                <div className="horizontal-scroll">
                  {playlistRows.map((item) => (
                    <HorizontalCollectionCard key={item.id} item={item} onClick={() => void openCollection(item)} />
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section id="view-search" className={`view-section ${activeView === "search" ? "active" : ""}`}>
          <div className="search-header-container no-avatar-header">
            <h1>Temukan</h1>
          </div>

          <form onSubmit={handleSubmit} className="search-box-wrapper">
            <div className="search-icon-input"><SearchIcon /></div>
            <input type="text" className="search-box" placeholder="Artis, lagu, atau album..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
          </form>

          {searchSuggestions.length > 0 && (
            <div className="section-container">
              <div className="vertical-list">
                {searchSuggestions.map((item) => (
                  <button key={item} type="button" className="search-suggestion" onClick={() => { setSearchInput(item); void handleSearch(item); }}>
                    <SearchIcon />
                    <span>{item}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchResults.tracks.length === 0 && searchResults.artists.length === 0 && !isSearchLoading ? (
            <>
              <div className="search-featured-row">
                {QUICK_SEARCHES.map((item) => (
                  <button key={item} type="button" className="search-feat-chip" onClick={() => { setSearchInput(item); void handleSearch(item); }}>
                    <span>🎵</span>
                    <span>{item}</span>
                  </button>
                ))}
              </div>

              <div className="genre-grid-section">
                <h2 className="section-title">Jelajahi</h2>
                <div className="genre-grid">
                  {searchCategories.map((category) => (
                    <button
                      key={category.title}
                      type="button"
                      className="genre-tile"
                      onClick={() => { setSearchInput(category.title); void handleSearch(category.title); }}
                    >
                      <div className="genre-tile-bg" style={{ backgroundImage: `url(${category.image})` }} />
                      <div className="genre-tile-overlay" style={{ background: `linear-gradient(135deg, ${category.color}99 0%, transparent 60%)` }} />
                      <span className="genre-tile-emoji">{category.emoji}</span>
                      <span className="genre-tile-name">{category.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div id="searchResultsUI">
              <h2 className="section-title">{isSearchLoading ? "Mencari..." : searchMessage || "Hasil pencarian"}</h2>
              {isSearchLoading ? (
                <>
                  <SkeletonRecentList />
                  <div className="section-container">
                    <h2 className="section-title">Artist</h2>
                    <SkeletonHorizontalRow />
                  </div>
                </>
              ) : (
                <>
                  <div className="vertical-list">
                    {searchResults.tracks.map((track) => (
                      <TrackRow key={track.id} track={track} active={currentTrack?.id === track.id} onClick={() => openTrack(track, searchResults.tracks, track.title)} onArtistClick={() => void openArtist(artistFromTrack(track))} right={<span className="play-badge">▶</span>} />
                    ))}
                  </div>

                  {searchResults.artists.length > 0 && (
                    <div className="section-container">
                      <h2 className="section-title">Artist</h2>
                      <div className="horizontal-scroll">
                        {searchResults.artists.map((artist) => (
                          <HorizontalArtistCard key={artist.id} artist={artist} onClick={() => void openArtist(artist)} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section id="view-library" className={`view-section ${activeView === "library" ? "active" : ""}`}>
          <div className="lib-header no-avatar-header">
            <div className="lib-header-left">
              <h1 className="lib-title">Koleksi Kamu</h1>
            </div>
          </div>

          <div className="lib-filters">
            <div className="pill">Disukai</div>
            <div className="pill">Favorit</div>
            <div className="pill">Terakhir</div>
          </div>

          <div className="section-container">
            <h2 className="section-title">Disukai</h2>
            <div className="lib-list" id="libraryFavorites">
              {likedList.map((track) => (
                <button key={track.id} type="button" className="lib-item" onClick={() => openTrack(track, likedList, track.title)}>
                  <img className="lib-item-img" src={track.artwork || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`} alt={track.title} />
                  <div className="lib-item-info">
                    <div className="lib-item-title">{track.title}</div>
                    <div className="lib-item-sub">{track.artist}</div>
                  </div>
                </button>
              ))}
              {likedList.length === 0 && <div className="empty-copy">Belum ada lagu disukai.</div>}
            </div>
          </div>

          <div className="section-container">
            <h2 className="section-title">Favorit</h2>
            <div className="lib-list" id="libraryFavoritesSaved">
              {favoriteTracks.map((track) => (
                <button key={`fav-${track.id}`} type="button" className="lib-item" onClick={() => openTrack(track, favoriteTracks, track.title)}>
                  <img className="lib-item-img" src={track.artwork || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`} alt={track.title} />
                  <div className="lib-item-info">
                    <div className="lib-item-title">{track.title}</div>
                    <div className="lib-item-sub">Favorit • {track.artist}</div>
                  </div>
                  <button
                    type="button"
                    className="rail-btn"
                    style={{ marginLeft: "auto", padding: "0 8px" }}
                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(track); }}
                  >✕</button>
                </button>
              ))}
              {favoriteTracks.length === 0 && <div className="empty-copy">Belum ada lagu favorit tersimpan.</div>}
            </div>
          </div>

          <div className="section-container">
            <h2 className="section-title">Terakhir</h2>
            <div className="lib-list" id="libraryRecent">
              {recentPlayed.map((track) => (
                <button key={`recent-${track.id}`} type="button" className="lib-item" onClick={() => openTrack(track, recentPlayed, track.title)}>
                  <img className="lib-item-img" src={track.artwork || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`} alt={track.title} />
                  <div className="lib-item-info">
                    <div className="lib-item-title">{track.title}</div>
                    <div className="lib-item-sub">Baru diputar • {track.artist}</div>
                  </div>
                </button>
              ))}
              {recentPlayed.length === 0 && <div className="empty-copy">Belum ada lagu terakhir diputar.</div>}
            </div>
          </div>
        </section>

        <section id="view-artist" className={`view-section ${activeView === "artist" ? "active" : ""}`}>
          {artistLoading ? (
            <SkeletonArtistProfile />
          ) : (
            <>
              <div className="artist-hero">
                <button type="button" className="back-btn" onClick={() => setActiveView(returnView)}>‹</button>
                <div className="artist-hero-meta">
                  <img className="artist-hero-img" src={artistDetail?.artist.artwork || "/images/satriamusic-cover.jpg"} alt={artistDetail?.artist.name || "artist"} />
                  <div>
                    <p className="artist-eyebrow">Profil artis</p>
                    <h1 id="artistNameDisplay">{artistDetail?.artist.name || "Nama Artis"}</h1>
                    <p className="artist-subtext">{artistDetail?.artist.subscribersText || "Artis terpilih"}</p>
                  </div>
                </div>
              </div>

              <div className="artist-actions-row">
                <button type="button" className="artist-play-btn" onClick={() => artistDetail?.tracks[0] && openTrack(artistDetail.tracks[0], artistDetail.tracks, artistDetail.artist.name)}>
                  <PlayIcon />
                </button>
              </div>

              <div className="section-container">
                <h2 className="section-title">Populer</h2>
                <div className="vertical-list">
                  {artistDetail?.tracks.map((track) => (
                    <TrackRow key={track.id} track={track} active={currentTrack?.id === track.id} onClick={() => openTrack(track, artistDetail.tracks, artistDetail.artist.name)} onArtistClick={() => void openArtist(artistFromTrack(track))} right={<span className="play-badge">▶</span>} />
                  ))}
                  {!artistDetail || artistDetail.tracks.length === 0 ? <div className="empty-copy">Belum ada lagu populer untuk artis ini.</div> : null}
                </div>
              </div>

              {artistDetail?.albums.length ? (
                <div className="section-container">
                  <h2 className="section-title">Album</h2>
                  <div className="horizontal-scroll">
                    {artistDetail.albums.map((item) => (
                      <HorizontalCollectionCard key={item.id} item={item} onClick={() => void openCollection(item)} />
                    ))}
                  </div>
                </div>
              ) : null}

              {artistDetail?.playlists.length ? (
                <div className="section-container">
                  <h2 className="section-title">Playlist</h2>
                  <div className="horizontal-scroll">
                    {artistDetail.playlists.map((item) => (
                      <HorizontalCollectionCard key={item.id} item={item} onClick={() => void openCollection(item)} />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>

      {currentTrack && !playerOpen && (
        <button className="mini-player" onClick={() => setPlayerOpen(true)}>
          <div className="mini-player-cover-progress">
            <svg className="cover-progress-svg" viewBox="0 0 52 52" aria-hidden="true">
              <rect className="cover-progress-track" x="3" y="3" width="46" height="46" rx="9" />
              <rect className="cover-progress-fill" x="3" y="3" width="46" height="46" rx="9" pathLength="100" style={{ ["--cover-progress" as string]: `${progress}` }} />
            </svg>
            <img src={currentTrack.artwork} alt="Cover" />
          </div>
          <div className="mini-player-info">
            <div className="mini-player-title">{currentTrack.title}</div>
            <div className="mini-player-artist">{currentTrack.artist}</div>
          </div>
          <div className="mini-player-controls" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="mini-icon-btn" onClick={() => handleToggleLike(currentTrack)}>
              <HeartIcon filled={likedTracks[currentTrack.id]} />
            </button>
            <button type="button" className="mini-icon-btn" onClick={handleTogglePlay}>
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
          </div>
        </button>
      )}

      <nav className="bottom-nav">
        <button type="button" className={`nav-item ${activeView === "home" ? "active" : ""}`} onClick={() => setActiveView("home")}>
          <HomeIcon />
          <span>Home</span>
        </button>
        <button type="button" className={`nav-item ${activeView === "search" ? "active" : ""}`} onClick={() => setActiveView("search")}>
          <SearchIcon />
          <span>Cari</span>
        </button>
        <button type="button" className={`nav-item ${activeView === "library" ? "active" : ""}`} onClick={() => setActiveView("library")}>
          <LibraryIcon />
          <span>Koleksi Kamu</span>
        </button>
      </nav>

      <div id="playerModal" className={`modal-overlay ${playerOpen ? "open" : ""}`}>
        <div id="playerBg" style={{ backgroundImage: `url(${playerBackground})` }}></div>
        <div className="player-modal-grid">
          <div className="player-modal-primary">
            <PlayerCard
              track={currentTrack}
              playing={isPlaying}
              liked={currentTrack ? likedTracks[currentTrack.id] : false}
              progress={progress}
              currentTime={currentTime}
              duration={duration || currentTrack?.duration || 0}
              volume={volume}
              loadingStream={loadingStream}
              onClose={() => setPlayerOpen(false)}
              onTogglePlay={handleTogglePlay}
              onPrev={handlePrevious}
              onNext={handleNext}
              onLike={() => currentTrack && handleToggleLike(currentTrack)}
              onMenu={() => setPlayerMenuOpen((previous) => !previous)}
              onArtistClick={() => currentTrack && void openArtist(artistFromTrack(currentTrack))}
              onSeek={handleSeek}
              onVolume={setVolume}
            />

            {playerMenuOpen && currentTrack && (
              <div className="player-menu-sheet overlay">
                <button type="button" className="player-menu-item" onClick={() => { handleToggleLike(currentTrack); setPlayerMenuOpen(false); }}>
                  {likedTracks[currentTrack.id] ? "Hapus dari Disukai" : "Tambahkan ke Disukai"}
                </button>
                <button type="button" className="player-menu-item" onClick={() => { handleToggleFavorite(currentTrack); setPlayerMenuOpen(false); }}>
                  {favoriteTracks.some((item) => item.id === currentTrack.id) ? "Hapus dari Favorit" : "Tambahkan ke Favorit"}
                </button>
                <button type="button" className="player-menu-item" onClick={() => { void openArtist(artistFromTrack(currentTrack)); setPlayerMenuOpen(false); }}>
                  Lihat Profil Artis
                </button>
              </div>
            )}
          </div>

          <div className="lyrics-panel-shell">
            <div className="lyrics-panel-header">
              <div>
                <div className="lyrics-eyebrow">Realtime lyrics</div>
                <h3 className="lyrics-title">{currentTrack?.title || "Tidak ada lagu aktif"}</h3>
                <p className="lyrics-subtitle">{lyricsLoading ? "Memuat lirik..." : visibleLyrics.length > 0 ? "Sinkron dengan lagu" : "Lirik belum tersedia"}</p>
              </div>
              <Equalizer active={isPlaying} />
            </div>

            <div className="lyrics-list" ref={lyricsListRef}>
              {visibleLyrics.length > 0 ? (
                visibleLyrics.map((line, index) => (
                  <p
                    key={`${line.time}-${index}`}
                    ref={(element) => {
                      lyricRefs.current[index] = element;
                    }}
                    className={`lyrics-line ${index === activeLyricIndex ? "active" : ""}`}
                  >
                    {line.text}
                  </p>
                ))
              ) : (
                <div className="empty-copy">Putar lagu untuk melihat lyrics realtime di sini.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="hidden-player-host" aria-hidden="true">
        <ReactPlayer
          key={currentTrack?.id || "idle"}
          ref={playerRef}
          src={playbackSource?.src}
          playing={Boolean(currentTrack) && isPlaying}
          controls={false}
          playsInline
          width={1}
          height={1}
          volume={volume / 100}
          stopOnUnmount={false}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={handleNext}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || currentTrack?.duration || 0)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        />
      </div>
    </>
  );
}
