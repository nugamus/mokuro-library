import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { PatchApplicator } from '../lib/PatchApplicator';
import { PatchInverter } from '../lib/PatchInverter';
import { MokuroData } from '../types/mokuro';

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
  data.patch_id = patchId; // Tag data
  await fs.promises.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.promises.writeFile(snapshotPath, JSON.stringify(data));

  // Update DB Pointer
  await fastify.prisma.ocrBranch.update({
    where: { id: branchId },
    data: { snapshotPatchId: patchId }
  });
}

// --- Helper: Fetch Ancestry Chain (CTE) ---
export async function fetchAncestryChain(fastify: FastifyInstance, startId: string, stopId: string | null = null) {
  return await fastify.prisma.$queryRaw<any[]>`
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
  const history = await fetchAncestryChain(fastify, targetPatchId, null);
  const data = await loadOriginalMokuro(fastify, mokuroPath);

  // Replay (Reverse: Root -> Target)
  for (let i = history.length - 1; i >= 0; i--) {
    const patch = history[i];
    if (patch.operation && patch.operation !== '{}') {
      try {
        const op = JSON.parse(patch.operation);
        PatchApplicator.apply(data, op);
      } catch (e) {
        fastify.log.error(`Patch apply failed during regen: ${e}`);
      }
    }
  }

  await saveSnapshot(fastify, branchId, data, targetPatchId);
  return data;
}

// --- Helper: Sync Snapshot to Head ---
export async function syncSnapshot(
  fastify: FastifyInstance,
  mokuroPath: string,
  data: MokuroData,
  startPatchId: string,
  endPatchId: string,
  branchId: string
): Promise<MokuroData> {
  if (startPatchId === endPatchId) return data;

  fastify.log.info(`Syncing snapshot ${startPatchId} -> ${endPatchId}`);
  const isLikelyForward = endPatchId > startPatchId;

  const tryForward = async () => {
    const chain = await fetchAncestryChain(fastify, endPatchId, startPatchId);
    const last = chain[chain.length - 1];
    if (last && last.parentId === startPatchId) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const p = chain[i];
        if (p.operation !== '{}') {
          PatchApplicator.apply(data, JSON.parse(p.operation));
        }
      }
      return true;
    }
    return false;
  };

  const tryBackward = async () => {
    const chain = await fetchAncestryChain(fastify, startPatchId, endPatchId);
    const last = chain[chain.length - 1];
    if (last && last.parentId === endPatchId) {
      for (const p of chain) {
        if (p.operation !== '{}') {
          const op = JSON.parse(p.operation);
          const inv = PatchInverter.invert(op);
          PatchApplicator.apply(data, inv);
        }
      }
      return true;
    }
    return false;
  };

  if (isLikelyForward) {
    if (await tryForward()) { await saveSnapshot(fastify, branchId, data, endPatchId); return data; }
    if (await tryBackward()) { await saveSnapshot(fastify, branchId, data, endPatchId); return data; }
  } else {
    if (await tryBackward()) { await saveSnapshot(fastify, branchId, data, endPatchId); return data; }
    if (await tryForward()) { await saveSnapshot(fastify, branchId, data, endPatchId); return data; }
  }

  return regenerateFromGenesis(fastify, mokuroPath, endPatchId, branchId);
}

// --- Helper: Ensure Admin Branch ---
export async function ensureAdminBranch(fastify: FastifyInstance, volumeId: string, mokuroPath: string) {
  let adminBranch = await fastify.prisma.ocrBranch.findUnique({
    where: { volumeId_userId: { volumeId, userId: 'admin' } }
  });

  if (!adminBranch) {
    const genesisPatch = await fastify.prisma.patch.create({
      data: { volumeId, userId: 'admin', parentId: null, operation: '{ "op": "replace", "path": "genesis" }' }
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
    data.patch_id = genesisPatch.id;
    await saveSnapshot(fastify, adminBranch.id, data, genesisPatch.id);
  }
  return adminBranch;
}

// --- Helper: Ensure User Branch ---
export async function ensureUserBranch(
  fastify: FastifyInstance,
  volumeId: string,
  userId: string,
  adminBranch: any
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
// HIGH-LEVEL HELPER (Reusable "Fetch State" Logic)
// ============================================================================

/**
 * Retrieves the fully computed MokuroData for a given user and volume.
 * Handles the entire lifecycle:
 * 1. Ensures Admin Branch exists
 * 2. Ensures User Branch exists (forks if needed)
 * 3. Loads Snapshot from disk
 * 4. Syncs or Regenerates if Snapshot is stale/corrupt
 * @param fastify Fastify Instance
 * @param userId The ID of the user requesting the data
 * @param volume The volume object (must include id and mokuroPath)
 * @returns The up-to-date MokuroData object
 */
export async function getComputedMokuroState(
  fastify: FastifyInstance,
  userId: string,
  volume: { id: string; mokuroPath: string }
): Promise<MokuroData> {
  // 1. Ensure Branches Exist
  const adminBranch = await ensureAdminBranch(fastify, volume.id, volume.mokuroPath);
  const userBranch = await ensureUserBranch(fastify, volume.id, userId, adminBranch);

  const snapshotPath = path.join(fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${userBranch.id}.json`);
  let mokuroData: MokuroData;

  // 2. Load Snapshot
  try {
    const content = await fs.promises.readFile(snapshotPath, 'utf-8');
    mokuroData = JSON.parse(content);
  } catch (e) {
    // Missing file -> Regenerate
    return regenerateFromGenesis(fastify, volume.mokuroPath, userBranch.headPatchId, userBranch.id);
  }

  // 3. Validate (Corruption Check)
  if (mokuroData.patch_id !== userBranch.snapshotPatchId) {
    fastify.log.warn(`Snapshot corruption detected for ${userBranch.id}.`);
    return regenerateFromGenesis(fastify, volume.mokuroPath, userBranch.headPatchId, userBranch.id);
  }

  // 4. Sync (Staleness Check)
  if (!userBranch.snapshotPatchId) {
    return regenerateFromGenesis(fastify, volume.mokuroPath, userBranch.headPatchId, userBranch.id);
  }

  if (userBranch.snapshotPatchId !== userBranch.headPatchId) {
    mokuroData = await syncSnapshot(
      fastify,
      volume.mokuroPath,
      mokuroData,
      userBranch.snapshotPatchId!,
      userBranch.headPatchId,
      userBranch.id
    );
  }

  return mokuroData;
}
