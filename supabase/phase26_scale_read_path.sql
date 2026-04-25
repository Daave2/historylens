-- phase26_scale_read_path.sql
-- Bounded read-path foundation for large projects.
-- Adds viewport-friendly map snapshot and year-bound RPCs.

CREATE INDEX IF NOT EXISTS idx_places_project_lat_lng
  ON public.places(project_id, lat, lng);

CREATE INDEX IF NOT EXISTS idx_entry_sources_source_entry
  ON public.entry_sources(source_id, entry_id);

CREATE INDEX IF NOT EXISTS idx_sources_project_title
  ON public.sources(project_id, title);

CREATE OR REPLACE FUNCTION public.get_project_year_bounds(p_project_id UUID)
RETURNS TABLE (
  min_year INTEGER,
  max_year INTEGER,
  entry_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_year INTEGER := EXTRACT(YEAR FROM NOW())::integer;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Project id is required';
  END IF;

  IF NOT (
    public.is_project_public(p_project_id)
    OR public.is_project_owner(p_project_id)
    OR public.has_project_role(p_project_id, ARRAY['editor', 'admin', 'pending'])
  ) THEN
    RAISE EXCEPTION 'Not authorized to read project';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN MIN(te.year_start) IS NULL THEN 1800
      ELSE GREATEST(1800, MIN(te.year_start)::integer - 20)
    END AS min_year,
    CASE
      WHEN MAX(COALESCE(te.year_end, te.year_start)) IS NULL THEN v_current_year
      ELSE GREATEST(MAX(COALESCE(te.year_end, te.year_start))::integer + 10, v_current_year)
    END AS max_year,
    COUNT(te.id)::integer AS entry_count
  FROM public.places p
  LEFT JOIN public.time_entries te ON te.place_id = p.id
  WHERE p.project_id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_project_map_snapshot(
  p_project_id UUID,
  p_min_lat DOUBLE PRECISION DEFAULT NULL,
  p_min_lng DOUBLE PRECISION DEFAULT NULL,
  p_max_lat DOUBLE PRECISION DEFAULT NULL,
  p_max_lng DOUBLE PRECISION DEFAULT NULL,
  p_year INTEGER DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 250
)
RETURNS TABLE (
  place_id UUID,
  project_id UUID,
  name TEXT,
  description TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  category TEXT,
  created_by UUID,
  pinned_image_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  aliases JSONB,
  entry_count INTEGER,
  first_year INTEGER,
  last_year INTEGER,
  marker_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_lat DOUBLE PRECISION;
  v_max_lat DOUBLE PRECISION;
  v_min_lng DOUBLE PRECISION := p_min_lng;
  v_max_lng DOUBLE PRECISION := p_max_lng;
  v_category TEXT := NULLIF(TRIM(COALESCE(p_category, '')), '');
  v_search TEXT := NULLIF(TRIM(COALESCE(p_search, '')), '');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 250), 1), 500);
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Project id is required';
  END IF;

  IF NOT (
    public.is_project_public(p_project_id)
    OR public.is_project_owner(p_project_id)
    OR public.has_project_role(p_project_id, ARRAY['editor', 'admin', 'pending'])
  ) THEN
    RAISE EXCEPTION 'Not authorized to read project';
  END IF;

  IF p_min_lat IS NOT NULL AND p_max_lat IS NOT NULL THEN
    v_min_lat := LEAST(p_min_lat, p_max_lat);
    v_max_lat := GREATEST(p_min_lat, p_max_lat);
  END IF;

  RETURN QUERY
  WITH filtered_places AS (
    SELECT p.*
    FROM public.places p
    WHERE p.project_id = p_project_id
      AND (
        v_category IS NULL
        OR p.category = v_category
        OR (
          v_category = 'other'
          AND COALESCE(p.category, '') NOT IN ('residential', 'commercial', 'landmark', 'natural', 'infrastructure')
        )
      )
      AND (v_min_lat IS NULL OR v_max_lat IS NULL OR p.lat BETWEEN v_min_lat AND v_max_lat)
      AND (
        v_min_lng IS NULL
        OR v_max_lng IS NULL
        OR (v_min_lng <= v_max_lng AND p.lng BETWEEN v_min_lng AND v_max_lng)
        OR (v_min_lng > v_max_lng AND (p.lng >= v_min_lng OR p.lng <= v_max_lng))
      )
      AND (
        p_cursor_created_at IS NULL
        OR p.created_at < p_cursor_created_at
        OR (p_cursor_id IS NOT NULL AND p.created_at = p_cursor_created_at AND p.id < p_cursor_id)
      )
      AND (
        v_search IS NULL
        OR p.name ILIKE '%' || v_search || '%'
        OR COALESCE(p.description, '') ILIKE '%' || v_search || '%'
        OR COALESCE(p.category, '') ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1
          FROM public.place_name_aliases a
          WHERE a.place_id = p.id
            AND a.alias ILIKE '%' || v_search || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM public.time_entries te
          WHERE te.place_id = p.id
            AND (
              COALESCE(te.title, '') ILIKE '%' || v_search || '%'
              OR COALESCE(te.summary, '') ILIKE '%' || v_search || '%'
              OR COALESCE(te.source, '') ILIKE '%' || v_search || '%'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.time_entries te
          JOIN public.entry_sources es ON es.entry_id = te.id
          JOIN public.sources s ON s.id = es.source_id
          WHERE te.place_id = p.id
            AND (
              s.title ILIKE '%' || v_search || '%'
              OR COALESCE(s.author, '') ILIKE '%' || v_search || '%'
              OR COALESCE(s.url, '') ILIKE '%' || v_search || '%'
            )
        )
      )
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT v_limit + 1
  ),
  entry_stats AS (
    SELECT
      fp.id AS place_id,
      COUNT(te.id)::integer AS entry_count,
      MIN(te.year_start)::integer AS first_year,
      MAX(COALESCE(te.year_end, te.year_start))::integer AS last_year,
      CASE
        WHEN COUNT(te.id) = 0 THEN 'none'
        WHEN p_year IS NULL THEN 'has_entries'
        WHEN BOOL_OR(te.year_start <= p_year AND (te.year_end IS NULL OR te.year_end >= p_year)) THEN 'exact'
        WHEN BOOL_OR(te.year_start <= p_year) THEN 'last_known'
        ELSE 'before_known'
      END AS marker_state
    FROM filtered_places fp
    LEFT JOIN public.time_entries te ON te.place_id = fp.id
    GROUP BY fp.id
  )
  SELECT
    fp.id AS place_id,
    fp.project_id,
    fp.name,
    fp.description,
    fp.lat,
    fp.lng,
    fp.category,
    fp.created_by,
    fp.pinned_image_id,
    fp.created_at,
    fp.updated_at,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'place_id', a.place_id,
          'project_id', a.project_id,
          'alias', a.alias,
          'start_year', a.start_year,
          'end_year', a.end_year,
          'note', a.note,
          'created_by', a.created_by,
          'created_at', a.created_at
        )
        ORDER BY a.start_year NULLS FIRST, a.alias
      )
      FROM public.place_name_aliases a
      WHERE a.place_id = fp.id
    ), '[]'::jsonb) AS aliases,
    COALESCE(es.entry_count, 0) AS entry_count,
    es.first_year,
    es.last_year,
    COALESCE(es.marker_state, 'none') AS marker_state
  FROM filtered_places fp
  LEFT JOIN entry_stats es ON es.place_id = fp.id
  ORDER BY fp.created_at DESC, fp.id DESC;
END;
$$;
