export function filterActiveSessions(sessions: SessionMeta[], query: string): SessionMeta[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((item) => !item.archived && terms.every((term) => `${item.title}\n${item.preview || ""}`.toLocaleLowerCase().includes(term)));
}

export function reusableEmptySession(sessions: SessionMeta[]): SessionMeta | undefined {
  return sessions.find((item) => !item.archived && item.title === "新会话" && !item.preview);
}
