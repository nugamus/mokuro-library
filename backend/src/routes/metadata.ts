import { FastifyPluginAsync } from 'fastify';
import { FastifyInstance } from 'fastify/types/instance';
import { Prisma } from '../generated/prisma/client'; // Import Prisma for types
import { updateSeriesStatus } from '../utils/seriesStatus';
import * as path from 'path';
import * as fs from 'fs';


// Define a schema for the request body on PUT
// This ensures we only accept valid, partial data for an update
const progressBodySchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    timeRead: { type: 'integer', minimum: 0 },
    charsRead: { type: 'integer', minimum: 0 },
    completed: { type: 'boolean' },
  },
  // No required fields, as this is a partial update
};

const seriesUpdateSchema = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] }, // Allow string or explicit null
    description: { type: ['string', 'null'] },
    bookmarked: { type: 'boolean' },
    organized: { type: 'boolean' },
    japaneseTitle: { type: ['string', 'null'] },
    romajiTitle: { type: ['string', 'null'] },
    synonyms: { type: ['string', 'null'] },
    tempCoverPath: { type: ['string', 'null'] }
  }
};

const volumeUpdateSchema = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] } // Allow string or explicit null
  }
};

// Define an interface for our type-safe params
interface ProgressParams {
  id: string; // This 'id' is the volumeId
}

// Define an interface for our type-safe body
interface ProgressBody {
  page?: number;
  timeRead?: number;
  charsRead?: number;
  completed?: boolean;
}

// For Volume or Series id
interface IdParams {
  id: string;
}

// Updated Interface for Series Body
interface SeriesUpdateBody {
  title?: string | null;
  description?: string | null;
  bookmarked?: boolean;
  organized?: boolean;
  japaneseTitle?: string | null;
  romajiTitle?: string | null;
  synonyms?: string | null;
  tempCoverPath?: string;
}

// For anime/manga database scrape response
interface ScrapedManga {
  englishName?: string;
  japaneseName?: string;
  romajiName?: string;
  synonyms?: string[];
  description?: string;
  coverUrl?: string;
}

interface AniListResponse {
  data: {
    Media: {
      title: {
        english: string | null;
        native: string | null;
        romaji: string | null;
      };
      synonyms: string[];
      description: string | null;
      coverImage: {
        extraLarge: string | null;
        large: string | null;
        medium: string | null;
      };
    } | null;
  };
}
interface KitsuResponse {
  data: Array<{
    attributes: {
      canonicalTitle: string;
      titles: {
        en?: string;
        en_jp?: string;
        ja_jp?: string;
      };
      abbreviatedTitles: string[];
      synopsis: string | null;
      posterImage: {
        large: string | null;
        medium: string | null;
        small: string | null;
      };
    };
  }>;
}

interface MALResponse {
  data: Array<{
    title: string; // This is the default (usually romaji)
    title_english: string | null;
    title_japanese: string | null;
    title_synonyms: string[];
    synopsis: string | null;
    images: {
      jpg: {
        image_url: string;
        large_image_url: string | null;
      };
    };
  }>;
}

interface KitsuResponse {
  data: Array<{
    attributes: {
      canonicalTitle: string;
      titles: {
        en?: string;
        en_jp?: string;
        ja_jp?: string;
      };
      abbreviatedTitles: string[];
      synopsis: string | null;
      posterImage: {
        large: string | null;
        medium: string | null;
        small: string | null;
      };
    };
  }>;
}

// Helper utility to remove undefined keys
const compact = <T extends object>(obj: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  ) as Partial<T>;
};

/**
 * Helper function to fix common Mojibake encoding errors
 * Detects and fixes cases where UTF-8 was decoded as Latin-1
 */
function fixMojibake(text: string | undefined | null): string | undefined {
  if (!text) return text ?? undefined;

  // Common Mojibake patterns (UTF-8 bytes misinterpreted as Latin-1)
  const mojibakePatterns: [RegExp, string][] = [
    [/Ã©/g, 'é'],  // e with acute
    [/Ã¨/g, 'è'],  // e with grave
    [/Ã«/g, 'ë'],  // e with diaeresis
    [/Ã¢/g, 'â'],  // a with circumflex
    [/Ã /g, 'à'],  // a with grave
    [/Ã¤/g, 'ä'],  // a with diaeresis
    [/Ã§/g, 'ç'],  // c with cedilla
    [/Ã´/g, 'ô'],  // o with circumflex
    [/Ã¹/g, 'ù'],  // u with grave
    [/Ã»/g, 'û'],  // u with circumflex
    [/Ã¼/g, 'ü'],  // u with diaeresis
    [/Ã®/g, 'î'],  // i with circumflex
    [/Ã¯/g, 'ï'],  // i with diaeresis
    [/Å\u0093/g, 'œ'], // oe ligature
    [/Ã\u0089/g, 'É'], // E with acute
  ];

  let fixed = text;
  for (const [pattern, replacement] of mojibakePatterns) {
    fixed = fixed.replace(pattern, replacement);
  }

  return fixed;
}

