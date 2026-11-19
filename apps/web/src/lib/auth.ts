const KEY = "copayme_follower_id";

export function getFollowerId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setFollowerId(id: string): void {
  localStorage.setItem(KEY, id);
}

export function clearFollowerId(): void {
  localStorage.removeItem(KEY);
}
