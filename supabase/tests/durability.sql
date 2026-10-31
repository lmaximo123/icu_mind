\set ON_ERROR_STOP on
insert into auth.users values ('10000000-0000-0000-0000-000000000001');
insert into public.units(id,label) values ('20000000-0000-0000-0000-000000000001','Synthetic durability fixture');
insert into public.unit_members values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','clinician');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into public.encounters(id,unit_id,bed_code) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','01');
select public.append_observation('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual');
