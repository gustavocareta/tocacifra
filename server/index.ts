import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { audioDir, db, tx } from './db.ts';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.ts';
import { importFromText, importFromUrl } from './importer.ts';

const MAX_SETLIST_ITEMS = 300;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac']);

/** Limite simples em memoria: no maximo `max` eventos por chave dentro da janela. */
export function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    blocked(key: string): boolean {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      hits.set(key, recent);
      return recent.length >= max;
    },
    add(key: string) { hits.set(key, [...(hits.get(key) ?? []), Date.now()]); },
    reset(key: string) { hits.delete(key); },
  };
}
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 1024 * 1024 });
  // No servidor proprio (desenvolvimento) o app usa a API Node; o config.js de public/ e da versao publicada (Supabase).
  app.get('/config.js', async (_req, reply) => reply.type('application/javascript; charset=utf-8').header('cache-control', 'no-store').send("export const CONFIG = { backend: 'node' };\n"));
  app.register(fastifyStatic, { root: publicDir });

  const uid = (req: { headers: { authorization?: string } }): number => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const id = m ? verifyToken(m[1]) : null;
    if (id === null) throw Object.assign(new Error('Faca login para continuar.'), { statusCode: 401 });
    return id;
  };
  const bad = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 });
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // ---------- conta ----------
  const loginFails = makeLimiter(Number(process.env.LOGIN_MAX_FAILS ?? 8), 15 * 60 * 1000);
  const registers = makeLimiter(Number(process.env.REGISTER_MAX ?? 10), 60 * 60 * 1000);
  const tooMany = () => Object.assign(new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.'), { statusCode: 429 });

  app.addContentTypeParser(/^audio\/.+/, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => done(null, body));

  app.post('/api/register', async (req, reply) => {
    if (registers.blocked(req.ip)) throw tooMany();
    registers.add(req.ip);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = str(b.email, 120).toLowerCase();
    const nick = str(b.nick, 40);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('E-mail invalido.');
    if (!nick) throw bad('Informe um nick.');
    if (password.length < 6 || password.length > 72) throw bad('A senha deve ter de 6 a 72 caracteres.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('Este e-mail ja esta cadastrado.');
    const r = db.prepare('INSERT INTO users (email, nick, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(email, nick, hashPassword(password), Date.now());
    reply.code(201);
    return { token: signToken(Number(r.lastInsertRowid)), user: { nick, email } };
  });

  app.post('/api/login', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = str(b.email, 120).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    // limita por IP e por e-mail, para travar tanto varredura de contas quanto tentativa de adivinhar uma senha
    const keys = [`ip:${req.ip}`, `em:${email}`];
    if (keys.some((k) => loginFails.blocked(k))) throw tooMany();
    const row = db.prepare('SELECT id, nick, pass_hash FROM users WHERE email = ?').get(email) as { id: number; nick: string; pass_hash: string } | undefined;
    if (!row || !verifyPassword(password, row.pass_hash)) {
      keys.forEach((k) => loginFails.add(k));
      throw Object.assign(new Error('E-mail ou senha incorretos.'), { statusCode: 401 });
    }
    loginFails.reset(`em:${email}`);
    return { token: signToken(row.id), user: { nick: row.nick, email } };
  });

  // ---------- musicas ----------
  type SongRow = { id: number; title: string; artist: string; tone: string; capo: number; style: string; body: string; updated_at: number; audio_type: string | null; audio_name: string | null };
  const songOut = (r: SongRow) => ({ id: r.id, title: r.title, artist: r.artist, tone: r.tone, capo: r.capo, style: r.style, body: r.body, updatedAt: r.updated_at, audioName: r.audio_type ? (r.audio_name ?? 'audio') : null });
  const audioPath = (id: number) => path.join(audioDir, `${id}.bin`);
  const songIn = (b: Record<string, unknown>) => {
    const title = str(b.title, 120);
    if (!title) throw bad('Informe o titulo.');
    const capo = Number(b.capo ?? 0);
    return {
      title,
      artist: str(b.artist, 120),
      tone: str(b.tone, 4),
      capo: Number.isInteger(capo) && capo >= 0 && capo <= 12 ? capo : 0,
      style: str(b.style, 40),
      body: typeof b.body === 'string' ? b.body.slice(0, 50_000) : '',
    };
  };

  app.get('/api/songs', async (req) => {
    const rows = db.prepare('SELECT * FROM songs WHERE user_id = ? ORDER BY title COLLATE NOCASE').all(uid(req)) as SongRow[];
    return rows.map(songOut);
  });

  app.post('/api/songs', async (req, reply) => {
    const u = uid(req);
    const s = songIn((req.body ?? {}) as Record<string, unknown>);
    const r = db.prepare('INSERT INTO songs (user_id, title, artist, tone, capo, style, body, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(u, s.title, s.artist, s.tone, s.capo, s.style, s.body, Date.now());
    reply.code(201);
    return songOut(db.prepare('SELECT * FROM songs WHERE id = ?').get(r.lastInsertRowid) as SongRow);
  });

  const ownSong = (req: { headers: { authorization?: string }; params: unknown }) => {
    const u = uid(req);
    const row = db.prepare('SELECT * FROM songs WHERE id = ? AND user_id = ?').get(Number((req.params as { id: string }).id), u) as SongRow | undefined;
    if (!row) throw Object.assign(new Error('Musica nao encontrada.'), { statusCode: 404 });
    return row;
  };

  app.get('/api/songs/:id', async (req) => songOut(ownSong(req)));

  app.put('/api/songs/:id', async (req) => {
    const row = ownSong(req);
    const s = songIn((req.body ?? {}) as Record<string, unknown>);
    db.prepare('UPDATE songs SET title=?, artist=?, tone=?, capo=?, style=?, body=?, updated_at=? WHERE id=?').run(s.title, s.artist, s.tone, s.capo, s.style, s.body, Date.now(), row.id);
    return songOut(db.prepare('SELECT * FROM songs WHERE id = ?').get(row.id) as SongRow);
  });

  app.delete('/api/songs/:id', async (req, reply) => {
    const id = ownSong(req).id;
    db.prepare('DELETE FROM songs WHERE id = ?').run(id);
    fs.rmSync(audioPath(id), { force: true });
    reply.code(204);
  });

  // ---------- audio da musica (playback para acompanhar) ----------
  app.put('/api/songs/:id/audio', { bodyLimit: MAX_AUDIO_BYTES }, async (req) => {
    const row = ownSong(req);
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.has(type)) throw bad('Formato de audio nao suportado (use mp3, m4a, ogg, wav ou flac).');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Arquivo vazio.');
    const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'audio')).replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 100) || 'audio';
    fs.writeFileSync(audioPath(row.id), req.body);
    db.prepare('UPDATE songs SET audio_type = ?, audio_name = ?, updated_at = ? WHERE id = ?').run(type, name, Date.now(), row.id);
    return songOut(db.prepare('SELECT * FROM songs WHERE id = ?').get(row.id) as SongRow);
  });

  app.get('/api/songs/:id/audio', async (req, reply) => {
    const row = ownSong(req);
    if (!row.audio_type || !fs.existsSync(audioPath(row.id))) throw Object.assign(new Error('Esta musica nao tem audio.'), { statusCode: 404 });
    return reply.header('content-type', row.audio_type).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=0').send(fs.createReadStream(audioPath(row.id)));
  });

  app.delete('/api/songs/:id/audio', async (req, reply) => {
    const row = ownSong(req);
    db.prepare('UPDATE songs SET audio_type = NULL, audio_name = NULL, updated_at = ? WHERE id = ?').run(Date.now(), row.id);
    fs.rmSync(audioPath(row.id), { force: true });
    reply.code(204);
  });

  // ---------- repertorios ----------
  type SetlistRow = { id: number; title: string; style: string; updated_at: number };
  type Item = { songId: number | null; label: string | null };
  const itemsOf = (id: number): Item[] =>
    (db.prepare('SELECT song_id, label FROM setlist_items WHERE setlist_id = ? ORDER BY position').all(id) as { song_id: number | null; label: string | null }[]).map((i) => ({ songId: i.song_id, label: i.label }));
  const setlistOut = (r: SetlistRow) => ({ id: r.id, title: r.title, style: r.style, updatedAt: r.updated_at, items: itemsOf(r.id) });

  const ownSetlist = (req: { headers: { authorization?: string }; params: unknown }) => {
    const u = uid(req);
    const row = db.prepare('SELECT * FROM setlists WHERE id = ? AND user_id = ?').get(Number((req.params as { id: string }).id), u) as SetlistRow | undefined;
    if (!row) throw Object.assign(new Error('Repertorio nao encontrado.'), { statusCode: 404 });
    return row;
  };

  const saveItems = (setlistId: number, userId: number, raw: unknown) => {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_SETLIST_ITEMS) throw bad(`Um repertorio aceita no maximo ${MAX_SETLIST_ITEMS} itens.`);
    db.prepare('DELETE FROM setlist_items WHERE setlist_id = ?').run(setlistId);
    const ins = db.prepare('INSERT INTO setlist_items (setlist_id, position, song_id, label) VALUES (?,?,?,?)');
    const owns = db.prepare('SELECT 1 FROM songs WHERE id = ? AND user_id = ?');
    list.forEach((it: { songId?: unknown; label?: unknown }, pos) => {
      if (it.songId != null) {
        if (!owns.get(Number(it.songId), userId)) throw bad('Musica invalida no repertorio.');
        ins.run(setlistId, pos, Number(it.songId), null);
      } else {
        ins.run(setlistId, pos, null, str(it.label, 60) || 'Momento');
      }
    });
  };

  app.get('/api/setlists', async (req) => (db.prepare('SELECT * FROM setlists WHERE user_id = ? ORDER BY title COLLATE NOCASE').all(uid(req)) as SetlistRow[]).map(setlistOut));
  app.get('/api/setlists/:id', async (req) => setlistOut(ownSetlist(req)));

  app.post('/api/setlists', async (req, reply) => {
    const u = uid(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const title = str(b.title, 120);
    if (!title) throw bad('Informe o titulo.');
    const id = tx(() => {
      const r = db.prepare('INSERT INTO setlists (user_id, title, style, updated_at) VALUES (?,?,?,?)').run(u, title, str(b.style, 40), Date.now());
      saveItems(Number(r.lastInsertRowid), u, b.items);
      return Number(r.lastInsertRowid);
    });
    reply.code(201);
    return setlistOut(db.prepare('SELECT * FROM setlists WHERE id = ?').get(id) as SetlistRow);
  });

  app.put('/api/setlists/:id', async (req) => {
    const row = ownSetlist(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const title = str(b.title, 120);
    if (!title) throw bad('Informe o titulo.');
    tx(() => {
      db.prepare('UPDATE setlists SET title=?, style=?, updated_at=? WHERE id=?').run(title, str(b.style, 40), Date.now(), row.id);
      saveItems(row.id, uid(req), b.items);
    });
    return setlistOut(db.prepare('SELECT * FROM setlists WHERE id = ?').get(row.id) as SetlistRow);
  });

  app.delete('/api/setlists/:id', async (req, reply) => {
    db.prepare('DELETE FROM setlists WHERE id = ?').run(ownSetlist(req).id);
    reply.code(204);
  });

  // ---------- sincronizacao (baixar tudo para uso offline) ----------
  app.get('/api/sync', async (req) => {
    const u = uid(req);
    const songs = (db.prepare('SELECT * FROM songs WHERE user_id = ? ORDER BY title COLLATE NOCASE').all(u) as SongRow[]).map(songOut);
    const setlists = (db.prepare('SELECT * FROM setlists WHERE user_id = ? ORDER BY title COLLATE NOCASE').all(u) as SetlistRow[]).map(setlistOut);
    return { at: Date.now(), songs, setlists };
  });

  // ---------- importacao (uma musica por vez) ----------
  app.post('/api/import', async (req) => {
    uid(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.url === 'string' && b.url.trim()) {
      try {
        return await importFromUrl(b.url.trim());
      } catch (e) {
        throw bad(e instanceof Error ? e.message : 'Nao foi possivel importar.');
      }
    }
    if (typeof b.text === 'string' && b.text.trim()) return importFromText(b.text, { title: str(b.title, 120), artist: str(b.artist, 120) });
    throw bad('Envie um link ou cole o texto da cifra.');
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Erro interno.' : err.message });
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const lan = process.argv.includes('--lan'); // abre para outros aparelhos da mesma rede (ex.: o celular)
  const host = lan ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1');
  buildApp().listen({ port, host }).then(() => {
    console.log(`TocaCifra em http://localhost:${port}`);
    if (lan) {
      const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
      console.log('No celular (mesma rede Wi-Fi), abra um destes enderecos:');
      for (const ip of ips) console.log(`  http://${ip}:${port}`);
      console.log('Atencao: use so em Wi-Fi de confianca. Sem HTTPS, o modo offline e o afinador nao funcionam no celular.');
    }
  });
}
