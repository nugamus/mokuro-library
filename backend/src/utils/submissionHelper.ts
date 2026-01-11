import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { HttpError } from '../types/error';

export interface VolumeMovePlan {
  volumeId: string;
  folderName: string;
  oldPathAbs: string;
  newPathRel: string;
  newPathAbs: string;
  newMokuroRel: string;
}

export interface SubmissionExecutionPlan {
  targetSeriesId: string | null;
  targetSeriesFolder: string;
  volumeMoves: VolumeMovePlan[];
  newSeriesData?: {
    folderName: string;
    title: string | null;
    description: string | null;
    sortTitle: string;
    coverPath: string | null;
  };
}

/**
 * Validates a submission request against the current Admin Library state.
 * Returns an Execution Plan if valid.
 */
export async function validateAndPlanSubmission(
  fastify: FastifyInstance,
  targetSeriesId: string | null | undefined,
  sourceSeries: {
    folderName: string;
    title?: string | null;
    description?: string | null;
    sortTitle: string;
    coverPath?: string | null
  },
  volumes: { id: string; folderName: string; filePath: string; mokuroPath: string }[]
): Promise<SubmissionExecutionPlan> {
  const projectRoot = fastify.projectRoot;
  let targetSeriesFolder = '';
  let newSeriesData: SubmissionExecutionPlan['newSeriesData'] = undefined;

  // --- 1. Series Validation ---
  if (!targetSeriesId) {

    const existing = await fastify.prisma.series.findUnique({
      where: { folderName_ownerId: { folderName: sourceSeries.folderName, ownerId: 'admin' } }
    });

    if (existing) {
      throw new HttpError(409, `Series '${sourceSeries.folderName}' already exists...`);
    }

    targetSeriesFolder = sourceSeries.folderName;
    newSeriesData = {
      folderName: sourceSeries.folderName,
      title: sourceSeries.title ?? null,
      description: sourceSeries.description ?? null,
      sortTitle: sourceSeries.sortTitle,
      coverPath: sourceSeries.coverPath ?? null
    };
  } else {
    const targetSeries = await fastify.prisma.series.findUnique({ where: { id: targetSeriesId } });
    if (!targetSeries) {
      throw new HttpError(404, 'Target series not found.');
    }
    targetSeriesFolder = targetSeries.folderName;
  }

  // --- 2. Volume & File System Validation ---
  const volumeMoves: VolumeMovePlan[] = [];
  const adminSeriesDirRel = path.join('uploads', 'admin', targetSeriesFolder);

  for (const vol of volumes) {
    if (targetSeriesId) {
      const collision = await fastify.prisma.volume.findFirst({
        where: { seriesId: targetSeriesId, folderName: vol.folderName }
      });
      if (collision) {
        throw new HttpError(409, `Volume '${vol.folderName}' already exists in the target series.`);
      }
    }

    const oldPathAbs = path.join(projectRoot, vol.filePath);
    const newPathRel = path.join(adminSeriesDirRel, vol.folderName);
    const newPathAbs = path.join(projectRoot, newPathRel);

    try {
      await fs.promises.access(newPathAbs);
      throw new HttpError(409, `Target directory already exists on disk: ${newPathRel}`);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    let newMokuroRel = vol.mokuroPath;
    if (vol.mokuroPath) {
      const fileName = path.basename(vol.mokuroPath);
      newMokuroRel = path.join(newPathRel, fileName).replace(/\\/g, '/');
    }

    volumeMoves.push({
      volumeId: vol.id,
      folderName: vol.folderName,
      oldPathAbs,
      newPathRel: newPathRel.replace(/\\/g, '/'),
      newPathAbs,
      newMokuroRel
    });
  }

  return {
    targetSeriesId: targetSeriesId || null,
    targetSeriesFolder,
    volumeMoves,
    newSeriesData
  };
}

/**
 * Executes the file moves defined in the plan using atomic renames.
 * Includes automatic rollback if any move fails.
 */
export async function executeMovePlan(
  fastify: FastifyInstance,
  moves: VolumeMovePlan[]
): Promise<void> {
  const movedVolumes: VolumeMovePlan[] = [];

  try {
    for (const move of moves) {
      // Ensure parent dir exists
      await fs.promises.mkdir(path.dirname(move.newPathAbs), { recursive: true });

      // Atomic Rename
      await fs.promises.rename(move.oldPathAbs, move.newPathAbs);
      movedVolumes.push(move);
    }
  } catch (e) {
    fastify.log.error(`Partial failure during file move. Rolling back ${movedVolumes.length} volumes. Error: ${e}`);

    // Internal Rollback: Undo what we just did in this specific execution attempt
    await revertMoves(fastify, movedVolumes);

    throw new Error(`Failed to move volume files (Changes rolled back): ${e}`);
  }
}

/**
 * Reverts a list of volume moves.
 * Used internally by executeMovePlan for partial failures,
 * or externally by Strategies if a DB transaction fails after a successful move.
 */
export async function revertMoves(
  fastify: FastifyInstance,
  moves: VolumeMovePlan[]
): Promise<void> {
  // Process in reverse order to unwind the stack
  for (const moved of [...moves].reverse()) {
    try {
      // We assume the old parent directory still exists (standard for move operations)
      await fs.promises.rename(moved.newPathAbs, moved.oldPathAbs);
    } catch (rollbackError) {
      fastify.log.error(`CRITICAL: Failed to rollback volume ${moved.folderName}. Filesystem may be inconsistent. ${rollbackError}`);
    }
  }
}
