import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

export const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
});

/**
 * Consome a sessão única mantida pelo <AuthProvider /> na raiz.
 * Não cria listeners nem chama getSession por componente.
 */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
