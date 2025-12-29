// A "Quad" representing the 4 corners of a text line (x,y)
export type Quad = [
  [number, number],
  [number, number],
  [number, number],
  [number, number]
];

// A "Rect" representing the bounding box of a block (min_x, min_y, max_x, max_y)
export type Rect = [number, number, number, number];

export interface MokuroBlock {
  box: Rect;
  vertical: boolean;
  font_size?: number;

  // NATIVE FORMAT: Split Arrays
  lines: string[];
  lines_coords: Quad[];
}

export interface MokuroPage {
  blocks: MokuroBlock[];
  img_path: string;
  // Add dimensions or other page metadata if needed
  width?: number;
  height?: number;
}

export interface MokuroData {
  // The UUID of the snapshot version (optional in raw OCR output, mandatory in Library)
  version_id?: string;

  title?: string;
  pages: MokuroPage[];
}
