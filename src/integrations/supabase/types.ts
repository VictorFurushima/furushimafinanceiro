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
      accounts: {
        Row: {
          color: string
          created_at: string
          id: string
          initial_balance: number
          name: string
          type: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          initial_balance?: number
          name: string
          type?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          initial_balance?: number
          name?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      balance_recharges: {
        Row: {
          account_id: string | null
          card_id: string | null
          converted_to_income: boolean
          created_at: string
          expected_amount: number
          expected_date: string
          id: string
          is_recurring: boolean
          name: string
          notes: string | null
          payment_method: string | null
          recharge_type: string
          recurring_day: number | null
          source_recharge_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          card_id?: string | null
          converted_to_income?: boolean
          created_at?: string
          expected_amount: number
          expected_date: string
          id?: string
          is_recurring?: boolean
          name: string
          notes?: string | null
          payment_method?: string | null
          recharge_type?: string
          recurring_day?: number | null
          source_recharge_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          card_id?: string | null
          converted_to_income?: boolean
          created_at?: string
          expected_amount?: number
          expected_date?: string
          id?: string
          is_recurring?: boolean
          name?: string
          notes?: string | null
          payment_method?: string | null
          recharge_type?: string
          recurring_day?: number | null
          source_recharge_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          id: string
          month: string
          user_id: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          id?: string
          month: string
          user_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          id?: string
          month?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          type: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          type: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      category_limits: {
        Row: {
          category_id: string
          created_at: string
          id: string
          monthly_limit: number
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          monthly_limit: number
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          monthly_limit?: number
          user_id?: string
        }
        Relationships: []
      }
      credit_card_bills: {
        Row: {
          amount: number
          card_id: string
          created_at: string
          due_date: string
          id: string
          month: number
          payment_date: string | null
          status: string
          user_id: string
          year: number
        }
        Insert: {
          amount?: number
          card_id: string
          created_at?: string
          due_date: string
          id?: string
          month: number
          payment_date?: string | null
          status?: string
          user_id: string
          year: number
        }
        Update: {
          amount?: number
          card_id?: string
          created_at?: string
          due_date?: string
          id?: string
          month?: number
          payment_date?: string | null
          status?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      credit_cards: {
        Row: {
          bank: string | null
          closing_day: number
          color: string
          created_at: string
          due_day: number
          id: string
          name: string
          status: string
          total_limit: number
          used_limit: number
          user_id: string
        }
        Insert: {
          bank?: string | null
          closing_day?: number
          color?: string
          created_at?: string
          due_day?: number
          id?: string
          name: string
          status?: string
          total_limit?: number
          used_limit?: number
          user_id: string
        }
        Update: {
          bank?: string | null
          closing_day?: number
          color?: string
          created_at?: string
          due_day?: number
          id?: string
          name?: string
          status?: string
          total_limit?: number
          used_limit?: number
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          category_id: string | null
          color: string
          created_at: string
          current_amount: number
          deadline: string | null
          id: string
          name: string
          notes: string | null
          target_amount: number
          user_id: string
        }
        Insert: {
          category_id?: string | null
          color?: string
          created_at?: string
          current_amount?: number
          deadline?: string | null
          id?: string
          name: string
          notes?: string | null
          target_amount: number
          user_id: string
        }
        Update: {
          category_id?: string | null
          color?: string
          created_at?: string
          current_amount?: number
          deadline?: string | null
          id?: string
          name?: string
          notes?: string | null
          target_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      ocr_detected_transactions: {
        Row: {
          confidence_level: string | null
          created_at: string
          detected_account: string | null
          detected_amount: number | null
          detected_date: string | null
          detected_description: string | null
          detected_payment_method: string | null
          detected_type: string | null
          id: string
          image_id: string
          possible_duplicate: boolean
          raw_text: string | null
          review_status: string
          saved_transaction_id: string | null
          suggested_category: string | null
          suggested_category_id: string | null
          user_id: string
        }
        Insert: {
          confidence_level?: string | null
          created_at?: string
          detected_account?: string | null
          detected_amount?: number | null
          detected_date?: string | null
          detected_description?: string | null
          detected_payment_method?: string | null
          detected_type?: string | null
          id?: string
          image_id: string
          possible_duplicate?: boolean
          raw_text?: string | null
          review_status?: string
          saved_transaction_id?: string | null
          suggested_category?: string | null
          suggested_category_id?: string | null
          user_id: string
        }
        Update: {
          confidence_level?: string | null
          created_at?: string
          detected_account?: string | null
          detected_amount?: number | null
          detected_date?: string | null
          detected_description?: string | null
          detected_payment_method?: string | null
          detected_type?: string | null
          id?: string
          image_id?: string
          possible_duplicate?: boolean
          raw_text?: string | null
          review_status?: string
          saved_transaction_id?: string | null
          suggested_category?: string | null
          suggested_category_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_detected_transactions_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "uploaded_transaction_images"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurring_expenses: {
        Row: {
          account_id: string | null
          amount: number
          billing_day: number
          category_id: string | null
          created_at: string
          end_date: string | null
          frequency: string
          id: string
          name: string
          notes: string | null
          payment_method: string | null
          start_date: string
          status: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          billing_day?: number
          category_id?: string | null
          created_at?: string
          end_date?: string | null
          frequency?: string
          id?: string
          name: string
          notes?: string | null
          payment_method?: string | null
          start_date?: string
          status?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          billing_day?: number
          category_id?: string | null
          created_at?: string
          end_date?: string | null
          frequency?: string
          id?: string
          name?: string
          notes?: string | null
          payment_method?: string | null
          start_date?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          notes: string | null
          occurred_at: string
          payment_method: string | null
          recurring_id: string | null
          subcategory: string | null
          type: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          payment_method?: string | null
          recurring_id?: string | null
          subcategory?: string | null
          type: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          payment_method?: string | null
          recurring_id?: string | null
          subcategory?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      uploaded_transaction_images: {
        Row: {
          created_at: string
          delete_after_processing: boolean
          error_message: string | null
          file_name: string
          id: string
          image_url: string | null
          ocr_confidence: string | null
          processing_status: string
          storage_path: string
          upload_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delete_after_processing?: boolean
          error_message?: string | null
          file_name: string
          id?: string
          image_url?: string | null
          ocr_confidence?: string | null
          processing_status?: string
          storage_path: string
          upload_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          delete_after_processing?: boolean
          error_message?: string | null
          file_name?: string
          id?: string
          image_url?: string | null
          ocr_confidence?: string | null
          processing_status?: string
          storage_path?: string
          upload_date?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_recharge_as_income: {
        Args: { p_recharge_id: string }
        Returns: string
      }
      generate_recurring_recharges: { Args: never; Returns: number }
      generate_recurring_transactions: { Args: never; Returns: number }
      mark_overdue_recharges: { Args: never; Returns: number }
      pay_credit_card_bill: { Args: { p_bill_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
