-- TocaCifra: tabelas, regras de seguranca (RLS), funcoes e pasta de audios no Supabase.
-- Execute UMA vez no painel do Supabase: SQL Editor > New query > colar > Run.
-- Cada pessoa so enxerga e altera os proprios dados (policies "to authenticated" com user_id = auth.uid()).

-- ---------- tabelas ----------
create table public.songs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  artist text not null default '' check (char_length(artist) <= 120),
  tone text not null default '' check (char_length(tone) <= 4),
  capo int not null default 0 check (capo between 0 and 12),
  style text not null default '' check (char_length(style) <= 40),
  body text not null default '' check (char_length(body) <= 50000),
  audio_name text check (char_length(audio_name) <= 100),
  updated_at timestamptz not null default now()
);
create index songs_user_idx on public.songs (user_id);

create table public.setlists (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  style text not null default '' check (char_length(style) <= 40),
  updated_at timestamptz not null default now()
);
create index setlists_user_idx on public.setlists (user_id);

-- song_id NULL = "momento" (etiqueta no meio da sequencia)
create table public.setlist_items (
  setlist_id bigint not null references public.setlists (id) on delete cascade,
  position int not null check (position between 0 and 299),
  song_id bigint references public.songs (id) on delete cascade,
  label text check (char_length(label) <= 60),
  primary key (setlist_id, position)
);
create index setlist_items_song_idx on public.setlist_items (song_id);

-- ---------- atualiza updated_at ----------
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger songs_touch before update on public.songs for each row execute function public.touch_updated_at();
create trigger setlists_touch before update on public.setlists for each row execute function public.touch_updated_at();

-- ---------- seguranca por linha (RLS) ----------
alter table public.songs enable row level security;
alter table public.setlists enable row level security;
alter table public.setlist_items enable row level security;

create policy songs_own on public.songs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy setlists_own on public.setlists for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy setlist_items_own on public.setlist_items for all to authenticated
  using (exists (select 1 from public.setlists l where l.id = setlist_id and l.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.setlists l where l.id = setlist_id and l.user_id = (select auth.uid()))
    and (song_id is null or exists (select 1 from public.songs s where s.id = song_id and s.user_id = (select auth.uid())))
  );

-- permissoes de tabela: so quem esta logado (anon nao tem acesso a nada)
revoke all on public.songs, public.setlists, public.setlist_items from anon, authenticated;
grant select, insert, update, delete on public.songs, public.setlists, public.setlist_items to authenticated;

-- ---------- funcoes usadas pelo app ----------
-- Baixa tudo de uma vez (para uso offline), no mesmo formato que o app usa.
create function public.sync_all() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'artist', s.artist, 'tone', s.tone, 'capo', s.capo, 'style', s.style, 'body', s.body,
        'updatedAt', (extract(epoch from s.updated_at) * 1000)::bigint, 'audioName', s.audio_name
      ) order by lower(s.title))
      from public.songs s), '[]'::jsonb),
    'setlists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'title', l.title, 'style', l.style,
        'updatedAt', (extract(epoch from l.updated_at) * 1000)::bigint,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('songId', i.song_id, 'label', i.label) order by i.position)
          from public.setlist_items i where i.setlist_id = l.id), '[]'::jsonb)
      ) order by lower(l.title))
      from public.setlists l), '[]'::jsonb)
  );
$$;

-- Cria (p_id nulo) ou atualiza um repertorio e troca os itens, tudo numa transacao.
create function public.save_setlist(p_id bigint, p_title text, p_style text, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id bigint;
begin
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Informe o titulo.' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(p_items), 0) > 300 then
    raise exception 'Um repertorio aceita no maximo 300 itens.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.setlists (title, style)
    values (left(btrim(p_title), 120), left(coalesce(p_style, ''), 40))
    returning id into v_id;
  else
    update public.setlists
       set title = left(btrim(p_title), 120), style = left(coalesce(p_style, ''), 40)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Repertorio nao encontrado.' using errcode = 'P0002';
    end if;
    delete from public.setlist_items where setlist_id = v_id;
  end if;

  insert into public.setlist_items (setlist_id, position, song_id, label)
  select v_id, (t.ord - 1)::int,
         nullif(t.e ->> 'songId', '')::bigint,
         case when nullif(t.e ->> 'songId', '') is null
              then left(coalesce(nullif(t.e ->> 'label', ''), 'Momento'), 60) end
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t (e, ord);

  return (
    select jsonb_build_object(
      'id', l.id, 'title', l.title, 'style', l.style,
      'updatedAt', (extract(epoch from l.updated_at) * 1000)::bigint,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('songId', i.song_id, 'label', i.label) order by i.position)
        from public.setlist_items i where i.setlist_id = l.id), '[]'::jsonb))
    from public.setlists l where l.id = v_id);
end $$;

revoke execute on function public.sync_all() from public, anon;
revoke execute on function public.save_setlist(bigint, text, text, jsonb) from public, anon;
grant execute on function public.sync_all() to authenticated;
grant execute on function public.save_setlist(bigint, text, text, jsonb) to authenticated;

-- "Ping" publico e inofensivo: um aviso automatico semanal evita que o plano gratis pause o projeto por inatividade.
create function public.ping() returns text language sql stable set search_path = '' as $$ select 'ok'::text $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- ---------- audios (pasta privada; cada pessoa so acessa a propria subpasta <id do usuario>/...) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 31457280,
        array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac'])
on conflict (id) do nothing;

create policy audio_select_own on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy audio_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy audio_update_own on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy audio_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
