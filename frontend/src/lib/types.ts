// --- Type definitions for our .mokuro file ---
export interface MokuroBlock {
  box: [number, number, number, number];
  lines_coords: [[number, number], [number, number], [number, number], [number, number]][];
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

export interface VolumeResponse {
  id: string;
  title: string;
  seriesId: string;
  pageCount: number;
  coverImageName: string | null;
  mokuroData: MokuroData;
}