/*
 * Helper function to scrape from a specific provider
 */
async function scrapeFromProvider(
  fastify: FastifyInstance,
  provider: 'anilist' | 'mal' | 'kitsu',
  seriesName: string
): Promise<ScrapedManga> {
  // Use a controller to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    switch (provider) {
      case 'anilist': {
        const query = `
          query ($search: String) {
            Media (search: $search, type: MANGA) {
              title { english native romaji }
              synonyms
              description
              coverImage { extraLarge large medium }
            }
          }
        `;
        const resp = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { search: seriesName } }),
          signal: controller.signal
        });

        if (!resp.ok) {
          fastify.log.error(`AniList API returned ${resp.status}: ${resp.statusText}`);
          return {};
        }

        const result = await resp.json() as AniListResponse;
        const media = result.data?.Media;
        if (!media) return {};

        return {
          englishName: fixMojibake(media.title?.english),
          romajiName: fixMojibake(media.title?.romaji),
          japaneseName: fixMojibake(media.title?.native),
          synonyms: (media.synonyms || []).map((s: string) => fixMojibake(s) || s).filter(Boolean),
          description: fixMojibake(media.description),
          coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || undefined
        };
      }

      case 'mal': {
        const resp = await fetch(
          `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(seriesName)}&limit=1`,
          { signal: controller.signal }
        );

        if (!resp.ok) {
          fastify.log.error(`MAL API returned ${resp.status}: ${resp.statusText}`);
          return {};
        }

        const { data } = await resp.json() as MALResponse;
        const manga = data?.[0];
        if (!manga) return {};

        return {
          englishName: fixMojibake(manga.title_english),
          romajiName: fixMojibake(manga.title),
          japaneseName: fixMojibake(manga.title_japanese),
          synonyms: (manga.title_synonyms || []).map((s: string) => fixMojibake(s) || s).filter(Boolean),
          description: fixMojibake(manga.synopsis),
          coverUrl: manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || undefined
        };
      }

      case 'kitsu': {
        const resp = await fetch(
          `https://kitsu.io/api/edge/manga?filter[text]=${encodeURIComponent(seriesName)}&page[limit]=1`,
          { signal: controller.signal }
        );

        if (!resp.ok) {
          fastify.log.error(`Kitsu API returned ${resp.status}: ${resp.statusText}`);
          return {};
        }

        const { data } = await resp.json() as KitsuResponse;
        const manga = data?.[0]?.attributes;
        if (!manga) return {};

        return {
          englishName: fixMojibake(manga.titles?.en || manga.titles?.en_jp),
          romajiName: fixMojibake(manga.canonicalTitle),
          japaneseName: fixMojibake(manga.titles?.ja_jp),
          synonyms: (manga.abbreviatedTitles || []).map((s: string) => fixMojibake(s) || s).filter(Boolean),
          description: fixMojibake(manga.synopsis),
          coverUrl: manga.posterImage?.large || manga.posterImage?.medium || manga.posterImage?.small || undefined
        };
      }
    }
  } catch (err) {
    fastify.log.error(`Failed to scrape from ${provider}: ${err}`);
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}


