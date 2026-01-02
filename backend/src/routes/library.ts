import { FastifyPluginAsync } from 'fastify';
import { pipeline, Readable } from 'stream';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { updateSeriesStatus } from '../utils/seriesStatus';
import { Prisma } from '../generated/prisma/client';
import { FastifyInstance } from 'fastify/types/instance';
import {
  deleteBranchSnapshots,
  ensureAdminBranch,
  ensureUserBranch,
  syncSnapshot
} from '../utils/ocrHelpers';

// Promisify pipeline for async/await
const pump = util.promisify(pipeline);

// --- Helpers ---

// Safe Filename (Security)
// Prevents directory traversal (../../) and illegal chars
function safeFilename(str: string): string {
  // Replace illegal chars with underscore, trim whitespace
  return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

// Cleanup Helper (Rollback)
async function deleteFolder(pathStr: string) {
  try {
    await fs.promises.rm(pathStr, { recursive: true, force: true });
  } catch (e) {
    console.error(`Failed to cleanup folder: ${pathStr}`, e);
  }
}

async function deleteSeriesById(fastify: FastifyInstance, seriesId: string, userId: string) {
  // 1. Find series with ownership check
  const series = await fastify.prisma.series.findFirst({
    where: { id: seriesId, ownerId: userId },
    include: {
      volumes: {
        include: {
          branches: { select: { id: true } }
        }
      }
    }
  });

  if (!series) {
    // Improvement: Check if it exists as Admin content to give a better error
    const adminSeries = await fastify.prisma.series.findFirst({
      where: { id: seriesId, ownerId: 'admin' }
    });
    if (adminSeries) {
      throw new Error('Cannot delete official content. Only the owner can delete this series.');
    }
    throw new Error('Series not found or access denied');
  }

  // 2. Cleanup Snapshots (Disk)
  const allBranchIds = series.volumes.flatMap((v: any) => v.branches.map((b: any) => b.id));
  await deleteBranchSnapshots(fastify, allBranchIds);

  // 3. Delete Series Directory (Disk)
  // Construct path deterministically: uploads/{userId}/{folderName}
  const seriesDirRelative = path.join('uploads', series.ownerId, series.folderName);
  const seriesDirAbsolute = path.join(fastify.projectRoot, seriesDirRelative);

  try {
    await fs.promises.rm(seriesDirAbsolute, { recursive: true, force: true });
  } catch (e) {
    fastify.log.error(`Failed to delete series directory: ${seriesDirAbsolute}. ${e}`);
  }

  // 4. Delete from DB (Cascade handles Volumes, Branches, Patches, Settings)
  await fastify.prisma.series.delete({ where: { id: seriesId } });

  return series.title || series.folderName;
}

async function deleteVolumeById(fastify: FastifyInstance, volumeId: string, userId: string) {
  // 1. Check if this is Official Content (Forbidden)
  const adminVolume = await fastify.prisma.volume.findFirst({
    where: { id: volumeId, series: { ownerId: 'admin' } }
  });

  if (adminVolume) {
    const err = new Error('Cannot delete official content. Only the admin can delete this volume.');
    (err as any).statusCode = 403;
    throw err;
  }

  // 2. Find volume with ownership check (via Series)
  const volume = await fastify.prisma.volume.findFirst({
    where: { id: volumeId, series: { ownerId: userId } },
    include: {
      series: {
        select: {
          id: true,
          ownerId: true,
          folderName: true,
          coverPath: true,
          _count: { select: { volumes: true } }
        }
      },
      branches: { select: { id: true } }
    }
  });

  if (!volume) {
    throw new Error('Volume not found or access denied');
  }

  // 3. Cleanup Snapshots (Disk)
  const branchIds = volume.branches.map((b: any) => b.id);
  await deleteBranchSnapshots(fastify, branchIds);

  // 4. Delete Volume Files (Disk)
  const absVolPath = path.join(fastify.projectRoot, volume.filePath);
  const absMokuroPath = path.join(fastify.projectRoot, volume.mokuroPath);

  try {
    await fs.promises.rm(absVolPath, { recursive: true, force: true });
    await fs.promises.rm(absMokuroPath, { force: true });
  } catch (e) {
    fastify.log.warn(`Failed to delete volume files: ${e}`);
  }

  // 5. Delete from DB
  await fastify.prisma.volume.delete({ where: { id: volumeId } });

  // 6. Recalculate series status
  await updateSeriesStatus(fastify.prisma, userId, volume.seriesId);

  return volume.title || volume.folderName;
}

// File consume
// Drains a readable stream completely by resuming it and waiting for the 'end' event.
// This is used to discard file contents we don't want to save.

function drainStream(stream: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.resume(); // Start the flow
  });
}

