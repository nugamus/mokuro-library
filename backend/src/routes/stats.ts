import { FastifyPluginAsync } from 'fastify';

const statsRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
	// GET /api/stats/summary
	fastify.get('/summary', {
		onRequest: [fastify.authenticate]
	}, async (request, reply) => {
		const userId = request.user!.id;

		// Get aggregated stats
		const progress = await fastify.prisma.userProgress.findMany({
			where: { userId },
		});

		let totalTime = 0;
		let totalChars = 0;
		let volumesCompleted = 0;

		for (const p of progress) {
			totalTime += p.timeRead || 0;
			totalChars += p.charsRead || 0;
			if (p.completed) volumesCompleted++;
		}

		// Calculate average reading speed (chars per minute)
		const recentSpeed = totalTime > 0 ? Math.round(totalChars / totalTime) : 0;

		return {
			recentSpeed,
			charactersRead: totalChars,
			volumesCompleted,
			totalTime: Math.round(totalTime),
		};
	});

	// GET /api/stats/reading-history
	fastify.get('/reading-history', {
		onRequest: [fastify.authenticate]
	}, async (request, reply) => {
		const userId = request.user!.id;
		const { timeRange = '30' } = request.query as { timeRange?: string };
		const days = Math.max(1, Math.min(365, Number.parseInt(timeRange, 10) || 30));

		// Get reading history grouped by day
		const history = await fastify.prisma.$queryRaw<Array<{
			date: string;
			totalChars: number;
			totalTime: number;
			speed: number;
		}>>`
			SELECT
				DATE(lastReadAt) as date,
				SUM(charsRead) as totalChars,
				SUM(timeRead) as totalTime,
				CAST(SUM(charsRead) / NULLIF(SUM(timeRead), 0) AS INTEGER) as speed
			FROM UserProgress
			WHERE userId = ${userId}
				AND lastReadAt IS NOT NULL
				AND lastReadAt > datetime('now', '-' || ${days} || ' days')
			GROUP BY DATE(lastReadAt)
			ORDER BY date ASC
		`;

		return { history };
	});

	// GET /api/stats/by-series
	fastify.get('/by-series', {
		onRequest: [fastify.authenticate]
	}, async (request, reply) => {
		const userId = request.user!.id;

		const seriesStats = await fastify.prisma.series.findMany({
			select: {
				id: true,
				title: true,
				folderName: true,
				volumes: {
					select: {
						id: true,
						progress: {
							where: { userId },
							select: {
								charsRead: true,
								timeRead: true,
								completed: true,
							}
						}
					}
				}
			}
		});

		const result = seriesStats.map((series: any) => {
			let totalChars = 0;
			let totalTime = 0;
			let volumesRead = 0;

			for (const volume of series.volumes) {
				for (const prog of volume.progress) {
					totalChars += prog.charsRead || 0;
					totalTime += prog.timeRead || 0;
					if (prog.completed) volumesRead++;
				}
			}

			const avgSpeed = totalTime > 0 ? Math.round(totalChars / totalTime) : 0;

			return {
				seriesName: series.title || series.folderName,
				volumes: volumesRead,
				avgSpeed,
				totalChars,
				totalTime: Math.round(totalTime),
			};
		}).filter((s: any) => s.volumes > 0);

		return { seriesStats: result };
	});

	// GET /api/stats/completed-volumes
	fastify.get('/completed-volumes', {
		onRequest: [fastify.authenticate]
	}, async (request, reply) => {
		const userId = request.user!.id;

		// Get completed progress with volume and series info
		const completed = await fastify.prisma.userProgress.findMany({
			where: {
				userId,
				completed: true,
			},
			orderBy: {
				lastReadAt: 'desc'
			},
			take: 50,
		});

		// Fetch volume and series info separately
		const volumeIds = completed.map((p: any) => p.volumeId);
		const volumes = await fastify.prisma.volume.findMany({
			where: { id: { in: volumeIds } },
			select: {
				id: true,
				title: true,
				folderName: true,
				series: {
					select: {
						title: true,
						folderName: true,
					}
				}
			}
		});

		const volumeMap = new Map(volumes.map((v: any) => [v.id, v]));

		const result = completed.map((prog: any) => {
			const volume = volumeMap.get(prog.volumeId);
			if (!volume) return null;

			const speed = prog.timeRead > 0 ? Math.round((prog.charsRead || 0) / prog.timeRead) : 0;

			return {
				seriesName: volume.series.title || volume.series.folderName,
				volumeTitle: volume.title || volume.folderName,
				speed,
				duration: Math.round(prog.timeRead),
				characters: prog.charsRead || 0,
				dateFinished: prog.lastReadAt,
			};
		}).filter(Boolean);

		return { completedVolumes: result };
	});

	// GET /api/stats/export
	fastify.get('/export', {
		onRequest: [fastify.authenticate]
	}, async (request, reply) => {
		const userId = request.user!.id;

		const data = await fastify.prisma.userProgress.findMany({
			where: { userId },
			orderBy: {
				lastReadAt: 'desc'
			}
		});

		// Fetch volume and series info
		const volumeIds = data.map((p: any) => p.volumeId);
		const volumes = await fastify.prisma.volume.findMany({
			where: { id: { in: volumeIds } },
			select: {
				id: true,
				title: true,
				folderName: true,
				series: {
					select: {
						title: true,
						folderName: true,
					}
				}
			}
		});

		const volumeMap = new Map(volumes.map((v: any) => [v.id, v]));

		const csvRows = [
			'Date,Series,Volume,Pages Read,Time (min),Chars Read,Speed (chars/min),Completed'
		];

		for (const row of data) {
			const volume = volumeMap.get(row.volumeId);
			if (!volume) continue;

			const speed = row.timeRead > 0 ? Math.round((row.charsRead || 0) / row.timeRead) : 0;
			csvRows.push([
				row.lastReadAt || 'N/A',
				volume.series.title || volume.series.folderName,
				volume.title || volume.folderName,
				row.page,
				Math.round(row.timeRead),
				row.charsRead || 0,
				speed,
				row.completed ? 'Yes' : 'No'
			].join(','));
		}

		const csv = csvRows.join('\n');

		return reply
			.header('Content-Disposition', 'attachment; filename=reading-stats.csv')
			.type('text/csv')
			.send(csv);
	});
};

export default statsRoutes;
