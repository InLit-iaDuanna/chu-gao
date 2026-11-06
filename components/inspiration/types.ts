export type PostShape =
  | "WORK"
  | "TEARDOWN"
  | "PATTERN"
  | "QUESTION"
  | "REFERENCE"
  | "PROCESS";
export type Discipline =
  | "GRAPHIC"
  | "PRODUCT"
  | "INDUSTRIAL"
  | "SERVICE"
  | "SPATIAL"
  | "BRAND"
  | "MOTION"
  | "DATAVIZ";
export type PromptVisibility = "PUBLIC" | "STRUCTURE_ONLY" | "PRIVATE";
export type PostSourceType = "STANDARD" | "CANVAS" | "NODES" | "PPT";

export interface InspirationMedia {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  mimeType: string;
  order: number;
  role: "FINAL" | "PROCESS";
  isCover: boolean;
  recipe: Record<string, unknown> | null;
}

export interface InspirationPost {
  id: string;
  author: { id: string | null; name: string; email?: string | null };
  shape: PostShape;
  shapeLabel: string;
  discipline: Discipline;
  disciplineLabel: string;
  title: string;
  story: string | null;
  origin: "ORIGINAL" | "STUDY" | "REPOST";
  originLabel: string;
  sourceType: PostSourceType;
  sourceTypeLabel: string;
  externalUrl: string | null;
  sourceNote: string | null;
  promptVisibility: PromptVisibility;
  status: "DRAFT" | "PENDING" | "PUBLISHED" | "HIDDEN";
  hasMedia: boolean;
  counts: {
    likes: number;
    bookmarks: number;
    comments: number;
    derived: number;
  };
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  media: InspirationMedia[];
  tags: Array<{
    id: string;
    slug: string;
    name: string;
    kind: "CATEGORY" | "STYLE";
    isFollowing?: boolean;
  }>;
  dailyPrompt: {
    id: string;
    day: string;
    title: string;
    prompt: string;
    keywords: string[];
  } | null;
  viewer: {
    isAuthor: boolean;
    isLiked: boolean;
    isBookmarked: boolean;
    isFollowingAuthor?: boolean;
  };
}

export interface InspirationComment {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  content: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  replies: InspirationComment[];
}

export interface InspirationPageData {
  items: InspirationPost[];
  nextCursor: string | null;
  filters: {
    disciplines: Array<{ value: Discipline; label: string }>;
    shapes: Array<{ value: PostShape; label: string }>;
  };
}