interface UploadMetadata {
  series_title?: string;
  series_description?: string;
  volume_title?: string;
  series_bookmarked?: boolean;
  // Progress Interface
  volume_progress?: {
    page: number;
    isCompleted: boolean;
    timeRead: number;
    charsRead: number;
  };
}

// an interface for the route parameters
interface VolumeParams {
  id: string; // This 'id' is the volumeId
}

interface SeriesParams {
  id: string; // This 'id' is the seriesId
}

// get request query
interface LibraryQuery {
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

interface MokuroPage { }

const libraryRoutes: FastifyPluginAsync = async (
  fastify,
  opts
): Promise<void> => {
  // Protect all routes in this file
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * GET /api/library
   * Gets a list of all Series and Volume metadata visible to the current user.
   * Includes both private uploads and Admin's shared content.
   */
  fastify.get<{ Querystring: LibraryQuery }>('/', async (request, reply) => {
    const userId = request.user.id;

    // 1. Parse Query Params
    const page = Math.max(1, request.query.page ?? 1);
    const limit = Math.max(1, Math.min(100, request.query.limit ?? 20));
    const q = request.query.q?.trim() ?? '';
    const sort = request.query.sort ?? 'title';
    const order = request.query.order ?? 'asc';
    const status = request.query.status ?? 'all';
    const bookmarked = request.query.bookmarked === 'true';
    const filter_missing = request.query.filter_missing ?? 'none';
    const is_organized = request.query.is_organized;

    // --- HELPER: Flatten Series + Settings ---
    // Merges the separate "Settings" object back into the "Series" object
    // so the frontend receives the flat structure it expects.
    const transformSeries = (series: any, settings?: any) => {
      // If we came from the 'recent' sort, settings are passed directly.
      // If we came from standard sort, settings are in series.userSettings[0].
      const userStats = settings || (series.userSettings && series.userSettings[0]);

      // Remove internal relations we don't want to send raw
      const { userSettings, ...cleanSeries } = series;

      return {
        ...cleanSeries,
        // 1. Flattened User State (Defaults if no interaction yet)
        bookmarked: userStats?.bookmarked ?? false,
        status: userStats?.status ?? 0,
        organized: userStats?.organized ?? false,
        lastReadAt: userStats?.lastReadAt ?? new Date(0), // Epoch if never read

        // 2. Computed "Official" Indicator
        isOfficial: series.ownerId === 'admin',

        // 3. Permissions Flag (Optional, helps frontend disable delete buttons)
        canEdit: series.ownerId === userId
      };
    };

    // --- QUERY BUILDERS ---

    const seriesWhere: Prisma.SeriesWhereInput = {
      AND: [
        { OR: [{ ownerId: userId }, { ownerId: 'admin' }] }
      ]
    };
    const andConditions = (seriesWhere.AND as Prisma.SeriesWhereInput[]);

    // A. Text Search
    if (q) {
      andConditions.push({
        OR: [
          { sortTitle: { contains: q } },
          { japaneseTitle: { contains: q } },
          { romajiTitle: { contains: q } },
          { synonyms: { contains: q } },
        ]
      });
    }

    // B. Missing Metadata Filters
    if (filter_missing !== 'none') {
      if (filter_missing === 'cover') andConditions.push({ coverPath: null });
      else if (filter_missing === 'description') andConditions.push({ OR: [{ description: null }, { description: "" }] });
      else if (filter_missing === 'title') andConditions.push({ OR: [{ japaneseTitle: null }, { romajiTitle: null }] });
      else if (filter_missing === 'any') andConditions.push({ OR: [{ coverPath: null }, { description: null }, { japaneseTitle: null }] });
    }

    // C. User Settings Filters (Status, Bookmark, Organized)
    const addUserFilter = (filter: Prisma.UserSeriesSettingsWhereInput) => {
      andConditions.push({ userSettings: { some: { userId: userId, ...filter } } });
    };

    if (bookmarked) addUserFilter({ bookmarked: true });
    if (is_organized === 'true') addUserFilter({ organized: true });
    else if (is_organized === 'false') {
      andConditions.push({
        OR: [{ userSettings: { none: { userId } } }, { userSettings: { some: { userId, organized: false } } }]
      });
    }

    if (status === 'reading') addUserFilter({ status: 1 });
    else if (status === 'read') addUserFilter({ status: 2 });
    else if (status === 'unread') {
      andConditions.push({
        OR: [{ userSettings: { none: { userId } } }, { userSettings: { some: { userId, status: 0 } } }]
      });
    }

    try {
      // BRANCH A: "Recently Read" (Query UserSeriesSettings)
      if (sort === 'recent') {
        const [total, settings] = await fastify.prisma.$transaction([
          fastify.prisma.userSeriesSettings.count({
            where: { userId, series: seriesWhere }
          }),
          fastify.prisma.userSeriesSettings.findMany({
            where: { userId, series: seriesWhere },
            orderBy: { lastReadAt: order },
            take: limit,
            skip: (page - 1) * limit,
            include: {
              series: {
                include: {
                  volumes: {
                    orderBy: { sortTitle: 'asc' },
                    select: {
                      pageCount: true,
                      progress: { where: { userId }, select: { completed: true, page: true } }
                    }
                  }
                }
              }
            }
          })
        ]);

        const data = settings.map((s: any) => transformSeries(s.series, s));

        return reply.send({
          data,
          meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
      }

      // BRANCH B: Standard Sort (Query Series)
      else {
        let orderBy: any;
        if (sort === 'created') orderBy = { createdAt: order };
        else if (sort === 'updated') orderBy = { updatedAt: order };
        else orderBy = { sortTitle: order };

        const [total, seriesList] = await fastify.prisma.$transaction([
          fastify.prisma.series.count({ where: seriesWhere }),
          fastify.prisma.series.findMany({
            where: seriesWhere,
            orderBy,
            take: limit,
            skip: (page - 1) * limit,
            include: {
              // Include settings to flatten them later
              userSettings: { where: { userId } },
              volumes: {
                orderBy: { sortTitle: 'asc' },
                select: {
                  pageCount: true,
                  progress: { where: { userId }, select: { completed: true, page: true } }
                }
              },
            },
          }),
        ]);

        const data = seriesList.map((s: any) => transformSeries(s));

        return reply.send({
          data,
          meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
      }

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ message: 'Could not retrieve library.' });
    }
  });

  /**
   * POST /api/library/check
   * Quick check to see if a Series/Volume pair already exists.
   * Prevents "EPIPE" errors by avoiding redundant uploads.
   */
  fastify.post<{ Body: { series_folder_name: string; volume_folder_name: string } }>(
    '/check',
    async (request, reply) => {
      const { series_folder_name, volume_folder_name } = request.body;
      const userId = request.user.id;

      if (!series_folder_name || !volume_folder_name) {
        return reply.status(400).send({ message: 'Missing identifiers' });
      }

      const exists = await fastify.prisma.volume.findFirst({
        where: {
          folderName: volume_folder_name,
          series: {
            folderName: series_folder_name,
            ownerId: userId
          }
        },
        select: { id: true } // Select minimal data
      });

      return reply.send({ exists: !!exists });
    }
  );

  /**
   * POST /api/library/upload
   * Smart Pipeline Upload: Receives one volume at a time.
   * STRICT ORDER: Fields (Identifiers) MUST come before Files.
   */
  fastify.post('/upload', async (request, reply) => {
    const userId = request.user.id;

    // Context State
    let seriesFolder = '';
    let volumeFolder = '';
    let metadata: UploadMetadata = {};

    let targetDir = '';
    let pageCount = 0;

    // Track specific files for DB updates
    let mokuroPathRelative = '';
    let coverImageName: string | null = null;
    let potentialSeriesCoverPath: string | null = null;

    try {
      for await (const part of request.parts()) {

        // --- PHASE 1: Metadata Fields (Must come first) ---
        if (part.type === 'field') {
          const value = typeof part.value === 'string' ? part.value.trim() : '';

          if (part.fieldname === 'series_folder_name') seriesFolder = safeFilename(value);
          if (part.fieldname === 'volume_folder_name') volumeFolder = safeFilename(value);

          if (part.fieldname === 'metadata') {
            try {
              metadata = JSON.parse(value);
            } catch (e) {
              fastify.log.warn('Invalid metadata JSON provided in upload.');
            }
          }
        }

        // --- PHASE 2: File Stream ---
        if (part.type === 'file') {
          // 1. Validation: Ensure we have folders before accepting files
          if (!seriesFolder || !volumeFolder) {
            // Consume stream to prevent hanging, then throw
            await drainStream(part.file);
            throw new Error('Missing folder identifiers. Metadata must be sent before files.');
          }

          // 2. Prepare Directory (Once)
          if (!targetDir) {
            // Check DB for duplicates BEFORE writing to disk (Fail Fast)
            const exists = await fastify.prisma.volume.findFirst({
              where: {
                folderName: volumeFolder,
                series: { folderName: seriesFolder, ownerId: userId }
              }
            });

            if (exists) {
              // Consume stream to prevent hanging, then throw
              await drainStream(part.file);
              return reply.status(409).send({ message: `Volume '${volumeFolder}' already exists.` });
            }

            // Create Directory: uploads/UserId/Series/Volume
            const relativeDir = path.join('uploads', userId, seriesFolder, volumeFolder);
            targetDir = path.join(fastify.projectRoot, relativeDir);
            await fs.promises.mkdir(targetDir, { recursive: true });
          }

          // We flatten the filename (ignore client paths like "Naruto/Vol 1/001.jpg")
          const safeName = safeFilename(path.basename(part.filename));
          let absPath = path.join(targetDir, safeName); // default save path

          // 3. Identify Special Files
          const isMokuro = safeName.endsWith('.mokuro');
          const isImage = /\.(jpg|jpeg|png|webp)$/i.test(safeName);
          const isCoverImage = isImage && path.parse(safeName).name === seriesFolder;

          if (isMokuro) {
            mokuroPathRelative = path.join('uploads', userId, seriesFolder, safeName).replace(/\\/g, '/');
            absPath = path.join(fastify.projectRoot, mokuroPathRelative);
          }

          else if (isCoverImage) {
            potentialSeriesCoverPath = path.join('uploads', userId, seriesFolder, safeName).replace(/\\/g, '/');
            absPath = path.join(fastify.projectRoot, potentialSeriesCoverPath);
          }

          else if (isImage) {
            // Only use as Volume Cover if it's NOT the series cover
            // and if we haven't found any other image yet
            if (!coverImageName) coverImageName = safeName;
            // increment page count
            pageCount++;
          }

          else {
            // invalid file, skip
            await drainStream(part.file);
            continue;
          }

          // 4. Save File
          await pump(part.file, fs.createWriteStream(absPath));
        }
      }

      // --- PHASE 3: Database Update ---
      if (pageCount === 0) throw new Error('No files received.');
      if (!mokuroPathRelative) throw new Error('Mokuro file missing.');

      // 1. Upsert Series (SHARED METADATA ONLY)
      let series = await fastify.prisma.series.findFirst({
        where: { folderName: seriesFolder, ownerId: userId }
      });

      if (!series) {
        series = await fastify.prisma.series.create({
          data: {
            ownerId: userId,
            folderName: seriesFolder,
            title: metadata.series_title || null,
            description: metadata.series_description || null,
            sortTitle: metadata.series_title || seriesFolder,
            // If we found a file matching "SeriesName.jpg", use it as cover
            coverPath: potentialSeriesCoverPath
          }
        });
      } else {
        // Prepare partial update
        let updateData: Prisma.SeriesUpdateInput = { updatedAt: new Date() };
        if (metadata.series_title && !series.title) {
          updateData.title = metadata.series_title;
          updateData.sortTitle = metadata.series_title;
        }
        if (metadata.series_description && !series.description) {
          updateData.description = metadata.series_description;
        }
        if (potentialSeriesCoverPath && !series.coverPath) {
          updateData.coverPath = potentialSeriesCoverPath;
        }

        await fastify.prisma.series.update({
          where: { id: series.id },
          data: updateData
        });
      }

      // 2. Handle User Settings (PRIVATE METADATA)
      // We must explicitly upsert the settings to save the bookmark
      await fastify.prisma.userSeriesSettings.upsert({
        where: { userId_seriesId: { userId, seriesId: series.id } },
        update: {
          // If metadata specifically sends true/false, update it.
          // If undefined, keep existing state.
          bookmarked: metadata.series_bookmarked !== undefined ? metadata.series_bookmarked : undefined
        },
        create: {
          userId,
          seriesId: series.id,
          bookmarked: metadata.series_bookmarked ?? false,
          // Default status is 0 (Unread)
        }
      });

      // 3. Create Volume
      const volumePathRelative = path.join('uploads', userId, seriesFolder, volumeFolder).replace(/\\/g, '/');
      const volume = await fastify.prisma.volume.create({
        data: {
          seriesId: series.id,
          folderName: volumeFolder,
          title: metadata.volume_title || null,
          sortTitle: metadata.volume_title || volumeFolder,
          pageCount: pageCount,
          filePath: volumePathRelative,
          mokuroPath: mokuroPathRelative || '',
          coverImageName: coverImageName
        }
      });

      // 4. Update Progress (if provided)
      if (metadata.volume_progress) {
        await fastify.prisma.userProgress.upsert({
          where: { userId_volumeId: { userId, volumeId: volume.id } },
          update: {
            page: metadata.volume_progress.page,
            completed: metadata.volume_progress.isCompleted
          },
          create: {
            userId: userId,
            volumeId: volume.id,
            page: metadata.volume_progress.page,
            completed: metadata.volume_progress.isCompleted
          }
        });

        // Recalculate Series Status via Settings (Helper handles the redirection)
        await updateSeriesStatus(fastify.prisma, userId, series.id);
      }

      return reply.status(200).send({
        message: 'Upload processed.',
        processed: 1,
        volumeId: volume.id
      });

    } catch (err) {
      // ROLLBACK
      if (targetDir) await deleteFolder(targetDir);

      fastify.log.error(err);
      return reply.status(500).send({
        message: (err as Error).message || 'Upload failed.'
      });
    }
  });

  /**
   * POST /api/library/series/:id/cover
   * Uploads and sets the cover image for a series.
   */
  fastify.post<{ Params: SeriesParams }>(
    '/series/:id/cover',
    async (request, reply) => {
      const { id: seriesId } = request.params;
      const userId = request.user.id;

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ message: 'No file uploaded.' });
      }

      try {
        // 1. Verify ownership and get series details
        const series = await fastify.prisma.series.findFirst({
          where: { id: seriesId, ownerId: userId }
        });

        if (!series) {
          // Consume stream to avoid hanging
          await data.toBuffer();
          return reply.status(404).send({ message: 'Series not found.' });
        }

        // 2. Determine paths
        // We need to find the series root directory. We can infer it.
        // Based on upload logic, it's 'uploads/<userId>/<seriesFolderName>/'
        const seriesDirRelative = path.join('uploads', userId, series.folderName);
        const seriesDirAbsolute = path.join(
          fastify.projectRoot,
          seriesDirRelative
        );

        // Ensure directory exists (it should, but good practice)
        await fs.promises.mkdir(seriesDirAbsolute, { recursive: true });

        // 3. Construct new filename: <seriesFolderName>.<ext>
        const ext = path.extname(data.filename).toLowerCase() || '.jpg';
        const newFileName = `${series.folderName}${ext}`;
        const filePathAbsolute = path.join(seriesDirAbsolute, newFileName);
        const filePathRelative = path.join(seriesDirRelative, newFileName);

        // 4. Save file
        await pump(data.file, fs.createWriteStream(filePathAbsolute));

        // 5. Update DB with absolute path (or relative if you prefer consistent storage)
        // Storing absolute path for consistency with volume.filePath
        await fastify.prisma.series.update({
          where: { id: seriesId },
          data: { coverPath: filePathRelative.replace(/\\/g, '/') }
        });

        return reply.status(200).send({ message: 'Cover updated successfully.' });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Failed to upload cover.' });
      }
    }
  );

