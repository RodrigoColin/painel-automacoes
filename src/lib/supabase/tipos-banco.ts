/**
 * Tipos gerados a partir do schema do Supabase — não editar à mão.
 *
 * Regerar depois de qualquer migração:
 *   npx supabase gen types typescript --project-id ofvvmcyavabhkcghmkmn
 * (ou pela ferramenta `generate_typescript_types` do MCP do Supabase)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      automacao_segredos: {
        Row: {
          atualizado_em: string;
          automacao_id: string;
          empresa_id: string;
          valores: Json;
        };
        Insert: {
          atualizado_em?: string;
          automacao_id: string;
          empresa_id: string;
          valores?: Json;
        };
        Update: {
          atualizado_em?: string;
          automacao_id?: string;
          empresa_id?: string;
          valores?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "automacao_segredos_automacao_id_fkey";
            columns: ["automacao_id"];
            isOneToOne: true;
            referencedRelation: "automacoes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automacao_segredos_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      automacoes: {
        Row: {
          atualizada_em: string;
          config: Json;
          criada_em: string;
          descricao: string;
          empresa_id: string;
          id: string;
          nome: string;
          proxima_execucao: string | null;
          responsavel_id: string | null;
          sincronizado_ate: string | null;
          status: Database["public"]["Enums"]["status_automacao"];
          tipo: Database["public"]["Enums"]["tipo_automacao"];
        };
        Insert: {
          atualizada_em?: string;
          config?: Json;
          criada_em?: string;
          descricao?: string;
          empresa_id: string;
          id?: string;
          nome: string;
          proxima_execucao?: string | null;
          responsavel_id?: string | null;
          sincronizado_ate?: string | null;
          status?: Database["public"]["Enums"]["status_automacao"];
          tipo: Database["public"]["Enums"]["tipo_automacao"];
        };
        Update: {
          atualizada_em?: string;
          config?: Json;
          criada_em?: string;
          descricao?: string;
          empresa_id?: string;
          id?: string;
          nome?: string;
          proxima_execucao?: string | null;
          responsavel_id?: string | null;
          sincronizado_ate?: string | null;
          status?: Database["public"]["Enums"]["status_automacao"];
          tipo?: Database["public"]["Enums"]["tipo_automacao"];
        };
        Relationships: [
          {
            foreignKeyName: "automacoes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automacoes_responsavel_id_fkey";
            columns: ["responsavel_id"];
            isOneToOne: false;
            referencedRelation: "perfis";
            referencedColumns: ["id"];
          },
        ];
      };
      empresas: {
        Row: {
          cnpj: string | null;
          criada_em: string;
          email: string | null;
          id: string;
          nome: string;
        };
        Insert: {
          cnpj?: string | null;
          criada_em?: string;
          email?: string | null;
          id?: string;
          nome: string;
        };
        Update: {
          cnpj?: string | null;
          criada_em?: string;
          email?: string | null;
          id?: string;
          nome?: string;
        };
        Relationships: [];
      };
      execucoes: {
        Row: {
          automacao_id: string;
          duracao_ms: number | null;
          empresa_id: string;
          externo_id: string | null;
          finalizada_em: string | null;
          id: string;
          iniciada_em: string;
          log_path: string | null;
          origem: string;
          resultado: Database["public"]["Enums"]["resultado_execucao"];
        };
        Insert: {
          automacao_id: string;
          duracao_ms?: number | null;
          empresa_id: string;
          externo_id?: string | null;
          finalizada_em?: string | null;
          id?: string;
          iniciada_em?: string;
          log_path?: string | null;
          origem?: string;
          resultado?: Database["public"]["Enums"]["resultado_execucao"];
        };
        Update: {
          automacao_id?: string;
          duracao_ms?: number | null;
          empresa_id?: string;
          externo_id?: string | null;
          finalizada_em?: string | null;
          id?: string;
          iniciada_em?: string;
          log_path?: string | null;
          origem?: string;
          resultado?: Database["public"]["Enums"]["resultado_execucao"];
        };
        Relationships: [
          {
            foreignKeyName: "execucoes_automacao_id_fkey";
            columns: ["automacao_id"];
            isOneToOne: false;
            referencedRelation: "automacoes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "execucoes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      integracoes_n8n: {
        Row: {
          criada_em: string;
          empresa_id: string;
          instancia_url: string;
        };
        Insert: {
          criada_em?: string;
          empresa_id: string;
          instancia_url: string;
        };
        Update: {
          criada_em?: string;
          empresa_id?: string;
          instancia_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integracoes_n8n_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: true;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      integracoes_n8n_segredos: {
        Row: {
          api_key: string;
          atualizado_em: string;
          empresa_id: string;
        };
        Insert: {
          api_key: string;
          atualizado_em?: string;
          empresa_id: string;
        };
        Update: {
          api_key?: string;
          atualizado_em?: string;
          empresa_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integracoes_n8n_segredos_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: true;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      logs_execucao: {
        Row: {
          empresa_id: string;
          execucao_id: string;
          horario: string;
          id: number;
          mensagem: string;
          nivel: Database["public"]["Enums"]["nivel_log"];
        };
        Insert: {
          empresa_id: string;
          execucao_id: string;
          horario?: string;
          id?: number;
          mensagem: string;
          nivel?: Database["public"]["Enums"]["nivel_log"];
        };
        Update: {
          empresa_id?: string;
          execucao_id?: string;
          horario?: string;
          id?: number;
          mensagem?: string;
          nivel?: Database["public"]["Enums"]["nivel_log"];
        };
        Relationships: [
          {
            foreignKeyName: "logs_execucao_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "logs_execucao_execucao_id_fkey";
            columns: ["execucao_id"];
            isOneToOne: false;
            referencedRelation: "execucoes";
            referencedColumns: ["id"];
          },
        ];
      };
      membros: {
        Row: {
          criado_em: string;
          empresa_id: string;
          papel: Database["public"]["Enums"]["papel_membro"];
          status: Database["public"]["Enums"]["status_membro"];
          user_id: string;
        };
        Insert: {
          criado_em?: string;
          empresa_id: string;
          papel?: Database["public"]["Enums"]["papel_membro"];
          status?: Database["public"]["Enums"]["status_membro"];
          user_id: string;
        };
        Update: {
          criado_em?: string;
          empresa_id?: string;
          papel?: Database["public"]["Enums"]["papel_membro"];
          status?: Database["public"]["Enums"]["status_membro"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membros_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membros_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "perfis";
            referencedColumns: ["id"];
          },
        ];
      };
      perfis: {
        Row: {
          email: string;
          id: string;
          nome: string;
          ultimo_acesso: string | null;
        };
        Insert: {
          email: string;
          id: string;
          nome?: string;
          ultimo_acesso?: string | null;
        };
        Update: {
          email?: string;
          id?: string;
          nome?: string;
          ultimo_acesso?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      nivel_log: "info" | "aviso" | "erro";
      papel_membro: "admin" | "editor" | "leitor";
      resultado_execucao: "sucesso" | "erro" | "em_andamento";
      status_automacao: "ativa" | "pausada" | "rascunho";
      status_membro: "ativo" | "convidado" | "inativo";
      tipo_automacao: "python-cron" | "n8n";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
