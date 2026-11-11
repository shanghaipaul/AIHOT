// The channels the module watches. YouTube has no public feed for a channel any more, so the
// module reads the channel's own page (and, for the numbers, an invidious instance); the list below is
// the only place a channel is written down.
//
// A channel that is on is read every cycle; one that is off keeps its videos and waits. Adding a
// channel is one line here: its id, its handle, its name and what kind of channel it is.
import { sql } from "@aihot/backend/db";
import type { YoutubeChannel } from "./types.ts";

export interface ChannelSeed {
  /** YouTube's own id for the channel, "UC...". */
  channelId: string;
  /** The address the channel is known by, without the site: "@handle". */
  handle: string;
  /** The channel's name, as YouTube shows it. */
  title: string;
  /** What kind of channel it is. */
  category: string;
  /** Off means the channel waits; its videos stay. */
  enabled?: boolean;
}

/** The channels the site watches. The first four are the ones the editor asked for. */
export const YOUTUBE_CHANNELS: readonly ChannelSeed[] = [
  { channelId: "UCIomFkAj4Vq_rGX2Jot7D8A", handle: "@AIsuperdomain", title: "AI超元域", category: "媒体", enabled: true },
  { channelId: "UCvijahEyGtvMpmMHBu4FS2w", handle: "@lingdujieshuo", title: "零度解说", category: "媒体", enabled: true },
  { channelId: "UCXYvWkR9LAOsOZjYhghDiXw", handle: "@linbintalk", title: "AI学长小林", category: "媒体", enabled: true },
  { channelId: "UCBj9S8TBRlCU4QnhTEOdWZQ", handle: "@axtonliu", title: "回到Axton", category: "个人", enabled: true },
  // Channels that were checked and read well; they wait until the editor turns them on.
  { channelId: "UCXZCJLdBC09xxGZ6gcdrc6A", handle: "@OpenAI", title: "OpenAI", category: "官方", enabled: false },
  { channelId: "UCP7jMXSY2xbc3KCAE0MHQ-A", handle: "@GoogleDeepMind", title: "Google DeepMind", category: "官方", enabled: false },
  { channelId: "UCrDwWp7EBBv4NwvScIpBDOA", handle: "@anthropic-ai", title: "Anthropic", category: "官方", enabled: false },
  { channelId: "UCHlNU7kIZhRgSbhHvFoy72w", handle: "@HuggingFace", title: "Hugging Face", category: "官方", enabled: false },
  { channelId: "UC9dJwjRL5rHn-2t-rHlwNpg", handle: "@OpenRouterAI", title: "OpenRouter", category: "官方", enabled: false },
  { channelId: "UCbfYPyITQ-7l4upoX8nvctg", handle: "@TwoMinutePapers", title: "Two Minute Papers", category: "研究", enabled: false },
  { channelId: "UC_CzsS7UTjcxJ-xXp1ftxtA", handle: "@SebastianRaschka", title: "Sebastian Raschka", category: "研究", enabled: false },
  { channelId: "UCXUPKJO5MZQN11PqgIvyuvQ", handle: "@AndrejKarpathy", title: "Andrej Karpathy", category: "研究", enabled: false },
  { channelId: "UCZHmQk67mSJgfCCTn7xBfew", handle: "@YannicKilcher", title: "Yannic Kilcher", category: "研究", enabled: false },
  { channelId: "UCxBcwypKK-W3GHd_RZ9FZrQ", handle: "@LatentSpacePod", title: "Latent Space Pod", category: "社区", enabled: false },
  { channelId: "UCMLtBahI5DMrt0NPvDSoIRQ", handle: "@MachineLearningStreetTalk", title: "Machine Learning Street Talk", category: "社区", enabled: false },
  { channelId: "UCsBjURrPoezykLs9EqgamOA", handle: "@Fireship", title: "Fireship", category: "社区", enabled: false },
  { channelId: "UC5Wz4fFacYuON6IKbhSa7Zw", handle: "@MattVidPro", title: "MattVidPro", category: "社区", enabled: false },
  { channelId: "UCNJ1Ymd5yFuUPtn21xtRbbw", handle: "@AIExplained-official", title: "AI Explained", category: "社区", enabled: false },
  { channelId: "UCqcbQf6yw5KzRoDDcZ_wBSw", handle: "@WesRoth", title: "Wes Roth", category: "社区", enabled: false },
  { channelId: "UC56HTzW3TZVhbDRDPzQZaxw", handle: "@TheAIVision", title: "The AI Vision", category: "社区", enabled: false },
];

/**
 * Writes the channels that are not in the table yet, and turns the ones that are on or off as the list
 * above says. The times the module keeps (when the channel was last read) are not touched.
 * Returns how many channels were written.
 */
export async function ensureChannels(): Promise<number> {
  let written = 0;
  for (const seed of YOUTUBE_CHANNELS) {
    const result = await sql`
      INSERT INTO youtube_channels (channel_id, handle, title, category, enabled)
      VALUES (${seed.channelId}, ${seed.handle}, ${seed.title}, ${seed.category}, ${seed.enabled ?? true})
      ON CONFLICT (channel_id) DO UPDATE SET handle = EXCLUDED.handle, title = EXCLUDED.title, category = EXCLUDED.category, enabled = EXCLUDED.enabled, updated_at = now()`;
    written += result.count ?? 0;
  }
  return written;
}

/** The channels that are on, in the order they are watched. */
export async function listChannels(): Promise<YoutubeChannel[]> {
  try {
    const rows = await sql<{
      channel_id: string; handle: string; title: string; category: string | null; enabled: boolean;
      last_fetched_at: Date | null; last_video_at: Date | null; video_count: string | null;
    }[]>`
      SELECT c.channel_id, c.handle, c.title, c.category, c.enabled, c.last_fetched_at, c.last_video_at,
             (SELECT count(*) FROM youtube_videos v WHERE v.channel_id = c.channel_id) AS video_count
      FROM youtube_channels c WHERE c.enabled ORDER BY c.title`;
    return rows.map((row) => ({
      channelId: row.channel_id,
      handle: row.handle,
      title: row.title,
      category: row.category,
      enabled: row.enabled,
      lastFetchedAt: row.last_fetched_at ? row.last_fetched_at.toISOString() : null,
      lastVideoAt: row.last_video_at ? row.last_video_at.toISOString() : null,
      videoCount: Number(row.video_count ?? 0),
    }));
  } catch {
    // The table arrives with the migration; before that there are no channels, not an error.
    return [];
  }
}
