import { useAuth } from '@/lib/auth-context';
import { Redirect } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading while checking auth state
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#7bed9a" />
      </View>
    );
  }

  // Redirect based on auth state
  if (isAuthenticated) {
    return <Redirect href="/(tabs)/home" />;
  }

  return <Redirect href="/login" />;
}