  /**
   * GET /api/library/series/:id
   * Gets full data for one series, including its volumes.
   * Flattens user settings into the series object, but keeps volume progress as an array.
   */
  fastify.get<{ Params: SeriesParams }>(
    '/series/:id',
    async (request, reply) => {
      const { id: seriesId } = request.params;
      const userId = request.user.id;

      try {
        const series = await fastify.prisma.series.findFirst({
          where: {
            id: seriesId,
            OR: [{ ownerId: userId }, { ownerId: 'admin' }]
          },
          include: {
            userSettings: { where: { userId } },
            volumes: {
              orderBy: { sortTitle: 'asc' },
              include: {
                progress: {
                  where: { userId: userId },
                  select: {
                    page: true,
                    completed: true,
                    timeRead: true,
                    charsRead: true,
                    lastReadAt: true
                  }
                }
              }
            },
          },
        });

        if (!series) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Series not found or you do not have permission to access it.',
          });
        }

        const userStats = series.userSettings[0];
        const { userSettings, ...cleanSeries } = series;

        const response = {
          ...cleanSeries,
          bookmarked: userStats?.bookmarked ?? false,
          status: userStats?.status ?? 0,
          organized: userStats?.organized ?? false,
          lastReadAt: userStats?.lastReadAt ?? new Date(0),

          // Computed "Official" Indicator
          isOfficial: series.ownerId === 'admin',

          // Permissions Flag (helps frontend disable delete/edit buttons)
          canEdit: series.ownerId === userId
        };

