import { Prisma } from "../../generated/prisma/client";

export const countBehindExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: 'ocrBranch-custom',
    model: {
      ocrBranch: {
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
