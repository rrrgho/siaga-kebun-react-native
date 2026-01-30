import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiClient } from './api-client';

export interface User {
  uid: string;
  name: string;
  username: string;
  email: string;
  level: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface LoginCredentials {
  username: string;
  password: string;
  device_name: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Load stored auth data on mount
  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const [storedToken, storedUser] = await Promise.all([
        SecureStore.getItemAsync('auth_token'),
        SecureStore.getItemAsync('user_data'),
      ]);

      if (storedToken && storedUser) {
        setState({
          token: storedToken,
          user: JSON.parse(storedUser),
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Error loading stored auth:', error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await apiClient.post<LoginResponse>('/login', credentials);
    const { token, user } = response.data;

    // Store auth data securely
    await Promise.all([
      SecureStore.setItemAsync('auth_token', token),
      SecureStore.setItemAsync('user_data', JSON.stringify(user)),
    ]);

    setState({
      token,
      user,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      // Clear stored auth data
      await Promise.all([
        SecureStore.deleteItemAsync('auth_token'),
        SecureStore.deleteItemAsync('user_data'),
      ]);
    } catch (error) {
      console.error('Error clearing auth data:', error);
    }

    setState({
      token: null,
      user: null,
      isLoading: false,
      isAuthenticated: false,
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
