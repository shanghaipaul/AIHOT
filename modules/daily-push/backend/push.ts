// Writes the daily report to a file under the site data directory. The issue is read through the
// engine's public read layer (packages/backend/src/publication/reports.ts): this module decides where
// a push goes, never what a daily contains.
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dailyWithNotes } from "@aihot/backend/publication/reports";
import { beijingDate } from "@aihot/contracts/time";
import { SITE } from "@aihot/site";

export type PushStatus = "pushed" | "skipped" | "empty" | "failed";

export interface PushResult {
  status: PushStatus;
  date: string | null;
  file: string | null;
  items: number;
  reason?: string;
}

/** Where the pushed issues land: <data dir>/push/. */
function pushDir(): string {
  return path.join(process.env.AIHOT_DATA_DIR || path.join(process.cwd(), ".data"), "push");
}

/** The file one issue is pushed to. */
export function pushFile(date: string): string {
  return path.join(pushDir(), `daily-${date}.md`);
}

/** The issue as Markdown, or null when there is no such daily. */
export async function renderDaily(date: string): Promise<string | null> {
  const issue = await dailyWithNotes(date);
  if (!issue) return null;
  const report = issue.body.report;
  const lines: string[] = [`# ${SITE.name} · ${report.date}`, ""];
  if (report.lead) {
    lines.push(`**${report.lead.title}**`);
    if (report.lead.leadParagraph) lines.push(report.lead.leadParagraph);
    lines.push("");
  }
  for (const section of report.sections) {
    if (!section.items.length) continue;
    lines.push(`## ${section.label}`);
    for (const item of section.items) {
      const link = item.links.aihot || item.links.original;
      const title = link ? `[${item.title}](${link})` : item.title;
      const summary = item.summary ? ` — ${item.summary}` : "";
      const source = item.source.name ? ` (${item.source.name})` : "";
      lines.push(`- ${title}${summary}${source}`);
    }
    lines.push("");
  }
  if (report.flashes.length) {
    lines.push("## 快讯");
    for (const flash of report.flashes) {
      const link = flash.links.aihot || flash.links.original;
      lines.push(`- ${link ? `[${flash.title}](${link})` : flash.title}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`原文: ${report.links.aihot}`);
  lines.push(`由 ${SITE.name} 自动推送`);
  return lines.join("\n");
}

/** Pushes one issue. An issue already pushed is left alone: the file is the receipt. */
export async function pushDaily(date: string): Promise<PushResult> {
  const file = pushFile(date);
  try {
    await access(file);
    return { status: "skipped", date, file, items: 0, reason: "这一期已经推过" };
  } catch {
    // No such file: this issue was not pushed yet.
  }
  try {
    const markdown = await renderDaily(date);
    if (!markdown) return { status: "empty", date, file: null, items: 0, reason: "没有这一期日报" };
    await mkdir(pushDir(), { recursive: true });
    await writeFile(file, markdown, "utf8");
    const items = markdown.split("\n").filter((line) => line.startsWith("- ")).length;
    return { status: "pushed", date, file, items };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "failed", date, file, items: 0, reason };
  }
}

/**
 * Pushes the newest daily there is. An issue whose date is still ahead is not pushed: it is written
 * before its edition time, and a push would announce it early.
 */
export async function pushLatestDaily(): Promise<PushResult> {
  const issue = await dailyWithNotes("latest");
  if (!issue) return { status: "empty", date: null, file: null, items: 0, reason: "还没有日报" };
  const date = issue.body.report.date;
  if (date > beijingDate(new Date())) {
    return { status: "skipped", date, file: null, items: 0, reason: "这一期还没到出刊时间" };
  }
  return pushDaily(date);
}