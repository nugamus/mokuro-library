import { FastifyPluginAsync, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs'; // We need fs to check if the file exists
import { createHash } from 'crypto';
import sharp from 'sharp';

// Define an interface for our type-safe params
interface FileParams {
  id: string; // This 'id' is the volumeId
  imageName: string;
}

interface ImageTransformQuery {
  w?: string;
  h?: string;
  q?: string;
  format?: string;
}

type TransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
  format?: string;
};

const parsePositiveInt = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const normalizeFormat = (value?: string) => {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (!['webp', 'jpeg', 'jpg', 'png', 'avif'].includes(normalized)) {
    return undefined;
  }
  return normalized === 'jpg' ? 'jpeg' : normalized;
};

const parseTransformOptions = (query: ImageTransformQuery): TransformOptions | null => {
  const width = parsePositiveInt(query.w);
  const height = parsePositiveInt(query.h);
  const quality = parsePositiveInt(query.q);
  const format = normalizeFormat(query.format);

  if (!width && !height && !quality && !format) {
    return null;
  }

  return {
    width,
    height,
    quality: quality ? Math.min(Math.max(quality, 40), 95) : 85,
    format
  };
};

const sendOptimizedImage = async (
  reply: FastifyReply,
  absolutePath: string,
  options: TransformOptions,
  cacheRoot: string
) => {
  const ext = path.extname(absolutePath).replace('.', '').toLowerCase();
  const targetFormat = options.format || (ext === 'jpg' ? 'jpeg' : ext || 'jpeg');
  const sizeKey = `${options.width || ''}x${options.height || ''}-${options.quality || ''}-${targetFormat}`;
  const cacheKey = createHash('sha1').update(`${absolutePath}:${sizeKey}`).digest('hex');
  const cacheDir = path.join(cacheRoot, 'uploads', 'cache', 'images');
  const cachePath = path.join(cacheDir, `${cacheKey}.${targetFormat}`);

  await fs.promises.mkdir(cacheDir, { recursive: true });

  try {
    const cached = await fs.promises.readFile(cachePath);
    return reply.type(`image/${targetFormat}`).send(cached);
  } catch {
    // Cache miss; continue to transform.
  }

  const transformer = sharp(absolutePath);
  if (options.width || options.height) {
    transformer.resize({
      width: options.width,
      height: options.height,
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  const buffer = await transformer
    .toFormat(targetFormat as keyof sharp.FormatEnum, {
      quality: options.quality
    })
    .toBuffer();

  await fs.promises.writeFile(cachePath, buffer);
  return reply.type(`image/${targetFormat}`).send(buffer);
};

// Helper function

/**
 * Resolves a file path by checking both NFC and NFD normalization forms.
 * This ensures cross-platform compatibility (Linux/Windows/macOS).
 * * @param baseDir The root directory (e.g., fastify.projectRoot).
 * @param relativePath The path stored in the database.
 * @returns The verified absolute path in its correct normalization, or null if not found.
 */
export async function resolveNormalizedPath(
  baseDir: string,
  relativePath: string
): Promise<string | null> {
  // 1. Generate the primary target (NFC)
  const absolutePathNFC = path.join(baseDir, relativePath).normalize('NFC');

  try {
    // Check if the NFC version exists on disk
    await fs.promises.access(absolutePathNFC, fs.constants.R_OK);
    return absolutePathNFC;
  } catch {
    // 2. Generate the fallback (NFD)
    const absolutePathNFD = absolutePathNFC.normalize('NFD');

    // If the strings are identical, there is no need for a second disk check
    if (absolutePathNFC === absolutePathNFD) {
      return null;
    }

    try {
      await fs.promises.access(absolutePathNFD, fs.constants.R_OK);
      return absolutePathNFD;
    } catch {
      // File does not exist in either form
      return null;
    }
  }
}

const filesRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  // Protect all routes in this file
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * GET /api/files/volume/:id/image/:imageName
   * Securely serves a specific manga page image.
   */
  fastify.get<{ Params: FileParams; Querystring: ImageTransformQuery }>(
    '/volume/:id/image/:imageName',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const { id: volumeId, imageName } = request.params;
      const userId = request.user.id;
      const transformOptions = parseTransformOptions(request.query);

      try {
        // Find the volume and verify ownership (User OR Admin)
        const volume = await fastify.prisma.volume.findFirst({
          where: {
            id: volumeId,
            series: {
              OR: [
                { ownerId: userId },
                { ownerId: 'admin' }
              ]
            },
          },
          select: {
            filePath: true, // Only select the path we need
          },
        });

        // Case 1: Volume not found or access denied
        if (!volume) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Volume not found or access denied.',
          });
        }

        // Security: Path Traversal Mitigation
        const cleanImageName = path.basename(imageName);

        // Construct the absolute file path
        const relativePath = path.join(
          volume.filePath,
          cleanImageName
        );

        // Check if file exists using normalization helper
        const validPath = await resolveNormalizedPath(fastify.projectRoot, relativePath);

        if (!validPath) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Image file not found.',
          });
        }

        if (transformOptions) {
          return await sendOptimizedImage(reply, validPath, transformOptions, fastify.projectRoot);
        }

        return reply.sendFile(validPath);

      } catch (error) {
        fastify.log.error({ err: error }, 'File serving error');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An error occurred while serving the file.',
        });
      }
    }
  );

  /**
   * GET /api/files/series/:id/cover
   * Securely serves the series cover image.
   */
  fastify.get<{ Params: { id: string }; Querystring: ImageTransformQuery }>(
    '/series/:id/cover',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const { id: seriesId } = request.params;
      const userId = request.user.id;
      const transformOptions = parseTransformOptions(request.query);

      try {
        const series = await fastify.prisma.series.findFirst({
          where: {
            id: seriesId,
            OR: [
              { ownerId: userId },
              { ownerId: 'admin' }
            ]
          },
          select: {
            coverPath: true,
          },
        });

        if (!series || !series.coverPath) {
          return reply.status(404).send('Cover not found');
        }

        // Ensure file exists before trying to send it
        const validPath = await resolveNormalizedPath(fastify.projectRoot, series.coverPath);

        if (!validPath) {
          return reply.status(404).send('Cover file missing from disk');
        }

        if (transformOptions) {
          return await sendOptimizedImage(reply, validPath, transformOptions, fastify.projectRoot);
        }

        return reply.sendFile(validPath);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send('Error serving cover');
      }
    }
  );

  /**
   * GET /api/files/preview
   * Serves an image file by path for preview purposes (e.g., scraped covers before confirmation).
   * Security: Only serves files within the user's upload directory.
   */
  fastify.get<{ Querystring: { path: string } }>(
    '/preview',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const { path: filePath } = request.query;
      const userId = request.user.id;

      if (!filePath) {
        return reply.status(400).send({ error: 'Missing path parameter' });
      }

      try {
        // Security check: Ensure the file path starts with uploads/temp/userId
        const expectedPrefix = `uploads/temp/${userId}/`;
        if (!filePath.startsWith(expectedPrefix)) {
          return reply.status(403).send({ error: 'Access denied' });
        }

        // Resolve the file path with normalization support
        const validPath = await resolveNormalizedPath(fastify.projectRoot, filePath);

        if (!validPath) {
          return reply.status(404).send({ error: 'File not found' });
        }

        return reply.sendFile(validPath);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Error serving file' });
      }
    }
  );
};

export default filesRoutes;
