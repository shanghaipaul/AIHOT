// The settings the owner writes in the configuration centre, and the keys the module reads
// them by. The engine's configuration centre collects them from the module's declaration (server.ts).
import type { ConfigEntry } from "@aihot/backend/runtime-config";

/** The keys, in one place to read them from. */
export const X_TIMELINE_KEY = {
  handle: "x.timeline.handle",
  mode: "x.timeline.mode",
  includeReplies: "x.timeline.include_replies",
  cookie: "x.timeline.cookie",
  proxy: "x.timeline.proxy",
  intervalMinutes: "x.timeline.interval_minutes",
  minGapMinutes: "x.timeline.min_gap_minutes",
  dailyCap: "x.timeline.daily_cap",
} as const;

/** How often the source is read when the configuration says nothing: two hours. */
export const DEFAULT_INTERVAL_MINUTES = 120;

/** How many posts a day the collection may bring in when the configuration says nothing. */
export const DEFAULT_DAILY_CAP = 200;

/** The smallest gap between two reads of the embedded timeline, in minutes. X limits an address. */
export const DEFAULT_MIN_GAP_MINUTES = 30;

/** The entries the configuration centre shows under "X 账号". */
export const X_TIMELINE_SETTINGS: ConfigEntry[] = [
  {
    key: X_TIMELINE_KEY.handle,
    label: "X 用户名",
    group: "X 账号",
    type: "string",
    default: "",
    description: "不带 @ 的 X 用户名",
  },
  {
    key: X_TIMELINE_KEY.mode,
    label: "采集方式",
    group: "X 账号",
    type: "enum",
    options: ["syndication", "socialdata", "cookie"],
    default: "syndication",
    description:
      "syndication=读 X 的嵌入时间线（免费，需要代理）；socialdata=付费 API（仓库已内置）；cookie=用登录 cookie 直连 x.com",
  },
  {
    key: X_TIMELINE_KEY.includeReplies,
    label: "包含回复",
    group: "X 账号",
    type: "bool",
    default: false,
  },
  {
    key: X_TIMELINE_KEY.cookie,
    label: "x.com Cookie",
    group: "X 账号",
    type: "string",
    default: "",
    secret: true,
    description: "cookie 模式需要 auth_token 与 ct0",
  },
  {
    key: X_TIMELINE_KEY.proxy,
    label: "采集代理",
    group: "X 账号",
    type: "string",
    default: "",
    secret: true,
    description:
      "syndication 模式用的代理，形如 http://用户名:密码@主机:端口；留空则直连（本机直连 x.com 不通）",
  },
  {
    key: X_TIMELINE_KEY.intervalMinutes,
    label: "采集间隔（分钟）",
    group: "X 账号",
    type: "int",
    default: DEFAULT_INTERVAL_MINUTES,
  },
  {
    key: X_TIMELINE_KEY.minGapMinutes,
    label: "最小请求间隔（分钟）",
    group: "X 账号",
    type: "int",
    default: DEFAULT_MIN_GAP_MINUTES,
    description: "X 按出口 IP 限流，两次读取之间至少隔这么久",
  },
  {
    key: X_TIMELINE_KEY.dailyCap,
    label: "每日条数上限",
    group: "X 账号",
    type: "int",
    default: DEFAULT_DAILY_CAP,
    description: "控制 SocialData 成本",
  },
];
