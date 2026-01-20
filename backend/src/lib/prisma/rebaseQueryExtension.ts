import { Prisma } from "../../generated/prisma/client";

// Raw Row from SQL (Flat, potential BigInts)
interface RebaseQueueRawRow {
  id: string;
  title: string;
  seriesId: string;
  pageCount: number;
  coverImageName: string | null;
  seriesTitle: string;
  branchId: string;
  headPatchId: string;
  branchVersion: number;
  hasAhead: bigint | number;
  hasBehind: bigint | number;
}

// Clean Output Object (Nested, pure Numbers)
export interface RebaseQueueEntry {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  pageCount: number;
  coverImageName: string | null;
  versionInfo: {
    branchId: string;
    headPatchId: string;
    branchVersion: number;
    hasAhead: number;
    hasBehind: number;
  };
}

export const rebaseQueryExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: 'rebaseQuery',
    model: {
      ocrBranch: {
        async getVolumesNeedingRebase(userId: string, limit = 50): Promise<RebaseQueueEntry[]> {
          const result = await client.$queryRaw<RebaseQueueRawRow[]>`
            SELECT
              v.id as "id",
              v."sortTitle" as "title",   -- Use sortTitle
              v."seriesId" as "seriesId",
              v."pageCount" as "pageCount",
              v."coverImageName" as "coverImageName",
              s."sortTitle" as "seriesTitle",   -- Useful context for the UI

              -- Branch Info for versionInfo
              ub.id as "branchId",
              ub."headPatchId" as "headPatchId",
              ub."version" as "branchVersion",

              -- Calculated Counts
              (uh.sequence - (ur.sequence - 1)) as "hasAhead",
              (ah.sequence - (ur.sequence - 1)) as "hasBehind"

            FROM "OcrBranch" ub
            JOIN "Volume" v ON ub."volumeId" = v.id
            JOIN "Series" s ON v."seriesId" = s.id

            -- Join Admin Branch (Source of Truth)
            JOIN "OcrBranch" ab ON ab."volumeId" = ub."volumeId" AND ab."userId" = 'admin'

            -- Join Patch Sequences for Math
            JOIN "Patch" ah ON ab."headPatchId" = ah.id   -- Admin Head
            JOIN "Patch" uh ON ub."headPatchId" = uh.id   -- User Head
            JOIN "Patch" ur ON ub."rootPatchId" = ur.id   -- User Root (Fork Point)

            WHERE
              ub."userId" = ${userId}
              AND s."ownerId" = 'admin'

              -- Inner join on rootPatchId already enforce ahead condition
              -- Behind Condition: Admin Head > Fork Point
              AND ah.sequence > (ur.sequence - 1)

            LIMIT ${limit};
          `;

          // Map to the requested nested structure
          return result.map(r => ({
            id: r.id,
            title: r.title,
            seriesId: r.seriesId,
            seriesTitle: r.seriesTitle, // Keeping this as it's vital for the inbox view
            pageCount: r.pageCount,
            coverImageName: r.coverImageName,
            versionInfo: {
              branchId: r.branchId,
              headPatchId: r.headPatchId,
              branchVersion: r.branchVersion,
              hasAhead: Number(r.hasAhead || 0),
              hasBehind: Number(r.hasBehind || 0)
            }
          }));
        },
        /**
         * Calculates how many branches for this user are behind the Admin's latest state.
         * Handles both Clean (Case A) and Dirty (Case B) logic.
         */
        async countBehind(userId: string): Promise<number> {
          // Use $queryRaw on the client context
          const result = await client.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) as count
            FROM "OcrBranch" ub
            JOIN "Volume" v ON ub."volumeId" = v.id
            JOIN "Series" s ON v."seriesId" = s.id
            -- Join Admin Branch
            JOIN "OcrBranch" ab ON ab."volumeId" = ub."volumeId" AND ab."userId" = 'admin'
            -- Join Patch Sequences
            JOIN "Patch" ah ON ab."headPatchId" = ah.id
            JOIN "Patch" uh ON ub."headPatchId" = uh.id
            LEFT JOIN "Patch" ur ON ub."rootPatchId" = ur.id

            WHERE ub."userId" = ${userId}
              AND s."ownerId" = 'admin'
              AND (
                -- Case A: Clean Branch
                (ub."rootPatchId" IS NULL AND ah.sequence > uh.sequence)
                OR
                -- Case B: Dirty Branch
                (ub."rootPatchId" IS NOT NULL AND ah.sequence > (ur.sequence - 1))
              )
          `;

          // Centralized BigInt safety handling
          const count = result[0]?.count ?? 0n;
          return Number(count);
        },
      },
    },
  });
});
