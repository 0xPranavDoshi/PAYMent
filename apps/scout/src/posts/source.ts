export interface RawPost {
  tweetId: string;
  xUserId: string;
  /** Lowercase, no leading "@". */
  xHandle: string;
  text: string;
  /** ISO timestamp decoded from the tweet id. */
  createdAt: string;
  isRetweet: boolean;
  isReply: boolean;
  quotedText?: string;
}

export interface PostSource {
  fetchPosts(handle: string, opts: { sinceId?: string; limit: number }): Promise<RawPost[]>;
}

export class PostSourceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PostSourceError";
  }
}
