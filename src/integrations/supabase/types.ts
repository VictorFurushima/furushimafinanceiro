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
      alerts: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          id: string
          read_at: string | null
          source_id: string | null
          source_type: string
          status: string
          title: string
          trigger_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          read_at?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          title: string
          trigger_at: string
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          read_at?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          title?: string
          trigger_at?: string
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
        Relationships: [
          {
            foreignKeyName: "balance_recharges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_recharges_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_recharges_source_recharge_id_fkey"
            columns: ["source_recharge_id"]
            isOneToOne: false
            referencedRelation: "balance_recharges"
            referencedColumns: ["id"]
          },
        ]
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
      calendar_events: {
        Row: {
          all_day: boolean
          category: string
          created_at: string
          description: string | null
          ends_at: string
          google_event_id: string | null
          id: string
          last_synced_at: string | null
          location: string | null
          priority: string
          recurrence_rule: string | null
          source_id: string | null
          source_type: string | null
          starts_at: string
          sync_enabled: boolean
          sync_error: string | null
          sync_status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          category?: string
          created_at?: string
          description?: string | null
          ends_at: string
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          location?: string | null
          priority?: string
          recurrence_rule?: string | null
          source_id?: string | null
          source_type?: string | null
          starts_at: string
          sync_enabled?: boolean
          sync_error?: string | null
          sync_status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          category?: string
          created_at?: string
          description?: string | null
          ends_at?: string
          google_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          location?: string | null
          priority?: string
          recurrence_rule?: string | null
          source_id?: string | null
          source_type?: string | null
          starts_at?: string
          sync_enabled?: boolean
          sync_error?: string | null
          sync_status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_integrations: {
        Row: {
          account_email: string | null
          calendar_id: string | null
          connected_at: string | null
          created_at: string
          id: string
          last_error: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_email?: string | null
          calendar_id?: string | null
          connected_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_email?: string | null
          calendar_id?: string | null
          connected_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "category_limits_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "credit_card_bills_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "goals_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_events: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string
          event_type: string
          id: string
          investment_id: string
          new_amount: number | null
          notes: string | null
          occurred_at: string
          previous_amount: number | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          created_at?: string
          event_type: string
          id?: string
          investment_id: string
          new_amount?: number | null
          notes?: string | null
          occurred_at?: string
          previous_amount?: number | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string
          event_type?: string
          id?: string
          investment_id?: string
          new_amount?: number | null
          notes?: string | null
          occurred_at?: string
          previous_amount?: number | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_events_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      investments: {
        Row: {
          applied_at: string
          color: string
          created_at: string
          current_amount: number
          id: string
          initial_amount: number
          institution: string | null
          inv_type: string
          invested_amount: number
          is_emergency_reserve: boolean
          liquidity: string
          maturity_date: string | null
          name: string
          notes: string | null
          objective: string | null
          risk: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          color?: string
          created_at?: string
          current_amount?: number
          id?: string
          initial_amount?: number
          institution?: string | null
          inv_type?: string
          invested_amount?: number
          is_emergency_reserve?: boolean
          liquidity?: string
          maturity_date?: string | null
          name: string
          notes?: string | null
          objective?: string | null
          risk?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string
          color?: string
          created_at?: string
          current_amount?: number
          id?: string
          initial_amount?: number
          institution?: string | null
          inv_type?: string
          invested_amount?: number
          is_emergency_reserve?: boolean
          liquidity?: string
          maturity_date?: string | null
          name?: string
          notes?: string | null
          objective?: string | null
          risk?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          link_id: string | null
          link_type: string
          note_date: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_id?: string | null
          link_type?: string
          note_date?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_id?: string | null
          link_type?: string
          note_date?: string
          title?: string
          updated_at?: string
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
          {
            foreignKeyName: "ocr_detected_transactions_saved_transaction_id_fkey"
            columns: ["saved_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_detected_transactions_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
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
      routine_occurrences: {
        Row: {
          completed_at: string
          created_at: string
          id: string
          notes: string | null
          occurrence_date: string
          routine_id: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          created_at?: string
          id?: string
          notes?: string | null
          occurrence_date: string
          routine_id: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string
          created_at?: string
          id?: string
          notes?: string | null
          occurrence_date?: string
          routine_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_occurrences_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          alert_minutes: number | null
          category: string
          created_at: string
          description: string | null
          duration_minutes: number
          generate_events: boolean
          id: string
          name: string
          objective: string | null
          reminder_minutes: number | null
          start_time: string
          status: string
          timezone: string
          updated_at: string
          user_id: string
          weekdays: number[]
        }
        Insert: {
          alert_minutes?: number | null
          category?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          generate_events?: boolean
          id?: string
          name: string
          objective?: string | null
          reminder_minutes?: number | null
          start_time?: string
          status?: string
          timezone?: string
          updated_at?: string
          user_id: string
          weekdays?: number[]
        }
        Update: {
          alert_minutes?: number | null
          category?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          generate_events?: boolean
          id?: string
          name?: string
          objective?: string | null
          reminder_minutes?: number | null
          start_time?: string
          status?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      shopping_items: {
        Row: {
          account_id: string | null
          card_id: string | null
          category_id: string | null
          created_at: string
          desired_date: string | null
          discount: number
          down_payment: number
          goal_id: string | null
          id: string
          image_url: string | null
          installments: number
          interest: number
          item: string
          link: string | null
          notes: string | null
          payment_method: string
          price: number
          priority: string
          purchase_type: string
          score: number | null
          shipping: number
          status: string
          store: string | null
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          card_id?: string | null
          category_id?: string | null
          created_at?: string
          desired_date?: string | null
          discount?: number
          down_payment?: number
          goal_id?: string | null
          id?: string
          image_url?: string | null
          installments?: number
          interest?: number
          item: string
          link?: string | null
          notes?: string | null
          payment_method?: string
          price?: number
          priority?: string
          purchase_type?: string
          score?: number | null
          shipping?: number
          status?: string
          store?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          card_id?: string | null
          category_id?: string | null
          created_at?: string
          desired_date?: string | null
          discount?: number
          down_payment?: number
          goal_id?: string | null
          id?: string
          image_url?: string | null
          installments?: number
          interest?: number
          item?: string
          link?: string | null
          notes?: string | null
          payment_method?: string
          price?: number
          priority?: string
          purchase_type?: string
          score?: number | null
          shipping?: number
          status?: string
          store?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          category: string
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          estimated_minutes: number | null
          event_id: string | null
          id: string
          priority: string
          routine_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          event_id?: string | null
          id?: string
          priority?: string
          routine_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          event_id?: string | null
          id?: string
          priority?: string
          routine_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
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
          flow: string
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
          flow?: string
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
          flow?: string
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
          {
            foreignKeyName: "transactions_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          owner_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          allow_low_score_wants: boolean
          created_at: string
          max_free_balance_pct: number
          max_income_installment_pct: number
          min_priority_auto: string
          min_reserve: number
          purchase_alerts: boolean
          reminder_amount: number
          reminder_day: number
          reminder_enabled: boolean
          reminder_investment_id: string | null
          reminder_last_shown: string | null
          reminder_message: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_low_score_wants?: boolean
          created_at?: string
          max_free_balance_pct?: number
          max_income_installment_pct?: number
          min_priority_auto?: string
          min_reserve?: number
          purchase_alerts?: boolean
          reminder_amount?: number
          reminder_day?: number
          reminder_enabled?: boolean
          reminder_investment_id?: string | null
          reminder_last_shown?: string | null
          reminder_message?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_low_score_wants?: boolean
          created_at?: string
          max_free_balance_pct?: number
          max_income_installment_pct?: number
          min_priority_auto?: string
          min_reserve?: number
          purchase_alerts?: boolean
          reminder_amount?: number
          reminder_day?: number
          reminder_enabled?: boolean
          reminder_investment_id?: string | null
          reminder_last_shown?: string | null
          reminder_message?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_reminder_investment_id_fkey"
            columns: ["reminder_investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_routine_occurrence: {
        Args: { p_date: string; p_routine_id: string }
        Returns: string
      }
      complete_shopping_item: {
        Args: { p_create_transaction: boolean; p_item_id: string }
        Returns: string
      }
      confirm_recharge_as_income: {
        Args: { p_recharge_id: string }
        Returns: string
      }
      generate_recurring_recharges: { Args: never; Returns: number }
      generate_recurring_transactions: { Args: never; Returns: number }
      get_account_balances: {
        Args: never
        Returns: {
          balance: number
          color: string
          id: string
          initial_balance: number
          name: string
          type: string
        }[]
      }
      get_dashboard_snapshot: { Args: never; Returns: Json }
      get_financial_overview: { Args: never; Returns: Json }
      get_monthly_financial_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          aportes: number
          despesas: number
          receitas: number
          resgates: number
          saldo_liquido: number
        }[]
      }
      get_monthly_series: {
        Args: { p_months?: number }
        Returns: {
          aportes: number
          despesas: number
          month: string
          receitas: number
          resgates: number
        }[]
      }
      get_spending_by_category: {
        Args: { p_from: string; p_to: string }
        Returns: {
          category_id: string
          color: string
          icon: string
          name: string
          total: number
        }[]
      }
      get_statistics_extras: {
        Args: { p_from: string; p_to: string; p_top?: number }
        Returns: Json
      }
      grant_viewer_access: { Args: { p_email: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invest_contribute: {
        Args: {
          p_account_id: string
          p_amount: number
          p_date: string
          p_investment_id: string
          p_notes: string
        }
        Returns: string
      }
      invest_redeem: {
        Args: {
          p_account_id: string
          p_amount: number
          p_date: string
          p_investment_id: string
          p_notes: string
        }
        Returns: string
      }
      invest_update_value: {
        Args: { p_investment_id: string; p_new_amount: number; p_notes: string }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      list_my_viewers: {
        Args: never
        Returns: {
          created_at: string
          email: string
          user_id: string
        }[]
      }
      mark_overdue_recharges: { Args: never; Returns: number }
      pay_credit_card_bill: { Args: { p_bill_id: string }; Returns: undefined }
      revoke_viewer_access: { Args: { p_user_id: string }; Returns: string }
      space_owner: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "viewer"
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
    Enums: {
      app_role: ["admin", "viewer"],
    },
  },
} as const
