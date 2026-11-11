// What the youtube module holds: the channels it watches, the videos it found there, and what the
// model made of each video. The types here are the contract between the backend (which reads YouTube
// and writes the tables) and the page (which only reads the api).
export interface YoutubeChannel {
  /** YouTube's own id for the channel, "UC...". */
  channelId: string;
  /** The address the channel is known by, without the site: "@handle". */
  handle: string;
  /** The channel's name, as YouTube shows it. */
  title: string;
  /** What kind of channel it is: official, research, media, community, personal. */
  category: string | null;
  /** A channel that is off is not read any more; its videos stay. */
  enabled: boolean;
  /** When the channel was last read. */
  lastFetchedAt: string | null;
  /** When its newest video was published. */
  lastVideoAt: string | null;
  /** How many videos of it the module keeps. */
  videoCount: number;
}

export interface YoutubeVideo {
  /** YouTube's own id for the video. */
  videoId: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string;
  title: string;
  url: string;
  /** The description the channel wrote, when it was read. */
  description: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  /** When the video was published, as an instant (UTC). */
  publishedAt: string | null;
  thumbnail: string | null;
  /** Whether a transcript was found for it. */
  transcriptAvailable: boolean;
  /** Where the transcript came from: the invidious instance, or "none". */
  transcriptSource: string | null;
  /** The Chinese summary the model wrote, when it has written one. */
  summary: string | null;
  /** The points the model took out of the video. */
  keyPoints: string[];
  /** The topics the model named. */
  topics: string[];
  /** When the model last wrote about it. */
  analyzedAt: string | null;
}

export interface YoutubeFeed {
  channels: YoutubeChannel[];
  videos: YoutubeVideo[];
  /** When the channels were last read. */
  fetchedAt: string | null;
  /** When the newest video was written. */
  updatedAt: string | null;
}
