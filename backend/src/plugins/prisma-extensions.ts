import { Prisma } from '../generated/prisma/client';
import { ulid } from 'ulid';

const modelsWithUlid = ['Patch', 'OcrBranch'];

export const ulidExtension = Prisma.defineExtension({
  name: 'ulid-generator',
  query: {
    $allModels: {
      async create({ model, args, query }) {
        if (modelsWithUlid.includes(model)) {
          // If ID is missing, generate a ULID
          if (!(args.data as any).id) {
            (args.data as any).id = ulid();
          }
        }
        return query(args);
      },
      async createMany({ model, args, query }) {
        if (modelsWithUlid.includes(model)) {
          if (Array.isArray(args.data)) {
            args.data.forEach((item: any) => {
              if (!item.id) item.id = ulid();
            });
          } else {
            // Handle case where data might be a single object (though strictly createMany takes array)
            const item = args.data as any;
            if (!item.id) item.id = ulid();
          }
        }
        return query(args);
      },
    },
  },
});
