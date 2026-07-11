-- 0002_search_function.sql
-- Adds product search (PRD.md FR-18, API.md §3 GET /api/search) on top of
-- 0001_init.sql's products_search_idx GIN index. Implemented as a Postgres
-- function (API.md §1 Layer C pattern) so the search term is a bound
-- function parameter, never string-interpolated into a query -- safe by
-- construction, not by sanitization. Runs as SECURITY INVOKER (the
-- default), so the caller's RLS policies (products: is_active = true)
-- still apply.

create or replace function search_products(q text default '', p_limit int default 50)
returns setof products
language plpgsql
stable
as $$
begin
  if q is null or btrim(q) = '' then
    return query
      select p.* from products p
      where p.is_active = true
      order by p.updated_at desc
      limit p_limit;
  else
    return query
      select p.* from products p
      where p.is_active = true
        and to_tsvector('simple', p.title_en || ' ' || coalesce(p.title_ar, ''))
            @@ websearch_to_tsquery('simple', q)
      order by ts_rank(
        to_tsvector('simple', p.title_en || ' ' || coalesce(p.title_ar, '')),
        websearch_to_tsquery('simple', q)
      ) desc
      limit p_limit;
  end if;
end;
$$;