        return reply.status(200).send(response);

      } catch (error) {
        fastify.log.error({ err: error }, 'Error fetching single series');
        return reply.status(500).send({ message: 'An unexpected error occurred.' });
      }
    }
  );

  /**
   * GET /api/library/volume/:id
   * Gets full data for one volume, including the parsed .mokuro JSON.
   */
  fastify.get<{ Params: { id: string } }>(
    '/volume/:id',
    async (request, reply) => {
      const { id: volumeId } = request.params;
      try {
        const volume = await request.accessStrategy.getVolume(volumeId);
        return volume;
      } catch (err: any) {
        if (err.message.includes('not found') || err.message.includes('access denied')) {
          return reply.code(404).send({ error: err.message });
        }
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  /**
     * DELETE /api/library/series/:id
     * Deletes an entire series, all its volumes, and all associated files.
     */
  fastify.delete<{ Params: SeriesParams }>(
    '/series/:id',
    async (request, reply) => {
      try {
        await deleteSeriesById(fastify, request.params.id, request.user.id);
        return reply.status(200).send({ message: 'Series deleted successfully.' });
      } catch (error) {
        fastify.log.error(
          { err: error },
          'Error deleting series'
        );
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred while deleting the series.'
        });
      }
    }
  );

  /**
   * DELETE /api/library/volume/:id
   * Deletes a single volume, its files, and its progress.
   */
  fastify.delete<{ Params: VolumeParams }>(
    '/volume/:id',
    async (request, reply) => {
      try {
        await deleteVolumeById(fastify, request.params.id, request.user.id);
        return reply.status(200).send({ message: 'Volume deleted successfully.' });
      } catch (error) {
        fastify.log.error(
          { err: error },
          'Error deleting volume'
        );
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred while deleting the volume.'
        });
      }
    }
  );

  /**
     * POST /api/library/batch/delete
     * Bulk deletion for Series or Volumes.
     */
  fastify.post<{ Body: { ids: string[]; type: 'series' | 'volume' } }>(
    '/batch/delete',
    async (request, reply) => {
      const { ids, type } = request.body;
      const userId = request.user.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ message: 'No IDs provided' });
      }

      const results = {
        success: [] as string[],
        errors: [] as { id: string; error: string }[]
      };

      // Execute sequentially to prevent file system locking issues
      for (const id of ids) {
        try {
          if (type === 'series') {
            await deleteSeriesById(fastify, id, userId);
            results.success.push(id);
          } else {
            await deleteVolumeById(fastify, id, userId);
            results.success.push(id);
          }
        } catch (e) {
          fastify.log.error(e);
          results.errors.push({ id, error: (e as Error).message });
        }
      }

      return reply.send({
        message: `Deleted ${results.success.length} items. Failed: ${results.errors.length}`,
        results
      });
    }
  );
};

export default libraryRoutes;
