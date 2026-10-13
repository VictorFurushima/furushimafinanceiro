-- Objetivo: corrigir a lista de convites de visualizacao recebidos (tela Configuracoes).
--   public.list_my_viewer_invitations() era SECURITY INVOKER e lia auth.users, que o papel
--   authenticated nao pode consultar: toda chamada falhava com "permission denied for table users"
--   (HTTP 403) e o convidado nunca via o convite para aceitar. Mesmo padrao de list_my_viewers:
--   funcao privada SECURITY DEFINER restrita ao proprio convidado + wrapper publico.
-- Tabelas afetadas: nenhuma (somente leitura de viewer_invitations e do e-mail do titular).
-- Impacto de dados: nenhum.
-- RLS: inalterada; a funcao privada filtra target_user_id = auth.uid().
-- Indices/FKs: nenhum (usa viewer_invitations_target_pending).
-- Rollback: recriar public.list_my_viewer_invitations como em 20260904190200 e remover a privada.

CREATE OR REPLACE FUNCTION private.list_my_viewer_invitations()
RETURNS TABLE(id uuid, owner_email text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT i.id, u.email::text, i.created_at, i.expires_at
  FROM public.viewer_invitations i JOIN auth.users u ON u.id = i.owner_id
  WHERE i.target_user_id = auth.uid() AND i.status = 'pending' AND i.expires_at > now()
  ORDER BY i.created_at DESC;
$$;
REVOKE ALL ON FUNCTION private.list_my_viewer_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.list_my_viewer_invitations() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_my_viewer_invitations()
RETURNS TABLE(id uuid, owner_email text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT * FROM private.list_my_viewer_invitations();
$$;
REVOKE ALL ON FUNCTION public.list_my_viewer_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_viewer_invitations() TO authenticated, service_role;
