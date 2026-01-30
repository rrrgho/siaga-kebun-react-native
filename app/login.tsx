import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Stack, router } from 'expo-router';
import { EyeIcon, EyeOffIcon, LockIcon, ShieldCheckIcon, UserIcon } from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const SCREEN_OPTIONS = {
  headerShown: false,
};

export default function LoginScreen() {
  const { login, isLoading: authLoading } = useAuth();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Validation Error', 'Please enter both username and password');
      return;
    }

    setIsLoading(true);
    try {
      await login({
        username: username.trim(),
        password: password.trim(),
        device_name: 'mobile_app',
      });
      router.replace('/(tabs)/home');
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Login failed';
      Alert.alert('Login Failed', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1">
          <View className="flex-1 justify-center px-6">
            {/* Logo/Header Section */}
            <View className="mb-12 items-center">
              <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-[#7bed9a]/20">
                <Icon as={ShieldCheckIcon} className="text-[#7bed9a]" size={48} />
              </View>
              <Text className="text-3xl font-bold text-gray-900">Siaga Kebun</Text>
              <Text className="mt-2 text-center text-gray-500">
                Security Officer Monitoring System
              </Text>
            </View>

            {/* Login Form */}
            <View className="gap-4">
              {/* Username Input */}
              <View className="gap-2">
                <Text className="text-sm font-medium text-gray-700">Username</Text>
                <View className="flex-row items-center rounded-xl border border-gray-200 bg-gray-50 px-4">
                  <Icon as={UserIcon} className="text-gray-400" size={20} />
                  <TextInput
                    className="ml-3 flex-1 py-4 text-base text-gray-900"
                    placeholder="Enter your username"
                    placeholderTextColor="#9ca3af"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                </View>
              </View>

              {/* Password Input */}
              <View className="gap-2">
                <Text className="text-sm font-medium text-gray-700">Password</Text>
                <View className="flex-row items-center rounded-xl border border-gray-200 bg-gray-50 px-4">
                  <Icon as={LockIcon} className="text-gray-400" size={20} />
                  <TextInput
                    className="ml-3 flex-1 py-4 text-base text-gray-900"
                    placeholder="Enter your password"
                    placeholderTextColor="#9ca3af"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} className="p-1">
                    <Icon
                      as={showPassword ? EyeOffIcon : EyeIcon}
                      className="text-gray-400"
                      size={20}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Login Button */}
              <Button
                onPress={handleLogin}
                disabled={isLoading}
                className={cn(
                  'mt-4 h-14 rounded-xl',
                  isLoading ? 'bg-[#7bed9a]/50' : 'bg-[#7bed9a] active:bg-[#5fd47d]'
                )}>
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-lg font-semibold text-white">Sign In</Text>
                )}
              </Button>
            </View>

            {/* Footer */}
            <View className="mt-8 items-center">
              <Text className="text-sm text-gray-400">Secure login powered by Laravel Sanctum</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}
