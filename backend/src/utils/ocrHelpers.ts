import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { PatchApplicator } from '../lib/PatchApplicator';
import { PatchInverter } from '../lib/PatchInverter';
import { MokuroData } from '../types/mokuro';
import { OcrBranch, PrismaClient } from '../generated/prisma/client';

// ============================================================================
// LOW-LEVEL HELPERS
// ============================================================================

// --- Helper: Clean up Snapshots ---
export async function deleteBranchSnapshots(fastify: FastifyInstance, branchIds: string[]) {
  for (const branchId of branchIds) {
    const snapshotPath = path.join(fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${branchId}.json`);
    try {
      await fs.promises.unlink(snapshotPath);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        fastify.log.warn(`Failed to delete snapshot ${snapshotPath}: ${e.message}`);
      }
    }
  }
}

// --- Helper: Load the original .mokuro file (Genesis State) ---
export async function loadOriginalMokuro(fastify: FastifyInstance, mokuroPath: string): Promise<MokuroData> {
  const absPath = path.join(fastify.projectRoot, mokuroPath);
  const content = await fs.promises.readFile(absPath, 'utf-8');
  return JSON.parse(content);
}

// --- Helper: Persist Snapshot ---
export async function saveSnapshot(fastify: FastifyInstance, branchId: string, data: MokuroData, patchId: string) {
  const snapshotPath = path.join(fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${branchId}.json`);
  data.patch_id = patchId;
  await fs.promises.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.promises.writeFile(snapshotPath, JSON.stringify(data));

  await fastify.prisma.ocrBranch.update({
    where: { id: branchId },
    data: { snapshotPatchId: patchId }
  });
}

// --- Helper: Fetch Ancestry Chain (CTE) ---
// Returns patches from startId walking up to (but not including) stopId
export async function fetchAncestryChain(prisma: PrismaClient, startId: string, stopId: string | null = null) {
  return await prisma.$queryRaw<any[]>`
    WITH RECURSIVE chain AS (
      SELECT * FROM "Patch" WHERE id = ${startId}
      UNION ALL
      SELECT p.* FROM "Patch" p
      INNER JOIN chain c ON c.parentId = p.id
      WHERE c.id <> ${stopId ?? ''}
    )
    SELECT * FROM chain;
  `;
}

// --- Helper: Regenerate Snapshot from Genesis ---
export async function regenerateFromGenesis(
  fastify: FastifyInstance,
  mokuroPath: string,
  targetPatchId: string,
  branchId: string
): Promise<MokuroData> {
  fastify.log.warn(`Regenerating snapshot from GENESIS for branch ${branchId}`);
  const history = await fetchAncestryChain(fastify.prisma, targetPatchId, null);
  const data = await loadOriginalMokuro(fastify, mokuroPath);

  // Replay (Reverse: Genesis -> Target)
  for (let i = history.length - 1; i >= 0; i--) {
    const patch = history[i];
    if (patch.operation && patch.operation !== '{}') {
      try {
        const op = JSON.parse(patch.operation);
        if (op.path !== 'genesis') {
          PatchApplicator.apply(data, op);
        }
      } catch (e) {
        fastify.log.error(`Patch apply failed during regen: ${e}`);
      }
    }
  }

  await saveSnapshot(fastify, branchId, data, targetPatchId);
  return data;
}

// --- Helper: Load Snapshot (internal) ---
// Returns snapshot data if valid, otherwise regenerates from genesis
export async function loadSnapshot(
  fastify: FastifyInstance,
  mokuroPath: string,
  branch: OcrBranch
): Promise<MokuroData> {
  const snapshotPath = path.join(fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${branch.id}.json`);

  try {
    const content = await fs.promises.readFile(snapshotPath, 'utf-8');
    const data: MokuroData = JSON.parse(content);

    // Validate: snapshot patchId must match DB
    if (data.patch_id === branch.snapshotPatchId) {
      return data;
    }

    fastify.log.warn(`Snapshot corruption detected for ${branch.id}`);
  } catch (e) {
    // File missing or unreadable
  }

  return regenerateFromGenesis(fastify, mokuroPath, branch.headPatchId, branch.id);
}

// --- Helper: Get Synced Snapshot ---
// Returns up-to-date MokuroData for a branch.
// Loads snapshot, syncs if stale, regenerates if corrupt/missing.
export async function syncSnapshot(
  fastify: FastifyInstance,
  mokuroPath: string,
  branch: OcrBranch
): Promise<MokuroData> {
  const data = await loadSnapshot(fastify, mokuroPath, branch);

  const startPatchId = branch.snapshotPatchId!;
  const endPatchId = branch.headPatchId;

  // Already up to date
  if (startPatchId === endPatchId) {
    return data;
  }

  const isForward = endPatchId > startPatchId;
  fastify.log.info(`Syncing snapshot ${startPatchId} -> ${endPatchId} (${isForward ? 'forward' : 'backward'})`);

  if (isForward) {
    const chain = await fetchAncestryChain(fastify.prisma, endPatchId, startPatchId);

    const last = chain[chain.length - 1];
    if (!last || last.parentId !== startPatchId) {
      fastify.log.warn(`Forward chain broken, regenerating from genesis`);
      return regenerateFromGenesis(fastify, mokuroPath, endPatchId, branch.id);
    }

    // Apply in chronological order (reverse of ancestry)
    for (let i = chain.length - 1; i >= 0; i--) {
      const p = chain[i];
      if (p.operation && p.operation !== '{}') {
        const op = JSON.parse(p.operation);
        if (op.path !== 'genesis') {
          PatchApplicator.apply(data, op);
        }
      }
    }
  } else {
    const chain = await fetchAncestryChain(fastify.prisma, startPatchId, endPatchId);

    const last = chain[chain.length - 1];
    if (!last || last.parentId !== endPatchId) {
      fastify.log.warn(`Backward chain broken, regenerating from genesis`);
      return regenerateFromGenesis(fastify, mokuroPath, endPatchId, branch.id);
    }

    // Invert in reverse chronological order
    for (const p of chain) {
      if (p.operation && p.operation !== '{}') {
        const op = JSON.parse(p.operation);
        if (op.path !== 'genesis') {
          const inv = PatchInverter.invert(op);
          PatchApplicator.apply(data, inv);
        }
      }
    }
  }

  await saveSnapshot(fastify, branch.id, data, endPatchId);
  return data;
}

// --- Helper: Ensure Admin Branch ---
export async function ensureAdminBranch(fastify: FastifyInstance, volumeId: string, mokuroPath: string) {
  let adminBranch = await fastify.prisma.ocrBranch.findUnique({
    where: { volumeId_userId: { volumeId, userId: 'admin' } }
  });

  if (!adminBranch) {
    const genesisPatch = await fastify.prisma.patch.create({
      data: { volumeId, userId: 'admin', parentId: null, operation: JSON.stringify({ op: 'replace', path: 'genesis' }) }
    });

    adminBranch = await fastify.prisma.ocrBranch.create({
      data: {
        volumeId,
        userId: 'admin',
        headPatchId: genesisPatch.id,
        rootPatchId: genesisPatch.id,
        snapshotPatchId: genesisPatch.id
      }
    });

    const data = await loadOriginalMokuro(fastify, mokuroPath);
    await saveSnapshot(fastify, adminBranch.id, data, genesisPatch.id);
  }
  return adminBranch;
}

// --- Helper: Ensure User Branch ---
export async function ensureUserBranch(
  fastify: FastifyInstance,
  volumeId: string,
  userId: string,
  adminBranch: OcrBranch
) {
  let userBranch = await fastify.prisma.ocrBranch.findUnique({
    where: { volumeId_userId: { volumeId, userId } }
  });

  if (!userBranch) {
    userBranch = await fastify.prisma.ocrBranch.create({
      data: {
        volumeId,
        userId,
        headPatchId: adminBranch.headPatchId,
        rootPatchId: null,
        snapshotPatchId: adminBranch.snapshotPatchId
      }
    });

    const adminSnapPath = path.join(fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${adminBranch.id}.json`);
    const userSnapPath = path.join(fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${userBranch.id}.json`);
    try {
      await fs.promises.copyFile(adminSnapPath, userSnapPath);
    } catch (e) {
      fastify.log.warn(`Admin snapshot missing, will regenerate on next read.`);
    }
  }
  return userBranch;
}

// ============================================================================
// HIGH-LEVEL HELPER
// ============================================================================

/**
 * Retrieves the fully computed MokuroData for a given user and volume.
 */
export async function getComputedMokuroState(
  fastify: FastifyInstance,
  userId: string,
  volume: { id: string; mokuroPath: string }
): Promise<MokuroData> {
  const adminBranch = await ensureAdminBranch(fastify, volume.id, volume.mokuroPath);
  const userBranch = await ensureUserBranch(fastify, volume.id, userId, adminBranch);
  return syncSnapshot(fastify, volume.mokuroPath, userBranch);
}
