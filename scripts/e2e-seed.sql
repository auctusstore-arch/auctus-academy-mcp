-- Seed for tests/e2e-supabase.test.ts. Run against a LOCAL Supabase that has the
-- auctus-academy migrations (including *_mcp_gateway.sql). Never against staging/prod.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','51789000-0000-4000-8000-00000000000a','authenticated','authenticated','e2e-a@example.test','',now(),'{}','{}',now(),now()),
       ('00000000-0000-0000-0000-000000000000','51789000-0000-4000-8000-00000000000b','authenticated','authenticated','e2e-b@example.test','',now(),'{}','{}',now(),now())
on conflict do nothing;
insert into public.profiles (id,email) values ('51789000-0000-4000-8000-00000000000a','e2e-a@example.test'),('51789000-0000-4000-8000-00000000000b','e2e-b@example.test') on conflict do nothing;
insert into subscriptions.plans (id,module,tier,name) values ('51789100-0000-4000-8000-000000000001','courses','complete','e2e complete') on conflict do nothing;
insert into subscriptions.user_subscriptions (id,user_id,plan_id,status) values
  ('51789200-0000-4000-8000-000000000001','51789000-0000-4000-8000-00000000000a','51789100-0000-4000-8000-000000000001','active'),
  ('51789200-0000-4000-8000-000000000002','51789000-0000-4000-8000-00000000000b','51789100-0000-4000-8000-000000000001','active')
on conflict do nothing;
insert into saring.projects (id,owner_id,name,r2_key,status,source,output_count) values
  ('51789300-0000-4000-8000-00000000000a','51789000-0000-4000-8000-00000000000a','e2e',
   '51789000-0000-4000-8000-00000000000a/51789300-0000-4000-8000-00000000000a/records.json.gz','ready','dedup',3)
on conflict (id) do update set r2_key = excluded.r2_key, output_count = 3;
insert into research.projects (id,owner_id,title,framework,research_question,framework_fields,team)
select '51789400-0000-4000-8000-00000000000a','51789000-0000-4000-8000-00000000000a','e2e paper','pico','Q?','{}',''
where not exists (select 1 from research.projects where id = '51789400-0000-4000-8000-00000000000a');
insert into ma.studies (id,project_id,owner_id,first_author,year,study_label,study_design,position) values
  ('51789500-0000-4000-8000-000000000001','51789400-0000-4000-8000-00000000000a','51789000-0000-4000-8000-00000000000a','Smith',2020,'Smith 2020','RCT',0)
  on conflict (id) do nothing;
insert into ma.outcomes (id,project_id,owner_id,name,analysis,outcome_type,effect_measure,direction,input_mode,position)
select * from (values ('51789600-0000-4000-8000-000000000001'::uuid,'51789400-0000-4000-8000-00000000000a'::uuid,'51789000-0000-4000-8000-00000000000a'::uuid,'Mortality','pairwise','binary','RR','lower_better','arm',0)) v
where not exists (select 1 from ma.outcomes where id = '51789600-0000-4000-8000-000000000001');
