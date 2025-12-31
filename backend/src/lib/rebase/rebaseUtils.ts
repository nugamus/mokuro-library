/**
 * Permutation Logic
 * Convention: Source Map
 * P[i] = k means "The element at new index i comes from old index k"
 * new_list[i] = old_list[P[i]]
 */
export class Permutation {
  /**
   * Composes two permutations.
   * Result acts as if we applied 'inner' first, then 'outer'.
   * result[i] = outer[inner[i]]
   * Notation: outer * inner (or outer ∘ inner)
   */
  static compose(outer: number[], inner: number[]): number[] {
    if (outer.length !== inner.length) {
      throw new Error('Permutation length mismatch during composition');
    }
    const result = new Array(outer.length);
    for (let i = 0; i < inner.length; i++) {
      result[i] = outer[inner[i]];
    }
    return result;
  }

  /**
   * Inverts a permutation.
   * If P maps "New Index -> Old Source", Inv(P) maps "Old Index -> New Destination"
   * Note: The result is technically a Target Map, but if treated as a Source Map
   * for the reverse operation, it restores the original order.
   */
  static invert(p: number[]): number[] {
    const result = new Array(p.length);
    for (let i = 0; i < p.length; i++) {
      const sourceIndex = p[i];
      result[sourceIndex] = i;
    }
    return result;
  }

  /**
   * Applies the permutation to find where an index moves to.
   * NOTE: This requires the permutation to be treated as a Target Map (Old -> New).
   * If you have a Source Map (New -> Old), you must INVERT it first to map 
   * "Old Index i" -> "New Index k".
   */
  static mapIndex(sourceMap: number[], oldIndex: number): number {
    // A source map tells us: "At new index 0, we have old index P[0]"
    // We need to find 'i' such that P[i] == oldIndex
    const newIndex = sourceMap.indexOf(oldIndex);
    return newIndex; // Returns -1 if index is gone (though strict permutations shouldn't delete)
  }
}

/**
 * JSON Pointer Utilities (RFC 6901 style)
 */
export class PathUtils {
  static parse(path: string): string[] {
    if (path === '' || path === '/') return [];
    // Remove leading slash and split
    return path.substring(1).split('/');
  }

  static compile(segments: string[]): string {
    if (segments.length === 0) return '/';
    return '/' + segments.join('/');
  }

  /**
   * Checks if 'child' is strictly a descendant of 'parent'.
   * e.g. parent="/a", child="/a/b" -> true
   */
  static isDescendant(child: string, parent: string): boolean {
    if (parent === '/') return child !== '/';
    if (!child.startsWith(parent + '/')) return false;
    return true;
  }

  /**
   * Checks if 'child' is a descendant OR the same path as 'parent'.
   */
  static isDescendantOrSelf(child: string, parent: string): boolean {
    if (child === parent) return true;
    return this.isDescendant(child, parent);
  }

  /**
   * Gets the relative path segments from parent to child.
   * Throws if not related.
   */
  static getRelativeSegments(child: string, parent: string): string[] {
    if (child === parent) return [];
    if (!this.isDescendant(child, parent)) {
      throw new Error(`Path '${child}' is not a descendant of '${parent}'`);
    }

    // parent="/" -> child="/a/b" -> suffix="a/b"
    // parent="/a" -> child="/a/b" -> suffix="b"
    const prefixLen = parent === '/' ? 1 : parent.length + 1;
    const suffix = child.substring(prefixLen);
    return suffix.split('/');
  }
}
