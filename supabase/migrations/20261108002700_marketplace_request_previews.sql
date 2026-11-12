-- Capture actual saved thumbnail bytes at first publication, never by later
-- backfill. Existing thumbnails have no source revision provenance, so none
-- can honestly be advertised as an exact visual of the published dimensions.
create table app_private.marketplace_request_previews (
 request_id uuid primary key references app_private.quote_request_publications(request_id),
 source_request_revision_id uuid not null,
 mime_type text not null check(mime_type in ('image/webp','image/jpeg')),
 image bytea not null check(octet_length(image) between 1 and 65536),
 frozen_request_project_revision bigint not null check(frozen_request_project_revision>0),
 project_revision_at_capture bigint not null check(project_revision_at_capture>0),
 thumbnail_updated_at timestamptz not null,
 captured_at timestamptz not null default clock_timestamp(),
 foreign key(request_id,source_request_revision_id) references app_private.marketplace_request_revisions(request_id,id)
);
alter table app_private.marketplace_request_previews enable row level security;
revoke all on app_private.marketplace_request_previews from public,anon,authenticated,service_role;
grant select,insert on app_private.marketplace_request_previews to service_role;
create function app_private.commerce_capture_request_preview() returns trigger language plpgsql security invoker set search_path='' as $$
declare d app_private.quote_request_drafts; thumbnail app_private.project_thumbnails; current_revision bigint;
begin
 if new.revision<>1 then return new; end if;
 select * into d from app_private.quote_request_drafts where id=new.request_id;
 select p.revision into current_revision from app_private.projects p where p.id=d.project_id and p.workspace_id=d.workspace_id and p.deleted_at is null for share;
 if not found then return new; end if;
 select * into thumbnail from app_private.project_thumbnails where project_id=d.project_id and workspace_id=d.workspace_id for share;
 if not found then return new; end if;
 -- Defense in depth for legacy direct-SQL thumbnails, in addition to HTTP validation.
 if not ((thumbnail.mime_type='image/jpeg' and octet_length(thumbnail.image)>=3 and substring(thumbnail.image from 1 for 3)=decode('ffd8ff','hex'))
 or (thumbnail.mime_type='image/webp' and octet_length(thumbnail.image)>=12 and substring(thumbnail.image from 1 for 4)=convert_to('RIFF','UTF8') and substring(thumbnail.image from 9 for 4)=convert_to('WEBP','UTF8'))) then return new; end if;
 insert into app_private.marketplace_request_previews(request_id,source_request_revision_id,mime_type,image,frozen_request_project_revision,project_revision_at_capture,thumbnail_updated_at)
 values(new.request_id,new.id,thumbnail.mime_type,thumbnail.image,d.project_revision,current_revision,thumbnail.updated_at);
 return new;
end $$;
create trigger commerce_capture_request_preview after insert on app_private.marketplace_request_revisions for each row execute function app_private.commerce_capture_request_preview();
create function app_private.commerce_request_preview_json(p_request uuid,p_revision uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from app_private.marketplace_request_revisions where id=p_revision and request_id=p_request) then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 select jsonb_build_object('mimeType',p.mime_type,'dataBase64',translate(encode(p.image,'base64'),chr(10),''),'byteSize',octet_length(p.image),
 'sourceProjectRevision',null,'sourceRequestRevisionId',p.source_request_revision_id,
 'frozenRequestProjectRevision',p.frozen_request_project_revision,'projectRevisionAtCapture',p.project_revision_at_capture,
 'thumbnailUpdatedAt',p.thumbnail_updated_at,'capturedAt',p.captured_at,
 'match',case when p_revision=p.source_request_revision_id then 'unverified_reference' else 'original_reference' end) into result
 from app_private.marketplace_request_previews p where p.request_id=p_request;
 return jsonb_build_object('preview',result);
end $$;
create function public.marketplace_request_preview(p_actor uuid,p_request uuid,p_revision uuid,p_supplier uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_supplier is null then perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_request);
 else perform app_private.commerce_assert_supplier(p_actor,p_supplier,p_request,false); end if;
 return app_private.commerce_request_preview_json(p_request,p_revision);
end $$;
create function public.marketplace_order_preview(p_actor uuid,p_order uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o app_private.marketplace_production_orders;
begin
 select * into o from app_private.marketplace_production_orders where id=p_order;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 perform app_private.commerce_order_side(p_actor,o,false);
 return app_private.commerce_request_preview_json(o.request_id,(o.terms->>'requestRevisionId')::uuid);
end $$;
revoke all on function app_private.commerce_capture_request_preview(),app_private.commerce_request_preview_json(uuid,uuid),public.marketplace_request_preview(uuid,uuid,uuid,uuid),public.marketplace_order_preview(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.commerce_capture_request_preview(),app_private.commerce_request_preview_json(uuid,uuid),public.marketplace_request_preview(uuid,uuid,uuid,uuid),public.marketplace_order_preview(uuid,uuid) to service_role;
