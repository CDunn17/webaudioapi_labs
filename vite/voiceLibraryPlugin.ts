import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type LibraryKind = 'config' | 'sample';
type LibraryMode = 'beat' | 'effect' | 'melody';

type LibraryEntry = {
  createdAt: string;
  id: string;
  kind: LibraryKind;
  mimeType?: string;
  mode: LibraryMode;
  name: string;
};

const MODES = new Set<LibraryMode>(['beat', 'effect', 'melody']);
const KINDS = new Set<LibraryKind>(['config', 'sample']);
const MAX_BODY_BYTES = 50 * 1024 * 1024;

const json = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
};

const safeId = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `item-${Date.now()}`;
};

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Library item exceeds the 50 MB limit.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const parseRoute = (request: IncomingMessage): {
  id?: string;
  kind?: LibraryKind;
  mode?: LibraryMode;
  name?: string;
} => {
  const url = new URL(request.url ?? '/', 'http://voice-lab.local');
  const parts = url.pathname.split('/').filter(Boolean);
  const offset = parts[0] === 'api' && parts[1] === 'voice-library' ? 2 : 0;
  const kind = parts[offset];
  const mode = url.searchParams.get('mode') ?? parts[offset + 1];
  const id = parts[offset + 2];
  return {
    ...(kind !== undefined && KINDS.has(kind as LibraryKind) ? { kind: kind as LibraryKind } : {}),
    ...(mode !== null && mode !== undefined && MODES.has(mode as LibraryMode)
      ? { mode: mode as LibraryMode }
      : {}),
    ...(id !== undefined
      ? { id: safeId(decodeURIComponent(id)) }
      : {}),
    ...(url.searchParams.get('name') !== null ? { name: url.searchParams.get('name') ?? '' } : {}),
  };
};

export const voiceLibraryPlugin = (): Plugin => ({
  name: 'voice-lab-library',
  configureServer(server) {
    const root = resolve(server.config.root, '.voice-lab-library');
    server.middlewares.use('/api/voice-library', async (request, response) => {
      try {
        const route = parseRoute(request);
        if (route.kind === undefined || route.mode === undefined) {
          json(response, 400, { error: 'A valid library kind and mode are required.' });
          return;
        }
        const directory = resolve(root, `${route.kind}s`, route.mode);
        await mkdir(directory, { recursive: true });

        if (request.method === 'GET' && route.id === undefined) {
          const files = await readdir(directory);
          const metadataFiles = route.kind === 'sample'
            ? files.filter((file) => file.endsWith('.meta.json'))
            : files.filter((file) => file.endsWith('.json'));
          const entries = await Promise.all(metadataFiles.map(async (file) => {
            try {
              const contents = await readFile(resolve(directory, file), 'utf8');
              const parsed = JSON.parse(contents) as { metadata?: LibraryEntry } | LibraryEntry;
              return 'metadata' in parsed ? parsed.metadata : parsed;
            } catch {
              return undefined;
            }
          }));
          json(response, 200, entries
            .filter((entry): entry is LibraryEntry => entry !== undefined)
            .sort((first, second) => second.createdAt.localeCompare(first.createdAt)));
          return;
        }

        if (request.method === 'GET' && route.id !== undefined) {
          if (route.kind === 'sample') {
            const metadata = JSON.parse(await readFile(
              resolve(directory, `${route.id}.meta.json`),
              'utf8'
            )) as LibraryEntry;
            const body = await readFile(resolve(directory, `${route.id}.audio`));
            response.statusCode = 200;
            response.setHeader('Content-Type', metadata.mimeType ?? 'application/octet-stream');
            response.end(body);
          } else {
            const body = await readFile(resolve(directory, `${route.id}.json`));
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(body);
          }
          return;
        }

        if (request.method === 'POST') {
          const name = (route.name ?? '').trim();
          if (name.length === 0) {
            json(response, 400, { error: 'Enter a name before saving.' });
            return;
          }
          const id = safeId(name);
          const metadata: LibraryEntry = {
            createdAt: new Date().toISOString(),
            id,
            kind: route.kind,
            mode: route.mode,
            name: name.slice(0, 80),
            ...(route.kind === 'sample'
              ? { mimeType: request.headers['content-type'] ?? 'application/octet-stream' }
              : {}),
          };
          const body = await readBody(request);
          if (route.kind === 'sample') {
            await writeFile(resolve(directory, `${id}.audio`), body);
            await writeFile(resolve(directory, `${id}.meta.json`), JSON.stringify(metadata, null, 2));
          } else {
            const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
            await writeFile(
              resolve(directory, `${id}.json`),
              JSON.stringify({ ...parsed, metadata }, null, 2)
            );
          }
          json(response, 201, metadata);
          return;
        }

        json(response, 405, { error: 'Unsupported library operation.' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        json(response, message.includes('ENOENT') ? 404 : 500, { error: message });
      }
    });
  },
});
