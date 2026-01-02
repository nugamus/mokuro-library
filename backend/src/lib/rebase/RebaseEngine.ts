import { ulid } from 'ulid';
import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import {
  RebaseResult,
  Resolution,
  ExtendedPatch,
  ResolutionType,
  Effect
} from '../../types/rebase';
import { PatchOperation } from '../../types/history';
import { PatchTransformer } from './PatchTransformer';
import { EffectFactory } from './Effect';
import { fetchAncestryChain, saveSnapshot, syncSnapshot } from '../../utils/ocrHelpers';
import { OcrBranch, Prisma } from '../../generated/prisma/client';

interface RebaseContext {
  sessionId: string;
  branchId: string;
  userId: string;

  adminChain: ExtendedPatch[];
  originalUserChain: ExtendedPatch[];  // Genesis (for restore)

  // Hot state
  currentPatches: ExtendedPatch[];     // Patches entering current admin round
  pendingPatches: ExtendedPatch[];     // Patches already processed this admin round
  currentAdminIndex: number;           // Position in adminChain
  currentUserIndex: number;            // Position in currentPatches (within admin loop)
  currentEffect: Effect;               // Effect at pause point

  resolutions: Map<string, ResolutionType>;  // Key: `${adminPatchId}:${userPatchId}`
  targetHeadId: string;
  originalBranchHeadId: string;
}

const sessionCache = new Map<string, RebaseContext>();

export class RebaseEngine {
  constructor(private fastify: FastifyInstance) { }

  private get prisma() {
    return this.fastify.prisma;
  }

  /**
   * Starts a new rebase session.
   */
  async start(volumeId: string, userId: string): Promise<RebaseResult> {
    const branch = await this.prisma.ocrBranch.findUnique({
      where: { volumeId_userId: { volumeId, userId } },
      include: { rootPatch: true, headPatch: true }
    });
    if (!branch) throw new Error('Branch not found');

    const adminBranch = await this.prisma.ocrBranch.findUnique({
      where: { volumeId_userId: { volumeId, userId: 'admin' } }
    });
    if (!adminBranch) throw new Error('Admin branch not found');

    // --- Check 1: Clean State ---
    if (!branch.rootPatchId) {
      await this.fastForward(branch, adminBranch);
      return { status: 'complete' };
    }

    // --- Check 2: Already Up to Date ---
    if (branch.headPatchId === adminBranch.headPatchId) {
      return { status: 'complete' };
    }

    // --- Check 3: Invalid Divergence (Detached) ---
    const rootPatch = await this.prisma.patch.findUnique({ where: { id: branch.rootPatchId } });

    if (!rootPatch || !rootPatch.parentId) {
      await this.fastForward(branch, adminBranch);
      return { status: 'complete' };
    }

    // --- 4. Initialize Session ---
    const adminChainRaw = await fetchAncestryChain(this.prisma, adminBranch.headPatchId, rootPatch.parentId);
    const userChainRaw = await fetchAncestryChain(this.prisma, branch.headPatchId, rootPatch.parentId);

    // Parse operations and reverse to chronological order
    const adminChain: ExtendedPatch[] = adminChainRaw.reverse().map(p => ({
      id: p.id,
      parentId: p.parentId,
      operation: JSON.parse(p.operation) as PatchOperation
    }));

    const userChain: ExtendedPatch[] = userChainRaw.reverse().map(p => ({
      id: p.id,
      parentId: p.parentId,
      operation: JSON.parse(p.operation) as PatchOperation
    }));

    const session = await this.prisma.rebaseSession.create({
      data: {
        branchId: branch.id,
        targetHeadPatchId: adminBranch.headPatchId,
        headPatchIdSnapshot: branch.headPatchId,
        resolutions: '[]',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24)
      }
    });

    const context: RebaseContext = {
      sessionId: session.id,
      branchId: branch.id,
      userId,
      adminChain,
      originalUserChain: userChain,
      currentPatches: userChain,
      pendingPatches: [],
      currentAdminIndex: 0,
      currentUserIndex: 0,
      currentEffect: { type: 'identity', path: '/' },
      resolutions: new Map(),
      targetHeadId: adminBranch.headPatchId,
      originalBranchHeadId: branch.headPatchId
    };
    sessionCache.set(session.id, context);

