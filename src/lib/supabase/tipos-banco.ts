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
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      acessos_chaves: {
        Row: {
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          descricao: string
          empresa_id: string
          id: string
          nome: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string
          empresa_id: string
          id?: string
          nome: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string
          empresa_id?: string
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "acessos_chaves_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acessos_chaves_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      acessos_chaves_segredo: {
        Row: {
          atualizado_em: string
          chave_id: string
          empresa_id: string
          valor: string
        }
        Insert: {
          atualizado_em?: string
          chave_id: string
          empresa_id: string
          valor: string
        }
        Update: {
          atualizado_em?: string
          chave_id?: string
          empresa_id?: string
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "acessos_chaves_segredo_chave_id_fkey"
            columns: ["chave_id"]
            isOneToOne: true
            referencedRelation: "acessos_chaves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acessos_chaves_segredo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      arquivos: {
        Row: {
          caminho: string
          empresa_id: string
          enviado_em: string
          enviado_por: string | null
          id: string
          nome: string
          tamanho_bytes: number
          tipo_mime: string | null
        }
        Insert: {
          caminho: string
          empresa_id: string
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          nome: string
          tamanho_bytes: number
          tipo_mime?: string | null
        }
        Update: {
          caminho?: string
          empresa_id?: string
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          nome?: string
          tamanho_bytes?: number
          tipo_mime?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arquivos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      automacao_segredos: {
        Row: {
          atualizado_em: string
          automacao_id: string
          empresa_id: string
          valores: Json
        }
        Insert: {
          atualizado_em?: string
          automacao_id: string
          empresa_id: string
          valores?: Json
        }
        Update: {
          atualizado_em?: string
          automacao_id?: string
          empresa_id?: string
          valores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automacao_segredos_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: true
            referencedRelation: "automacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacao_segredos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      automacoes: {
        Row: {
          atualizada_em: string
          config: Json
          criada_em: string
          descricao: string
          empresa_id: string
          id: string
          nome: string
          proxima_execucao: string | null
          responsavel_id: string | null
          sincronizado_ate: string | null
          status: Database["public"]["Enums"]["status_automacao"]
          tipo: Database["public"]["Enums"]["tipo_automacao"]
        }
        Insert: {
          atualizada_em?: string
          config?: Json
          criada_em?: string
          descricao?: string
          empresa_id: string
          id?: string
          nome: string
          proxima_execucao?: string | null
          responsavel_id?: string | null
          sincronizado_ate?: string | null
          status?: Database["public"]["Enums"]["status_automacao"]
          tipo: Database["public"]["Enums"]["tipo_automacao"]
        }
        Update: {
          atualizada_em?: string
          config?: Json
          criada_em?: string
          descricao?: string
          empresa_id?: string
          id?: string
          nome?: string
          proxima_execucao?: string | null
          responsavel_id?: string | null
          sincronizado_ate?: string | null
          status?: Database["public"]["Enums"]["status_automacao"]
          tipo?: Database["public"]["Enums"]["tipo_automacao"]
        }
        Relationships: [
          {
            foreignKeyName: "automacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automacoes_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          cnpj: string | null
          criada_em: string
          eh_plataforma: boolean
          email: string | null
          id: string
          nome: string
        }
        Insert: {
          cnpj?: string | null
          criada_em?: string
          eh_plataforma?: boolean
          email?: string | null
          id?: string
          nome: string
        }
        Update: {
          cnpj?: string | null
          criada_em?: string
          eh_plataforma?: boolean
          email?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      execucoes: {
        Row: {
          arquivo_nome: string | null
          arquivo_path: string | null
          automacao_id: string
          duracao_ms: number | null
          empresa_id: string
          externo_id: string | null
          finalizada_em: string | null
          id: string
          iniciada_em: string
          log_path: string | null
          origem: string
          resultado: Database["public"]["Enums"]["resultado_execucao"]
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_path?: string | null
          automacao_id: string
          duracao_ms?: number | null
          empresa_id: string
          externo_id?: string | null
          finalizada_em?: string | null
          id?: string
          iniciada_em?: string
          log_path?: string | null
          origem?: string
          resultado?: Database["public"]["Enums"]["resultado_execucao"]
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_path?: string | null
          automacao_id?: string
          duracao_ms?: number | null
          empresa_id?: string
          externo_id?: string | null
          finalizada_em?: string | null
          id?: string
          iniciada_em?: string
          log_path?: string | null
          origem?: string
          resultado?: Database["public"]["Enums"]["resultado_execucao"]
        }
        Relationships: [
          {
            foreignKeyName: "execucoes_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execucoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      infisical_caminhos_clientes: {
        Row: {
          atualizado_em: string
          caminho: string
          empresa_id: string
        }
        Insert: {
          atualizado_em?: string
          caminho: string
          empresa_id: string
        }
        Update: {
          atualizado_em?: string
          caminho?: string
          empresa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "infisical_caminhos_clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      integracao_infisical_plataforma: {
        Row: {
          ambiente: string
          client_id: string
          criada_em: string
          id: boolean
          injetar_segredos: boolean
          mascarar_valores: boolean
          projeto_id: string
          site_url: string
        }
        Insert: {
          ambiente?: string
          client_id: string
          criada_em?: string
          id?: boolean
          injetar_segredos?: boolean
          mascarar_valores?: boolean
          projeto_id: string
          site_url?: string
        }
        Update: {
          ambiente?: string
          client_id?: string
          criada_em?: string
          id?: boolean
          injetar_segredos?: boolean
          mascarar_valores?: boolean
          projeto_id?: string
          site_url?: string
        }
        Relationships: []
      }
      integracao_infisical_plataforma_segredo: {
        Row: {
          atualizado_em: string
          client_secret: string
          id: boolean
        }
        Insert: {
          atualizado_em?: string
          client_secret: string
          id?: boolean
        }
        Update: {
          atualizado_em?: string
          client_secret?: string
          id?: boolean
        }
        Relationships: []
      }
      integracao_n8n_plataforma: {
        Row: {
          criada_em: string
          id: boolean
          instancia_url: string
        }
        Insert: {
          criada_em?: string
          id?: boolean
          instancia_url: string
        }
        Update: {
          criada_em?: string
          id?: boolean
          instancia_url?: string
        }
        Relationships: []
      }
      integracao_n8n_plataforma_segredo: {
        Row: {
          api_key: string
          atualizado_em: string
          id: boolean
        }
        Insert: {
          api_key: string
          atualizado_em?: string
          id?: boolean
        }
        Update: {
          api_key?: string
          atualizado_em?: string
          id?: boolean
        }
        Relationships: []
      }
      logs_execucao: {
        Row: {
          empresa_id: string
          execucao_id: string
          horario: string
          id: number
          mensagem: string
          nivel: Database["public"]["Enums"]["nivel_log"]
        }
        Insert: {
          empresa_id: string
          execucao_id: string
          horario?: string
          id?: number
          mensagem: string
          nivel?: Database["public"]["Enums"]["nivel_log"]
        }
        Update: {
          empresa_id?: string
          execucao_id?: string
          horario?: string
          id?: number
          mensagem?: string
          nivel?: Database["public"]["Enums"]["nivel_log"]
        }
        Relationships: [
          {
            foreignKeyName: "logs_execucao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_execucao_execucao_id_fkey"
            columns: ["execucao_id"]
            isOneToOne: false
            referencedRelation: "execucoes"
            referencedColumns: ["id"]
          },
        ]
      }
      membros: {
        Row: {
          criado_em: string
          empresa_id: string
          papel: Database["public"]["Enums"]["papel_membro"]
          status: Database["public"]["Enums"]["status_membro"]
          user_id: string
        }
        Insert: {
          criado_em?: string
          empresa_id: string
          papel?: Database["public"]["Enums"]["papel_membro"]
          status?: Database["public"]["Enums"]["status_membro"]
          user_id: string
        }
        Update: {
          criado_em?: string
          empresa_id?: string
          papel?: Database["public"]["Enums"]["papel_membro"]
          status?: Database["public"]["Enums"]["status_membro"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membros_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membros_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis: {
        Row: {
          email: string
          id: string
          nome: string
          ultimo_acesso: string | null
        }
        Insert: {
          email: string
          id: string
          nome?: string
          ultimo_acesso?: string | null
        }
        Update: {
          email?: string
          id?: string
          nome?: string
          ultimo_acesso?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      armazenamento_bytes_usados: { Args: never; Returns: number }
    }
    Enums: {
      nivel_log: "info" | "aviso" | "erro"
      papel_membro: "admin" | "editor" | "leitor"
      resultado_execucao: "sucesso" | "erro" | "em_andamento"
      status_automacao: "ativa" | "pausada" | "rascunho"
      status_membro: "ativo" | "convidado" | "inativo"
      tipo_automacao: "python-cron" | "n8n" | "upload"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      nivel_log: ["info", "aviso", "erro"],
      papel_membro: ["admin", "editor", "leitor"],
      resultado_execucao: ["sucesso", "erro", "em_andamento"],
      status_automacao: ["ativa", "pausada", "rascunho"],
      status_membro: ["ativo", "convidado", "inativo"],
      tipo_automacao: ["python-cron", "n8n", "upload"],
    },
  },
} as const
