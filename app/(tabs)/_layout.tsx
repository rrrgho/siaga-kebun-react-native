import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Tabs } from 'expo-router';
import { AlertTriangleIcon, HomeIcon, MapIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';

const PRIMARY_COLOR = '#7bed9a';

export default function TabsLayout() {
  const { user } = useAuth();
  const isSatpam = user?.level === 'SATPAM';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_COLOR,
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          paddingTop: 8,
          paddingBottom: 8,
          height: 70,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <View
              className={cn('rounded-full p-2', focused ? 'bg-[#7bed9a]/20' : 'bg-transparent')}>
              <Icon as={HomeIcon} size={24} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          href: isSatpam ? null : undefined, // Hide tab for SATPAM users
          tabBarIcon: ({ color, focused }) => (
            <View
              className={cn('rounded-full p-2', focused ? 'bg-[#7bed9a]/20' : 'bg-transparent')}>
              <Icon as={MapIcon} size={24} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="danger-area"
        options={{
          title: 'Danger Area',
          tabBarIcon: ({ color, focused }) => (
            <View
              className={cn('rounded-full p-2', focused ? 'bg-[#7bed9a]/20' : 'bg-transparent')}>
              <Icon as={AlertTriangleIcon} size={24} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
