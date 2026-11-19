import { pinyin } from "pinyin-pro";

/** R82 搜索升级：标题/摘要除字面子串外，还支持拼音全拼与首字母
 * （「课堂计划」可被 ketang / kt 命中）。转换结果按原文缓存，
 * 侧栏每次按键不必重复解析；缓存上限避免长期驻留无限增长。 */
const PINYIN_CACHE_LIMIT = 400;
const pinyinCache = new Map<string, string>();

function pinyinBlob(text: string): string {
  const cached = pinyinCache.get(text);
  if (cached !== undefined) return cached;
  const syllables = pinyin(text, { toneType: "none", type: "array" }) as string[];
  const full = syllables.join("");
  const initials = syllables.map((syllable) => syllable[0] ?? "").join("");
  const blob = `${full} ${initials}`.toLocaleLowerCase();
  if (pinyinCache.size >= PINYIN_CACHE_LIMIT) pinyinCache.clear();
  pinyinCache.set(text, blob);
  return blob;
}

/** 单条会话的可搜索文本：标题 + 摘要（原文、小写、拼音全拼/首字母）。 */
function searchableText(item: SessionMeta): string {
  const title = item.title || "";
  const preview = item.preview || "";
  return `${title}\n${preview}\n${pinyinBlob(`${title} ${preview}`)}`.toLocaleLowerCase();
}

export function filterActiveSessions(sessions: SessionMeta[], query: string): SessionMeta[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((item) => {
    if (item.archived) return false;
    if (!terms.length) return true;
    const haystack = searchableText(item);
    return terms.every((term) => haystack.includes(term));
  });
}

export function reusableEmptySession(sessions: SessionMeta[]): SessionMeta | undefined {
  return sessions.find((item) => !item.archived && item.title === "新会话" && !item.preview);
}