    return this.runSimulation(context);
  }

  /**
   * Continues an existing rebase with a new resolution.
   */
  async continue(rebaseId: string, resolution: ResolutionType): Promise<RebaseResult> {
    let context = sessionCache.get(rebaseId);
    if (!context) {
      context = await this.restoreSession(rebaseId);
    }

    // Get current conflict from hot state
    const adminPatch = context.adminChain[context.currentAdminIndex];
    const userPatch = context.currentPatches[context.currentUserIndex];

    if (!adminPatch || !userPatch) {
      throw new Error('No pending conflict to resolve');
    }

    // Key: adminPatchId:userPatchId
    const resolutionKey = `${adminPatch.id}:${userPatch.id}`;
    context.resolutions.set(resolutionKey, resolution);

    await this.prisma.rebaseSession.update({
      where: { id: rebaseId },
      data: { resolutions: JSON.stringify([...context.resolutions.entries()]) }
    });

    // Continue from hot state (no replay needed)
    return this.runSimulation(context);
  }

  /**
   * Deletes hot and db sessions
   */
  async abort(rebaseId: string): Promise<void> {
    const deleted = sessionCache.delete(rebaseId);

    try {
      await this.prisma.rebaseSession.delete({ where: { id: rebaseId } });
    } catch (e) {
      // Only throw if it wasn't in memory cache either
      if (!deleted) {
        throw new Error('Rebase session not found');
      }
      // Was in memory but not DB — possible expiry, log but don't throw
      this.fastify.log.warn(`Rebase session ${rebaseId} not found in DB (may have expired)`);
    }
  }

  // --- Internal Logic ---

  private async runSimulation(ctx: RebaseContext, commit = true): Promise<RebaseResult> {
    let currentPatches = ctx.currentPatches;

    for (let i = ctx.currentAdminIndex; i < ctx.adminChain.length; i++) {
      const adminPatch = ctx.adminChain[i];

      // Use saved effect if resuming mid-admin-patch, otherwise compute fresh
      let currentEffect = (i === ctx.currentAdminIndex && ctx.currentUserIndex > 0)
        ? ctx.currentEffect
        : EffectFactory.fromOperation(adminPatch.operation);

      // Start with pending patches from partial round, or empty
      const nextPatches: ExtendedPatch[] = (i === ctx.currentAdminIndex)
        ? [...ctx.pendingPatches]
        : [];

      // Determine starting user index (resume point or 0)
      const startUserIndex = (i === ctx.currentAdminIndex) ? ctx.currentUserIndex : 0;

      for (let j = startUserIndex; j < currentPatches.length; j++) {
        const userPatch = currentPatches[j];
        const resolutionKey = `${adminPatch.id}:${userPatch.id}`;
        const resolution = ctx.resolutions.get(resolutionKey);

        const result = PatchTransformer.transform(
          userPatch,
          currentEffect,
          adminPatch,
          resolution
        );

        if (!result.success) {
          // Save hot state before returning
          ctx.currentPatches = currentPatches;
          ctx.pendingPatches = nextPatches;
          ctx.currentAdminIndex = i;
          ctx.currentUserIndex = j;
          ctx.currentEffect = currentEffect;

          return {
            status: 'paused',
            rebaseId: ctx.sessionId,
            conflict: result.conflict
          };
        }

        currentEffect = result.effect;

        if (result.op) {
          nextPatches.push({
            id: userPatch.id,
            parentId: null,
            operation: result.op
          });
        }
      }

      currentPatches = nextPatches;

      // Reset just in case, but we won't use these until a pause
      ctx.pendingPatches = [];
      ctx.currentUserIndex = 0;
      ctx.currentEffect = { type: 'identity', path: '/' };
    }

    // Update hot state before commit
    ctx.currentPatches = currentPatches;
    ctx.pendingPatches = [];
    ctx.currentAdminIndex = ctx.adminChain.length;
    ctx.currentUserIndex = 0;

    if (commit) {
      await this.commit(ctx, currentPatches.map(p => p.operation));
    }
    return { status: 'complete', finalPatches: currentPatches.map(p => p.operation) };
  }

  private async commit(ctx: RebaseContext, finalOps: PatchOperation[]) {
    const newPatchesData: Prisma.PatchCreateManyInput[] = [];
    let prevId = ctx.targetHeadId;


    const currentBranch = await this.prisma.ocrBranch.findUnique({ where: { id: ctx.branchId } });
    if (!currentBranch || currentBranch.headPatchId !== ctx.originalBranchHeadId) {
      throw new Error('Branch was modified during rebase. Please retry.');
    }
    const adminBranch = await this.prisma.ocrBranch.findUnique({
      where: { volumeId_userId: { volumeId: currentBranch.volumeId, userId: 'admin' } }
    });
    if (!adminBranch) throw new Error('Admin branch not found');

    for (const op of finalOps) {
      const newId = ulid();
      newPatchesData.push({
        id: newId,
        parentId: prevId,
        volumeId: currentBranch.volumeId,
        userId: ctx.userId,
        operation: JSON.stringify(op),
        createdAt: new Date(),
      });
      prevId = newId;
    }

    await this.prisma.$transaction(async (tx: any) => {
      if (newPatchesData.length > 0) {
        await tx.patch.createMany({ data: newPatchesData });
      }

      const newHeadId = newPatchesData.length > 0
        ? newPatchesData[newPatchesData.length - 1].id
        : ctx.targetHeadId;

      const newRootId = newPatchesData.length > 0
        ? newPatchesData[0].id
        : null;

      await tx.ocrBranch.update({
        where: { id: ctx.branchId },
        data: {
          headPatchId: newHeadId,
          rootPatchId: newRootId,
          version: { increment: 1 },
          snapshotPatchId: adminBranch.snapshotPatchId
        }
      });


      await tx.rebaseSession.delete({ where: { id: ctx.sessionId } });

      if (ctx.originalUserChain.length > 0) {
        const oldRootId = ctx.originalUserChain[0].id;
        const exists = await tx.patch.findUnique({ where: { id: oldRootId } });
        if (exists) await tx.patch.delete({ where: { id: oldRootId } });
      }
    });

    // Copy admin snapshot to user
    const adminSnapPath = path.join(this.fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${adminBranch.id}.json`);
    const userSnapPath = path.join(this.fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${currentBranch.id}.json`);
    try {
      await fs.promises.copyFile(adminSnapPath, userSnapPath);
    } catch (e) {
      this.fastify.log.warn(`Admin snapshot missing for ${currentBranch.volumeId}, fixing admin and retrying...`);
      const new_data = (await syncSnapshot(this.fastify, adminBranch)).data;
      await saveSnapshot(this.fastify, currentBranch.id, new_data, new_data.patch_id ?? '');
    }
    sessionCache.delete(ctx.sessionId);
  }

  private async fastForward(branch: OcrBranch, adminBranch: OcrBranch) {
    await this.prisma.ocrBranch.update({
      where: { id: branch.id },
      data: {
        headPatchId: adminBranch.headPatchId,
        rootPatchId: null,
        snapshotPatchId: adminBranch.snapshotPatchId,
        version: { increment: 1 }
      }
    });

    // Copy admin snapshot to user
    const adminSnapPath = path.join(this.fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${adminBranch.id}.json`);
    const userSnapPath = path.join(this.fastify.projectRoot, 'uploads', 'cache', 'snapshots', `${branch.id}.json`);
    try {
      await fs.promises.copyFile(adminSnapPath, userSnapPath);
    } catch (e) {
      this.fastify.log.warn(`Admin snapshot missing for ${branch.volumeId}, fixing admin and retrying...`);
      const new_data = (await syncSnapshot(this.fastify, adminBranch)).data;
      await saveSnapshot(this.fastify, branch.id, new_data, new_data.patch_id ?? '');
    }
  }

  private async restoreSession(sessionId: string): Promise<RebaseContext> {
    const session = await this.prisma.rebaseSession.findUnique({
      where: { id: sessionId },
      include: { branch: true }
    });
    if (!session) throw new Error('Session expired or not found');

    const branch = session.branch;
    const rootPatch = await this.prisma.patch.findUnique({ where: { id: branch.rootPatchId! } });

    if (!rootPatch || !rootPatch.parentId) throw new Error('Invalid branch state for restore');

    const adminChainRaw = await fetchAncestryChain(this.prisma, session.targetHeadPatchId, rootPatch.parentId);
    const userChainRaw = await fetchAncestryChain(this.prisma, session.headPatchIdSnapshot, rootPatch.parentId);

    // Parse operations and reverse to chronological order
    const adminChain: ExtendedPatch[] = adminChainRaw.reverse().map(p => ({
      id: p.id,
      parentId: p.parentId,
      operation: JSON.parse(p.operation) as PatchOperation
    }));

    const userChain: ExtendedPatch[] = userChainRaw.reverse().map(p => ({
      id: p.id,
      parentId: p.parentId,
      operation: JSON.parse(p.operation) as PatchOperation
    }));

    const context: RebaseContext = {
      sessionId: session.id,
      branchId: session.branchId,
      userId: branch.userId,
      adminChain,
      originalUserChain: userChain,
      currentPatches: userChain,
      pendingPatches: [],
      currentAdminIndex: 0,
      currentUserIndex: 0,
      currentEffect: { type: 'identity', path: '/' },
      resolutions: new Map(JSON.parse(session.resolutions)),
      targetHeadId: session.targetHeadPatchId,
      originalBranchHeadId: session.headPatchIdSnapshot
    };

    // Replay from genesis to reconstruct hot state (no commit)
    await this.runSimulation(context, false);

    sessionCache.set(sessionId, context);
    return context;
  }
}
