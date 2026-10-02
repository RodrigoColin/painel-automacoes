-- Oystr: 2025 ficou sem `historico_fixo` (a migration 0005 populou contas,
-- categorias_grupo e linhas_receita, mas não essa coluna). Sem ele, a tela
-- nativa recalcula 2025 inteiro pelas bases ao vivo em vez de usar os
-- números já conferidos contra o relatório nativo do Omie (o mesmo dado que
-- o pipeline antigo usa como `historico_2025.json`/`SALDO_INICIAL_2025`) —
-- isso diverge o acumulado (acum) do ano todo e se propaga em cascata por
-- 2026, explicando boa parte da diferença entre a tela nativa e o artefato
-- (achado 02/10/2026).

update public.fluxo_caixa_config c
set historico_fixo = '[
      {"mes": "2025-01", "ent": 1110960.00, "sai": 1116862.63, "acum": 768954.50},
      {"mes": "2025-02", "ent": 1076472.74, "sai": 968162.65,  "acum": 877264.59},
      {"mes": "2025-03", "ent": 1215738.50, "sai": 1381152.41, "acum": 711850.68},
      {"mes": "2025-04", "ent": 1185189.97, "sai": 1105134.57, "acum": 791906.08},
      {"mes": "2025-05", "ent": 1176414.69, "sai": 850243.71,  "acum": 1118077.06},
      {"mes": "2025-06", "ent": 1332063.34, "sai": 937383.11,  "acum": 1512757.29},
      {"mes": "2025-07", "ent": 1120009.17, "sai": 1380870.56, "acum": 1251895.90},
      {"mes": "2025-08", "ent": 1256275.14, "sai": 1071896.14, "acum": 1436274.90},
      {"mes": "2025-09", "ent": 1117137.57, "sai": 1049261.84, "acum": 1504150.63},
      {"mes": "2025-10", "ent": 1154353.84, "sai": 1620989.80, "acum": 1037514.67},
      {"mes": "2025-11", "ent": 1090934.64, "sai": 1082465.25, "acum": 1045984.06},
      {"mes": "2025-12", "ent": 1104053.51, "sai": 1431724.56, "acum": 718313.01}
    ]'::jsonb,
    atualizado_em = now()
from public.empresas e
where e.id = c.empresa_id and e.nome ilike '%oystr%' and not e.eh_plataforma;
