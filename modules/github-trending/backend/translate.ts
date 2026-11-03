// The Chinese description of a repository. The worker writes it (the page never calls a model):
// the list is read every two hours from GitHub, and every repository whose description has not been
// translated yet is sent to the model in one batch, which answers with the Chinese text for each of
// them. The answer is kept beside the English text it came from, so a repository whose description
// changed on GitHub is translated again and one whose description stayed is not.
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { modelFor } from "@aihot/backend/editorial/models";

const Output = z.object({ items: z.array(z.object({ repo: z.string(), zh: z.string() })) });

/** The wording of the translation; a change of it is a new version, so old answers are not reused. */
const PROMPT_VERSION = "github-trending-zh@v2";

const SYSTEM = [
  "你把开源仓库的英文简介翻译成简体中文。",
  "规则：",
  "1. 只输出 JSON：{\"items\":[{\"repo\":\"owner/name\",\"zh\":\"中文简介\"}]}。",
  "2. repo 必须与输入里的 repo 完全一致，一个输入对应一条输出，顺序相同。",
  "3. zh 是简体中文的一句话简介，不加 Markdown，不加引号，不写解释，最多 40 个汉字，说清这个仓库是做什么的。",
  "4. 保留专有名词、库名、命令与参数（如 TypeScript、PyTorch、--flag），产品名保留英文原名。",
  "5. 原文已经是中文时原样返回。",
].join("\n");

/** How many repositories one call carries; the answer is one line per repository. */
const BATCH = 20;

interface Pending {
  repo: string;
  description: string;
}

/**
 * The repositories whose description has not been translated yet (or whose description changed on
 * GitHub). An empty list when the table is not there yet: the migration comes with the module.
 */
async function pending(limit: number): Promise<Pending[]> {
  try {
    return await sql<Pending[]>`
      SELECT DISTINCT t.repo, t.description
      FROM github_trending t
      LEFT JOIN github_trending_zh z ON z.repo = t.repo AND z.description = t.description
      WHERE z.repo IS NULL AND t.description IS NOT NULL AND btrim(t.description) <> ''
      ORDER BY t.repo
      LIMIT ${limit}`;
  } catch {
    return [];
  }
}

/**
 * Translates the repositories that have no Chinese description yet and keeps the answer.
 * Returns how many descriptions were written.
 */
export async function translatePending(limit = BATCH): Promise<number> {
  const rows = await pending(limit);
  if (rows.length === 0) return 0;
  const model = await modelFor("translate");
  const result = await chatJson({
    model,
    purpose: "translate_github_trending",
    subject: `github-trending:${rows.length}`,
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    user: JSON.stringify(rows.map((row) => ({ repo: row.repo, description: row.description }))),
    schema: Output,
    temperature: 0.2,
    maxTokens: 4000,
  });
  const wanted = new Map(rows.map((row) => [row.repo, row.description]));
  const items = result.data.items.filter((item) => wanted.has(item.repo) && item.zh.trim() !== "");
  if (items.length === 0) return 0;
  await sql.begin(async (tx) => {
    for (const item of items) {
      const description = wanted.get(item.repo)!;
      await tx`INSERT INTO github_trending_zh (repo, description, zh) VALUES (${item.repo}, ${description}, ${item.zh.trim()})
        ON CONFLICT (repo) DO UPDATE SET description = EXCLUDED.description, zh = EXCLUDED.zh, updated_at = now()`;
    }
  });
  return items.length;
}

/**
 * Translates over several rounds, so one run catches up with a long list: the merged list holds a
 * hundred repositories per period, which is several batches.
 */
export async function translateTrending(rounds = 6): Promise<number> {
  let total = 0;
  for (let round = 0; round < rounds; round += 1) {
    const written = await translatePending();
    total += written;
    if (written === 0) break;
  }
  return total;
}