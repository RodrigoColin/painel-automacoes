-- `revoke ... from public` só derruba o grant implícito da pseudo-role
-- PUBLIC — o Supabase também concede EXECUTE a `anon` por padrão em toda
-- função nova do schema `public`. Sem este revoke explícito, um visitante
-- sem sessão conseguiria chamar a função pela API REST.
revoke execute on function public.armazenamento_bytes_usados() from anon;
