import { MokuroData } from './mokuro';

export interface LibraryQuery {
  page?: number;
  limit?: number;
  q?: string;
  sort?: 'title' | 'created' | 'updated' | 'recent';
  order?: 'asc' | 'desc';
  status?: 'all' | 'read' | 'unread' | 'reading';
  bookmarked?: string;
  filter_missing?: 'cover' | 'description' | 'title' | 'any' | 'none';
  is_organized?: 'true' | 'false';
}

export interface LibraryEntry {
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
}

export interface LibraryResponse {
  data: LibraryEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SeriesResponse extends LibraryEntry {
  volumes: VolumeResponse[];
}

export interface VolumeResponse {
  id: string;
  title: string;
  seriesId: string;
  pageCount: number;
  coverImageName: string | null;
  progress: any[]; // UserProgress details
  mokuroData: MokuroData;
  versionInfo: {
    branchId: string;
    headPatchId: string;
    hasAhead: boolean;
    hasBehind: boolean;
  };
}
