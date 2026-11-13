begin;
create schema if not exists coffin_private;
revoke all on schema coffin_private from public, anon, authenticated;
create table if not exists coffin_private.quota (
 bucket text primary key, minute bigint not null, hits int not null
);
create or replace function public.coffin_allow(p_bucket text,p_limit int)
returns boolean language plpgsql security definer set search_path='' as $$
declare m bigint := floor(extract(epoch from now())/60); n int;
begin
 delete from coffin_private.quota where minute < m-2;
 insert into coffin_private.quota as q values(p_bucket,m,1)
 on conflict(bucket) do update set hits=case when q.minute=excluded.minute then q.hits+1 else 1 end,minute=excluded.minute
 returning hits into n;
 return n<=p_limit;
end $$;
create table if not exists coffin_private.door_best (
 player uuid primary key,
 nickname text not null check (char_length(nickname) between 1 and 18),
 doors integer not null check (doors >= 0),
 progress integer not null check (progress between 0 and 99),
 submitted timestamptz not null default now()
);
create index if not exists coffin_door_order on coffin_private.door_best(doors desc, progress desc, submitted, player);
create table if not exists coffin_private.door_receipts (
 run uuid primary key, expires timestamptz not null
);
create index if not exists coffin_door_receipt_expiry on coffin_private.door_receipts(expires);

create or replace function public.coffin_door_finish(p_player uuid,p_nickname text,p_doors int,p_progress int,p_run uuid,p_expires timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_expires <= now() then raise exception 'expired'; end if;
 delete from coffin_private.door_receipts where expires <= now();
 insert into coffin_private.door_receipts values (p_run,p_expires) on conflict do nothing;
 if not found then return; end if;
 insert into coffin_private.door_best as b(player,nickname,doors,progress)
 values (p_player,p_nickname,p_doors,p_progress)
 on conflict (player) do update set nickname=excluded.nickname, doors=excluded.doors,
 progress=excluded.progress, submitted=now()
 where (excluded.doors,excluded.progress) > (b.doors,b.progress);
end $$;

create or replace function public.coffin_door_board(p_player uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with leaders as (
   select * from coffin_private.door_best order by doors desc,progress desc,submitted,player limit 100
 ), ranked as (
   select *,rank() over(order by doors desc,progress desc) as pos from leaders
 ), me as (
   select nickname,doors,progress,1+(select count(*) from coffin_private.door_best x
   where (x.doors,x.progress)>(b.doors,b.progress)) as rank
   from coffin_private.door_best b where b.player=p_player
 )
 select jsonb_build_object(
   'top',coalesce((select jsonb_agg(jsonb_build_object('rank',pos,'nickname',nickname,'doors',doors,
    'progress',progress,'mine',player=p_player) order by doors desc,progress desc,submitted,player) from ranked),'[]'::jsonb),
   'me',(select to_jsonb(me) from me))
$$;
revoke all on function public.coffin_allow(text,int),public.coffin_door_finish(uuid,text,int,int,uuid,timestamptz),public.coffin_door_board(uuid) from public,anon,authenticated;
grant execute on function public.coffin_allow(text,int),public.coffin_door_finish(uuid,text,int,int,uuid,timestamptz),public.coffin_door_board(uuid) to service_role;
commit;
