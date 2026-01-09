export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export type Rect = [number, number, number, number];

// --- Type definitions Reader GET ---
export interface MokuroBlock {
  box: Rect;
  lines_coords: Quad[];
  lines: string[];
  vertical?: boolean;
  font_size?: number;
  domElement?: HTMLDivElement;
}
export interface MokuroPage {
  img_width: number;
  img_height: number;
  blocks: MokuroBlock[];
  img_path: string;
}
export interface MokuroData {
  title: string;
  title_uuid: string;
  volume: string;
  pages: MokuroPage[];
}

export interface VolumeReaderResponse {
  id: string;
  title: string;
  seriesId: string;
  pageCount: number;
  coverImageName: string | null;
  progress: UserProgress[];
  mokuroData: MokuroData;
  versionInfo: {
    branchId: string;
    headPatchId: string;
    branchVersion: number;
    hasAhead: boolean;
    hasBehind: boolean;
  };
}

// --- Core Library Types ---

export interface UserProgress {
  page: number;
  completed: boolean;
  timeRead: number;
  charsRead: number;
  lastReadAt?: string;
}

export interface Volume {
  id: string;
  seriesId?: string; // Helpful for back-references
  title: string | null;
  sortTitle?: string | null;
  folderName: string;
  pageCount: number;
  coverImageName: string | null;
  createdAt: string;
  // Progress is usually an array from Prisma relations, though often 1 item per user
  progress: UserProgress[];
}

export interface Series {
  id: string;
  title: string | null;
  japaneseTitle: string | null;
  romajiTitle: string | null;
  synonyms: string | null;
  description: string | null;
  folderName: string;
  coverPath: string | null;
  sortTitle: string;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  // Flattened User Settings
  bookmarked: boolean;
  status: number;
  organized: boolean;
  lastReadAt: Date;
  isOfficial: boolean;
  canEdit: boolean;
  // Progress Stats (Cached)
  totalPageCount: number;
  totalVolumeCount: number;
  readPageCount: number;
  completedVolumeCount: number;

  volumes?: Volume[]; // Optional, present in Detail View
}

export type PaginationData = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Union for Selection State
export type LibraryItem = Series | Volume;

// --- Upload Pipeline Types ---

export interface UploadJob {
  id: string;
  name: string;
  files: File[];
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  resultMsg?: string;
  seriesFolderName: string;
  volumeFolderName: string;
  metadata: {
    seriesTitle?: string | null;
    seriesDescription?: string | null;
    seriesBookmarked?: boolean;
    volumeTitle?: string | null;
    volumeProgress?: { page: number; completed: boolean } | null;
  };
}

export interface DirNode {
  name: string;
  fullPath: string;
  files: File[];
  children: Map<string, DirNode>;
}

export interface SeriesMetadata {
  series: {
    title: string | null;
    description?: string | null;
    bookmarked?: boolean;
  };
  volumes: Record<
    string,
    {
      displayTitle: string | null;
      progress?: { page: number; completed: boolean } | null;
    }
  >;
}

// Fine Values: Used for 'replace' operations on leaf nodes.
export type FineValue =
  | string // For text content
  | boolean // For 'vertical' flag
  | number // For 'font_size'
  | Rect // For block 'box'
  | Quad; // For line 'coords'

// --- 2. Coarse / Unified Values ---

// UnifiedLine: Merges the split arrays (lines + lines_coords) into one atomic unit.
export interface UnifiedLine {
  text: string;
  coords: Quad;
}

// UnifiedBlock: Represents a full block structure.
export interface UnifiedBlock {
  box: Rect;
  vertical: boolean;
  font_size?: number;
  lines: UnifiedLine[];
}

export type PatchValue = FineValue | UnifiedBlock | UnifiedLine;

// --- 3. The Patch Operation ---
export type OpType = 'replace' | 'add' | 'remove' | 'reorder' | 'genesis';

export type PatchOperation =
  | { op: 'genesis'; path: string }
  | { op: 'replace'; path: string; value: PatchValue; old_value: PatchValue }
  | { op: 'add'; path: string; value: PatchValue }
  | { op: 'remove'; path: string; old_value: PatchValue }
  | { op: 'reorder'; path: string; new_order: number[] };

// --- Submission & Contribution Types ---

export interface SubmissionVolume {
  id: string;
  submissionId: string;
  volumeId: string;
}

export interface Submission {
  id: string;
  userId: string;
  status: 'pending' | 'accepted' | 'rejected';
  targetSeriesId: string | null;
  sourceSeriesId: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;

  // Relations
  volumes?: SubmissionVolume[];
  user?: { id: string; username: string };
  targetSeries?: { id: string; title: string; folderName: string };
  sourceSeries?: { id: string; title: string; folderName: string };
  _count?: { volumes: number };
}

export interface SubmitVolumesRequest {
  volumeIds: string[];
  targetSeriesId?: string;
}

export interface RejectSubmissionRequest {
  reason: string;
}

export interface BulkAcceptRequest {
  submissionIds: string[];
}

export interface BulkRejectRequest {
  submissionIds: string[];
  reason: string;
}

export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export interface ContributionsSummary {
  ahead: number;
  behind: number;
  pendingSubmissionsCount: number;
}