const metadataRoutes: FastifyPluginAsync = async (
  fastify,
  opts
): Promise<void> => {
  // Protect all routes in this file
  fastify.addHook('preHandler', fastify.authenticate);

  // ===========================================================================
  // PROGRESS ENDPOINTS
  // Namespace: /volume/:id/progress
  // ===========================================================================

  /**
   * GET /api/metadata/volume/:id/progress
   * Gets the progress for a specific volume for the current user.
   */
  fastify.get<{ Params: ProgressParams }>(
    '/volume/:id/progress',
    async (request, reply) => {
      const { id: volumeId } = request.params;
      const userId = request.user.id; // we know request has user thanks to the auth hook

      try {
        const progress = await fastify.prisma.userProgress.findUnique({
          where: {
            // Use the @@unique([userId, volumeId]) index
            userId_volumeId: {
              userId,
              volumeId,
            },
          },
          // Select ONLY the fields the client needs
          select: {
            page: true,
            timeRead: true,
            charsRead: true,
            completed: true,
          },
        });

        // If no progress found, return default values
        if (!progress) {
          return reply.status(200).send({
            page: 1,      // From schema default
            timeRead: 0,  // From schema default
            charsRead: 0, // From schema default
            completed: false, // From schema default
          });
        }

        return reply.status(200).send(progress);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Could not retrieve progress.',
        });
      }
    }
  );

  /**
   * PATCH /api/metadata/volume/:id/progress
   * Saves or updates the progress for a volume for the current user.
   */
  fastify.patch<{ Params: ProgressParams; Body: ProgressBody }>(
    '/volume/:id/progress',
    { schema: { body: progressBodySchema } },
    async (request, reply) => {
      const { id: volumeId } = request.params;
      const userId = request.user.id;
      const data = request.body;

      try {
        // 1. Upsert UserProgress
        const upsertedProgress = await fastify.prisma.userProgress.upsert({
          where: { userId_volumeId: { userId, volumeId } },
          update: { ...data },
          create: { userId, volumeId, ...data },
        });

        // 2. Series Status Update
        const volume = await fastify.prisma.volume.findUnique({
          where: { id: volumeId },
          select: { seriesId: true }
        });

        if (volume) {
          const seriesId = volume.seriesId;

          // Case A: Completion Status Changed -> Must Recalculate Full Status
          if (data.completed !== undefined) {
            await updateSeriesStatus(fastify.prisma, userId, seriesId);

            // Also update 'lastReadAt'
            await fastify.prisma.userSeriesSettings.upsert({
              where: { userId_seriesId: { userId, seriesId } },
              create: { userId, seriesId, lastReadAt: new Date(), status: data.completed ? 1 : 0 },
              update: { lastReadAt: new Date() }
            });
          }
          // Case B: Simple Page Update -> Lightweight Update
          else if (data.page !== undefined) {
            // 1. Check current status to decide if we need to bump it to 'Reading'
            const currentSettings = await fastify.prisma.userSeriesSettings.findUnique({
              where: { userId_seriesId: { userId, seriesId } },
              select: { status: true }
            });

            // If missing or Unread(0), bump to Reading(1). 
            // If already Reading(1) or Completed(2), leave status alone.
            const shouldBumpStatus = !currentSettings || currentSettings.status === 0;

            await fastify.prisma.userSeriesSettings.upsert({
              where: { userId_seriesId: { userId, seriesId } },
              create: {
                userId,
                seriesId,
                lastReadAt: new Date(),
                status: 1
              },
              update: {
                lastReadAt: new Date(),
                // Conditionally update status only if needed
                ...(shouldBumpStatus ? { status: 1 } : {})
              }
            });
          }
        }

        return reply.status(200).send(upsertedProgress);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
          return reply.status(404).send({ message: 'Volume not found.' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Could not save progress.' });
      }
    }
  );

  /**
     * DELETE /api/metadata/volume/:id/progress
     * Resets progress (Wipe).
     */
  fastify.delete<{ Params: IdParams }>(
    '/volume/:id/progress',
    async (request, reply) => {
      const { id: volumeId } = request.params;
      const userId = request.user.id;

      try {
        await fastify.prisma.userProgress.delete({
          where: { userId_volumeId: { userId, volumeId } },
        });

        const volume = await fastify.prisma.volume.findUnique({
          where: { id: volumeId },
          select: { seriesId: true }
        });
        if (volume) await updateSeriesStatus(fastify.prisma, userId, volume.seriesId);

        return reply.send({ message: 'Progress reset successfully.' });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          return reply.send({ message: 'Progress was already empty.' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Could not reset progress.' });
      }
    }
  );


  // ===========================================================================
  // METADATA ENDPOINTS (Renaming & Descriptions)
  // Namespace: /series/:id and /volume/:id
  // ===========================================================================

  /**
   * PATCH /api/metadata/series/:id
   * Updates Series metadata (Title, Description, Bookmarked).
   */
  fastify.patch<{ Params: IdParams; Body: SeriesUpdateBody }>(
    '/series/:id',
    { schema: { body: seriesUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.id;
      const {
        bookmarked,
        organized,
        tempCoverPath,
        ...sharedData
      } = request.body;

      try {
        // 1. Fetch Series to check ownership & existing paths
        const series = await fastify.prisma.series.findFirst({
          where: {
            id,
            OR: [{ ownerId: userId }, { ownerId: 'admin' }]
          },
          select: { ownerId: true, folderName: true, coverPath: true, title: true },
        });

        if (!series) return reply.status(404).send({ message: 'Series not found.' });

        const isOwner = series.ownerId === userId;

        // 2. Handle SHARED Data Update (Only if Owner)
        // If user is NOT owner but tries to update title/description, we ignore/warn
        const hasSharedUpdates = Object.keys(compact(sharedData)).length > 0 || tempCoverPath;

        if (hasSharedUpdates) {
          if (!isOwner) {
            // We don't throw error, just log and ignore shared updates 
            // to allow "mixed" requests (bookmark + title) to partially succeed
            fastify.log.warn(`User ${userId} attempted to edit shared series ${id}`);
          } else {
            let finalCoverPath = series.coverPath;

            // Handle Cover Move
            if (tempCoverPath && tempCoverPath.includes(`uploads/temp/${userId}/`)) {
              const tempPathAbsolute = path.join(fastify.projectRoot, tempCoverPath);
              const ext = path.extname(tempCoverPath);
              const seriesDirRelative = path.join('uploads', userId, series.folderName);
              const seriesDirAbsolute = path.join(fastify.projectRoot, seriesDirRelative);

              await fs.promises.mkdir(seriesDirAbsolute, { recursive: true });

              const fileName = `${series.folderName}${ext}`;
              const finalPathAbsolute = path.join(seriesDirAbsolute, fileName);
              finalCoverPath = path.join(seriesDirRelative, fileName).replace(/\\/g, '/');

              await fs.promises.rename(tempPathAbsolute, finalPathAbsolute);
            }

            const dataToUpdate: Prisma.SeriesUpdateInput = compact({
              ...sharedData,
              sortTitle: sharedData.title !== undefined ? (sharedData.title ?? series.folderName) : undefined,
              coverPath: finalCoverPath,
            });

            await fastify.prisma.series.update({
              where: { id },
              data: dataToUpdate,
            });
          }
        }

        // 3. Handle PRIVATE Data Update (Settings)
        if (bookmarked !== undefined || organized !== undefined) {
          const settingsUpdate: any = {};
          if (bookmarked !== undefined) settingsUpdate.bookmarked = bookmarked;
          if (organized !== undefined) settingsUpdate.organized = organized;

          await fastify.prisma.userSeriesSettings.upsert({
            where: { userId_seriesId: { userId, seriesId: id } },
            create: { userId, seriesId: id, ...settingsUpdate },
            update: settingsUpdate
          });
        }

        return reply.send({ message: 'Series updated successfully.' });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Update failed.' });
      }
    }
  );

  /**
   * PATCH /api/metadata/volume/:id
   * Renames the Display Title of a Volume.
   */
  fastify.patch<{ Params: IdParams; Body: { title: string | null } }>(
    '/volume/:id',
    { schema: { body: volumeUpdateSchema } },
    async (request, reply) => {
      const { id } = request.params;
      const { title } = request.body;
      const userId = request.user.id;

      try {
        // Only owner can rename volume titles
        const vol = await fastify.prisma.volume.findFirst({
          where: { id, series: { ownerId: userId } },
          select: { folderName: true },
        });

        if (!vol) return reply.status(403).send({ message: 'Access denied or volume not found.' });

        await fastify.prisma.volume.update({
          where: { id },
          data: { title, sortTitle: title ?? vol.folderName },
        });

        return reply.send({ message: 'Volume title updated.' });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Update failed.' });
      }
    }
  );

  /**
   * POST /api/metadata/batch/organize
   * Batch updates the 'organized' status.
   */
  fastify.post<{ Body: { ids: string[]; value: boolean } }>(
    '/batch/organize',
    async (request, reply) => {
      const { ids, value } = request.body;
      const userId = request.user.id;

      if (!ids || !Array.isArray(ids)) return reply.status(400).send({ message: 'No IDs provided' });

      try {
        // Iterate and upsert for each series ID to ensure settings exist
        await fastify.prisma.$transaction(
          ids.map(id =>
            fastify.prisma.userSeriesSettings.upsert({
              where: { userId_seriesId: { userId, seriesId: id } },
              create: { userId, seriesId: id, organized: value },
              update: { organized: value }
            })
          )
        );

        return reply.send({ message: 'Batch update successful.', count: ids.length });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Batch update failed.' });
      }
    }
  );

  /**
   * POST /api/metadata/series/scrape
   * Scrapes metadata (title, description, cover) from external APIs.
   * Implements multi-provider fallback for missing critical fields.
   */
  fastify.post<{ Body: { seriesId: string; seriesName: string; provider: 'anilist' | 'mal' | 'kitsu' } }>(
    '/series/scrape',
    async (request, reply) => {
      const { seriesId, seriesName, provider } = request.body;
      const userId = request.user.id;

      try {
        // 1. Verify ownership
        const series = await fastify.prisma.series.findFirst({
          where: { id: seriesId, ownerId: userId },
          select: { id: true, title: true, japaneseTitle: true, romajiTitle: true, synonyms: true, description: true, coverPath: true, folderName: true }
        });

        if (!series) {
          return reply.status(404).send({ message: 'Series not found' });
        }

        // 2. Scrape metadata from primary provider
        let scrapedData = await scrapeFromProvider(fastify, provider, seriesName);

        // 3. Multi-provider fallback: silently fill missing fields from other providers
        const needsFallback = !scrapedData.japaneseName || !scrapedData.romajiName || !scrapedData.description;

        if (needsFallback) {
          const otherProviders: ('anilist' | 'mal' | 'kitsu')[] = ['anilist', 'mal', 'kitsu'].filter(p => p !== provider) as ('anilist' | 'mal' | 'kitsu')[];

          for (const fallbackProvider of otherProviders) {
            // Only fetch if we still have missing fields
            const stillMissing = !scrapedData.japaneseName || !scrapedData.romajiName || !scrapedData.description;
            if (!stillMissing) break;

            const fallbackData = await scrapeFromProvider(fastify, fallbackProvider, seriesName);

            // Fill in ONLY missing fields from fallback (don't replace existing data)
            if (fallbackData.japaneseName && !scrapedData.japaneseName) {
              scrapedData.japaneseName = fallbackData.japaneseName;
            }
            if (fallbackData.romajiName && !scrapedData.romajiName) {
              scrapedData.romajiName = fallbackData.romajiName;
            }
            if (fallbackData.description && !scrapedData.description) {
              scrapedData.description = fallbackData.description;
            }

            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        const isEmpty = !scrapedData || Object.keys(scrapedData).length === 0;
        if (isEmpty) {
          throw new Error("Scrape returned empty.");
        }

        // Note: We intentionally keep all title variants even if they're identical.
        // This allows users to see all available data and make their own choice.

        // 4.5. Fallback: If no English title, use Romaji as the primary title
        // This ensures the "Title" field is always populated when possible
        if (!scrapedData.englishName && scrapedData.romajiName) {
          scrapedData.englishName = scrapedData.romajiName;
        }

        // 5. Download cover image if available
        let tempCoverPath: string | undefined;
        if (scrapedData.coverUrl) {
          try {
            const imageResp = await fetch(scrapedData.coverUrl);
            if (imageResp.ok) {
              const buffer = await imageResp.arrayBuffer();
              const contentType = imageResp.headers.get('content-type');
              let ext = '.jpg';
              if (contentType?.includes('png')) ext = '.png';
              else if (contentType?.includes('webp')) ext = '.webp';

              // Save to a temporary directory specifically for this user/session
              const tempDir = path.join(fastify.projectRoot, 'uploads', 'temp', userId);
              await fs.promises.mkdir(tempDir, { recursive: true });

              const tempFileName = `temp_${seriesId}_${Date.now()}${ext}`;
              const tempFilePathAbsolute = path.join(tempDir, tempFileName);

              await fs.promises.writeFile(tempFilePathAbsolute, Buffer.from(buffer));
              // Return relative path for the frontend to reference
              tempCoverPath = path.join('uploads', 'temp', userId, tempFileName).replace(/\\/g, '/');
            }
          } catch (err) {
            fastify.log.error(`Failed to download temp cover: ${err}`);
          }
        }

        // 6. Return scraped data for preview (don't save yet)
        return reply.status(200).send({
          current: {
            title: series.title,
            japaneseTitle: series.japaneseTitle,
            romajiTitle: series.romajiTitle,
            synonyms: series.synonyms,
            description: series.description,
            hasCover: !!series.coverPath,
            coverPath: series.coverPath
          },
          scraped: {
            title: scrapedData.englishName,
            japaneseTitle: scrapedData.japaneseName,
            romajiTitle: scrapedData.romajiName,
            synonyms: scrapedData.synonyms?.length ? JSON.stringify(scrapedData.synonyms) : undefined,
            description: scrapedData.description,
            hasCover: !!tempCoverPath,
            tempCoverPath
          }
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        fastify.log.error({
          error: errorMessage,
          stack: errorStack,
          seriesId,
          seriesName,
          provider
        }, 'Failed to scrape metadata');
        return reply.status(500).send({
          error: 'Failed to scrape metadata',
          message: errorMessage
        });
      }
    }
  );
};

export default metadataRoutes;
